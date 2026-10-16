# Knowledge review log

`npm run kb:check` reports every user-facing change since the last commit that
touched `src/lib/knowledge/`. That works while docs need editing — but a review
that concludes "nothing to change here" would leave the report stale forever,
and the next person would re-read the same diffs.

So a no-change review is recorded here. Adding a line touches the knowledge base,
which is exactly what `kb:check` measures from, and it leaves a reason behind for
whoever reads the same commits next.

One line per review, newest last.

---

- **2026-08-15 · up to `3a4c611`** — Homepage hero replaced (recipient's phone in
  a browser instead of the two-iPhones photo), hero subhead rewritten, template
  gallery phone relabelled "What they see — in their browser", and the "no app"
  claims across `/products/*` and `/testimonials` reworded to name the subject.
  **No doc change needed:** `no-app-needed` in `docs/product.ts` already states
  the fact correctly and the assistants never described the hero image. Nothing
  moved, was renamed, or changed plan.

- **2026-08-17 · up to the revert of `3a4c611`** — The change above was reverted
  in full at the owner's request: it pushed the "they install nothing" point
  harder than intended. The hero photo, hero subhead, the four-bullet list, the
  "01 Share in one tap" copy, the wallet-section line, the `/products/*` and
  `/testimonials` wording, and the template gallery's "Scroll on phone to view"
  label are all back to their pre-`3a4c611` text. **Still no doc change needed,**
  for the same reason as above — and the docs never described either version of
  the hero, so they were correct before, during, and after.

- **2026-08-19 · up to `7207811`** — Marketing mockups caught up to the shipped
  card page (numbered badges removed, ambient accent wash, real lead form, QR
  button dropped) and to Swift Links (Nebula-pinned phone with section headers
  and styled icon chips); pricing/plan bullets rewritten to what actually ships
  (Looks in "Social design", "No SwiftCard promos" instead of "no branding
  anywhere"); legacy `/card/` URLs replaced with root everywhere they were
  still emitted (.vcf download, iOS widget, /preview iframes, share button).
  **Doc changes made in the same pass:** `marketing-site.ts` gained the
  homepage claim-box entry point, the fuller footer description, and dropped
  the hardcoded template count. Everything else the mockup work touched is
  visual-only and already documented correctly (`product.ts` was current on
  Looks, headers, icon styling, and root URLs).

- **2026-09-02 · up to `e7a2f30`** — Swift Links hero-blend passes (`db8ffcd`,
  `e7a2f30`) are visual-only: the photo/logo header now washes into the sheet
  with no visible seam; no behavior, plan line, or user-facing wording
  changed. Signup-nudge commit `5dfb9b9` restyled the popup and changed its
  frequency to once ever per moment per browser — a marketing popup the KB
  deliberately doesn't document (support never needs to explain its cadence;
  the existing "signed-in users are never shown join-free invites" behavior
  is unchanged). Agent Flow (`de0769c`) is the owner-only /admin console —
  never customer-facing, nothing for the assistants to know. Earlier same-day
  user-facing changes (bolt badge + promo sheet, Free-only footer, Upload
  photo header option, tour-banner timing, Link buttons note) all landed with
  their KB updates in their own commits.

- **2026-09-03 · up to `eb1f7d4`** — Nothing customer-facing. `c6653a9` (push
  "notifications are off" copy naming the iPhone path) landed with its own KB
  update. Everything else this day is the owner-only /admin Agent Flow console
  and its plumbing: the always-on watchdog loop (Finn/Bo/Vera/Dash lose their
  schedules), catch-up dispatch, Atlas's two daily reports, the durable
  `error_events` sink, the shared `media_assets` creative pool, Jake gaining a
  page-writing step, and the new paid-ads agent (Addy) — all draft-only and
  never customer-facing. The one thing that WILL become user-visible is the
  pages Jake drafts, but those publish as ordinary /blog content through the
  existing owner-approval gate; the assistants already know how to talk about
  the blog, and no feature, price, plan, label or flow changed.

- **2026-09-04 · up to `638d584`** — `ContactsClient.tsx` changed, but nothing a
  user should be TOLD changed. The automation panel still shows "Sends <date>"
  and "Sent <date>" in exactly those words; the fix is that the scheduled date
  is now derived from the daily run (18:00 UTC) instead of the raw due instant,
  so an automation set up late in the evening no longer displays every step a
  day early. `automations.ts › when-follow-ups-send` already says sends are
  processed once a day and that the times beside each cadence describe the
  shape of the schedule rather than the minute a message leaves — both still
  true, and both now match what the screen shows. No page, button, label, plan
  line or step count moved.

- **2026-09-16 · up to `d82b2f7`** — Three commits since the last knowledge
  touch. `adff301` was a performance audit: Sentry moved to a dynamic import,
  `AccountIsolationGuard` now tests for the session cookie before loading the
  Supabase SDK, and `/links/[username]` reads the same cached loader the card
  page already used. `6664b26` and `d82b2f7` changed `scripts/qa-prod-probe.mjs`
  and `tests/monitoring-wiring.test.ts`. **No doc change needed for those
  three:** the performance work states in its own message that no behaviour was
  traded, and nothing about it is visible to a person using the product — no
  page, tab, button, step or plan moved. The probe and its test are internal
  tooling the assistants never describe.

  **A doc change WAS needed for `05e6e16`,** made in this pass: the plan step's
  Pro button used to read "Start free →" beside the Free plan's own "free"
  button, and a guest who had chosen Free tapped it and landed on a trial
  they had declined (owner report, 2026-09-15). Both labels are now bound to
  what they do. `marketing-site.ts` had been telling the assistants that picking
  Free means clicking "Start free →" — which was the *Pro* button's old label,
  so the one doc sentence a confused customer would have been answered with
  pointed at the exact button that charged them. It now names
  "Continue with Free →" and says plainly what the Pro button beside it does.

- **2026-10-16 · up to `b9bc511f`** — Two commits of the owner's Apple-style
  restyle (`51cc514b`, `b9bc511f`) plus the earlier `0736ea6d` (link-preview
  stand-in artwork). **No doc change needed.** The restyle is paint only, by
  the owner's rule: every page, tab, button, label, step and plan line is where
  it was and says what it said — semantic colours, the San Francisco / Inter
  typeface, glass bars, capsule buttons and filled fields replaced the cream
  theme and outlined controls. Nothing a user is told about navigating the
  product changed; the docs name buttons by their labels, and none moved.
