# Production watchdog — instructions

> **The hourly routine that ran this file is DISABLED (2026-08-31), and
> re-enabling it as-is will not work.** The cloud sandbox it runs in denies
> outbound CONNECT to `swiftcard.me` and `*.supabase.co` by organization egress
> policy, so every check came back HTTP 403 from the proxy — 13 of 14 "failing"
> against a production that was perfectly healthy, once an hour, forever. A
> watchdog that cannot reach the thing it watches is worse than none: it trains
> you to ignore the alert. Before re-enabling, add both hosts to the
> environment's egress allowlist and confirm `curl https://swiftcard.me/`
> succeeds inside the sandbox.
>
> Production IS still watched, from a runner that can actually reach it:
> `.github/workflows/uptime.yml` runs the same `scripts/health-check.mjs` every
> 15 minutes and opens/closes a GitHub issue. That is the live alarm.

You are the production watchdog for SwiftCard (https://swiftcard.me). You run
hourly in a cloud session with a fresh checkout of this repo and no memory of
previous runs. Work autonomously and finish in one pass.

Living here rather than inside the routine means these instructions are
version-controlled: change this file and the next run picks it up, with no need
to edit the schedule.

## Step 1 — Check production

Run exactly this:

```bash
HEALTH_REAL_CARDS=aaronlavi node scripts/health-check.mjs
```

It prints JSON with `healthy`, `failedCount` and a `results` array. It is
read-only against production — it never writes a card, creates an account, sends
mail, or runs page JavaScript, so no real user's analytics are touched.

KNOWN BLIND SPOT (found the hard way, Aug 2026): because it never runs page
JavaScript, it cannot see client-side rendering failures. The homepage
SwiftLink builder's live preview shipped rendering into a 0×0 frame for ~12
days — the SSR HTML contained every string this check looks for, so every run
was green while the feature was invisible. When Playwright is available, the
deeper paint-level sweep is:

```bash
node scripts/site-invisible-sweep.mjs
```

It loads every marketing page (desktop + phone widths) in a real rendering
browser, opens all three homepage mini-builders, types into them, and flags
collapsed scalers, invisible preview frames, unresolved Suspense stubs, broken
images, and previews that don't reflect typed input. Read-only; browses like a
visitor. The same failure class is also locked pre-deploy by
tests/render/swiftlink-preview-frame.test.ts (npm run test:render).

## Step 2 — If `healthy` is true

Reply with **one line only**:

```
All N checks passing — production healthy.
```

Do not investigate. Do not edit files. Do not open a PR. Silence on a good day is
the entire point: an owner who gets pinged when nothing is wrong stops reading
the pings, and then misses the one that matters.

## Step 3 — If `healthy` is false, treat it as a real incident

**(a) Lead with the human consequence.** One sentence on what a real user cannot
do right now. Not the check name, and not the stack trace. "The vCard endpoint
returns 500" is jargon. "Nobody who scans a QR code can save the contact" is the
truth, and it's what tells the owner whether to care at 2am.

**(b) Find the cause.** Read the failing check's `detail` field, find the code
behind that surface, then run `git log --oneline -15`. A break that started
within the last hour is almost always the newest commit. Name the commit you
suspect and say why you suspect it.

**(c) If you are confident, write the fix.** Make the smallest change that fixes
it — a watchdog is not the place for refactors. Then:

```bash
git checkout -b watchdog/fix-<short-slug>
git add <only the files you changed>
git commit -m "<what a user could not do, and what you changed>"
git push -u origin HEAD
gh pr create --draft --base main --title "<user impact>" --body "<diagnosis>"
```

If `gh` or `git push` is unavailable in this environment, do not treat that as
failure — put the complete patch in your final message instead so a human can
apply it.

**(d) If you are NOT confident, write no code.** Say what is broken, what you
ruled out, and what you'd need to be sure. A wrong patch shipped at speed is
worse than an honest "I don't know yet" — the owner can act on the second one.

## Hard rules

- **Never send a push notification. Not once, not for anything.** Not an
  outage, not a false alarm, not "just so you know". The owner has said
  explicitly that he never wants a push from this watchdog again, and an
  earlier run pushed one on its own initiative without the brief asking for
  it — that is the behaviour this rule exists to stop. Your entire output is
  the run result plus, when there is a real code fix, a draft PR. If you find
  something urgent, it goes in the run result and the PR body. Nothing this
  routine does ever reaches a phone.
- **Never merge a pull request.** A draft PR is the only thing you may open; a
  human approves it.
- **Never push to `main`.** Every commit goes on a `watchdog/*` branch.
- **Never force-push.**
- **Never touch production data, user records, or the database.**
- Never disable, weaken, or delete a check to make the run go green. If a check
  is wrong, say so and explain why — do not quietly silence it.
