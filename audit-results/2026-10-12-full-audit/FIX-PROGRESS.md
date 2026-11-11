# Audit fix progress (local, uncommitted)

Process and order: C:\Users\Malve\.claude\plans\soft-singing-babbage.md
Three items per round; owner approves each round before work starts.
Status: open · in progress · FIXED (commit, live sha) · ALREADY FIXED (commit) · SKIPPED (owner) · NEEDS OWNER

## High tier
| Round | Item | Status | Notes |
|---|---|---|---|
| 1 | NS-01 Capacitor critical advisory | FIXED + LIVE (5de09da8, live in 44ff6af5) | native part ships with next Mac/Android build (OWNER-MANUAL-ACTIONS #1, #2) |
| 1 | NEW: Next.js 16.3.4 critical RCE (next/og) + 6 advisories | FIXED + LIVE (5de09da8, live in 44ff6af5) | owner approved adding it to round 1 |
| 1 | NS-03 Android CAMERA permission | FIXED + LIVE (b9edfed9; phones need next Android build) | ships with next Android build |
| 1 | NS-06 Chunk-load recovery | FIXED + LIVE (ea96ba44) | Skew Protection = Pro plan (OWNER-MANUAL-ACTIONS #3) |
| later | NEW: vitest/tinypool critical advisories (dev-only, never shipped) | open | vitest 3→5 is a major bump; schedule with tooling items |
| 2 | B-01 Seat reduction extra cycle | FIXED + LIVE (80149773, live in 4139d0d3) | + owner 24h seat rule; preview-route quote during a pending reduction noted for B-16 |
| 2 | B-02 Out-of-order subscription.updated | FIXED + LIVE (80149773, live in 4139d0d3) | |
| 2 | B-15 Checkout supersede cancels without refund | FIXED + LIVE (80149773, live in 4139d0d3) | |
| 3 | SEC-06 Admin MFA / leaked-password | MFA REMOVED BY OWNER (37ceafbd, 2026-10-19); leaked-password = OWNER #5 | was: two-step = OWNER #4 at first /admin visit; leaked-password = OWNER #5; 2 admin routes used isAdminEmail directly (fixed) |
| 3 | F-ADMIN-01 Users list plan dropdown | FIXED + LIVE (4139d0d3) | |
| 3 | F-ADMIN-02 User detail actions | FIXED + LIVE (4139d0d3) | "Take offline" notifying the owner = new behaviour, not added (ask) |
| 4 | NS-05 Push token binding | FIXED + LIVE (693ef8d3) | |
| 4 | N-11 Push registration opt-in only | FIXED + LIVE (693ef8d3) | |
| 4 | N-01 Notifications never marked read | FIXED + LIVE (693ef8d3) | nid only from visit-notify pushes (views, saves, leads, returns); billing/team/recap pushes carry none yet |
| 5 | B-03 customization read-modify-write | FIXED + LIVE (371239e7 + ae3f87ed) | merge_customization SQL applied to prod |
| 5 | B-06 Unhandled Stripe terminal states | FIXED + LIVE (371239e7) | Stripe dashboard = OWNER #6, #7 |
| 5 | N-08 Per-IP notify flood cap | FIXED + LIVE (371239e7) | push cap 6/h kept; record ceiling 60/h added (rotating-id abuse) |
| 6 | C02-A01 Office brand partial save | FIXED + LIVE (111592d3) | |
| 6 | C02-A02 Brand propagation office_id check | FIXED + LIVE (111592d3) | |
| 6 | C02-A39 Link bypasses unsaved guard | FIXED + LIVE (111592d3) | ask owner: keep a Free user's unsaved Pro design through checkout? (new behaviour, not added) |
| 7 | C02-A52 Non-Latin name blocked | LIVE (6406d1ab, via 65325d94) | |
| 7 | C02-004 Rename copies pre-edit capture | LIVE (6406d1ab) | |
| 7 | NS-04 iOS selling UI flash | LIVE (6406d1ab) | server-known native via NativeRequestBoundary on signed-in screens |
| 8 | A-09 Fabricated views | LIVE (c94778fa) | cookieless ceiling 300/day per IP per card; device-key dedupe NOT extended (2026-09-18 two-iPhones bug) |
| 8 | A-06 Seeded sample lead in admin | LIVE (c94778fa) | |
| 8 | A-03 Deleted owners in admin analytics | LIVE (c94778fa) | |
| 9 | P-03 Card page uncacheable | LIVE, partial (65325d94) | /card/ redirect at the edge + cached plan-limit; full CDN caching = owner question |
| 9 | P-06 /contacts 1000-row cap | LIVE (65325d94) | paged 1000 at a time |
| 9 | P-01 Homepage 2.4 MB | ALREADY FIXED (129d12e5) | 204 KB measured live 2026-10-16 |
| 9 | I-01 CRM call timeouts | LIVE (65325d94) | CRM calls already bounded by ddf2a79a; added timeouts to Google + Salesforce OAuth token exchange |

## Medium / Low tiers
Proposed round by round in area order (see plan). Items get added here as they are proposed.

| Round | Item | Status | Notes |
|---|---|---|---|
| 10 | B-04 First payment not recorded | LIVE (642d7fa5) | subscription_data.metadata.user_id + invoice owner fallback; retry (500) for an untagged first invoice under 1h |
| 10 | B-05 Event marked handled on arrival | LIVE (642d7fa5) | state processing/done, stale 3 min takeover, 409 while in progress, maxDuration 60. NEEDS the stripe_events.state column in prod (MCP migration was blocked by permission) — code falls back to old behaviour until then |
| 10 | B-22 Trial notice stamped before send | LIVE (642d7fa5) | stamp after send via merge; Resend idempotency key; stale cancel flag checked with Stripe |
| 11 | B-07 Duplicate offices per owner | LIVE (0efac80b) | settleOneOffice (oldest wins, racer deletes its own row); unique index SQL in supabase/offices-one-per-owner.sql = OWNER-MANUAL #9 |
| 11 | B-08 Orphan-office members locked in | LIVE (0efac80b) | resolveOfficeContext null when owner gone; daily releaseOrphanedOffices sweep (0 affected in prod today) |
| 11 | B-10 Referral credit 12x for annual | LIVE (0efac80b) | referralCreditCents: monthly equivalent x seats |
| 11 | B-09 Members can't delete own account | ASK OWNER | conflicts with owner decision 2026-09-23 recorded in office/members/delete-account/route.ts |
| 12 | B-11 Apple Pro + Office grant = free Office | LIVE (c4887b2d) | grant refused for Apple payers, before the code is spent |
| 12 | B-12 Late RevenueCat EXPIRATION revokes payer | LIVE (c4887b2d) | revoke re-checks rcProActive; write errors throw; 8s timeout |
| 12 | B-13 Card fingerprint null for every trial | LIVE (c4887b2d) | lib/stripe-card-fingerprint: sub → customer → setup intent → attached card; reported when none. Needs a test-mode run to confirm in prod |
| 13 | B-16 change-plan lowers seats with credit | LIVE (76bef8da) | 409 use_seats_control before any Stripe change; BillingManager shows message |
| 13 | B-17 Purge leaves data behind | LIVE (76bef8da) | safeDelete checks {error}; purge stops before profile on failure; +user_devices, apple_refresh_tokens, push_log, unsubscribe_events, contact_links/devices, office_notifications. FOLLOW-UP: QA scripts' auth-only deletes + one-off orphan cleanup (needs owner OK) |
| 13 | B-18 Promo uses spent on Apply | LIVE (76bef8da) | redeem only checks non-grant codes; daily releaseAbandonedPromoClaims (>25h unspent); checkout reuse refreshes redeemed_at |
| 14 | N-04 insertNotification false for every error | LIVE (8f0522a6) | writeNotification created/duplicate/failed, reported; payment_failed + lead_reply push unless duplicate |
| 14 | N-06 identical-words dedupe drops distinct events | LIVE (8f0522a6) | identity includes lead_id |
| 14 | N-02 visit rows written outside the ledger | LIVE (8f0522a6) | scoped ownVisitKey for slug hand-over; column fallback reported |
| — | DD-07 legacy STRIPE_PRICE_ID fallback | ASK OWNER | removal |
| 15 | N-07 catch-up uses raw plan column | LIVE (849a5dc7) | isPaidProfile + PLAN_COLUMNS |
| 15 | N-15 lead_reply masked by raw plan | LIVE (849a5dc7) | isPaidProfile |
| 15 | N-10 lifecycle mail skipped without prefs row | LIVE (849a5dc7) | ensureEmailPreferences before getEmailPrefs |
| 16 | N-13 badge counts rows the bell hides | LIVE (9ffea4a2) | hiddenTypesForReader |
| 16 | N-09 owner mail ignores bounce/complaint list | LIVE (9ffea4a2) | ownerMailAddress + welcome isOptedOut |
| 16 | N-20 Free morning tap lands on Contacts | LIVE (9ffea4a2) | destinationFor(paid) |
| 16 | N-18 payment_failed opens billing in app | VERIFIED OK | BillingManager renders compliant panel in app |
| — | N-12 referral copy in app | ASK OWNER | App Review copy decision |
| — | N-03 badge flaps 20 vs total | DEFERRED | needs NotificationBell, being edited by another session |
| 17 | SEC-03 PII in logs | LIVE (ae920b7d) | reportError scrubs message/stack/extra; design-transfer logs leak kinds |
| 17 | SEC-01 lead form oracle + tampering | LIVE (ae920b7d) | uniform response; fill/bind only from a browser already bound to that contact |
| 17 | SEC-02 account-exists oracle | LIVE (ae920b7d) | answers only about an email this browser (sc_vid) shared |
| 18 | SEC-09 admin removes peer admins | LIVE (1168a4e7) | owner-only for admin/billing_admin |
| 18 | SEC-04 guest uploads forever | LIVE (1168a4e7) | adopt on claim, 30-day purge, refuse unreadable guest file. FOLLOW-UP: guest video human gate waits for Turnstile |
| 18 | SEC-18 exports cache/limit/escaping | LIVE (1168a4e7) | lib/csv-cell, no-store, team export rate limit |
| 19 | SEC-12 deleted accounts keep API access | LIVE (f36bda28) | lib/live-account guard on cards, leads/manual, checkout, scanner, upload, link-video. Integrations routes not yet |
| 19 | SEC-20 GET unsubscribe unsubscribes | LIVE (f36bda28) | GET asks; form POST ?ui=1; one-click POST unchanged |
| 19 | SEC-21 SW caches any path | LIVE (f36bda28) | APP_PATH denylist in saveCard + navigate |
| — | SEC-07 device sign-out doesnt sign out | NEEDS OWNER | DB migration (revoked tombstone / SECURITY DEFINER claim_device_slot) |
| 20 | C02-001 createBucket every upload | LIVE (77614784) | lib/public-bucket |
| 20 | C02-003 reserved slugs miss live pages | LIVE (77614784) | +9 names; test derives from src/app |
| 20 | C02-008 draft claim races/clamps/photoUrl | LIVE (77614784) | settle after insert; clampCardWrite; photoUrl null. Name-required NOT added (claim client has no 400 handling) |
| 21 | C02-002 signature route unguarded | LIVE (b6d31b3d) | version 409, PNG + card-shape |
| 21 | C02-010 signature skips pixel check | LIVE (b6d31b3d) | capturePainted + SIGNATURE_CAPTURE_VERSION |
| 21 | C02-005 PATCH accepts empty name | LIVE (b6d31b3d) | 400 like create |
| 22 | C02-009 CardScaler 0-width hides card | LIVE (f7d3223d) | 0 = unknown; collapse report skips unseen pages; 10 render files green |
| 22 | C02-011 NFC write no cancel | LIVE (f7d3223d) | AbortController, 60s timeout, button cancels, abort on unmount |
| 22 | C02-012 manual rename drops wallet regs | VERIFIED BY DESIGN | rename_card_slug keeps no alias; old slug freed, UI warns |
| 23 | A-02 unvalidated ?source= | LIVE (5322a189) | storedSource allowlist; widget label |
| 23 | A-10 QA teardown wrong column | LIVE (5322a189) | card_owner_username; __links views. Deletion-time analytics scrub NOT done (conflicts with 30-day reopen) |
| 23 | A-11 nothing prunes / funnel 1000-row cap | LIVE (5322a189) | paged funnel; daily pruneLogTables. ASK OWNER: site_pageviews retention |
| 24 | A-08 NAT budgets per IP | LIVE (44a0db57) | per-visitor budget + buzz cap when cookie proven; 5x IP pool otherwise |
| 24 | A-17 funnel counts rows | LIVE (44a0db57) | distinct session per step |
| 24 | A-07 datacenter fail-open | LIVE (44a0db57) | cloud-region towns -> region when unverified; 60s failure cache; more hosting orgs |
| 25 | F-OFFICE-01 name differs Team vs Analytics | LIVE (c4d9c3ec) | invite_name/email in shared ladder |
| 25 | F-OFFICE-03 teammate card edit unvalidated | LIVE (c4d9c3ec) | type checks, name, email, clampCardWrite |
| 25 | F-OFFICE-04 invite accepts any string | LIVE (c4d9c3ec) | email shape, name cap 120 |
| 26 | F-OFFICE-02 contacts false empty | LIVE (572a6b87) | error state |
| 26 | F-OFFICE-05 branding hides error | LIVE (572a6b87) | server message, 401 copy, maxLength |
| 26 | F-OFFICE-06 person/analytics crash | LIVE (572a6b87) | office/admin/error.tsx |
| 27 | N-03 badge flaps 20 vs total | LIVE (8249d8ee) | X-Unread-Total header |
| 27 | F-OFFICE-09 offline card actions | LIVE (8249d8ee) | gated on liveCards |
| 27 | F-OFFICE-10 export 429 raw JSON | LIVE (8249d8ee) | lib/download-refusal |
| 28 | F-ADMIN-04 create-card email claim | LIVE (6e21277a) | loginEmailed + setupLink |
| 28 | F-ADMIN-03 promo send unguarded | LIVE (6e21277a) | confirm, sendKey, campaign row, shared warm-up cap |
| 28 | F-ADMIN-06 admin inputs uncapped | LIVE (6e21277a) | server caps + clampField |
| 29 | I-05 AI fallback silent | LIVE (be50c867) | failures reported; still single provider (consent notice). ASK OWNER: real fallback = name both providers |
| 29 | P-08 checkout success polls forever | LIVE (be50c867) | backoff, stops ~3 min |
| 29 | P-05 dashboard 50 serial pages | LIVE (be50c867) | counted first page + 6 parallel. Aggregate RPC would need DB migration |
| 30 | I-07 CRM disconnect keeps provider grant | LIVE (88dedb32) | revokeProviderGrant |
| 30 | E-02 preview calls itself production | LIVE (88dedb32) | appUrl(); ~75 inline fallbacks remain (follow-up) |
| 31 | F-CONTACTS-03/04 silent failed saves | LIVE (ded02437) | fail() + 401 copy |
| 31 | F-CONTACTS-05 contact fields uncapped | LIVE (ded02437) | contactFieldProblem + maxLength |
| 32 | F-SCAN-02 one message for every scan failure | LIVE (b9bfa76a) | ScanServiceError 429/413/503 |
| 32 | F-SETTINGS-03 three 30-day literals | LIVE (b9bfa76a) | lib/deletion-grace |
| 32 | F-MKT-03 error screen dashboard link on public pages | LIVE (b9bfa76a) | inApp → homepage |
| 33 | F-DASH-01 app cap notice hardcodes 5/3/3 | LIVE (1058fbb4) | LEADS_CAP_NATIVE_COPY + REFERRAL |
| 33 | F-MKT-01 compare pages hardcode own price | LIVE (1058fbb4) | PLAN_PRICES/OFFICE_MIN_SEATS |
| 33 | F-ADMIN-05 admin busy states stick | LIVE (1058fbb4) | finally/catch; disconnect reports failure |
| 35 | F-AUTH-01 QA orphan auth users | LIVE (50005bfe) | owner OK 2026-10-18; daily sweep, 253 leftovers clear in ~4 days |
| — | F-SETTINGS-01 legacy /profile editor | ASK OWNER | redirect /profile → /settings/flows is a removal |
| 34 | I-02 contact lost while CRM revoked | LIVE (6882a150) | 401/403 queued + catch-up on reconnect |
| 34 | I-04 missing secret → false reconnect banner | LIVE (6882a150) | RefreshUnavailableError + config report |
| 34 | I-06 free cap reads raw plan | LIVE (6882a150) | isPaidProfile in both capture routes. I-03 verified fixed by CRM rewrite |
| 35 | NM-04 failed payment no bell if email fails | LIVE (668c25f5) | bell+push independent of email (also a thrown send) |
| 35 | NM-11 trial-ending claim never released | LIVE (668c25f5) | trial-charge half already fixed (B-22); release on failure |
| 35 | E-01 ENV_KEYS_NEEDED drift | LIVE (668c25f5) | 68 rows + test; ADMIN_SECRET retired (not in Vercel). AGENTS_GITHUB_REPO default correct (repo renamed to swiftcard/) |
| 36 | C02-006 two devices overwrite card edits | LIVE (89d43763) | fingerprint version + 409 + Reload/Save mine anyway; render test both engines |
| 36 | P-04 /templates CLS | LIVE (b64af3a3) | hero glow ::before → background; headline lg:-mx-6. 0.609→0.001 phone, 0.331→0.044 desktop |
| 36 | F-MKT-06 aria-hidden mockup focusable | LIVE (a0078edb) | HomeCardPhone inert + nightly sweep check. (f) favicon already fixed |
| 37 | N-05 failed push never retried | LIVE (4c20ca15) | one retry for transient failures; collapse id/tag stop doubles. Daytime catch-up gap remains (catch-up reads quiet hours only) |
| 37 | N-21 hourly jobs unmonitored | LIVE (c362497f) | health check: 2 failures in a row or 12h stale -> uptime incident |
| 37 | F-HELP-01 Android help sells | LIVE (1a0e7cd4) | platform split, androidAnswer x4, ANDROID_RULES, test vs Android no-selling list. AGENTS.md native rule stale (owner file, not edited) |
| - | NEW: homepage CLS 0.0-0.18 on production | NOT REPRODUCED (2026-10-19) | 9 throttled runs on 1a0e7cd4: 0-0.007 at 390 and 1280 |
| - | ASK OWNER | open | F-SETTINGS-01, F-AUTH-02, NM-07, DD-07/08/13/17 |
| 38 | I-08 IP geo sub-processor undisclosed | LIVE (in a0cd28da) | /privacy names ipinfo.io/ipwho.is; prod has no IPINFO_TOKEN (keyless ipwho.is, no DPA). ASK OWNER: buy ipinfo token (DPA) or drop the second lookup; lookup still on request path (600ms cap) |
| 38 | P-02 585 KB Sentry browser chunk | LIVE (in a0cd28da) | named re-exports via lib/sentry-client-sdk: 585 KB -> 231 KB (72 KB gz); no Sentry env in Vercel so no visitor impact today |
| 38 | A-01 card_events vs card_views gap | VERIFIED OK (2026-10-19) | last 14d: 50 events / 50 views, 0 unmatched with the __links key; card_views.ip never stored |
| - | SEC-08 browser-role table grants | ASK OWNER (2026-10-19) | still 58 tables x anon/authenticated (346 grants each); all tables RLS on, 0 using(true) policies. supabase/least-privilege-2026-09-24.sql ready; offer to run it |
| - | C02-007 / C02-013 | DUPLICATES | same as SEC-03 / SEC-04 (LIVE) |
| 38 | NM-01 forwarded note buzzes at 8am | LIVE (in a0cd28da) | lib/catchup-category heldCategory; contact_engaged kept (= upgraded return visit, which pushed) |
| 38 | NM-02 closed contact download in catch-up | LIVE (in a0cd28da) | CONTACT_RULE_CATEGORIES |
| 38 | NM-03 milestone view lost from catch-up | LIVE (in a0cd28da) | milestone_* = card_view / contact_return by lead_id |
| - | NM-05 recap switch hides bell recap | ASK OWNER | label says push only; changing it shows recaps to people who switched them off |
| 39 | NM-09 catch-up tells admin about own join | LIVE (in a0cd28da) | meta.userId filter per recipient |
| 39 | NM-14 stale customization overwrite | LIVE (in a0cd28da) | reminders job: 5 writes -> mergeCustomization; trial-notice/pro-ended already merged |
| 39 | NM-12 web push silent without VAPID | LIVE (in a0cd28da) | failure web vapid-keys-missing -> push.delivery; outcome failed |
| 40 | NM-10 team push without its ledger row | LIVE (in a0cd28da) | notifyOffice returns written; alertTeam: no row, no push; insert error reported |
| 40 | NM-06 three types for Office access ended | LIVE (in a0cd28da) | all office_plan_downgraded |
| 40 | NM-08 six types untested | LIVE (in a0cd28da) | matrix ROWS + engaged lead_id masking |
