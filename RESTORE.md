# Restoring the database

Every night GitHub Actions takes an encrypted copy of the production database
(**Actions → Nightly database backup**). Each copy is kept 90 days.

**You need the backup passphrase.** It is the only thing that can open a
backup. It lives in your password manager (it was shown once, on 2026-11-16).
Without it the backups cannot be read by anyone.

## In five steps

1. Install the tools once: `brew install gnupg postgresql@17`
2. GitHub → **Actions** → **Nightly database backup** → a green run → download
   the `swiftcard-db-YYYY-MM-DD` artifact at the bottom, and unzip it.
3. Open it (asks for the passphrase):
   `gpg --decrypt --output backup.tar swiftcard-db-YYYY-MM-DD.tar.gpg && mkdir backup && tar -xf backup.tar -C backup`
4. **Getting back a few rows** (the usual case) — load it into a scratch
   database on your Mac, never straight into production:
   `createdb swiftcard_restore && pg_restore --no-owner --no-privileges -d swiftcard_restore backup/public.dump`
   then copy out what you need.
5. **Rebuilding everything** in a new Supabase project: follow
   [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md#2b-rebuild-everything-in-a-new-supabase-project-disaster).

Not in the backup: uploaded pictures (they live in Supabase Storage) and the
Supabase Vault secrets. Details, and what each file inside holds, are in
[docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md).

## How the backup connects

It signs in as `swiftcard_backup`, a read-only database role made for it
(it can read every table and change nothing), through Supabase's session
pooler. That connection string is the `SUPABASE_DB_URL` Actions secret; the
passphrase is `BACKUP_PASSPHRASE`. If the role's password is ever changed,
update that secret.
