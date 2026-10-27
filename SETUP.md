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

Every tab is created with its headers, dropdowns and colours. A tab you delete
comes back empty at the next sync; a tab you rename is left alone and a fresh
one is created, so don't rename tabs.

How the rows behave:

- **A row you delete stays deleted.** The sync never adds it back. To get
  rid of a row without losing its history, set its Status to Skipped instead.
- **Each agent's own tab is where you edit.** Notes, dates and a reworded
  message are read from there. On Today - Action Queue, Today - Top 50,
  All Leads and Intent Leads only the **Status** is yours; the other columns
  are copies and are rewritten every sync.
- **One Status, every copy.** Set it on the agent's tab or in the Action
  Queue; the other copy follows at the next sync. If both were changed in the
  same 15 minutes, the agent's own tab wins.
- **Sent / Posted and Completed only record what you did.** They never post,
  publish or open a pull request. Approved is the only Status that can make
  something happen (a blog post going live; a Bluesky reply once that is
  switched on, see 6).
- **Controls:** change only the Value column. A change made on the admin
  page shows up in the Sheet at the next sync and is never undone by the old
  value that was in the cell. Last Changed shows when a value last changed.

## 4. The edit hook (three minutes, makes Status changes instant)

Without it, a Status you set is picked up within 15 minutes. With it, seconds.

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
3. In the Sheet, Controls → "Bluesky: how far automation may go" →
   `Approval posts it`.
4. When you are ready for real posts: Controls → "Dry run" → `No`.

Until all four are true, a Bluesky row works like every other one: copy the
reply, open the post, paste.

## 7. Dry run

The whole system ships with Controls → **Dry run = Yes**. Agents research,
draft and fill the Sheet; nothing is published, posted or sent, and no paid
service is charged. Setting a row to Sent / Posted only records that you did
it yourself. Turn Dry run off only after:

- the connections above are set,
- you have read a week of drafts,
- (for email, next release) the outreach domain is warmed up.

## 8. Emergency stop

Any one of these stops every agent at its next step:

- Sheet → Controls → **Pause all agents** → `Yes` (seconds with the hook,
  15 minutes without);
- `/admin/crew` → **Pause all agents**;
- Vercel → `CREW_DISABLED=1` (needs a redeploy; stops the clock entirely).

The Sheet keeps syncing and logging while paused, so your Status changes are
still honoured, and a Pause all set in the Sheet can be lifted in the Sheet.

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
