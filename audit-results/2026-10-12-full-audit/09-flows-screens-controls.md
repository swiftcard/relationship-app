# 09 — User flows, screens and controls audit (READ-ONLY)

Repo: C:\Users\Malve\Desktop\SwiftCard\relationship-app  HEAD: 655a4480 (2026-10-12)
Audited committed HEAD via `git show HEAD:<path>` for files another session has dirty; uncommitted diff noted separately in Appendix F.
Findings appended incrementally as confirmed.

## Findings

## Appendix E — Local test-failure diagnosis (written first; confirmed)

### E1 tests/plan-cards-single-source.test.ts "Free is offered wherever all three plans are" — CAUSED BY THE UNCOMMITTED DIFF, not a flake
- The test (tests/plan-cards-single-source.test.ts:43-46) asserts `code("src/components/PlanCards.tsx").match(/<FreePlanCard/g)?.length).toBe(2)` ("web + app").
- The uncommitted diff to src/components/PlanCards.tsx (hunk at line ~87) adds a third `<FreePlanCard hidePrice ... />` inside a new `if (detectNativePlatform() === "android")` branch ("ANDROID SELLS NOTHING, owner 2026-10-08"). Three occurrences -> test fails.
- HEAD has exactly 2 occurrences, so CI at HEAD is green. The other session must either update the test's count to 3 (and its comment "web + iOS + Android") or restructure. Also the diff adds `hidePrice` prop to FreePlanCard in src/components/PlanTierCards.tsx — harmless to this test.
- Verdict: regression introduced by the working tree; the test is doing its job.

### E2 tests/background-reliability.test.ts "is a double-tap window, not a lockout" — TIMEOUT / environment flake, not a logic failure
- The test (tests/background-reliability.test.ts:62-68) does `await import("@/app/api/leads/share-card/route")` to read `SHARE_REPEAT_WINDOW_MS`. That dynamic import pulls the whole route module graph: supabase-server, supabase-admin, owner-usernames, lead-access, notification-privacy, plan, rate-limit, outbound-cap, resolve-card, share-preview, contact-links, sms, email... (src/app/api/leads/share-card/route.ts:1-20). vitest `testTimeout: 30_000` (vitest.config:18); the import took >30 s on this Windows box (cold transform of a large server module graph, probably with antivirus / disk contention from the other session's build).
- share-card/route.ts is NOT in the uncommitted diff (`git diff HEAD --name-only | grep share-card` -> 0), so the constant is unchanged from HEAD where CI passes.
- Verdict: flake. Re-run in isolation (`npx vitest run tests/background-reliability.test.ts`) should pass. Suggested hardening (Low): read the constant from source text like the sibling tests do, or move `SHARE_REPEAT_WINDOW_MS` to a leaf module (e.g. src/lib/rate-limit.ts) so the test doesn't import Supabase/Twilio code.

### F-AUTH-01 262 auth.users without a profile: QA teardown deletes the profile BEFORE the auth user, with no retry, so any failure leaves an orphan
- Severity: Medium
- Platform: production database (all)
- Account type/plan affected: QA seed accounts (253 @swiftcard-test.invalid); the pattern also explains part of the 8 real orphans (see F-AUTH-02)
- Feature/page: scripts/qa-flows.mjs teardown; nightly-qa / qa:flows
- File/component/function: scripts/qa-flows.mjs:1078-1100 (`finally` block), scripts/qa-a11y.mjs:393, scripts/qa-android-shell.mjs:256, scripts/qa-mac.mjs, scripts/qa-office-links-brand.mjs (same shape)
- Problem: cleanup is a sequence of awaited admin REST DELETEs: leads, notifications, cards, profiles, then `/auth/v1/admin/users/{id}` LAST. Nothing except the signature delete has `.catch`. If the profiles delete succeeds and the auth delete throws (rate limit, 5xx, CI job killed on timeout, browser hang), the auth user survives with no profile. 253 such rows exist in production, so the cleanup has been failing at the last step repeatedly.
- Expected behavior: delete the auth user first (or wrap each step in try/catch and retry), plus a nightly sweep deleting `@swiftcard-test.invalid` auth users older than 24 h.
- Actual behavior: orphan auth users accumulate; they count against Supabase auth quotas and pollute `listUsers`, which src/lib/auth-landing.ts:94 uses for the duplicate-account alert with only the first 1000 most-recent users. 253 QA rows push real accounts out of that page and weaken the alert.
- How to reproduce: run qa:flows and kill it between the profiles DELETE and the auth DELETE; or query auth.users for `qa-flows-*@swiftcard-test.invalid`.
- Likely cause: ordering + no error handling in teardown; the `extraUsers` loop has the same shape.
- User impact: indirect (auth quota, weakened duplicate alert, noisy admin user lists if /admin/users ever lists auth users).
- Confidence: Confirmed (code); per-row failure mode Unable to Verify without logs.

### F-AUTH-02 "Sign in" (intent=signin) with Apple/Google for a person without an account mints the auth user, then signs them out with "no account": the 5 Apple-relay + 3 Gmail orphans are this funnel leak
- Severity: Medium
- Platform: web Apple/Google sign-in with intent=signin; iOS native Apple sign-in
- Account type/plan affected: brand-new visitors who tap the SIGN-IN button rather than Create account
- Feature/page: /auth/callback -> src/lib/auth-landing.ts:123-126 -> /onboarding
- File/component/function: src/app/onboarding/page.tsx:33-37 (`if (intent === "signin" && !pendingInvite) { signOut(); redirect("/login?error=no_account") }`)
- Problem: Supabase OAuth creates the auth.users row on the first successful round-trip regardless of intent. The app then refuses to provision a profile and signs the person out, but the auth row stays. If the visitor never returns via Create account, a profile-less auth user remains forever. This matches the 5 `@privaterelay.appleid.com` and 3 gmail rows. It is also a lost signup: a first-time visitor who guessed the wrong tab is bounced with an error instead of being onboarded.
- Expected behavior: either onboard anyway (the person proved ownership of the email) with a one-line "No account yet, so we created one", or admin-delete the just-minted auth user when refusing so later attempts are clean and orphans do not accumulate.
- Actual behavior: /login?error=no_account; auth row persists. A later Create account with the same Apple ID re-uses the row and onboarding provisions (recoverable), but the 8 real orphans show most do not return.
- How to reproduce: /login -> Sign in tab -> Continue with Apple with an Apple ID never used on SwiftCard -> lands on /login?error=no_account; auth.users now has the relay email with no profiles row.
- Likely cause: the deliberate "Task 4" rule (sign-in tap with no account bounces to Create account) is applied after the OAuth user already exists.
- User impact: lost signups; orphan rows; the person's "Hide my email" relay address is consumed.
- Confidence: Confirmed (code path); attribution of the 8 rows Suspected.

### F-AUTH-03 Orphan-user (auth row, no profile) sign-in path is otherwise closed: documented trace
- Severity: Low (informational)
- Platform: all
- Account type/plan affected: any auth user without a profiles row
- Feature/page: proxy -> /dashboard -> /onboarding
- File/component/function: src/proxy.ts:96-118 (deleted check uses `.maybeSingle()`; null profile = not deleted), src/app/dashboard/page.tsx:125 (`if (!profile) redirect("/onboarding")`), src/app/onboarding/page.tsx:39-60 (admin insert: username `<emailprefix>-<uid6>`, template "classic-pro", email = auth email, then `/cards/new?add=1`); email/password sign-in in LoginForm always goes through /onboarding (src/components/LoginForm.tsx:296).
- Problem: none found; the loop is closed. Nit: profiles row gets created_at = now, so a recovered old orphan is treated as a post-2026-09-17 account and forced through /welcome (dashboard/page.tsx:239-246). Acceptable.
- Confidence: Confirmed

### F-AUTH-04 Password forms carry method="post" (rule satisfied); one password input lives outside any form
- Severity: Low
- Platform: web
- Account type/plan affected: all
- Feature/page: /login, /auth/reset-password, Settings -> Account -> Delete account
- File/component/function: src/components/LoginForm.tsx:590 (`<form onSubmit method="post">`); src/components/ResetPasswordForm.tsx:230 (same); src/components/ManageAccount.tsx:516 (`<input type="password">` with NO enclosing form); src/components/IntegrationsSettings.tsx:460 (API-key field, no form)
- Problem: the delete-account "Confirm it's you" password input is not inside a form, so Enter does nothing and password managers may not autofill. No GET risk because there is no form, so the rule is not violated.
- Expected behavior: wrap in `<form method="post" onSubmit>` so Enter submits and the guard is explicit.
- Confidence: Confirmed

### F-AUTH-05 proxy.ts login wall and deleted-account redirect cover only 7 prefixes; /grow, /welcome, /upgrade, /checkout, /share, /join, /admin rely on page-level checks
- Severity: Low
- Platform: web + native
- Account type/plan affected: signed-out visitors; deleted accounts inside the 30-day window
- Feature/page: src/proxy.ts:77-85 (`protectedPaths`) vs the matcher (src/proxy.ts:355-374)
- Problem: the `_deleted` redirect and the device-slot claim run only when `isProtected`. A deleted account can still open /grow, /upgrade, /checkout, /welcome, /share unless the page checks `_deleted` itself; /welcome (src/app/welcome/page.tsx:24-51) checks login and plan but not `_deleted`. Device limit is likewise not enforced on those routes.
- Expected behavior: apply the deleted-account redirect to every matched signed-in route.
- Confidence: Confirmed for /welcome; others see F-NAV-02.


---
## F-ONB — onboarding, welcome, join, plan step, tour, nudges

### F-ONB-01 /join/<bogus-token> renders a friendly dead end with HTTP 200 (soft 404)
- Severity: Low / Platform: all / Account: any (signed-out or in) / Page: /join/[token]
- File:line: src/app/join/[token]/page.tsx:52-61 (`if (!invite) return <DeadEnd …/>`)
- Problem: unknown, revoked, declined, suspended, lapsed-owner and expired invites all return the same DeadEnd component with status 200 (no `notFound()`).
- What the user sees: SwiftCard logo, "This link doesn't work anymore", "The invite may have expired or been canceled. Ask whoever invited you to send a fresh one.", and a "Go to sign in →" link to /login. No Accept button, which is correct.
- Expected: same copy, but a 404/410 status so monitors and QA can tell a dead token from a live one. /join is disallowed in robots.ts, so SEO is not the issue. The issue is that uptime/QA probes can't use the status code.
- Also: the bogus-token branch tells someone who is already signed in to "Go to sign in". It should send them to /dashboard.
- Likely cause: a deliberate UX choice that never set a status code.
- User impact: cosmetic. Monitoring can't tell these cases apart. Confidence: High.

### F-ONB-02 Plan-step gate: dashboard redirect and card-live rule use different exemption lists
- Severity: Low / Platform: all / Account: Free accounts created on or after 2026-09-17 / Page: /dashboard → /welcome; public card
- File:line: dashboard/page.tsx (HEAD) ~236-247 vs src/lib/card-active.ts:48-60 (awaitingPlanChoice)
- Problem: the dashboard sends someone to /welcome when `!_planChosen && !proEndedPending && !pendingInvite && created_at >= PLAN_STEP_REQUIRED_SINCE`. awaitingPlanChoice (used by public card, /share, sitemap, ai-consent) also exempts `_trialEnded` but not `pendingInvite`. The comment in card-active claims "the same test the dashboard uses … can never disagree", which isn't true.
- Divergent cases:
  (a) An app-trial or grant that ended (referral-server.ts:653 sets `_trialEnded`, not `_proEndedChoicePending`). The card stays live, but every dashboard load bounces to /welcome until they choose a plan again.
  (b) A Free user with a pending team invite. The dashboard doesn't send them to choose, but their public card counts as "awaiting plan" and stays dark until they join.
- Expected: one shared predicate, used in both places.
- User impact: rare, but confusing: a forced re-choice, or a dark card. Confidence: Medium (needs a matching account to reproduce).

### F-ONB-03 FirstLeadNudge and ReferAFriend hardcode the referral reward ("3 signups / 3 friends")
- Severity: Low / Platform: web (nudge is hidden in native) / Account: Free / Page: dashboard, Settings → Refer
- File:line: src/components/FirstLeadNudge.tsx:43 (HEAD); src/components/ReferAFriend.tsx:106
- Problem: the copy says "3 signups earn you a month of Pro free" and "Invite 3 friends", but the real numbers live in src/lib/referral.ts (REFERRAL.SIGNUPS_PER_REWARD = 3, NEW_USER_FREE_MONTHS = 1, REFERRER_FREE_MONTHS = 1).
- Expected: read from REFERRAL, the way referral-server.ts does.
- User impact: the copy will be wrong the day the constant changes. Confidence: High.

### F-ONB-04 FirstLeadNudge only fires when leadCount is exactly 1
- Severity: Low / Platform: web / Account: Free / Page: dashboard
- File:line: FirstLeadNudge.tsx useEffect (`if (isPro || leadCount !== 1) return;`)
- Problem: anyone whose first dashboard visit happens after 2 or more real contacts never sees the "first contact" activation nudge. The dismissal is stored only in localStorage, so it comes back on a new browser if the count is still 1.
- User impact: the activation and referral nudge is missed. Confidence: High (logic read).

### F-ONB-05 Guided tour anchors: all 23 exist (verified, no finding)
- Every `anchor:` in src/lib/tour-steps.ts (help-bubble … settings-billing) has a matching `data-tour` in src/components or src/app. Tour completion lives in localStorage only (`sc_tour_completed`), so it is per browser. That's by design per the TourBanner comment, since the banner is gated on ?tour=1/?welcome=1.
- /onboarding: no-profile signin intent → sign out + /login?error=no_account (see F-AUTH-02). New account → /cards/new?add=1, never /dashboard (as documented). /welcome/team is a redirect-only legacy page. No dead controls found.

---
## F-DASH — dashboard (read at HEAD 655a4480)

### F-DASH-01 Free lead-cap banner hardcodes "5 free leads" and "Invite 3 friends … up to 3 months" next to a FREE_LIMIT constant
- Severity: Medium (the copy drifts silently on the most-seen upsell) / Platform: iOS+Android shell (nativeCopy) and web / Account: Free / Page: /dashboard
- File:line: dashboard/page.tsx (HEAD) 1095-1105 (nativeCopy + nativeContent: literal "You've used your 5 free leads this month") and 1129-1131 (literal "Invite 3 friends … up to 3 months")
- Problem: the web branch of the same banner uses `${FREE_LIMIT}` (line 73 = PLAN_LIMITS.FREE_LEADS_PER_MONTH). The native branch and the referral footnote hardcode 5 and 3/3. The referral values live in lib/referral.ts REFERRAL.SIGNUPS_PER_REWARD and MAX_REFERRAL_REWARDS. AGENTS.md: limits belong in plan.ts.
- Expected: interpolate FREE_LIMIT and REFERRAL.*.
- Actual: if FREE_LEADS_PER_MONTH changes, the iPhone app tells Free users the wrong cap while the web tells them the right one.
- User impact: the app and the web would show different numbers for one rule. Confidence: High.

### F-DASH-02 "leads" vs "contacts" on the same dashboard
- Severity: Low / Platform: all / Account: Free / Page: /dashboard
- File:line: dashboard/page.tsx (HEAD) 1095-1131 ("free leads used", "new leads are locked", "Unlimited leads") vs FirstLeadNudge ("Your first contact!"), PendingInvite/join copy ("contacts"), the nav tab "Contacts", and the /contacts page.
- Problem: the product renamed leads to contacts (the Office console rule is "contacts, never leads"), but the Free cap banner, PlanGate nativeCopy and the UpgradeButton context still say "leads".
- Expected: "contacts" everywhere a user reads it. Confidence: High.

### F-DASH-03 TrialBanner "urgent" (≤3 days) styling is unreachable
- Severity: Info / Platform: all / Account: anyone in a free period / Page: /dashboard
- File:line: TrialBanner.tsx:28 (`urgent = daysLeft <= 3`) vs billing-state.ts:206 showsTrialBubble (first 24h of the ACCOUNT only)
- Problem: the bubble only renders in the account's first 24 hours, when daysLeft is about 14 or 30. The amber urgent state and its "1 day left" copy are dead code. The only exception is a grant shorter than 4 days given on day one. No user-facing defect, but a reviewer may think the dashboard warns before a trial ends. It doesn't; that warning lives only in Settings → Profile and notifications.
- Confidence: High.

### F-DASH-04 Pending team invite banner has no decline or dismiss; decline exists only on /join
- Severity: Low / Platform: all / Account: Free with an unaccepted invite / Page: /dashboard
- File:line: src/components/PendingInviteBanner.tsx:28-40 (only a "Join →" link); decline API /api/office/decline is called only from JoinButton.tsx:14
- Problem: someone who doesn't want to join (wrong company, old employer) sees the purple banner on every dashboard load until the invite expires. In the empty-account state it takes the whole screen, with "create a personal card instead" as a footnote.
- Expected: a "Not now / Decline" control on the banner, or at least a dismiss.
- Confidence: High.

### F-DASH-05 Dashboard controls: inventory checked, no dead controls
- My Cards: radiogroup of `?card=<username>` links plus Edit (`/cards/<id>/edit`) plus an expand toggle (MyCardsList.tsx:100-246). "View Live Link" (new tab). Add card: a Link to /cards/new?add=1, or, when locked, a button opening SecondCardSheet (Esc/backdrop/"Not now" close it; no focus trap, which is an a11y nit). Traffic range Today/Week/Month/Locations are links (`?vrange=`). Locations is gated for Free with "Upgrade to Pro →" /upgrade. TrialBanner links: "Manage plan" /settings/flows?billing=1 (param honoured, settings/flows/page.tsx:57-58) and "Keep Pro →" /upgrade. ProEndedPanel posts /api/account/choose-plan with a busy/disabled guard. RateUs: keepalive POST /api/profile/rate-us. Empty state: "Create your card →" /cards/new?add=1. Card picker: "Select a card" list.
- Empty states: no cards → create screen; no location data → "No location data yet"; link-tap line hidden at 0. Error states: the analytics queries fall back to 0 or null without a visible error (a DB failure renders "0 views", indistinguishable from no traffic). Low; see Appendix A.

---
## F-CONTACTS — /contacts, ContactsClient, AddContactModal, leads APIs

Production facts (read-only SQL, 2026-10-13): leads = 243; follow_up_sequence non-null = 243, NON-EMPTY = 1; leads tagged "demo" = 223 (92% of all contacts are the seeded sample); lead_reminders = 0 rows.

### F-CONTACTS-01 lead_reminders is an orphan: nothing writes it and nothing reads its API
- Severity: Low (dead feature surface, no user-visible break) / Platform: all / Account: all / Feature: contact reminders
- File:line: src/app/api/leads/[id]/reminders/route.ts:7-31 (GET only). The only other references are deletes in api/cards/[id]/route.ts:479 and lib/account-purge.ts:93.
- Problem: no code anywhere inserts into lead_reminders, and no component fetches /api/leads/<id>/reminders. The 0 rows in production are the expected result, not an outage. Reminders as a user feature are not wired. Follow-ups actually run on leads.follow_up_sequence (the /api/reminders cron, a different thing despite the name).
- Expected: remove the table, route and purge lines (orphan per the owner's audit rule), or wire them up.
- Confidence: High (repo-wide grep).

### F-CONTACTS-02 "242/245 leads carry a follow-up sequence" is the column default `[]`, not auto-generation
- Severity: Info / File: supabase/schema-v2.sql:6 (`follow_up_sequence jsonb DEFAULT '[]'`)
- Finding: only 1 of 243 leads has a non-empty sequence. Sequences are created only on demand (POST /api/leads/[id]/generate-sequence from ContactsClient, or a PATCH with follow_up_sequence). Nobody gets a sequence they didn't ask for. Any metric that counts "leads with a sequence" by non-null is wrong; count by `jsonb_array_length > 0`.
- Confidence: High.

### F-CONTACTS-03 Notes and "Where we met" saves fail silently (no message), including on an expired session
- Severity: Medium / Platform: all / Account: all / Page: /contacts → contact → Info
- File:line: ContactsClient.tsx:958-964 (saveNotes), 652-659 (saveField), 896-907 (updateField returns only res.ok)
- Problem: on any non-2xx (401 after the session expires, 402, 500) or a network error, the editor stays open and the button goes back to "Save", but no notice is shown. Other actions on the same screen call `fail("Couldn't … please try again.")` (deleteLead :953, toggleRead :942, reset automation :535).
- Repro: open a contact, edit Notes, block /api/leads/* in devtools (or let the session expire), tap Save. Nothing happens and no text appears.
- Expected: `fail(...)`; on 401, a "You've been signed out — sign in again" with a link to /login?next=/contacts.
- User impact: users assume the note saved, close the tab, and lose it. Confidence: High.

### F-CONTACTS-04 No 401 handling anywhere in Contacts. An expired session shows generic "try again" errors or nothing
- Severity: Low / File: ContactsClient.tsx (no `401` check in 2,000 lines). Only 6 client files in the repo check 401 (CustomCardDesigner, GlobalAiConsent, GuestDraftClaim, NativeAppBridge, WelcomePlan, CheckoutClient).
- Problem: AddContactModal shows the raw server error string "Unauthorized" (AddContactModal.tsx:138-142 `setError(data.message || data.error …)`). The contact list's PATCH/DELETE paths show "Couldn't … please try again", and retrying can never succeed.
- Expected: one shared 401 handler that routes to /login?next=<current>. Confidence: High.

### F-CONTACTS-05 No length caps on contact fields, client or server
- Severity: Low / Files: ContactsClient.tsx (0 `maxLength` attributes), AddContactModal.tsx (0), api/leads/manual/route.ts:22-60 (only `name?.trim()` required), api/leads/[id]/route.ts:28-31 ALLOWED_PATCH_FIELDS (no size or type checks except tags)
- Problem: name/email/phone/company/notes/where_met/convo_details/company_description accept unbounded strings. A non-string `name` (e.g. a number) throws on `.trim()`, which is an uncaught 500. A DB error's raw `error.message` goes back to the user (manual/route.ts `{ error: error.message }`, 500).
- Expected: caps that match lib/card-limits style (e.g. name 120, notes 5,000), with a 400 on bad types. Confidence: High.

### F-CONTACTS-06 Adding a contact by hand spends the Free "leads captured" monthly quota, and the error says "leads"
- Severity: Low (product/copy) / Account: Free / File: api/leads/manual/route.ts:50-58 and the `bumpUsage(…"leads")` after insert
- Problem: a contact the owner types in (or scans) counts against FREE_LEADS_PER_MONTH, the same quota as people who share their info through the card. The 402 copy is "You've captured your N free leads this month. Upgrade to Pro to add unlimited contacts.", mixing leads and contacts in one sentence. Whether manual adds should count is an owner decision; the copy inconsistency is a defect either way.
- Confidence: High.

### F-CONTACTS-07 Deleting the sample contact works, but replaying the tour seeds it back
- Severity: Low / File: ContactsClient.tsx:386-428 → api/contacts/seed-demo/route.ts (re-seeds when the card has 0 leads)
- Finding: the demo contact (lib/demo-contact.ts "Jordan Rivera", tags demo+unread) can be deleted like any contact (the timeline labels it "Sample contact — … isn't a real person"). If the user then replays the tour (TakeTourButton) on a card with no contacts, a new sample is inserted and is NOT removed when the tour ends. It also arrives tagged "unread", so it inflates the unread dot and the bell after the user deliberately removed it. Separately, 223/243 production leads are this sample, so most accounts have never received a real contact.
- Expected: delete the reseeded sample when the tour ends, or seed it without "unread".
- Confidence: High (code), Medium (impact).

### F-CONTACTS-08 deleteLead has no in-flight guard
- Severity: Info / File: ContactsClient.tsx:946-956
- The confirm dialog closes only after the DELETE resolves, so a double tap on the confirm sends two DELETEs. The second is a harmless no-op (DELETE … .in(card_owner) returns success on 0 rows). No user-visible bug. Noted against the double-submit rule.

---
## F-SCAN — card scanner (Android camera already in 08)

### F-SCAN-01 /api/scanner/send is an orphan endpoint that emails any address
- Severity: Low (orphan; abuse surface for Pro accounts) / Platform: n/a / Account: Pro, Office / File: src/app/api/scanner/send/route.ts:11-94
- Problem: nothing in src calls `/api/scanner/send` (the only mention is a comment in api/office/invite/route.ts:64). It sends "<FirstName> shared their contact card with you" from the `connect` sender to any `toEmail` with no format validation, rate limited at 20 per 10 minutes. Its plan check (`plan !== "pro" && plan !== "enterprise"`) differs from the sibling /api/scanner (isPaidPlan), so a paid state isPaidPlan recognises (e.g. Apple or a grant, if stored differently) can be refused.
- Expected: delete it (orphan per the audit rule), or validate the email and use isPaidPlan.
- Confidence: High (repo-wide grep).

### F-SCAN-02 The scanner's distinct failures all collapse into one message
- Severity: Low / Platform: all / Account: Pro / Page: Contacts → Add contact → Scan a card
- File:line: src/lib/scan-card.ts:60-69 (`if (!res.ok) throw new Error("scan_failed")`) → AddContactModal.tsx:115-121
- Problem: 429 ("You're scanning very quickly — give it a minute"), 413 image_too_large and 503 no_ai (no AI provider) all reach the user as "Couldn't read that card. Try a clear, well-lit photo." A rate-limited or AI-outage user is told to retake the photo, and that can't help.
- Expected: pass through the server's `error`/`message` for 429 and 503, and say "photo too large" for 413.
- Confidence: High.

### F-SCAN-03 The scanner extracts title and website, and the add-contact form drops them
- Severity: Info / Files: api/scanner/route.ts prompt (name, title, company, phone, email, website) vs AddContactModal.tsx:105-111 (keeps name/email/phone/company only)
- Problem: AI work is thrown away, and the user retypes the website (leads has no title/website column; company_description exists but is unused here).
- Confidence: High.

---
## F-GROW — /grow, ReferAFriend, RateUsCard, GrowShare (grow/page.tsx and GrowShare at HEAD)

### F-GROW-01 "RATE US" heading renders over an empty slot on Android (app and browser)
- Severity: Low / Platform: Android app, Android web / Account: Free, Pro, Office owner / Page: /grow
- File:line: grow/page.tsx (HEAD) ~97-102 (`{APP_STORE_ID && (<div><p>Rate us</p><RateUsCard/></div>)}`) vs RateUsCard.tsx:27-29 (`if (!href || androidApp) return null;`) and `sc-apple-only` on its root (hidden on any Android browser)
- Problem: the section label is outside the component that hides itself, so Android users see an orphan "RATE US" caption followed by the next section.
- Expected: move the label inside RateUsCard, or gate the whole block on the same condition.
- Confidence: High.

### F-GROW-02 ReferAFriend hardcodes every referral number although `cap` is in scope
- Severity: Low / File: src/components/ReferAFriend.tsx:106-107 ("Invite 3 friends … 1 month of Pro free — up to 3 months total"), :138 ("all 3 referral months"), :140 ("3 of 3 complete") while :145 renders `{cap}` from progress
- Problem: same drift class as F-ONB-03 and F-DASH-01. lib/referral.ts REFERRAL holds SIGNUPS_PER_REWARD, REFERRER_FREE_MONTHS, MAX_REFERRAL_REWARDS and NEW_USER_FREE_MONTHS.
- Confidence: High.

### F-GROW-03 Controls inventory: all wired; copy-failure is silent
- /grow: subscription-gated sections (enterprise hides Refer). Office sub-users are redirected to /dashboard. "Add your Swift Signature" → /share#signature (LinksPageTabs honours the hash). "Share your live card" → the public slug in a new tab, or /dashboard when there is no card. GrowShare: X / LinkedIn / WhatsApp / Email intents, native share, Copy. NotificationBell referral rows → /grow#refer (id present in ReferAFriend.tsx:103). The claim button has a `disabled={claiming}` guard and shows success/failure text.
- Gap: GrowShare `copy()` swallows clipboard errors (`catch { /* ignore */ }`), so on an insecure context or a denied permission the button does nothing and says nothing. Info.
- ReferralGiftPanel is used only by NewCardWizard and WelcomePlan (the plan step), not /grow.

---
## F-SETTINGS — /settings/flows, /settings/devices, /profile, delete/reopen

### F-SETTINGS-01 /profile and /profile/card are orphaned legacy editors that are still served, still QA-swept, and show a link that may not be the user's card
- Severity: Medium / Platform: all / Account: all / Page: /profile, /profile/card
- File:line: src/app/profile/page.tsx (whole file); knowledge/index.ts:52 calls it "Legacy settings page, superseded by /settings/flows and linked from nowhere"; ProfileForm.tsx:235 and linkedin-connected/page.tsx:23 still send people back to /profile.
- Problem:
  (1) The live-link row builds `${APP_URL}/${profile.username}`. That's the ACCOUNT handle ("name-abc123" minted in onboarding), not the card slug. grow/page.tsx:35-37 documents that "the account handle 404s" for modern accounts and uses publicCardSlug instead. The Copy button and Preview here may therefore hand out a dead link.
  (2) It is a light-theme ("bg-cream", "Edit Card") second copy of the profile, follow-up automation (day1/day15/day30 flow_settings) and email-preference settings, so the same settings exist in two places with different UIs.
  (3) The LinkedIn photo-suggest flow returns users to this orphan page (returnTo="/profile", and /linkedin-connected's fallback), dropping a modern user onto the legacy screen.
  (4) scripts/qa-a11y.mjs:327-328 and the nightly profile-persistence check still exercise /profile, which is why production logs show a DOM TimeoutError there. QA is testing a page no user is meant to reach.
- Expected: redirect /profile → /settings/flows and /profile/card → /cards/<primary>/edit; point returnTo and the fallback at /settings/flows; move the QA checks to the real screens.
- Confidence: High for (2), (3), (4); Medium for (1) (depends on whether /<account-handle> still resolves; grow's comment says it 404s).

### F-SETTINGS-02 "Change password" on Security sends signed-in (and Google/Apple-only) users to the recovery-link page
- Severity: Low / Platform: all / Account: all / Page: Settings → Security
- File:line: settings/flows/page.tsx:416-433 → /auth/reset-password (ResetPasswordForm stages checking/no-session…)
- Problem: the description says "Your account password", but OAuth-only accounts have no password, and the screen is the light-theme recovery page titled "Set a new password". It doesn't ask for the current password (reauth is a security concern; see 06). There's no copy for "you sign in with Google/Apple — add a password".
- Confidence: Medium.

### F-SETTINGS-03 The deletion grace period is three separate literals
- Severity: Low / Files: lib/account-purge.ts:23 PURGE_GRACE_DAYS = 30 (`>=`); api/account/reopen/route.ts:6 GRACE_DAYS = 30 (`>`); app/account-deleted/page.tsx:6 GRACE_DAYS = 30
- Problem: the comment "must match" is the only guard. The reopen and purge comparisons differ (>= vs >), so for the exact instant at 30 days the page says 0 days while reopen still allows it. That's harmless now, but the copy, API and purge job can drift. Import PURGE_GRACE_DAYS everywhere.
- Confidence: High.

### F-SETTINGS-04 Delete flow: inventory checked, behaves; one copy gap for office owners
- ManageAccount.tsx: steps why → detail → keep → loss → offer → confirm. Each has Back/Continue; the retention fetch waits for the server ("One moment…"). finalizeDelete has a `loading` guard. The password reauth runs only when needsPassword. Errors show inline. On success: releaseDevice, then location.replace("/account-deleted").
- /account-deleted: signed in and deleted → "N days left", ReopenAccount (POST /api/account/reopen, disabled while loading, error text), LeaveDeletedAccount. Signed out → "Sign back in" (/login?next=/account-deleted).
- Gap: the office-owner warning says "transferring ownership by contacting support", but there is no support link or address on that screen. Info.
- DeviceManager (/settings/devices, linked from Settings → Profile at settings/flows/page.tsx:269): sign-out per device, busy guard, errors shown. EmailPreferencesForm: saving guard plus error text. No dead controls found.

---
## F-HELP — HelpWidget, sales chat, knowledge base

### F-HELP-01 Native-safe KB answers sell Apple in-app purchase, and the Android shell receives them too
- Severity: Medium / Platform: Android app (also an iOS policy-wording question) / Account: Free / Feature: in-app help assistant
- File:line: src/lib/knowledge/docs/account.ts:98-100 (nativeAnswer "You can subscribe to Pro right in the app: tap \"Upgrade to Pro\" … The subscription sheet shows the plans and prices…"), :283-284 (referral nativeAnswer "earn a month of Pro free"), and the "Manage subscription … Apple account" answers. HelpWidget.tsx:74 sends `native = useIsNativeApp()`. lib/platform.ts:54 detectNativeApp is true for `window.androidBridge`. api/ai/help/route.ts:93-128 uses that one boolean for the native scope.
- Problem:
  (a) AGENTS.md says commerce nativeAnswers must carry "no pricing, upgrade, billing, or website language". The live nativeAnswers now describe in-app subscribing, upgrading and prices (correct for iOS IAP, but contradicting the written rule that reviewers rely on).
  (b) There is ONE native flag, so an Android app user asking "how do I upgrade" is told to subscribe in the app through Apple's sheet. The Android shell sells nothing (see the uncommitted tests/render/android-sells-nothing test another session is adding), and Android has no Apple subscription.
- Expected: a platform-split scope (ios | android | web) with an Android-safe answer; update the AGENTS.md rule to match the IAP era.
- Confidence: High for (a); Medium for (b) (the Android shell's commerce state is in flux in the uncommitted diff).

### F-HELP-02 kb:check's "PhotoFirst.tsx changed after the last KB update" is a false positive
- Severity: Info / The only post-KB change (1e461af2 → 655a4480) to PhotoFirst.tsx is a 3-line comment rewrite. The other changed files since the KB commit are admin-only (admin/users/UsersClient.tsx Title/Company color, api/admin/create-card). No customer-facing KB drift from those commits. kb:check flags by path, not by user-visible diff.
- Confidence: High.

### F-HELP-03 KB answers hardcode limits that live in code
- Severity: Low / Files: knowledge/docs/account.ts:38 ("You can be signed in on 2 devices at a time" vs lib/device.ts:36 DEVICE_LIMIT = 2); account.ts:284 ("Invite 3 friends … up to 3 months" vs lib/referral.ts REFERRAL.*); account.ts:263/268 ("30 days" vs account-purge PURGE_GRACE_DAYS)
- Problem: AGENTS.md says limits belong in code and derived.ts, and tests/knowledge-truth only guards plan.ts prices and limits, not device, referral or grace constants. These would go stale silently. The delete answer also says "then 'Type DELETE' and your password", but Google/Apple-only accounts are never asked for a password (ManageAccount needsPassword).
- Confidence: High.

### F-HELP-04 commerce:true and nativeAnswer pairing is intact
- 15 `commerce: true` docs and 15 `nativeAnswer` fields (account 10, marketing-site 3, getting-started 1, product 1); types.ts:56-62 makes a missing one a compile error. retrieval.ts:116 swaps them in for native scope. Settings paths quoted in the KB ("Plan and billing", "Notifications and preferences", "Help and referrals", "Advanced account settings", "Cards and sharing", "Security", "Profile") all match the section labels in settings/flows/page.tsx:244-511. KB contacts.ts:45 already documents that the scanner drops title and website (F-SCAN-03).

---
## F-MKT / F-NAV — marketing site, navigation, 404/error

### F-MKT-01 Compare pages hardcode SwiftCard's own prices and seat minimum
- Severity: Medium (pricing drift on public SEO pages) / Platform: web / Account: logged-out / Page: /compare, /compare/[slug]
- File:line: src/app/compare/page.tsx:31 ("$4.99/mo"), :36 ("$3.99/seat/mo · min 2 seats"); src/app/compare/[slug]/page.tsx:71, 108, 126, 145, 163 ("$4.99/mo", "$4.99/month")
- Problem: plan.ts:30 PRO_MONTHLY_CENTS = 499 and :20 OFFICE_MIN_SEATS = 2 are "the ONE source of truth" for displayed prices. The compare pages type SwiftCard's numbers by hand, and the comment at compare/page.tsx:28 even says "SwiftCard's numbers are the same ones live on /pricing". tests/knowledge-truth only guards the knowledge docs, not pages. A price change leaves /compare advertising the old price. (Competitor prices are legitimately literal.)
- Expected: format from PLAN_PRICES/PLAN_LIMITS.
- Confidence: High.

### F-MKT-02 Every 404 on the site says "Couldn't find that card"
- Severity: Low / Platform: all / Page: /blog/<bad>, /for/<bad>, /products/<bad>, /compare/<bad>, /cards/<bad>/edit, /office/admin/team/<bad>, plus any unknown path
- File:line: src/app/not-found.tsx:21-28 (the only not-found.tsx in the app; 13 pages call notFound())
- Problem: a mistyped blog post or product URL, or a signed-in user's stale edit link, gets "Couldn't find that card … the card may have moved" and a "Create your free card →" CTA. Copy also disagrees on build time across screens: "about 30 seconds" (404), "about 60 seconds" (dashboard empty state), "about 2 minutes" (/join).
- Expected: a generic 404 at the root, with card-specific wording only in app/[username]/not-found.tsx.
- Confidence: High.

### F-MKT-03 error.tsx sends everyone to /dashboard; there is no global-error.tsx
- Severity: Low / File: src/app/error.tsx:39-49 ("Try again" reset plus a link to /dashboard); src/app/global-error.tsx is absent
- Problem: a logged-out visitor who hits an error on a marketing page is offered "dashboard", which bounces them to /login. An error thrown in the root layout itself renders Next's unstyled default, because only global-error.tsx can catch that.
- Confidence: High.

### F-MKT-04 Contact form: a submit before hydration loses the message; no length caps
- Severity: Low / Platform: web / Account: logged-out / Page: /contact → POST /api/contact
- File:line: src/app/contact/page.tsx:173 (`<form onSubmit={handleSubmit}>`, no method/action; inputs have id= but no name=), :87-105; api/contact/route.ts:10-14
- Problem: (1) Per AGENTS.md "everything is interactive before it is hydrated": a submit in that gap does a GET to /contact with no fields (no name attributes), reloads the page and silently drops what was typed. There's no PII leak, but the message is lost. (2) The client prefixes "Topic: …\n\n" to the message, so the server's "message is required" check can never fail for this form. (3) No maxLength on any field, and no server cap before the Resend email. (4) A 429 ("Too many messages") shows the same generic error state as a 500.
- Expected: method="post" plus a server fallback (or disable the submit until hydrated); caps; surface the server error text.
- Confidence: High.

### F-MKT-05 HANDOFF item "DashboardDemo/PreviewClient still show the removed 'Total leads' header" is already resolved
- Severity: Info / Files: src/components/site/DashboardDemo.tsx, src/app/preview/PreviewClient.tsx contain no "Total leads" (PreviewClient.tsx:702 says "{n} contacts"). HANDOFF.md:66-69 is stale and should be struck.
- Confidence: High.

### F-MKT-06 Production accessibility findings (from the production probe), cross-checked against source where possible
- Severity: Medium in aggregate (WCAG 2.1 AA failures on the main conversion pages) / Platform: web / Account: logged-out
- (a) Voice-control label mismatch on the homepage demo cards and the template picker: the visible text and the accessible name differ (WCAG 2.5.3), so "click <visible label>" fails. Probe fact; source not individually re-verified.
- (b) Contrast failures: the pricing summary, /terms body, the /templates lede, and 9 px slate-400 text on the homepage (WCAG 1.4.3). Probe fact.
- (c) Only 32 of 60 sampled text nodes scale with the root font size, so px-locked text ignores the browser zoom/font setting (1.4.4). Probe fact.
- (d) "No focus ring on home 'Your full name' input": the source DOES draw one, on the pill rather than the input. HeroClaim.tsx:82-95 has `focus:outline-none` and globals.css:1074-1087 adds `.sc-claim:focus-within` (2 px #1D4ED8 inset plus a 4 px halo) and removes the input outline. A probe that inspects only the input's own outline reports none. Likely a probe false positive; confirm visually. Confidence: Medium.
- (e) aria-hidden phone mockups contain focusable elements (4.1.2, focusable content hidden from screen readers). HomeCardPhone.tsx:25 is `aria-hidden` + `pointer-events-none` but not `inert`, so any link or button inside stays in the Tab order. InertPreview.tsx already uses `inert`; the site mockups should too.
- (f) The demo card shows a broken favicon: PreviewClient.tsx:56 uses website "northwind.io", and /api/link-icon 404s for that domain. Use a domain the icon proxy can serve, or a bundled icon.
- (g) The product pages (/products/[slug]) have 10–16 tap targets under 24 px (2.5.8). Probe fact.

### F-NAV-01 The same tabs carry different names on phone and computer
- Severity: Low / Files: src/components/MobileNav.tsx:27 "Home" vs AppTopNav "Dashboard" tab (AppTopNav.tsx:71, data-tour nav-dashboard); MobileNav.tsx:49 "Links" → /share, while the page and product are "Swift Links" plus "Swift Signature", the dashboard tile says "Swift Link views", and the location rows say "Swift Links".
- Problem: the tour, help KB and support copy must name the tab twice ("Home"/"Dashboard"), and "Links" undersells a page that also holds the email signature. See Appendix C.
- Confidence: High.

### F-NAV-02 Internal links: no dead literal hrefs
- All 77 distinct literal internal hrefs in src/app and src/components (`href="/…"` and `href: "/…"`, ignoring query and hash) resolve to a page, a route handler, a dynamic segment or a public file. The hash targets used cross-page (/grow#refer, /share#signature, /settings/flows?billing=1) all have receivers. Template-literal hrefs (`/cards/${id}/edit`, `/join/${token}`) were spot-checked.

---
## Appendix A — Control inventory (compact)

| Page | Controls | Wired? | Loading / guard | Error | Empty |
|---|---|---|---|---|---|
| /onboarding | none (server redirect) | yes | n/a | throws a friendly Error on profile insert failure | n/a |
| /welcome | WelcomePlan (plans, promo, checkout) | yes (03 covers) | yes | yes | n/a |
| /join/[token] | JoinSignIn / JoinSwitchAccount / JoinButton (accept + decline) / DeadEnd link | yes | yes | DeadEnd states, all HTTP 200 (F-ONB-01) | n/a |
| /dashboard | card radios, Edit, expand, View Live Link, Add card / SecondCardSheet, range tabs, Upgrade, ProEndedPanel choose, TrialBanner links, RateUs, FirstLeadNudge Refer/Dismiss, PendingInvite Join | yes | ProEndedPanel busy | analytics failures render as 0 (no error UI) | create-card screen; "No location data yet" |
| /contacts | list, filters, Add contact / Scan, detail tabs, Notes/Where-met edit, automations, AI draft, vCard, Export CSV, delete, read toggle | yes | notes/field/seq/contact saving guards; delete has none (F-CONTACTS-08) | notes and where-met silent (F-CONTACTS-03); no 401 path | sample contact |
| Add contact modal | scan, fields, Add contact | yes | saving guard | raw server error text | n/a |
| /grow | RateUs, Refer claim, share intents, Copy, secondary links | yes | claim guard | copy silent | n/a |
| /settings/flows | 7 sections; Devices link; Change password; push toggles; AI consent; email prefs; integrations; delete flow | yes | yes | yes | n/a |
| /settings/devices | per-device Sign out | yes | busy guard | yes | n/a |
| /account-deleted | Reopen, Leave, Sign back in | yes | loading guard | yes | n/a |
| /profile, /profile/card | legacy editors (F-SETTINGS-01) | orphan | — | — | — |
| /contact | form | yes after hydration only | loading guard | generic | success panel + "send another" |
| 404 / error | Create card, Home / Try again, Dashboard | yes | — | — | — |

## Appendix B — Dead hrefs and orphans
- Literal internal hrefs: none dead (F-NAV-02).
- Orphan endpoints: /api/scanner/send (F-SCAN-01), /api/leads/[id]/reminders plus the lead_reminders table (F-CONTACTS-01).
- Orphan pages still served: /profile, /profile/card (F-SETTINGS-01); /welcome/team is a redirect-only legacy page (fine).
- Wrong-audience link: error.tsx → /dashboard for logged-out visitors (F-MKT-03). The bogus-invite DeadEnd → "Go to sign in" for signed-in users (F-ONB-01).

## Appendix C — Label inconsistencies
| Concept | Variants seen | Where |
|---|---|---|
| contact | "leads" / "contacts" | dashboard cap banner + nativeCopy ("free leads", "leads are locked"); api/leads/manual 402 ("free leads … unlimited contacts"); nav and /contacts say Contacts |
| dashboard tab | "Home" / "Dashboard" | MobileNav vs AppTopNav |
| links page | "Links" / "Swift Links" / "Swift Link views" / "Swift Signature" | MobileNav tab; /share page; dashboard tile; grow row |
| card build time | "about 30 seconds" / "about 60 seconds" / "about 2 minutes" | not-found.tsx; dashboard empty state; /join |
| referral reward | literal "3 / 1 month / up to 3" in four places | FirstLeadNudge, ReferAFriend, the dashboard cap footnote, KB account.ts:284 (source of truth: lib/referral.ts) |
| 404 subject | "card" for every 404 | not-found.tsx |

## Appendix D — Knowledge-base drift
- kb:check's PhotoFirst.tsx flag: false positive (a comment-only change). Post-KB commits otherwise touch only admin screens (F-HELP-02).
- Native answers describe Apple IAP selling, contradicting AGENTS.md's "no pricing/upgrade" rule, and they reach the Android shell (F-HELP-01).
- Hardcoded limits in KB: devices "2" (DEVICE_LIMIT), referral "3/3" (REFERRAL), "30 days" (PURGE_GRACE_DAYS). The delete answer promises a password step that OAuth accounts never see (F-HELP-03).
- KB index correctly marks /profile as legacy, but the product still routes LinkedIn photo-suggest back there (F-SETTINGS-01).
- No KB mention of reminders found. Consistent with the feature being an orphan.
