# Audit 01 — Dead, duplicate, legacy, unfinished code

Repo: relationship-app (SwiftCard). Read-only audit, 2026-10-12. Findings appended incrementally.
Note: worktree has uncommitted changes from another session (see git status at top of session); ignored except where noted.

## A. Dead code in src (zero-importer analysis)

Method: single-pass index of every `from '...'`/`import('...')`/`require('...')` specifier across src/, scripts/, tests/ (1,000+ files), matched against each of the 549 modules under src/components and src/lib by exact basename. Result: 4 modules with zero importers in src/scripts.

### DD-01 `AddSeatButton.tsx` is dead since 2026-07-14 but kept maintained
- Severity: Low
- Platform: all (web)
- Account type/plan affected: Office admins (would-be)
- Feature/page: Office admin > Team > add seat
- File/component/function: src/components/AddSeatButton.tsx (131 lines)
- Problem: Nothing imports it (0 importers in src/scripts/tests). Its last consumer was replaced by the inline "+ Add team member" modal in commit 3a409ba9 (2026-07-14, "Office admin rebuilt for non-technical owners"). Yet it has been touched twice since (a6cbdf77 lint, 4ba06444 accessibility) — maintenance effort on dead UI. It still POSTs to `/api/stripe/subscription/seats` (live route), so if someone re-imports it they re-open a second seat-purchase path that bypasses the modal's wording/confirm.
- Expected behavior: Dead component deleted (no test reads it).
- Actual behavior: 131 lines of orphaned billing UI shipped in the repo (tree-shaken from bundle, so no user impact).
- How to reproduce: `grep -rn AddSeatButton src scripts tests` -> only the file itself.
- Likely cause: Office admin rebuild replaced it without deleting it.
- User impact: none at runtime; maintenance confusion.
- Confidence: Confirmed

### DD-02 `HeroPhone.tsx` — self-declared SUPERSEDED component kept alive only by a test
- Severity: Low
- Platform: web (marketing)
- Account type/plan affected: n/a
- Feature/page: landing hero
- File/component/function: src/components/HeroPhone.tsx (222 lines; header comment "SUPERSEDED — do not copy this phone shell. Nothing imports this component.")
- Problem: The real phone is components/PhoneFrame.tsx. HeroPhone is kept because tests/landing-content.test.ts:41-46 reads public/demo/avatar.svg and asserts it's an illustration. The component was still edited on 2026-09-10 (8d1c1dba, 4b5836bd) — i.e. design work landed on a dead file.
- Expected behavior: Move the avatar assertion to a test that doesn't depend on HeroPhone; delete HeroPhone. `/demo/avatar.svg` IS still used by tests/render/card-detail-fill + card-fit-sweep as a fixture, so the SVG itself should stay.
- Actual behavior: Dead 222-line component carrying an obsolete second iPhone shell design.
- How to reproduce: `grep -rn HeroPhone src` -> only the file.
- Likely cause: Documented in file header; deliberate deferral.
- User impact: none.
- Confidence: Confirmed

### DD-03 `Skeleton.tsx` (SkeletonBlockLight) — zero consumers
- Severity: Low
- Platform: web
- Account type/plan affected: n/a
- Feature/page: loading states
- File/component/function: src/components/Skeleton.tsx (8 lines; exports SkeletonBlockLight only)
- Problem: Header says "Shared pulsing skeleton block for loading.tsx files — dark-theme variant and light-theme variant", but the dark variant was removed (36830881, 2026-09-28 perf audit) and no loading.tsx imports SkeletonBlockLight; every loading.tsx uses PickerSkeleton or inline markup.
- Expected behavior: delete, or use it.
- Actual behavior: Orphan file with a comment describing an export that no longer exists.
- How to reproduce: `grep -rn SkeletonBlock src` -> only Skeleton.tsx.
- Likely cause: perf-audit commit halved the file without checking the remaining export's consumers.
- User impact: none.
- Confidence: Confirmed

### DD-04 `lib/office-attention.ts` — logic with no UI since 2026-07-27, kept only for its unit test
- Severity: Low
- Platform: web
- Account type/plan affected: Office
- Feature/page: Office admin "Needs attention" panel (removed)
- File/component/function: src/lib/office-attention.ts (119 lines); test tests/office-team-metrics.test.ts imports it
- Problem: Commit 91bc15b6 (2026-07-27 "dead code") deleted components/office/AttentionList.tsx (the only consumer) and explicitly kept lib/office-attention "because real tests read or import them; deleting them [would break tests]". So the repo keeps and tests a rules engine (invite_expired / card_incomplete / member_idle / empty_seat / lead_uncontacted) that no user can ever see. Test suite is testing dead logic and giving false coverage.
- Expected behavior: Either wire it back into Office admin (the rules are product-relevant: "an empty paid seat ... burning cash right now") or delete lib + its test block.
- Actual behavior: Dead module + test maintained for 2.5 months.
- How to reproduce: `grep -rn office-attention src` -> no hits outside the file.
- Likely cause: commit message of 91bc15b6 — tests blocked the deletion and nobody followed up.
- User impact: Office owners don't get the "needs attention" nudges the code was written to give.
- Confidence: Confirmed

## B. Retired / compatibility / legacy surfaces

### DD-05 `/api/views/[username]` retired endpoint is still public and still a POST sink
- Severity: Low
- Platform: web/API
- Account type/plan affected: all card owners
- Feature/page: analytics ingest
- File/component/function: src/app/api/views/[username]/route.ts (POST), src/lib/ingest-log.ts:52
- Problem: Retired 2026-09-18 (writes nothing, logs `reason: "retired_endpoint"`). No caller remains in src/, public/, ios/, android/, capacitor-shell/ (only comments and scripts/qa-prod-probe.mjs:72 mention it). It still answers 200 `{ok:true, retired:true}` to any unauthenticated POST and writes one `analytics_ingest_log` row per hit — i.e. an open, un-rate-limited log writer. Keeping it "so any page still open from before the tracker changed does not see an error" was reasonable for a few days; 3+ weeks later no browser tab from Sept 18 is still open.
- Expected behavior: Delete the route (404) or keep it but stop logging; also drop the `api_views_retired` classification in ingest-log.ts.
- Actual behavior: Dead endpoint remains a write path into a production table.
- How to reproduce: `curl -X POST https://swiftcard.me/api/views/anything` -> 200 + a log row.
- Likely cause: deliberate soft-retirement never hardened.
- User impact: none directly; log noise / junk rows if scripted.
- Confidence: Confirmed (code); production row count not checked.

### DD-06 Legacy `/card/[username]` redirect + `/signup` + `/settings` redirects — intentional, keep
- Severity: Low (informational)
- Platform: web
- Account type/plan affected: all
- File/component/function: src/app/card/[username]/page.tsx, next.config.ts:56-100
- Problem: These are documented compat shims (printed NFC tags/Wallet passes hold /card/<u>; /signup is "the most guessed URL"). Not dead — must stay. Only note: `src/app/card/[username]/opengraph-image.tsx` sibling is deliberately a non-redirect; make sure any future og-image change is applied to both /[username] and /card/[username] (duplicate surface by design).
- Confidence: Confirmed

### DD-07 Legacy `STRIPE_PRICE_ID` fallback still wired into checkout, subscription mapping and promo-codes
- Severity: Medium
- Platform: web (Stripe)
- Account type/plan affected: Pro monthly buyers
- Feature/page: /upgrade checkout, webhook plan mapping, admin promo codes
- File/component/function: src/app/api/stripe/checkout/route.ts:25,38,117; src/lib/subscription.ts:25; src/app/api/admin/promo-codes/route.ts:19; .env.example:168; ENV_KEYS_NEEDED.md:115; STRIPE_TWILIO_SETUP.md:47
- Problem: STRIPE_TWILIO_SETUP.md:47 says the legacy fallback "was also" removed/retired, yet 5 code sites still read `process.env.STRIPE_PRICE_ID`; checkout/route.ts:117 uses it with a non-null assertion (`priceId = process.env.STRIPE_PRICE_ID!`) as the monthly price when NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID is unset — which would send `undefined` to Stripe. Two env vars for one price is exactly the "wrong price accidentally selected again" scenario the doc warns about.
- Expected behavior: one price-id source (`NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID`), legacy var deleted from code, .env.example and docs.
- Actual behavior: Dual-source price id; doc claims removal that didn't happen.
- How to reproduce: grep STRIPE_PRICE_ID src.
- Likely cause: cleanup documented before being done.
- User impact: Low today (prod has the NEXT_PUBLIC var); a misconfigured env could silently sell the wrong price.
- Confidence: Confirmed

### DD-08 `lib/external-purchase.ts` — superseded purchase path still live on iOS
- Severity: Medium
- Platform: iOS app
- Account type/plan affected: Free users in the iOS shell (US storefront)
- Feature/page: Settings > Billing, Plan cards, Office Team actions
- File/component/function: src/lib/external-purchase.ts (canOfferExternalPurchase, openExternalPurchase); consumers src/components/BillingManager.tsx:13, PlanCards.tsx:12, office/TeamActions.tsx:6, NativeAppBridge.tsx:134,375; src/lib/iap.ts:5-10
- Problem: iap.ts's header states the link-out remedy "was implemented (see external-purchase.ts) and REJECTED anyway" by App Review under 3.1.3(b); Pro is now a RevenueCat IAP. Yet `canOfferExternalPurchase()` still returns true on iOS whenever the native ExternalPurchase plugin is present, and three components still render the "buy on the website" button through it. Two parallel purchase paths exist in the iOS build — one Apple already rejected. (NativePaywall.tsx:48 comment says the link "is deliberately absent from this build", which contradicts the other three consumers.)
- Expected behavior: One purchase path on iOS (IAP). external-purchase.ts either deleted or reduced to the `openLinkInDefaultBrowser` helper NativeAppBridge needs.
- Actual behavior: Dual, contradictory paths; which one a user sees depends on which component they land on.
- How to reproduce: Read the four consumer files; run tests/aasa-card-links.test.ts (it reads external-purchase.ts as a string).
- Likely cause: IAP added on top instead of replacing.
- User impact: Possible App Review rejection on the next native build; inconsistent upgrade UX in the app.
- Confidence: Confirmed (code); whether current TestFlight build shows both buttons: Unable to Verify (needs Mac).

### DD-09 HubSpot OAuth env vars (`HUBSPOT_CLIENT_ID/SECRET`) are dead configuration
- Severity: Low
- Platform: web
- Account type/plan affected: Pro/Office with CRM
- Feature/page: Settings > Integrations > HubSpot
- File/component/function: src/lib/sync-hubspot.ts:21-22; src/app/api/integrations/hubspot/token/route.ts:9-14; ENV_KEYS_NEEDED.md:195
- Problem: token/route.ts documents that HubSpot connects via a pasted Private App token because HubSpot's public-app OAuth creation "is currently disabled"; there is no OAuth start/callback route for HubSpot (only DELETE and token POST). sync-hubspot.ts still passes clientId/clientSecret to the refresh path, which can never run for Private App tokens (expires_at null). ENV_KEYS_NEEDED.md:195 still tells the operator "Unset = the Connect button can't complete" — false.
- Expected behavior: Remove the refresh config + env vars, fix the doc.
- Actual behavior: Dead env requirement; misleading operator doc.
- Confidence: Confirmed

### DD-10 LinkedIn import libs are env-gated, not dead (informational)
- Severity: Low (informational)
- File/component/function: src/lib/sync-linkedin.ts (isLinkedInEnabled), src/lib/linkedin-photo.ts; consumers api/integrations/linkedin/{connect,callback,route}.ts, components/ProfilePhotoSuggest.tsx, cards/new, cards/[id]/edit, profile, landing page
- Problem: Not dead. Gated on LINKEDIN_CLIENT_ID+SECRET; 6 live importers. Header says "nothing here is claimed to be operational" which is stale relative to the 2026-09-30 photo-sharpening work (linkedin-photo.ts) — the feature clearly ships. Only the comment is stale.
- Confidence: Confirmed

## C. Debug code, root clutter, stale docs

### DD-11 `IapProbe` — debug component shipped in the dashboard bundle (gated to one email)
- Severity: Low
- Platform: iOS app / web
- Account type/plan affected: only iap-test@swiftcard.me renders it
- Feature/page: /dashboard
- File/component/function: src/components/IapProbe.tsx; mounted at src/app/dashboard/page.tsx:839 (`user.email?.toLowerCase() === "iap-test@swiftcard.me" && <IapProbe />`)
- Problem: A simulator diagnostic is compiled into the production dashboard client bundle for every user (the import at dashboard/page.tsx:31 is static; only the render is gated). It console.logs and POSTs to /api/client-error. Gate is an email-string compare in a server component, so it's safe, but it is debug tooling living in product code with a hardcoded test-account email.
- Expected behavior: Dynamic `import()` behind the gate, or move to a scripts/ harness.
- Actual behavior: Shipped (tree-shaking can't drop it since the import is unconditional).
- Confidence: Confirmed

### DD-12 Stray `console.log` in production server/lib code
- Severity: Low
- File/component/function: src/app/api/design-transfer/route.ts:250, src/lib/card-flatten.ts:280, src/components/IapProbe.tsx:40
- Problem: Only 3 console.log sites in src (good hygiene overall). design-transfer:250 logs the user id + pipeline summary on every call; card-flatten:280 logs 160 chars of model JSON. Neither goes through the structured logger others use (`logIngest`, client-error). Both are the Gemini "design transfer" feature that HANDOFF.md says is blocked on a free-tier Gemini key.
- Expected behavior: route through the app's logger or remove.
- Confidence: Confirmed

### DD-13 Root folder literally named `undefined/` with 47 committed PNGs (2.9 MB)
- Severity: Medium
- Platform: repo
- File/component/function: undefined/*.png (47 files, all tracked), committed in 5807ac85 (2026-08-07 "Rebuild the Logo First card against real logos")
- Problem: A render script was run with an unset output-dir variable (`OUT`/`out` resolving to the string "undefined") and the resulting screenshots (adv-pop-square-logo-INFLIGHT.png, adv-t1-transparent-on-gradient.png, ...) were committed alongside LogoFirst.tsx. Nothing in src/scripts/tests references any of the filenames. The directory name itself is a tell that this was never intended.
- Expected behavior: `git rm -r undefined/` and add `undefined/` to .gitignore (the `git add -A` guard in AGENTS.md was written after this).
- Actual behavior: 2.9 MB of junk in every clone; the public repo shows a folder named "undefined".
- How to reproduce: `git ls-files undefined | wc -l` -> 47.
- Likely cause: scripts/appstore-*.mjs style `process.env.OUT || default` pattern in a since-deleted ad-hoc script, run with an interpolated undefined.
- Confidence: Confirmed

### DD-14 `audit-results/` — a July 2026 one-off audit report committed to the product repo
- Severity: Low
- File/component/function: audit-results/full-platform-overnight-repair/* (12 files incl. a 375px screenshot), last commit e129bacf 2026-07-15
- Problem: Point-in-time findings (security, stripe, office, performance, "unresolved-items") from 3 months ago; everything actionable in it has either been fixed or superseded by tests/ui-review-*, tests/perf-audit-* pins. Nothing references it. It gives a reader a false picture of current state.
- Expected behavior: move to docs/archive or delete.
- Confidence: Confirmed

### DD-15 `qa-sweep-out/` (36 MB) and `qa-offline-out/` — local QA output sitting at repo root
- Severity: Low
- File/component/function: qa-sweep-out/flyer (ignored via .gitignore, 0 tracked, 36 MB on disk); qa-offline-out/ (untracked, NOT in .gitignore — another session's new output dir)
- Problem: qa-sweep-out is correctly ignored but is being used as a scratch dir for flyer work unrelated to the QA sweep script (see memory "flyer source drift"). qa-offline-out/ is a new output dir that is not ignored — the exact pattern .gitignore's own comment warns about ("one broad git add -A from committing QA junk").
- Expected behavior: add `qa-offline-out/` (or a `qa-*-out/` glob) to .gitignore.
- Confidence: Confirmed (qa-offline-out appears in `git status` as untracked)
- **Lead-auditor correction:** the `qa-offline-out/` folder was created by this audit's own run of `scripts/qa-offline.mjs` on 2026-10-12 and has been removed. The underlying point stands: `qa-offline.mjs` defaults its output to `qa-offline-out/` at the repo root (line 28) and that path is not in `.gitignore`, so any run leaves untracked output where `git add -A` would pick it up.

### DD-16 `tsconfig.tsbuildinfo` — not tracked (OK)
- Severity: Low (informational)
- Problem: Lead asked whether it is tracked. `git ls-files tsconfig.tsbuildinfo` is empty; `*.tsbuildinfo` is in .gitignore. 700 KB on disk only. No action.
- Confidence: Confirmed

### DD-17 Four root docs still describe the product as "Swisscard" and list as planned things that shipped months ago
- Severity: Medium
- Platform: repo/docs (operator + onboarding of new sessions/agents)
- File/component/function: NEXT_STEPS.md (last commit 2026-06-24), TASK_LOG.md (2026-06-24), PROJECT_CONTEXT.md (2026-09-29 but title/intro still "Swisscard"), ENV_KEYS_NEEDED.md (title "Swisscard")
- Problem (verified against code):
  - NEXT_STEPS.md items #1-#10 are all done: Resend/Stripe/Twilio are wired (STRIPE_TWILIO_SETUP.md, src/app/api/stripe/*, lib/sms*), promo-code UI exists (NewCardWizard `?promo=`), lead form has phone required (LeadCaptureForm.tsx:169 "Your phone number (required)"), multi-card editor exists, admin broadcast exists.
  - PROJECT_CONTEXT.md "Planned Features (not yet built)" lists 6 items that are all built (viewed_card notifications: api/card-events/route.ts:251,278; promo UI; phone-required; Stripe/Twilio). "Card Templates (5 total)" — there are 9 templates (ClassicPro, CustomCard, LocalBusiness, LogoFirst, LuxuryMinimal, MiniQR, ModernBold, PanelVideo, PhotoFirst). "Database Tables" lists ~12 tables; supabase/ creates 60+.
  - HANDOFF.md (2026-08-13) "STILL OPEN — viewed_card notifications DON'T EXIST" — they do now (card-events route branches on viewed_card at :251 and :278). "App Store 1.0.0 still WAITING_FOR_REVIEW" — 1.0.4 went live 2026-09-29 (memory). Items 1 (Twilio A2P), 4 (Google branding), 5 (parked decisions) have unknown current status.
  - README.md is the untouched create-next-app template plus "Auto-push test from ThinkPad".
  - MONITORING.md (2026-07-31) describes a Sentry/watchdog setup "Nothing in here is active until you add the secrets" — AGENTS.md says the deploy watchdog was found disabled by hand on 2026-08-17; MONITORING.md doesn't mention this.
- Expected behavior: Delete NEXT_STEPS.md and TASK_LOG.md (fully superseded); rewrite PROJECT_CONTEXT.md or delete it in favour of AGENTS.md; refresh HANDOFF.md or delete; README gets a real 20-line project README. Agents are told by CLAUDE.md to read AGENTS.md, but any session that opens PROJECT_CONTEXT.md gets a wrong product name, wrong template count and a list of "unbuilt" features that exist.
- Actual behavior: 4 misleading docs, 2 of them 3.5 months stale.
- Confidence: Confirmed

### DD-18 `REFERRAL_SETUP.sql` at repo root while every other SQL lives in supabase/
- Severity: Low
- File/component/function: REFERRAL_SETUP.sql (last commit 2026-06-30); referral code used by src/lib/account-purge.ts, campaign-links.ts, card-active.ts
- Problem: The referral tables are live, but their DDL is the only SQL outside supabase/, so anyone rebuilding the schema from supabase/ misses it.
- Expected behavior: move into supabase/ (and into the migration map, see section E).
- Confidence: Confirmed

