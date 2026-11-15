# Database backup and restore

Supabase's free plan keeps no backups. `.github/workflows/db-backup.yml` takes
one every night instead.

## What it does

Every night (about 4 am New York) a GitHub Actions job:

1. Connects to the database through Supabase's session pooler and runs
   `pg_dump`. It only reads.
2. Checks the dump is readable and holds the tables it should.
3. Packs it into one file and encrypts it with AES-256 (GnuPG, passphrase).
4. Decrypts it again and compares, so a backup that cannot be opened fails
   that night.
5. Uploads the encrypted file as a workflow artifact kept for 90 days, the
   longest GitHub allows.

If a night fails, one issue titled "Nightly database backup failing" opens
(GitHub emails you) and closes itself after the next good backup.

## The one thing to understand

**This repository is public, so anyone signed in to GitHub can download the
backup file.** The encryption is the only thing between them and every
customer's data.

- Use a long random passphrase (the job refuses anything under 20 characters).
- Keep it in a password manager. If you lose it, every backup is unreadable
  and nobody can recover it. If it leaks, treat every backup from the last 90
  days as public: change the passphrase, delete the old artifacts.

If that trade is not acceptable, the alternative is to send the same
encrypted file to a private bucket (Cloudflare R2, Backblaze B2 or S3)
instead of a GitHub artifact. The dump and encryption steps stay the same.

## Secrets to add

GitHub -> the repository -> Settings -> Secrets and variables -> Actions ->
New repository secret.

| Secret | Value |
|---|---|
| `SUPABASE_DB_URL` | Supabase dashboard -> **Connect** (top bar) -> **Session pooler** -> copy the URI and replace `[YOUR-PASSWORD]` with the database password. It looks like `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. It must be the session pooler on port 5432: the direct address is IPv6-only and GitHub cannot reach it, and the transaction pooler (port 6543) cannot run `pg_dump`. If the password contains `@ : / ? #` or spaces, percent-encode them. Forgotten the password: Supabase -> Project Settings -> Database -> Reset database password (then update this secret; the app itself does not use that password). |
| `BACKUP_PASSPHRASE` | A long random passphrase, for example the output of `openssl rand -base64 32`. Save it in your password manager before pasting it into GitHub: GitHub will never show it to you again. |

Then: Actions -> **Nightly database backup** -> **Run workflow**. A green run
with an artifact named `swiftcard-db-YYYY-MM-DD` means it works.

## What is in the file, and what is not

Inside `swiftcard-db-YYYY-MM-DD.tar.gpg`:

| File | Holds |
|---|---|
| `public.dump` | Every app table (cards, contacts, views, offices, billing state, ...): structure and rows. |
| `auth-storage-data.dump` | The rows of Supabase's `auth` schema (accounts, logins) and `storage` schema (the index of uploaded files). Rows only. |
| `cron-jobs.txt` | The list of scheduled database jobs, for reference. |

Not in the backup:

- **Uploaded files** (profile photos, logos, card images). They live in
  Supabase Storage, not the database. The backup has the list of them but not
  the pictures.
- **Supabase Vault secret values** (`clock_secret`, `demo_tick_secret`). Only
  the original project can decrypt them. Re-enter them by hand after a restore
  (`ENV_KEYS_NEEDED.md` says where each lives).
- Database settings made in the dashboard (auth providers, email templates,
  URL configuration).

## Restore

You need `gpg` and the Postgres 17 tools. On a Mac: `brew install gnupg postgresql@17`.

### 1. Get and open the backup

1. GitHub -> Actions -> **Nightly database backup** -> pick a green run ->
   download the artifact at the bottom. Unzip it.
2. Decrypt and unpack (it asks for the passphrase):

   ```bash
   gpg --decrypt --output backup.tar swiftcard-db-YYYY-MM-DD.tar.gpg
   mkdir backup && tar -xf backup.tar -C backup
   ```

3. Look inside before touching any database:

   ```bash
   pg_restore --list backup/public.dump | head -40
   ```

### 2a. Get back one table or a few rows (the common case)

Restore into a scratch database on your own computer and copy out what you
need. This cannot hurt production.

```bash
createdb swiftcard_restore
psql swiftcard_restore -c 'create schema if not exists auth; create schema if not exists extensions;'
pg_restore --no-owner --no-privileges -d swiftcard_restore backup/public.dump
psql swiftcard_restore -c 'select count(*) from leads;'
```

Errors about missing roles, extensions or `auth.users` references are
expected on a plain local Postgres; the table rows still load.

### 2b. Rebuild everything in a new Supabase project (disaster)

1. Create a new Supabase project. Copy its **Session pooler** connection
   string into `NEW_DB`.
2. Restore the app tables, then the accounts and file index:

   ```bash
   NEW_DB='postgresql://postgres.<new-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'

   pg_restore --no-owner --no-privileges --clean --if-exists -d "$NEW_DB" backup/public.dump

   pg_restore --no-owner --no-privileges --data-only --disable-triggers -d "$NEW_DB" backup/auth-storage-data.dump
   ```

   If the second command complains about rows that already exist, the new
   project was not empty; start again from a fresh project.
3. Recreate the scheduled jobs from the files in `supabase/` (the ones that
   call `cron.schedule`), using `backup/cron-jobs.txt` as the checklist, and
   put the Vault secrets back.
4. Point the app at the new project: update `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel,
   the same in GitHub Secrets, then redeploy.
5. Re-do the dashboard settings (auth providers, redirect URLs, email
   templates, storage buckets) and re-upload files if you have them.

Never run `pg_restore --clean` against the live project to "roll back" a
mistake. Restore into a scratch database (2a) and copy the rows across.

## Test it once

A backup nobody has restored is a guess. After the first green run, do steps
1 and 2a once and check a table you know (for example your own card in
`cards`).
