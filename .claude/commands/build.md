---
description: Build Card Builder drafts. One card now, a batch now, or a batch overnight. Usage - /build now <office or person, city> · /build now <area, type, count> · /build tonight <area, type, count>
argument-hint: now <office or person, city> | now <area, type, count> | tonight <area, type, count>
---

Card Builder: **$ARGUMENTS**

The first word says when, the rest says what. Everything this makes is a
**draft only staff can see. Do not publish anything and do not send anything
to anyone.**

## Which one is it

| The owner typed | Do this |
|---|---|
| `now` + **one** office, person, link or notes (no count at the end) | Follow `.claude/commands/build-card.md` with the rest as its input. |
| `now` + an area, a type and a **count** ("Brooklyn, brokerages, 10") | Follow `.claude/commands/build-batch.md` with the rest as its input and `"kind": "now"`. |
| `now` with nothing after it | Follow `.claude/commands/build-batch.md` with no area: build everything in the owner's Queue. |
| `tonight` + an area, a type and a count, or nothing | The same batch, `"kind": "tonight"`, run as below. |

Telling one prospect from a batch: a batch ends in a number and names a place
and a kind of office, not a person or a firm. "Harbor Realty Group, Brooklyn"
is one card. "Brooklyn, independent brokerages, 25" is a batch. If it really
could be either, treat it as one card: that is the smaller mistake.

## `tonight`

It means: start now, run with nobody watching, and have the drafts waiting in
Approve by 8am. There is no separate overnight machine: **this session is
what does the work**, on this computer, which has the keys the tool needs. So:

1. Before anything else, keep the computer awake for the run:
   `caffeinate -dims -t 36000 &` (ten hours; it ends by itself).
2. Say one line to the owner, then start: "Building overnight. Leave this
   window open and the Mac plugged in; closing the lid is fine only if it is
   set not to sleep on power. You'll get one push at 8am."
3. Follow `.claude/commands/build-batch.md` with `"kind": "tonight"`: the
   Queue first, then the area. Its unattended rules are the whole point here:
   **never ask a question**, save each draft as it is done, skip and log
   failures, and `batch-finish` at the end whatever happened.
4. The push is held until 8am New York time by the app. Don't try to send one.
5. If this session is interrupted (the Mac slept, the window was closed), the
   owner types the same `/build tonight …` again and it resumes: `batch-start`
   returns what was already done.

The reply at the end is the batch's summary table, as `build-batch.md` says.
