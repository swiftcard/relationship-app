---
description: Find offices, then build a draft preview card with written outreach for each of the best ones, one after another, unattended, and end with one summary table. Usage - /build-batch <area, type, count>
argument-hint: <area, type, count>   e.g. "Brooklyn, independent brokerages, 5"
---

Build a batch of Card Builder drafts for: **$ARGUMENTS**

Read the three parts as *area*, *type of office* and *how many drafts*. If the
type is missing, look for all three kinds (independent brokerages, agent teams,
mortgage branches). If the count is missing, build 5. **30 at most** in one
batch; asked for more, build 30 and say so.

Everything this makes is a **draft only staff can see. Do not publish
anything and do not send anything to anyone.** The owner approves each one in
admin › Card Builder › Approve and sends every message by hand.

## It runs unattended

The owner starts this and walks away, sometimes for the night.

- **Never ask the owner a question mid-run.** Not which office, not whether to
  continue, not for a missing detail. Decide by the rules here; when a rule
  doesn't cover it, skip that office, log why, and go on.
- **Save each draft as it is done**, and log its outcome at once (below). A
  run that is interrupted loses nothing that was finished.
- **A failure is skipped and logged, never fatal.** A page that won't load, a
  tool error, an office that can't meet the bar: log it as `skipped` or
  `failed` with the reason in a few plain words, and start the next office.
  If the same tool error happens three times in a row on different offices,
  stop, finish the batch (step 5) and say what the error was.
- **Rerunning resumes.** Step 1 hands back what an unfinished run already did.

## Steps

1. **Open the batch.** Write `{ "label": "$ARGUMENTS", "kind": "now", "wanted": <count> }`
   to a file in the scratchpad (`"kind": "tonight"` when `/build tonight`
   started this) and run `node scripts/card-builder.mjs batch-start <file.json>`.
   Keep the `batch_id`. If it says `resumed: true`, every office in
   `already_done` is finished: don't research or build it again, and count the
   built ones toward the count.

2. **The owner's queue comes first.** Run `node scripts/card-builder.mjs queue`.
   Each item is something the owner dropped in from their phone: a name and
   city, a link, or their own notes (`owners_own_notes: true`, whose facts
   count as confirmed by the owner). Build each one exactly as
   `.claude/commands/build-card.md` says, with the item's text as its input
   and `"batch_id"` in the draft's JSON, then settle it right away:
   `node scripts/card-builder.mjs queue-settle <queue id> <file.json>` with
   `{ "outcome": "built", "preview_id": "…", "batch_id": "…" }`, or
   `{ "outcome": "skipped" | "failed", "note": "<why>" }`. Log it to the batch
   too (step 4). Queue items don't count toward the count: the owner asked for
   each of them by name.
   When this command was given **no area** (only the queue is wanted), skip
   step 3.

3. **Find the offices.** Follow `.claude/commands/find-offices.md` from start
   to finish for the same area and type, asking it for **twice the count**
   (some will fall out). That means its rules too: only a buyer, the six
   criteria, the disqualifiers, `card-builder.mjs check` on every candidate,
   `card-builder.mjs fit` and `card-builder.mjs save-leads`. Don't stop to ask
   which one to build: this command builds. Order them best fit first, by the
   score the tool gave, and log at once, as `skipped`, with the reason:
   - anything `check` marked `skip`: already contacted, on the do-not-contact
     list, or already has a preview
   - anything disqualified or refused by `save-leads`
   - anything where you couldn't establish who is in charge

4. **Build a draft for each, one after another, until you have the count.**
   For each office in order, follow `.claude/commands/build-card.md` from
   start to finish, with the office, its decision-maker and its city as the
   input: its own `check`, `warm`, the research, at least 3 verified
   specifics, the hook, `colors`, `create-draft` (pass the `lead_id` as
   `crew_lead_id`, and the `batch_id`), `quality`, `shots` (open and look at
   both pictures), any fixes with `update-draft`, `style`, and the written
   outreach with `set-outreach`.
   - One at a time. Finish one office completely before starting the next, so
     a problem with one never leaves another half-built.
   - **The moment an office is finished or given up on, log it**: write
     `{ "office": "…", "outcome": "built", "preview_id": "…" }` or
     `{ "office": "…", "outcome": "skipped" | "failed", "reason": "…" }` and
     run `node scripts/card-builder.mjs batch-log <batch id> <file.json>`.
     Reasons are for the owner: "already contacted", "on the do-not-contact
     list", "couldn't confirm who is in charge", "fewer than 3 verified
     specifics", "no direct phone or email", "their site wouldn't load".
   - **A draft that can't be finished doesn't count toward the count.** If an
     office can't reach 3 verified specifics, or its decision-maker can't be
     confirmed on a second site, or `create-draft` refuses it, log why and
     move to the next office. Don't pad it and don't lower the bar.
   - If a draft was created but ends up too generic, leave it as a draft, log
     it as `built` (the Approve view shows what it is missing), and build one
     more to replace it.
   - Stop when you have the count, or when the list from step 3 runs out.

5. **Close the batch.** Run `node scripts/card-builder.mjs batch-finish <batch id>`.
   It prints the brief the owner will see at the top of Card Builder: how many
   drafts, best score first, how many were skipped and why. The app then sends
   the owner **one** push (you don't, and can't). Use the brief's numbers in
   the summary, not your memory of them. Always run this, even when the batch
   built nothing or stopped early.

## Reply with

**One summary table**, best score first:

| Office | Decision-maker | Score | Hook | Draft link | Couldn't confirm |
|---|---|---|---|---|---|

- *Office*: its name and kind (brokerage / team / mortgage branch)
- *Decision-maker*: name and role
- *Score*: the personalization score out of 100, and "too generic" if it is
- *Hook*: the fact and, in a few words, what it leads to
- *Draft link*: the draft link the tool returned
- *Couldn't confirm*: what was left blank or marked uncertain; "nothing" if so

Under the table:

- for each draft, **both versions of the first text and the text with the
  link**, word for word (the rest are on its card in the Approve view), and
  its warm path if it has one
- the offices you **left out** and why (already contacted, do-not-contact,
  already has a preview, disqualified, couldn't confirm who is in charge,
  couldn't reach 3 specifics)
- the link to the Approve view: `https://swiftcard.me/admin/card-builder/approve`

End with: every one of these is a draft, nothing is public and nothing has
been sent.
