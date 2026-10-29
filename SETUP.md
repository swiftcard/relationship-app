# SETUP — the SwiftCard Leads sheet

How to connect the Google Sheets headquarters, in order. Each step says what
breaks without it. Secrets go in Vercel (Settings → Environment Variables),
never in the Sheet and never in git.

## 1. Database (one minute)

Run `supabase/crew-sheets.sql` in the Supabase SQL editor (after `crew.sql`
and `crew-office.sql`, which are already applied). Without it the Sheet
features stay quiet and the sync agent says "Run supabase/crew-sheets.sql".
The file is safe to run again: if you ran an earlier copy, run this one too
(it adds the `shown_status` column; until then the sync waits for it).

## 2. Google Cloud (ten minutes, once)

1. In the Google Cloud project that owns the service account in
   `GOOGLE_SHEETS_SA_JSON`, enable the **Google Sheets API** and the **Google
   Drive API** (and the **Google Calendar API** for meetings, later).
2. In Google Workspace, create a **Shared Drive** (Drive → Shared drives → New),
   name it "SwiftCard Leads". Add the service account's email (the
   `client_email` inside `GOOGLE_SHEETS_SA_JSON`) as **Content manager**.
   The service account cannot own files in anyone's My Drive, so this is where
   the workbook and the daily snapshots live.
3. Copy the Shared Drive's id from its URL
   (`drive.google.com/drive/folders/<id>`) into Vercel as `CREW_SHARED_DRIVE_ID`.
4. Put your and Aaron's Google account emails, comma-separated, in
   `CREW_SHEET_SHARE_EMAILS`. Nobody is guessed: empty means nobody is added.

## 3. Create the workbook

Either wait up to 15 minutes for the clock, or run it now. The "Sheet sync"
and "Sheet daily snapshot" agents are always on: they have no Start / Stop,
they keep running through Pause all (they never send anything, and they are
what reads a Pause all you lift in the Sheet), and only `CREW_DISABLED=1`
stops them.

```
node scripts/crew-sheet-setup.mjs
```

It prints the workbook URL. Put the id from that URL
(`docs.google.com/spreadsheets/d/<id>/edit`) in Vercel as `CREW_SHEET_ID`, so
the workbook is pinned even if the database is restored.

Every tab is created with its headers. A tab you delete comes back empty at
the next sync; a tab you rename is left alone and a fresh one is created, so
don't rename tabs.

What's in it (owner, 2026-10-29): one tab per agent, each exactly three
columns, **Name, Message, Link** (a hidden Key column is how the sync finds a
row; leave it hidden), plus **Paste a Post**. No dashboard, queues, pipeline,
stats, Controls or logs; Start, Stop and Pause all are in admin → Agents.

How the rows behave:

- **Copy the message, tap the link, paste, send.** The link is the place the
  message goes: the exact post or comment for a reply, the chat itself for an
  Instagram DM, Reddit's message screen with the message already typed, a new
  email with the message already in it.
- **Then delete the row. A deleted row counts as sent.** The sync records it
  (the person is marked as contacted, so no agent writes to them again) and
  never adds it back.
- **A row that stops waiting comes off by itself:** sent from the admin page,
  skipped, or expired.
- **Reword a message right in the cell** if you like; the agent learns from
  your edits.

## 4. The edit hook (optional, makes a reworded message count in seconds)

Without it, a reworded message is picked up within 15 minutes. With it,
seconds. Deleting a row is always seen by the 15-minute sync.

1. Pick any long random string and set it in Vercel as `CREW_SHEET_HOOK_SECRET`.
2. In the workbook: **Extensions → Apps Script**. Delete the sample code and
   paste `apps-script/SwiftCardLeads.gs`. Save.
3. **Project Settings (gear) → Script Properties → Add**:
   - `HOOK_URL` = `https://swiftcard.me/api/crew/sheet-hook`
   - `HOOK_SECRET` = the same string as `CREW_SHEET_HOOK_SECRET`
4. **Triggers (clock icon) → Add Trigger**: function `onSheetEdit`, event
   source **From spreadsheet**, event type **On edit**. Save and accept the
   permissions (it needs "connect to an external service" to post to swiftcard.me).

That's it. A simple `onEdit` cannot call external services, which is why the
trigger must be installed by hand once.

## 5. Daily snapshots

Automatic once `CREW_SHARED_DRIVE_ID` exists: at 7:30am New York the "Sheet
daily snapshot" agent copies the workbook to
`SwiftCard Leads/Daily/YYYY-MM-DD/` in the Shared Drive and removes folders
older than 90 days. Snapshots inherit the Shared Drive's access; share the
drive, not the files.

## 6. Bluesky (optional, the one platform that can post an approved reply)

1. Bluesky → Settings → App passwords → create one for "SwiftCard agents".
2. Vercel: `BLUESKY_HANDLE` (e.g. `swiftcardapp.bsky.social`) and
   `BLUESKY_APP_PASSWORD`.
3. The "Bluesky: how far automation may go" setting → `Approval posts it`.
4. When you are ready for real posts: the "Dry run" setting → `No`.
   (These settings were on the Sheet's Controls tab, removed 2026-10-29; ask
   for them to be changed until they have a place in admin → Agents.)

Until all four are true, a Bluesky row works like every other one: copy the
reply, open the post, paste.

## 7. Dry run

The whole system ships with **Dry run = Yes**. Agents research,
draft and fill the Sheet; nothing is published, posted or sent, and no paid
service is charged. Setting a row to Sent / Posted only records that you did
it yourself. Turn Dry run off only after:

- the connections above are set,
- you have read a week of drafts,
- (for email, next release) the outreach domain is warmed up.

## 8. Emergency stop

Any one of these stops every agent at its next step:

- `/admin/crew` → **Pause all agents**;
- Vercel → `CREW_DISABLED=1` (needs a redeploy; stops the clock entirely).

The Sheet keeps syncing while paused, so a row you delete is still recorded
as sent.

## 9. Every variable

| Name | Where | What |
|---|---|---|
| `GOOGLE_SHEETS_SA_JSON` | Vercel | The service account key (whole JSON). Already set for the old lead mirror. |
| `CREW_SHARED_DRIVE_ID` | Vercel | The Shared Drive the service account is a Content manager of. |
| `CREW_SHEET_ID` | Vercel | The workbook id, once created. |
| `CREW_SHEET_ID_TEST` | local `.env.local` only | A second workbook for local dry runs; never the live one. |
| `CREW_SHEET_SHARE_EMAILS` | Vercel | The owners' Google accounts, comma-separated. |
| `CREW_SHEET_HOOK_SECRET` | Vercel + Script Properties | The edit hook's bearer token. |
| `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` | Vercel | Optional; approval-triggered Bluesky replies. |

Cold email (domain, SPF/DKIM/DMARC, inbox delegation, warm-up, limits,
unsubscribe) is documented here when it ships (PR 3).
