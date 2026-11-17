# Card Builder on the owner's Mac

Card Builder's batches and its iMessage sending run on the owner's Mac, not on
Vercel: the research is done by Claude Code (no paid API call inside the app),
and the texts go out from the owner's own number through the Messages app.
One small program does both: `scripts/card-builder-mac/agent.mjs`.

## What it does

| Every minute | |
|---|---|
| **Batches** | Picks up a batch made with *Card Builder › New batch* (now, or 11pm for "overnight") and runs `/build-batch batch <id> chunk 10` with Claude Code until the count is reached. Each draft is saved as it is finished, so a run that dies loses nothing. Two runs in a row that build nothing end the batch with a note. |
| **Sending** | Takes one approved opener from `prospect_outbox` when *Card Builder › iMessage sender* allows it (days, hours, daily cap, a random gap of a few minutes), sends it through Messages **on iMessage only**, then reads the Messages database to see whether it went. A number that isn't on iMessage is marked and skipped; it is never sent as SMS on purpose (if the phone falls back to green on its own, that is recorded as sent and the number is marked). |
| **Listening** | A reply of "stop", "remove me", "wrong number"… puts the number on the do-not-contact list and takes anything queued for it back out. |
| **Pop-up** | When a prospect really opens their card (the same open the server texts and pushes about), a window on this screen names them and their company, shows their number, and offers **Call** (FaceTime › Call with iPhone). It stays up for 15 minutes. |
| **Own networks** | Tells the server which networks are the owner's (a hash, never the address), so the preview Messages draws on this Mac, or the owner opening a link at home, never counts as the prospect looking. |

It reads the Supabase keys from `.env.local` and talks to the database, never
to swiftcard.me.

**The research is fenced in.** It reads web pages anyone can write, so a page
could try to give it orders. Each run happens in `~/.swiftcard-card-builder/run`,
a folder holding only copies of the Card Builder commands and the product
docs, with no keys in its environment, none of the owner's own Claude
settings (`--setting-sources project`) and no MCP servers. It may only run
the Card Builder tool (which makes drafts and never sends), read that folder,
search and read the web, and write in its own `work` folder.

**One text per person.** The database allows one live opener per phone
number, not just per card; a number already texted, by the Mac or by hand, is
never queued again; a send that may or may not have gone (the Mac slept
mid-send) blocks the number until the owner checks Messages; the
do-not-contact list is checked by number, email and email domain, at queue
time and again right before sending.

## Set it up (once)

1. Apply `supabase/card-builder-imessage.sql` in the Supabase SQL editor.
2. In a terminal, from the repo: `bash scripts/card-builder-mac/install.sh`.
   It prints which `node` it uses.
3. **System Settings › Privacy & Security › Full Disk Access**: add that
   `node` file (press ⌘⇧G in the file picker and paste the path). This lets the
   agent read whether a text was delivered and whether anyone replied "stop".
   Without it, texts still go, but "not on iMessage" is only caught when
   Messages refuses outright, and stop replies aren't seen.
4. The first send makes macOS ask whether `node` may control **Messages**:
   allow it.
5. Messages must be signed in to the owner's Apple ID with their phone
   number turned on under *Messages › Settings › iMessage › "You can be
   reached by"* and *"Start new conversations from"* set to the phone number,
   so prospects see the owner's number, not an email address.
6. Keep the Mac on and awake during sending hours (it keeps itself awake while
   a batch runs).

Logs: `~/Library/Logs/swiftcard-card-builder.log`.
Stop it for good: `bash scripts/card-builder-mac/install.sh uninstall`.
Try it without sending or building anything: `node scripts/card-builder-mac/agent.mjs --once --dry-run`.

## Things that are true and worth knowing

- **iMessage hides link previews from unknown senders.** A prospect who
  doesn't have the owner's number in their contacts sees "Tap to Load
  Preview" instead of their own face, until they tap it. The opener's words
  have to earn that tap on their own; the picture is the reward.
- **A number that isn't on iMessage** shows once in the owner's Messages as a
  red "Not Delivered" text (that is how the agent finds out). Nothing is
  retried as SMS. Delete it in Messages if it bothers you.
- **An interrupted send is never retried** (the Mac slept mid-send): a double
  text is worse than a missed one. It shows as *Failed: interrupted*.

## Google Voice: the second way to send (2026-11-17)

Some openers go from the owner's Google Voice number instead of iMessage. The
owner sends each one **by hand**: SwiftCard never drives Google Voice (no
browser automation, no scraping, no unofficial API), the same rule as LinkedIn.

- **Per batch:** *New batch › Send with: iMessage (my Mac) or Google Voice*. A
  Google Voice batch's prospects never go into `prospect_outbox`; once approved
  they wait in *Card Builder › Send from Google Voice*.
- **Per prospect:** on Approve, "Send this one from Google Voice instead" (and
  back). Switching to Google Voice takes back anything queued on the Mac.
- **Not on iMessage:** "Send from Google Voice" becomes the main button. Never
  for an office line.
- **The button** copies the opener with its link and opens
  `voice.google.com/u/0/messages?itemId=t.+1…` (the address the web app uses
  for a one-number conversation; not documented by Google) in a new tab. On
  iPhone the same web address: the Google Voice app has no documented "text
  this number" link. The tap records `sent_channel = 'google_voice'`.
- **One text per number** still holds both ways: a number texted from Google
  Voice has its Mac rows canceled and is never queued; a number the Mac texted
  (or that is queued for it) never shows in the Google Voice list.
- **Stop replies** come to Google Voice, where this Mac can't read them: the
  owner taps **They said stop** (Google Voice list or the Call screen), which
  adds `tel:+1…` to the do-not-contact list and cancels anything queued.
- **Daily cap:** *iMessage sender › Google Voice texts a day, at most*
  (default 20). Google can restrict a personal Voice number that texts many
  new people.
- SQL: `supabase/card-builder-google-voice.sql`.
