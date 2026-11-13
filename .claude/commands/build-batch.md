---
description: Find offices, then build a draft preview card with written outreach for each of the best ones, one after another, and end with one summary table. Usage - /build-batch <area, type, count>
argument-hint: <area, type, count>   e.g. "Brooklyn, independent brokerages, 5"
---

Build a batch of Card Builder drafts for: **$ARGUMENTS**

Read the three parts as *area*, *type of office* and *how many drafts*. If the
type is missing, look for all three kinds (independent brokerages, agent teams,
mortgage branches). If the count is missing, build 5.

Everything this makes is a **draft only staff can see. Do not publish
anything and do not send anything to anyone.** The owner approves each one in
admin › Card Builder › Approve and sends every message by hand.

## Steps

1. **Find the offices.** Follow `.claude/commands/find-offices.md` from start
   to finish for the same area and type, asking it for **twice the count**
   (some will fall out). That means its rules too: only a buyer, the six
   criteria, the disqualifiers, `card-builder.mjs check` on every candidate,
   `card-builder.mjs fit` and `card-builder.mjs save-leads`. Don't stop to ask
   which one to build: this command builds.

2. **Order them** best fit first, by the score the tool gave. Leave out, and
   list at the end with the reason:
   - anything `check` marked `skip`: already contacted, on the do-not-contact
     list, or already has a preview
   - anything disqualified or refused by `save-leads`
   - anything where you couldn't establish who is in charge

3. **Build a draft for each, one after another, until you have the count.**
   For each office in order, follow `.claude/commands/build-card.md` from
   start to finish, with the office, its decision-maker and its city as the
   input: its own `check`, the research, at least 3 verified specifics, the
   hook, `colors`, `create-draft` (pass the `lead_id` as `crew_lead_id`),
   `quality`, `shots` (open and look at both pictures), any fixes with
   `update-draft`, and the written outreach with `set-outreach`.
   - One at a time. Finish one office completely before starting the next, so
     a problem with one never leaves another half-built.
   - **A draft that can't be finished doesn't count toward the count.** If an
     office can't reach 3 verified specifics, or its decision-maker can't be
     confirmed on a second site, or `create-draft` refuses it, note why and
     move to the next office. Don't pad it and don't lower the bar.
   - If a draft was created but ends up too generic, leave it as a draft, say
     so in the table, and build one more to replace it.
   - Stop when you have the count, or when the list from step 1 runs out; then
     say how many you built and why you stopped.

4. **Check the batch.** Run `node scripts/card-builder.mjs quality <id>` for
   every draft once more and use those numbers and messages in the summary,
   not your memory of them.

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

- for each draft, **the first text and the text with the link**, word for
  word (the rest are on its card in the Approve view)
- the offices you **left out** and why (already contacted, do-not-contact,
  already has a preview, disqualified, couldn't confirm who is in charge,
  couldn't reach 3 specifics)
- the link to the Approve view: `https://swiftcard.me/admin/card-builder/approve`

End with: every one of these is a draft, nothing is public and nothing has
been sent.
