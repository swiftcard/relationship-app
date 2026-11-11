# SwiftCard — Full Read-Only Product Audit

**Audited:** commit `655a4480` on `main`, live on swiftcard.me (confirmed through `/api/health`). iOS 1.0.6 on the App Store. Audit dates 2026-10-12 to 2026-10-14 (the three unfinished appendices were completed on 2026-10-14).
**Nothing was changed.** No code edits, no commits, no database writes, no Stripe calls. The only side effects were a local production build (`.next`), reports in an untracked folder, and read-only SQL against production.

---

## Executive summary

**Overall condition: stable and shippable for web, with real gaps in data integrity, push, billing edge cases and the native shells.** The core path works and was verified live. Visitors can open a card, save the contact, see Swift Links, get a Wallet pass, and use the card offline. CI, nightly production QA, paint checks and uptime are all green at the audited commit, and there are no open incident issues. Type check is clean, and lint has no errors.

**Production readiness:**
- **Web (desktop and phone browser): ready, with fixes recommended.** Every public route loaded cleanly in Chromium and WebKit at 390, 768, 1280 and 1920 px. There was no overflow, no broken layout and no server errors.
- **iOS app: live, but carries one critical dependency advisory and three High issues.** The issues are push registrations decaying to zero, a crash-like dead state after deploys, and a flash of web selling UI that App Review can see.
- **Android app: not ready for release.** The card scanner's camera is blocked, the status bar is invisible in dark mode, and the keyboard covers inputs. Work to remove selling from Android is in progress but not committed.
- **Analytics: trustworthy for an owner's own dashboard, not for business metrics.** See the analytics section.
- **Billing: correct on the happy path; several Office-seat and webhook-ordering bugs still cost customers money.** Two of these were first reported in July and are still open.

**Biggest risks, in order:**
1. **Capacitor 8.4.2 critical advisory in both app shells** (NS-01). A fix is available as a non-major upgrade.
2. **Push notifications reach almost nobody.** Production has exactly one registered device. Every sign-out or re-login unbinds the device and never asks again (NS-05, N-11).
3. **Office customers are overcharged.** A scheduled seat reduction is billed a full extra cycle (B-01), and out-of-order Stripe events can remove team members (B-02). Both were open in July and are still open.
4. **The site-owner admin has no second factor** and can cancel subscriptions, email every user and merge code to `main` (SEC-06). Leaked-password protection is off in Supabase.
5. **Admin business metrics are wrong.** 223 of 245 leads are the seeded sample contact. 34% of card views and 84% of leads belong to deleted owners. Views can be fabricated with a direct POST (A-06, A-03, A-09).
6. **Notifications are never marked read** except by tapping inside the bell. 67 of 82 are unread, and `opened_at` has never been set (N-01).
7. **The iOS shell paints the web "Upgrade to Pro" UI for 1–3 seconds** before switching to the app version (NS-04). This is App Review 3.1.1 exposure.

**Counts (309 findings; 82 added on 2026-10-14 from the completed appendices):**

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 27 |
| Medium | 108 |
| Low | 150 |
| Info / verified-OK notes | 23 |

One claim was downgraded after verification. B-14 said users could rewrite their own billing state through the database API. Production grants and the server code both block it today, so it is Low and latent.

**What could not be verified:**
- **Signed-in screens were not driven live.** The Supabase service-role key was not on this machine, so the seeded Free, Pro and Office accounts were not created. Signed-in behaviour rests on code tracing, the 6,298-test suite, and the nightly production QA, which ran green at this commit.
- **The owner's own browser session was signed out.** I did not use the saved password Chrome offered.
- **Stripe test mode, RevenueCat and a real iPhone or Android device were not available.** Findings that depend on them are marked accordingly.

---

## Critical issues

### NS-01 — Capacitor 8.4.2 in both app shells carries a critical advisory
- **Severity:** Critical
- **Platform:** iOS app, Android app
- **Account type/plan:** All
- **Feature/page:** Native shell
- **File:** `package.json` / `package-lock.json` (`@capacitor/ios`, `@capacitor/android`); `capacitor.config.ts` (remote `server.url`)
- **Problem:** GHSA-rvm3-566m-v7fv. Remote content can be loaded at the app origin through Capacitor's internal HTTP proxy path. `npm audit` rates it critical.
- **Expected behavior:** Patched Capacitor.
- **Actual behavior:** 8.4.2 is installed, and the shell runs in the affected remote-URL configuration.
- **How to reproduce:** Run `npm audit`.
- **Likely cause:** The dependency was not bumped.
- **User impact:** Script running at the app origin can reach the native bridge (IAP, push, device APIs).
- **Confidence:** Confirmed (versions and configuration). Exploitability on our exact setup was not tested.

---

## High priority issues

Each issue has the full 13-field write-up in the appendix for its area.

| ID | Issue | Platform | Who | Confidence |
|---|---|---|---|---|
| **NS-05** | Push token binding is severed on every sign-out, re-login or device eviction and never re-requested. Production has **1** registered device; 132 of 230 push attempts found no subscription. | iOS, Android | All | Mechanism confirmed; production count confirmed |
| **N-11** | Push registration is opt-in only and retried silently. Failures appear only in error_events. | iOS, Android, web | All | Confirmed |
| **NS-06** | No recovery after a deploy. A warm app hits "Failed to load chunk", and the sign-in return and push-tap listeners die until the app is force-quit. This was observed in production on 2026-10-10 at /login. | iOS app | All | Missing handler confirmed |
| **NS-04** | Every full page load in the app paints the web selling UI (Upgrade to Pro, referral promo) for the 1–3 s before hydration, then swaps. The server already knows it is the app. | iOS app | Free, trial | Code confirmed; timing suspected |
| **NS-03** | Android never declares CAMERA, so the card scanner's camera is auto-denied. | Android | Pro | Confirmed |
| **C02-A01** | An Office Branding save can show "Applied ✓" after saving only logo, company, website and template. Any update error triggers a retry that drops phone, fax, address, design, locks or every Swift Links field, and the route still returns ok (`api/office/brand/route.ts:201-215`). | Web, all shells | Office admin | Confirmed (re-read) |
| **C02-A02** | The second brand-propagation pass (`office-brand.ts:636-650`) targets every active `office_members` row without the `profiles.office_id` cross-check the route's first pass uses. A departed member with a stale row gets the office design written over their own card. | Backend | Office member | Confirmed (re-read) |
| **C02-A39** | `<Link>` navigation bypasses the editor's unsaved-changes guard, including the Pro dialog's "Start my free trial". A Free user loses the Pro design they were upgrading for. | All | Free | Confirmed by code trace |
| **C02-A52** | A name with no Latin letters (for example 李明) and no company cannot get past step 1 of the create-card wizard. | All | All | Confirmed by code trace |
| **B-01** | A scheduled Office seat reduction is applied after the renewal invoice, so the customer pays a full extra cycle at the old seat count. *Open since July.* | Web, Stripe | Office owner | Code confirmed |
| **B-02** | A stale or out-of-order `customer.subscription.updated` event trims Office members and overwrites seats. *Open since July.* | Backend | Office | Code confirmed |
| **B-03** | Concurrent webhook handlers overwrite each other's `profiles.customization` (whole-JSON read-modify-write). | Backend | Paid | Code confirmed |
| **B-06** | Stripe states `unpaid`, `paused` and `incomplete_expired` never downgrade. No `invoice.payment_failed` event has ever been stored, so it may not be subscribed in Stripe. | Backend | Paid | Code confirmed; dashboard config blocked |
| **B-15** | Checkout "supersede" cancels the account's other subscription immediately with no refund. Two tabs mean paying twice, and a retried event cancels the newer subscription. | Web, Stripe | Upgrading users | Code confirmed |
| **SEC-06** | The site-owner admin is protected by password plus email allow-list only. There is no MFA, and leaked-password protection is off. This role can export all users, email everyone, cancel subscriptions and merge PRs to `main`. | Web | Site admin | Confirmed |
| **F-ADMIN-01** | The plan dropdown on the admin Users list changes plans with no confirmation and ignores every error. One mis-scroll can cancel a paying customer or dissolve an Office. | Web | Site admin | Confirmed |
| **F-ADMIN-02** | On the admin user page, the plan buttons, "Grant 1 month of Pro" and "Take offline" have no confirmation, and their errors are dropped. | Web | Site admin | Confirmed |
| **N-01** | Nothing marks a notification read except a tap in the bell. Pushes, push taps, Contacts and the dashboard never do. In production 67 of 82 are unread and `opened_at` was never set. | All | All | Confirmed (code + production) |
| **N-08** | The per-IP notification flood cap silences the bell row and the CRM mirror. Link taps that never notify use up the cap. | Backend | All | Confirmed |
| **A-09** | Views, scans and saves can be fabricated with a direct POST to `/api/card-events`. The human check runs only in the browser, and a visitor id in the body is adopted as identity. Each fake view pushes the owner. | Backend | All | Confirmed |
| **A-06** | 223 of 245 leads are the seeded sample contact (source `qr_code`). Admin analytics is the one reader that does not exclude them, so lead totals are about 9× real and the QR channel is fiction. | Admin analytics | Site admin | Confirmed in production |
| **A-03** | Admin analytics counts rows of deleted owners: 34% of card_views and 84% of leads. | Admin analytics | Site admin | Confirmed |
| **C02-004** | Changing a card's URL copies the pre-edit preview image to the new address, so the new link unfurls with the old card in iMessage and Slack. | All | All | Code confirmed |
| **P-01** | The homepage HTML is 2.4 MB, mostly 27 inline QR SVGs with unrounded coordinates. On slow 4G, LCP is 4.9 s, blocking time is 6.4 s and full load is 16.9 s. | Web | Visitors | Measured |
| **P-03** | Public card pages are uncacheable (`private, no-store`) and run up to 3 serial DB queries. `/card/<slug>` renders a whole page just to redirect. Time to first byte is about 2 s, against about 80 ms elsewhere. | Web | Visitors | Measured |
| **I-01** | No CRM or provider HTTP call has a timeout. A hung HubSpot, Salesforce or Google request holds the function until Vercel kills it. | Backend | Pro | Confirmed |
| **P-06** | `/contacts` loads every lead with no range. PostgREST's 1,000-row cap would silently hide contacts after #1,000. No account is near that today. | Web | Heavy users | Confirmed (source); latent |

---

## Medium priority issues

| ID | Issue | Area |
|---|---|---|
| B-04 | First `invoice.payment_succeeded` arrives before checkout stores the customer id and is dropped | Billing |
| B-05 | The idempotency marker is written first, so an event is lost if the function dies mid-run | Billing |
| B-07 | Two simultaneous Pro↔Office paths can create duplicate `offices` rows | Billing |
| B-08 | Members of the 2 offices whose owner was deleted keep Office forever and cannot leave | Billing / data |
| B-09 | Office members cannot delete their account or leave the team in the app | Office |
| B-10 | Referral reward for an annual subscriber credits a full year, not a month | Billing |
| B-11 | Apple-billed Pro plus an Office grant code gives permanent free Office | Billing |
| B-12 | A late RevenueCat EXPIRATION revokes a re-subscribed Apple user; DB errors still return 200 | Billing / iOS |
| B-13 | The "one trial per card" guard appears dead (0 card ledger rows) | Billing |
| B-16 | Seat reduction through change-plan applies immediately with a prorated credit | Billing |
| B-17 | Account purge swallows delete failures and skips about 11 tables. This explains the orphan rows | Data |
| B-18 | Capped promo-code uses are spent on "Apply", not on purchase | Billing |
| B-22 | The trial "charge soon" notice is marked sent before it is sent, with no retry | Billing / email |
| DD-07 | Legacy `STRIPE_PRICE_ID` fallback still wired into checkout and promo codes | Billing / legacy |
| DD-08 / NS-10 | The superseded Safari purchase link-out is still live beside IAP on iOS | iOS / policy |
| A-01 | 36% of view events have no matching view row: a key mismatch plus history, not live double counting | Analytics |
| A-02 | Traffic source comes from `?source=` unvalidated, so "QR & NFC scans" can be spoofed | Analytics |
| A-07 | The datacenter filter fails open. "Ashburn, US" views are counted when the geo lookup fails | Analytics |
| A-08 | Trade-show Wi-Fi: per-IP budgets drop real views and silence pushes; the limiter is per-instance memory | Analytics |
| A-10 | QA teardown deletes card_events on a column that does not exist, every night | Analytics / data |
| A-11 | Nothing prunes the ingest log, product_events or site_pageviews; the admin funnel caps silently at 20k rows | Analytics |
| A-13 | "Views" means three different things across milestones, recap and dashboards | Analytics |
| A-17 | The funnel inflates: `card_creation_started` fires on every editor mount (1,566 started vs 340 completed) | Analytics |
| N-02 | Visit dedupe falls back to a NULL visit_key on two live paths; 15 such rows since the migration | Notifications |
| N-03 | Three different unread counts: icon, bell (max 20) and app overwrite | Notifications |
| N-04 | Any DB error in `insertNotification` is treated as a duplicate, silently dropping the bell row and the push | Notifications |
| N-05 | A push that fails in transit is never retried or caught up | Notifications |
| N-07 | Morning catch-up uses the raw plan column, so an expired grant can see a locked lead's name | Notifications |
| N-09 | Lifecycle emails ignore bounce and complaint suppression | Email |
| N-10 | Trial-ending emails are skipped for accounts with no email_preferences row | Email |
| N-12 | The iOS copy remap misses bell rows that contain plan or billing words | iOS / policy |
| N-21 | Recap, activation, catch-up and trial notice all depend on one GitHub Actions secret and schedule | Notifications |
| SEC-01 | The public lead form can confirm whether a contact exists and edit an existing contact by phone number | Security |
| SEC-02 | `/api/account-exists` allows account enumeration without signing in | Security |
| SEC-03 / C02-007 | design-transfer writes users' emails, phones and addresses into Vercel logs (seen in production) | Privacy |
| SEC-04 / C02-013 | Guest uploads (images up to 5 MB, videos up to 25 MB) go to a public bucket and are never cleaned up | Security / cost |
| SEC-07 | "Sign out" in Settings → Devices does not sign the device out; it re-claims the slot. The 2-device limit is set by the caller | Security |
| SEC-08 | Browser roles still hold full grants on about 50 tables, including CRM OAuth tokens; RLS without policies is the only wall. The fix is written but not applied | Security |
| SEC-09 | An Office "admin" can remove other admins and the billing admin | Office / security |
| C02-001 | `createBucket` runs on every share-image and signature upload: 47 duplicate-key DB errors a day | Cards / backend |
| C02-002 | The email-signature capture has no version gate, so a stale tab can overwrite the hot-linked image | Cards |
| C02-003 | The reserved-slug list misses 5 live pages, so a card named "download" is unreachable | Cards |
| C02-006 | Card edits are last-write-wins across tabs and devices | Cards |
| C02-008 | Concurrent draft claims create two cards, and the claim skips name validation | Cards |
| C02-009 | CardScaler treats a brief zero width as permanent, leaving the card invisible (seen in production on Safari at /demo-realty) | Cards / WebKit |
| C02-010 | The email-signature capture skips the pixel check the other captures run | Cards |
| I-02 | A failed CRM sync is lost; the "keeps trying" copy is untrue for that lead | Integrations |
| I-03 | Leads without an email duplicate in HubSpot, Pipedrive and Salesforce on every edit | Integrations |
| I-04 | Token refresh has no single-flight guard; a missing secret in one environment can mark production connections broken | Integrations |
| I-05 | The AI "fallback" is not a fallback; the first provider's failure returns nothing | AI |
| I-06 | A failing Zap is invisible to the user; the payload has no lead id | Integrations |
| I-08 | Every view and lead sends the visitor's IP to a third-party geo API; `/privacy` does not say so | Privacy |
| P-02 | The 585 KB chunk is the Sentry browser SDK with Replay code | Performance |
| P-04 | `/templates` layout shift is 0.84 (cause not traced) | Performance |
| P-05 | The dashboard pulls up to 50,000 view rows in up to 50 serial requests to draw a 60-day chart | Performance |
| E-01 | ENV_KEYS_NEEDED.md has drifted: 68 keys are undocumented and ADMIN_SECRET is documented but barely read | Config |
| E-02 | The `swiftcard.me` fallback for NEXT_PUBLIC_APP_URL is pasted 85 times, so previews send OAuth and Stripe returns to production | Config |
| NS-02 | 6 render-test failures locally come from the in-flight diff (the platform mock is missing `useIsAndroidApp`) | Tests |
| NS-07 | iOS-on-Mac detection can land in the wrong document | iOS on Mac |
| NS-08 | The Android status bar is never styled, so it is invisible in dark mode (seen in the production sweep) | Android |
| NS-09 | No Android keyboard inset handling under edge-to-edge | Android |
| F-AUTH-01 | 262 auth users have no profile: 253 QA leftovers because teardown deletes the profile first | Data |
| F-AUTH-02 | Sign-in with Apple or Google for a non-member creates the auth user, then says "no account" | Auth |
| F-CONTACTS-03 | Notes and "Where we met" fail silently, including on an expired session | Contacts |
| F-SETTINGS-01 | `/profile` and `/profile/card` are orphaned legacy editors still served (source of the production /profile timeout) | Settings |
| F-HELP-01 | The app-safe help answers describe Apple in-app purchase, and Android gets them too | Help / Android |
| F-DASH-01 / F-MKT-01 | Dashboard and compare pages hardcode prices, the 5-lead cap and referral numbers | Copy / plan.ts |
| F-MKT-06 | Accessibility: 44 voice-control label mismatches, 10 contrast failures, text that does not scale, a missing focus ring, focusable items inside aria-hidden | UI / a11y |
| F-OFFICE-01 | A member's name differs between the Team tab and the Analytics tab and CSV | Office |
| F-OFFICE-02 | The Office Contacts tab shows "No contacts yet" when the load fails | Office |
| F-OFFICE-03 | "Edit details" on a teammate's card has no validation or length caps | Office |
| F-OFFICE-05 | Branding save hides the server's error; inputs are uncapped and copied to every member card | Office |
| F-ADMIN-03 | The promo "Email to users" has no confirm, idempotency, cap or log | Admin |
| F-ADMIN-04 | "Create card for business" always claims the login email was sent | Admin |
| F-ADMIN-05 | Admin loading states stick forever on a network failure | Admin |
| DD-13 | The root folder literally named `undefined/` holds 47 committed PNGs (2.9 MB) | Repo |
| DD-17 | Four root docs still say "Swisscard" and list as planned things that shipped months ago | Docs |

---

## Low priority and polish issues

99 Low items, listed by area. Full write-ups are in the appendices.

- **Cards:** C02-005 PATCH accepts an empty name. C02-011 NFC write has no cancel. C02-012 manual rename drops Wallet registrations.
- **Billing:** B-14 latent customization guard gap. B-19 referral credit not idempotent. B-20 expired grants keep server features up to a day (59 checks use the raw plan). B-21 Free cap race. B-23 retention coupon override unvalidated. B-24 prices hardcoded outside plan.ts.
- **Analytics:** A-04 rename skips two tables. A-05 Office custom ranges use UTC. A-12 analytics_events has no reader. A-14 the console's own View links inflate counts. A-15 offline replay header can backdate views. A-16 the bare "bot" token drops real Android phones. A-18 time zones differ per screen. A-19 partial-period comparisons. A-20 41 historical rows still carry visitor email or phone. A-21 advisor noise.
- **Notifications:** N-06 identical-wording dedupe drops distinct events. N-13 Office badge disagrees with the bell. N-14 Office read state is shared across admins. N-15 raw plan in lead_reply. N-16 30 s polling with 3–4 queries. N-17 duplicate index. N-18 the payment_failed destination inside iOS. N-20 push URL mismatch.
- **Security:** SEC-05 open image proxy. SEC-10 one secret is both the encryption and signing key. SEC-11 one scheduler secret for all jobs. SEC-12 soft-deleted accounts keep API access. SEC-13 fake Wallet registrations. SEC-14 no global AI spend cap. SEC-15 telemetry sinks accept anything. SEC-16 CSP is clickjacking-only. SEC-17 IPv6 SSRF gaps. SEC-18 CSV caching and formula escaping.
- **Performance and config:** P-07 two serial DB trips in the proxy. P-08 /checkout/success re-renders every 2 s. P-09 no image optimisation on public pages. I-07 disconnect never revokes the OAuth grant. E-03 `!`-asserted env reads crash at request time. E-04 next.config notes. E-05 69 ESLint warnings, 27 of one real bug class.
- **Native:** NS-11 compare-page prices in the app. NS-12 Watch and widget ship although the docs say they don't; orphan API. NS-13 the service worker is inert in iOS. NS-14 versions say 1.0.7 in code but 1.0.6 in the build; the Play listing doc is stale. NS-15 detection notes.
- **Flows and screens:** F-AUTH-04/05; F-ONB-01..04 (bogus invite link returns 200; plan-step rules disagree; hardcoded referral numbers; first-lead nudge only at exactly 1). F-DASH-02 leads vs contacts. F-DASH-04 the invite banner can't be dismissed. F-CONTACTS-01 reminders table orphaned. F-CONTACTS-04..07 (no 401 handling, no caps, manual adds spend the Free quota, the tour re-seeds the sample contact). F-SCAN-01 orphan email endpoint. F-SCAN-02 one error message for every failure. F-GROW-01/02. F-SETTINGS-02 "Change password" goes to the recovery page. F-SETTINGS-03. F-HELP-03. F-MKT-02 every 404 says "Couldn't find that card". F-MKT-03 error page always sends to /dashboard. F-MKT-04 contact form loses a pre-hydration submit. F-NAV-01 tab names differ by device.
- **Office and admin:** F-OFFICE-04, 06–13 (role assignment exists only in the database, no 401 handling, an offline card is still shareable, raw JSON on the rate limit). F-ADMIN-06..11.
- **Dead and legacy code:** DD-01..05, 09, 11, 12, 14, 15, 18.

---

## Code quality

- **Healthy:** `tsc` is clean. ESLint shows 0 errors and 69 warnings (27 of one real-bug-class rule, most of the rest in scripts). There are 6,298 unit and source-invariant tests and 90 render test files. There are no TODO or FIXME markers, and essentially no commented-out code.
- **Local test state:** 2 unit failures and 6 render-file failures are all explained by the other session's uncommitted diff or a timeout (Appendix E in 09, NS-02). CI is green at HEAD.
- **Weak spots:**
  - Errors are often swallowed with `catch(() => …)`: Office Contacts, admin pages, Branding, Contacts notes.
  - No screen handles an expired session (401) by sending the user to sign in.
  - Server-side length caps are missing on many text inputs.
  - 59 server checks use the raw `plan` column instead of `effectivePlan`.
  - The `!`-asserted env reads in 25 files crash at request time.
  - The 2,555-line card wizard, 2,000-line Contacts client and 1,288-line dashboard are hard to change safely.

## Broken features

These are confirmed not working as intended:
- Push delivery to almost everyone (NS-05, N-11).
- Notification read state (N-01).
- The Android scanner camera (NS-03).
- Devices "Sign out" (SEC-07).
- Reminders, which have no writer and no UI (F-CONTACTS-01).
- Role assignment in the Office console, which has no UI (F-OFFICE-07).
- The 404 page for non-card URLs (F-MKT-02).
- The broken favicon on the demo card: `/api/link-icon?host=northwind.io` returns 404 on every load in both engines.

## Partially implemented features

- **Twilio SMS:** the code is complete, but the A2P registration is still blocked. Three lead_messages have sat in "queued" status.
- **LinkedIn photo import:** gated off by env.
- **Office roles:** an API exists but there is no UI.
- **Android "sells nothing":** in flight, uncommitted.
- **Exact card captures:** in flight, uncommitted.
- **Apple Watch and widget:** they ship in the binary, but the docs say they don't, and the API is orphaned (NS-12).
- **Retention pruning:** functions exist but nothing schedules them (A-11).
- **Least-privilege SQL:** written, not applied (SEC-08).
- **Design transfer:** quality was never judged by the owner (HANDOFF).

## UI / UX

- **Verified live:**
  - 67 public routes × 4 widths × 2 engines (536 page loads) showed no horizontal overflow, no invisible cards and no server errors.
  - The logged-out sweep showed 0 findings at 390, 768, 1280 and 1920 px.
  - The logged-out Android-shell sweep was clean except for the status bar.
- **Issues:**
  - Accessibility (F-MKT-06): 64 findings. Voice-control labels do not match visible text on homepage demo cards and the template picker. Contrast fails on the pricing summary, terms and 9 px home text. Only 32 of 60 text nodes scale with the user's font size.
  - `/templates` layout shift is 0.84.
  - Small tap targets on product pages.
  - The leads vs contacts wording drifts across the dashboard and admin.
  - Office tab and column names are inconsistent.
- **Not verified live:** signed-in screens. See "What could not be verified" above.

## Analytics — can the data be trusted?

**For an owner's own card dashboard: yes, mostly.**
- Same-visitor dedupe works, with 0 duplicate rows within 30 minutes in production.
- Owner self-views are excluded.
- No view row lacks a visitor id, and IP addresses are not stored.
- The numbers tend to undercount (trade-show Wi-Fi caps, ITP on iPhones) rather than overcount.

**For anything used to make business decisions, sell, or compare: no, not yet.**
- Views, scans and saves can be fabricated by a direct POST (A-09).
- "QR scans" come from an unvalidated URL parameter (A-02).
- Admin lead totals are about 9× real, because 223 of 245 leads are the seeded sample (A-06).
- A third of view rows and most leads belong to deleted owners (A-03, A-10).
- The datacenter filter fails open (A-07).
- "Views" means different things on different screens (A-13).
- The signup funnel counts editor mounts as starts (A-17).
- Nothing is ever pruned (A-11).

**Event coverage:** card views, Swift Links views, vCard saves and link clicks are recorded. Scanner use, Create+ link opens, NFC taps and Wallet opens are recorded only as a view `source`, not as their own events. The full matrix is in 04-analytics Appendix A.

## Notifications

- **The pipeline design is sound:** one notification per visit, rank upgrade instead of duplicates, quiet hours with a morning catch-up, and 0 duplicate visit keys in production.
- **In practice:**
  - Push reaches one device system-wide (NS-05, N-11).
  - Read state is never set outside the bell (N-01).
  - DB blips are silently treated as duplicates (N-04).
  - Failed pushes are never retried (N-05).
  - The three badge counts disagree (N-03).
  - Lifecycle emails ignore bounce suppression (N-09).
  - Trial emails are skipped for accounts without a preferences row (N-10).
- **SMS is not live,** pending A2P registration.

## Performance

- Slow 4G on the homepage: 2.4 MB HTML, 3,782 DOM nodes, LCP 4.9 s, blocking time 6.4 s (P-01).
- Card pages are uncached, with a 2 s time to first byte (P-03).
- The dashboard runs up to 50 serial view-row requests (P-05).
- The Sentry Replay SDK is 585 KB (P-02).
- There is no image optimisation on public pages (P-09).
- The bell polls every 30 s per tab (N-16).
- The database is healthy: 102 ms latency and 43 MB size. The advisors list 18 unindexed foreign keys (mostly marketing-agent tables), 15 unused indexes and 1 duplicate index.

## Billing / plans / permissions

- **Happy-path Stripe checkout, renewal and cancel are wired.** Server-side plan sanitizing covers the card editors, and the `/api/profile` route strips server-only fields.
- **Open money bugs:**
  - B-01: extra seat cycle (July #3).
  - B-02: out-of-order events trim members (July #2).
  - B-15: double subscription with no refund.
  - B-16: immediate seat cut.
  - B-10: annual referral reward credits a year.
  - B-11: free Office via Apple Pro plus a grant code.
  - B-18: promo uses spent on Apply.
- **Permission gaps:**
  - An Office admin can remove other admins (SEC-09).
  - Roles cannot be assigned in the UI (F-OFFICE-07).
  - Members can't leave a team (B-09).
  - Members of the 2 ownerless offices are stuck (B-08).
- **The full state matrix** (22 user states × effective plan × UI × gating) is in 03 Appendix A. The role matrix is in 06 Appendix B.

## Database / data integrity

| Fact (production, 2026-10-12) | Meaning |
|---|---|
| 262 of 296 auth users have no profile | 253 are QA leftovers and 8 are real people who tried "Sign in" without an account (F-AUTH-01/02) |
| 205 of 245 leads and 101 of 298 card views reference deleted owners | Purge leaves rows behind (B-17, A-10) |
| 2 offices have an owner who no longer exists | Members are stuck on Office (B-08) |
| 2 enterprise profiles have no office_id | Inconsistent plan state |
| 246 user_devices and 108 email_preferences rows have no profile | Purge and QA teardown gaps |
| 907 of 921 Wallet pass rows match no card (893 are QA names) | QA residue |
| 0 `invoice.payment_failed` events ever stored | The Stripe subscription may be missing (B-06) |
| 0 lead_reminders rows ever | Feature has no writer (F-CONTACTS-01) |
| RLS on all tables; policies on 7; full grants left on about 50 | Safe only because of RLS with no policy (SEC-08) |
| All 4 storage buckets are public, with 0 object policies | Writes go only through the server; guest uploads accumulate (SEC-04) |
| 73 loose SQL files, no migration tracking; base tables never created in the repo | Production schema cannot be rebuilt from source |

## Cross-platform differences

The full parity table is in 08 Appendix A.

| Feature | Web | iOS | Android |
|---|---|---|---|
| Selling | Stripe | Apple IAP plus a leftover Safari link-out (NS-10) | Should sell nothing; work in flight |
| Push | Web push | Decays to zero (NS-05) | Same mechanism |
| Offline | Service worker | Native OfflineCard; the service worker is inert (NS-13) | Service worker |
| Scanner | Works | Works | Camera blocked (NS-03) |
| Wallet | Apple only | Apple only | None |
| NFC | Not available | Available | Not available |

- **iOS-on-Mac:** NFC, Wallet and camera are hidden; Mac detection is fragile (NS-07).
- **Safari vs Chrome:** identical in the 536-load sweep. Production logged an invisible-card error only on Safari (C02-009), which did not reproduce headless.

## Dead / duplicate / legacy code

- **Never imported:** `AddSeatButton`, `HeroPhone` and `Skeleton` components; `office-attention.ts` library.
- **Retired endpoint still accepting posts:** `/api/views/[username]`.
- **Orphan APIs:** `/api/office/role`, `/api/office/cards` (GET), `/api/office` (GET), `/api/scanner/send`, `/api/watch/card`.
- **Legacy env still read:** `STRIPE_PRICE_ID`. **Dead env:** `HUBSPOT_CLIENT_ID`/`SECRET`.
- **Debug component in the dashboard bundle:** `IapProbe`.
- **Repo clutter:** the `undefined/` folder (47 PNGs); `qa-sweep-out/` (36 MB, untracked); `audit-results/` from July; four stale docs saying "Swisscard"; `REFERRAL_SETUP.sql` at the root; a stash from 2026-09-20 holding an unmerged `card-templates/shared.tsx` change.
- **Database tables:** 4 tables are created but unused by the app.
- **Never-run retention:** `prune_*` functions.
- **Previously reported, now resolved:** viewed-card notifications exist now (HANDOFF said not built). The "Total leads" header on the marketing demo is gone (F-MKT-05). The PhotoFirst knowledge-base drift is a false positive (F-HELP-02).

## Already-known items: status

| Item (source) | Status today |
|---|---|
| July #2: out-of-order webhook trims members | **Still open** (B-02) |
| July #3: seat reduction billed an extra cycle | **Still open** (B-01) |
| July: verify RLS on base tables | **Settled.** Data is safe; grants were never revoked (SEC-08) |
| July: run admin-email-log.sql | Applied (the `admin_email_campaigns` table exists) |
| HANDOFF: viewed_card notifications not built | **Done** |
| HANDOFF: badge capped at 20 fetched rows | **Still true** (N-03) |
| HANDOFF: Twilio A2P blocked | Still not live (code returns not_configured) |
| AGENTS.md: deploy watchdog switched off | Not checkable from here; the workflow did not appear in recent runs |
| `least-privilege-2026-09-24.sql` | **Not applied** |

## Uncommitted work in progress (not audited as shipped)

Another session has 40 modified and 6 untracked files that implement two features:
- **"The Android app sells nothing":** AndroidProInfo, an Android request check, and 15 plan and selling components.
- **Exact card captures:** `capture-exact.ts`; capture version 9→10.

This diff causes all local test failures: 2 unit tests, plus 6 render files where the platform mock lacks the new `useIsAndroidApp` hook. Those tests must be updated before that work can pass CI. Its effect on F-HELP-01, NS-04 and the Android parity rows is described in 08 Appendix C.

---

## Master audit table

✅ Verified working · ⚠️ Works with issues · ❌ Broken · 🟡 Partial · ❓ Unable to verify · N/A

"Verified" means a live check in this audit (production sweep, probe, SQL) or a passing test run recorded in the appendix. Signed-in columns are ❓ where only code tracing supports them.

| Feature | Desktop Web | Mobile Web | iOS | Android | Backend | Analytics | Notifications | UI | Status |
|---|---|---|---|---|---|---|---|---|---|
| Marketing site, blog, compare, legal | ✅ | ✅ | N/A | N/A | ✅ | ⚠️ A-17 | N/A | ⚠️ a11y, P-01 | ⚠️ |
| Public card page | ✅ | ✅ | ❓ | ❓ | ⚠️ P-03 | ⚠️ A-09 | ✅ | ⚠️ C02-009 | ⚠️ |
| Save contact (vCard) | ✅ | ✅ | ❓ | ❓ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Swift Links page | ✅ | ✅ | ❓ | ❓ | ⚠️ C02-A19/A23 (editor) | ⚠️ A-13 | ❓ | ✅ | ⚠️ |
| Offline card | ✅ | ✅ | ❓ NS-13 | ❓ | ✅ | ⚠️ A-15 | N/A | ✅ | ⚠️ |
| Apple Wallet pass | ✅ | ✅ | ❓ | N/A | ⚠️ SEC-13 | ✅ | N/A | ❓ | ⚠️ |
| Link previews / OG image | ✅ | ✅ | N/A | N/A | ⚠️ C02-001/004 | N/A | N/A | ✅ | ⚠️ |
| Signup / login / reset | ✅ | ✅ | ❓ | ✅ | ⚠️ F-AUTH-02, SEC-02 | N/A | N/A | ✅ | ⚠️ |
| Guest card wizard (/cards/new) | ✅ | ✅ | ❓ | ✅ | ⚠️ C02-008, C02-A55 | ⚠️ A-17 | N/A | ⚠️ C02-A52 (non-Latin name blocked) | ⚠️ |
| Card editing / templates / design | ❓ | ❓ | ❓ | ❓ | ⚠️ C02-003/006, C02-A43 | N/A | N/A | ⚠️ C02-A39/A40/A41 (unsaved-changes guard gaps) | 🟡 |
| QR sharing | ✅ | ✅ | ❓ | ❓ | ✅ | ⚠️ A-02 | N/A | ✅ | ⚠️ |
| NFC sharing | N/A | ❓ | ❓ | N/A | ✅ | ⚠️ A-02 | N/A | ⚠️ C02-011 | ❓ |
| Email signature | ❓ | ❓ | ❓ | ❓ | ⚠️ C02-002/010 | ✅ | N/A | ❓ | ⚠️ |
| Lead capture form | ✅ | ✅ | ❓ | ❓ | ⚠️ SEC-01 | ⚠️ A-06 | ⚠️ N-08 | ✅ | ⚠️ |
| Contacts / lead management | ❓ | ❓ | ❓ | ❓ | ⚠️ P-06 | ⚠️ A-06 | ❓ | ⚠️ F-CONTACTS-03 | ⚠️ |
| Warm-lead / return alerts | ❓ | ❓ | ❌ NS-05 | ❌ NS-05 | ⚠️ N-02 | ✅ | ❌ N-11 | ❓ | ❌ |
| AI card scanner | ❓ | ❓ | ❓ | ❌ NS-03 | ⚠️ I-05 | ❓ | N/A | ⚠️ F-SCAN-02 | ⚠️ |
| Reminders | ❌ | ❌ | ❌ | ❌ | ❌ F-CONTACTS-01 | N/A | N/A | ❌ | ❌ |
| SMS follow-ups | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 A2P pending | N/A | 🟡 | ❓ | 🟡 |
| Google Contacts / HubSpot / Salesforce / Pipedrive / HighLevel | ❓ | ❓ | ❓ | ❓ | ⚠️ I-01..04 | N/A | ⚠️ I-02 | ❓ | ⚠️ |
| Zapier | ❓ | ❓ | ❓ | ❓ | ⚠️ I-06 | N/A | ⚠️ | ❓ | ⚠️ |
| Owner dashboard analytics | ❓ | ❓ | ❓ | ❓ | ⚠️ P-05 | ⚠️ trusted for own card | N/A | ❓ | ⚠️ |
| Admin analytics | ❓ | N/A | N/A | N/A | ⚠️ | ❌ A-03/A-06 | N/A | ❓ | ❌ |
| In-app bell | ❓ | ❓ | ❓ | ❓ | ⚠️ N-04 | N/A | ❌ N-01/N-03 | ❓ | ⚠️ |
| Push notifications | ❓ | ❓ | ❌ NS-05 | ❌ NS-05 | ⚠️ N-05, NM-07 (no email fallback) | N/A | ❌ N-11 | ❓ | ❌ |
| Email (welcome, receipts, lifecycle) | N/A | N/A | N/A | N/A | ⚠️ N-09/N-10, NM-11, DC-01 | N/A | ⚠️ | N/A | ⚠️ |
| Settings / devices / delete account | ❓ | ❓ | ❓ | ❓ | ⚠️ SEC-07 | N/A | N/A | ⚠️ F-SETTINGS-02 | ⚠️ |
| Stripe checkout / billing | ❓ | ❓ | N/A | N/A | ⚠️ B-03/06/15 | ⚠️ A-17 | ⚠️ B-22, NM-04 (declined card can go unannounced) | ❓ | ⚠️ |
| Free trial / expiry | ❓ | ❓ | ❓ | N/A | ⚠️ B-20/22 | N/A | ⚠️ N-10 | ❓ | ⚠️ |
| Apple IAP | N/A | N/A | ❓ | N/A | ⚠️ B-12 | N/A | N/A | ⚠️ NS-04/10 | ⚠️ |
| Promo codes / referrals | ❓ | ❓ | ❓ | ❓ | ⚠️ B-10/18/19 | N/A | N/A | ⚠️ hardcoded copy | ⚠️ |
| Office console (team, analytics, branding) | ❓ | ❓ | ❓ | ❓ | ❌ C02-A01/A02 (branding), B-01/02, SEC-09 | ⚠️ F-OFFICE-01 | ⚠️ N-14 | ⚠️ F-OFFICE-02/05 | ⚠️ |
| Office invites / seats | ❓ | ❓ | ❓ | ❓ | ❌ B-01/B-02 | N/A | ✅ | ⚠️ F-OFFICE-04 | ❌ |
| Site admin tools | ❓ | N/A | N/A | N/A | ⚠️ SEC-06 | ❌ | N/A | ❌ F-ADMIN-01/02 | ❌ |
| Help / sales assistants | ❓ | ❓ | ⚠️ N-12 | ⚠️ F-HELP-01 | ⚠️ SEC-14 | N/A | N/A | ❓ | ⚠️ |
| Android app shell (logged out) | N/A | N/A | N/A | ⚠️ NS-08 | N/A | N/A | N/A | ⚠️ | 🟡 |
| iOS app shell | N/A | N/A | ⚠️ NS-01/04/06 | N/A | N/A | N/A | ❌ | ⚠️ | ⚠️ |
| Apple Watch / widget | N/A | N/A | 🟡 NS-12 | N/A | 🟡 | N/A | N/A | ❓ | 🟡 |
| Google Wallet | N/A | N/A | N/A | ❌ not built | N/A | N/A | N/A | N/A | N/A |

---

## Addendum (2026-10-14): completed appendices

The three appendices the first pass could not finish are now done, against the same commit `655a4480`, read-only. They add 82 findings: 4 High, 27 Medium, 51 Low.

**11 — Dead-code inventory.** An import graph over 1,388 committed files plus reachability from 287 Next.js entry points. Results:
- 3 dead component files (`AddSeatButton`, `HeroPhone`, `Skeleton`; DD-01..03) and 1 test-only lib (`office-attention`).
- 26 unused exports in `src/lib`, plus 31 exports that only tests run.
- 5 API routes with no caller (DC-01..05). The notable one is **DC-01**: `/api/email/one-click-unsubscribe` is referenced nowhere, and outgoing `List-Unsubscribe` headers use other routes. Either the one-click wiring was never finished or the route is leftover.

**12 — Card-editor control inventory.** 296 controls across the wizard, Edit card, designers, upload/crop, Swift Links, Office Branding, admin Create card and the share/QR/wallet/signature modals, each traced to its route and table. 63 defects (C02-A01..A65). The High ones are in the table above. Notable Medium items:
- **C02-A40:** text typed before the Edit page hydrates is recovered for only 6 fields.
- **C02-A19:** per-link "Row style" is labelled Pro but works on Free.
- **C02-A20 / A22 / A44:** uploads race the form: a stale link list is restored, Save isn't blocked mid-upload, and a cancelled crop still applies.
- **C02-A43:** `/api/cards/[id]/rename` has no plan or view-only check.
- **C02-A23:** `tel:` and `mailto:` links are saved as `https://tel:`.
- **C02-A32:** "Add to card" ignores the 40-element cap and can delete the name or QR.
- **C02-A54:** "Get Office" from a Free account ends on `/upgrade` with plan, seats and promo dropped.
- **C02-A55:** the card-count limit isn't atomic.
- **C02-A11:** admin Create card always says the email was sent.

One subagent claim was refuted on re-check: design-transfer and scan-design do call `aiConsentBlock`.

**13 — Notification trigger matrix.** 57 rows (every bell type, push-only send, team-inbox type, email/SMS kind and operator channel) with trigger, recipient, plan, channels, dedupe, quiet hours, preference and pinning test, plus a channel failure-handling table. 14 defects (NM-01..14):
- **NM-04 (Medium, re-read):** if the payment-failed email can't be sent, the bell row and push for that failure are skipped too (`stripe/webhook/route.ts:173, 198-201`). Together with B-06 (no `invoice.payment_failed` event has ever been stored), a declined card can produce no warning anywhere.
- **NM-07 (Medium):** an owner with no push device gets nothing outside the app for a new lead or a reply. With 1 registered device in production (N-11), that is almost everyone.
- **NM-11 (Medium):** trial-charge and Pro-ending notices are stamped "sent" before sending and never retried.
- Low: the catch-up pushes bell-only types (NM-01), skips the closed-contact filter (NM-02), loses milestone views (NM-03) and ignores `skipPushFor` (NM-09). The weekly-recap push switch also hides the bell row (NM-05). Six types have no test (NM-08). Missing VAPID keys fail silently (NM-12).
- Suspected: NM-06 (three type names for one message), NM-10, NM-13 (recap cron timeout as users grow) and NM-14 (stale whole-`customization` writes).

---

## Appendices (full 13-field write-ups)

Each file has every finding with Severity, Platform, Account type, Feature/page, File:line, Problem, Expected, Actual, Reproduce, Likely cause, User impact and Confidence.

| File | Area | Extras |
|---|---|---|
| `baseline-evidence.md` | Every test run, probe, sweep and SQL count behind this report | Spot-check verdicts |
| `01-dead-duplicate-legacy.md` | DD-01..18 | — |
| `02-cards-editor-links.md` | C02-001..013 | — |
| `03-billing-plans-permissions.md` | B-01..24 | 22-state matrix |
| `04-analytics.md` | A-01..21 | Event matrix, trust verdict, follow-up SQL |
| `05-notifications.md` | N-01..21 | — |
| `06-security.md` | SEC-01..21 | Route authorization matrix (178 routes), Office capability matrix, secrets scan |
| `07-integrations-env-perf.md` | I, E, P | Integration status, env table, performance hot spots |
| `08-native-shells.md` | NS-01..16 | Parity table, App Review 3.1.1 checklist, in-flight Android diff |
| `09-flows-screens-controls.md` | F-AUTH, ONB, DASH, CONTACTS, SCAN, GROW, SETTINGS, HELP, MKT, NAV | Control inventory, hrefs, labels, KB drift, test diagnosis |
| `10-office-admin.md` | F-OFFICE, F-ADMIN | Control inventory |
| `11-dead-code-inventory.md` | DC-01..05 (plus DD refs) | Dead files, test-only modules, unused exports, uncalled API routes |
| `12-card-editor-controls.md` | C02-A01..A65 | 296-control inventory with handler → route → table, gating, loading/error/double-submit |
| `13-notification-trigger-matrix.md` | NM-01..14 | 57-row trigger matrix, channel failure handling |

**Gaps in this audit:**
- The dead-code inventory, card-editor control inventory and notifications trigger matrix were completed on 2026-10-14 (appendices 11–13).
- Signed-in screens need a live pass with the service-role key, which would let the nightly QA scripts run locally against seeded accounts.
