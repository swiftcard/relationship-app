# Baseline evidence (verified 2026-10-12)

## Target
- Audited commit: `655a4480` on `main` (live: `/api/health` sha matches; db 102 ms; APNs/FCM/web push configured).
- CI at HEAD: `CI` verify+render green; `Nightly production QA` green (17:41Z); `Paint check` green; `Production health check` green (09:16Z). 0 open GitHub issues (no `uptime`/`nightly-qa` issues).
- App Store: 1.0.6 live since 2026-10-07, min iOS 15, 6 ratings (5.0).
- Vercel: Hobby plan (1h runtime-log retention, 2 crons). Last 12 production deploys all READY; deploy gate active since 2026-10-09.
- Worktree at audit time: 40 modified + 6 untracked files (two in-flight features: Android-sells-nothing; exact card captures) + 1 stash from 2026-09-20 (`card-templates/shared.tsx`, +153/−13, never merged).

## Local checks (worktree = HEAD + in-flight diff)
| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint` | 0 errors, 69 warnings |
| `npm test` (vitest, 357 files / 6,298 tests) | 2 failures: `background-reliability` (31 s timeout, "Share button… double-tap window"), `plan-cards-single-source` ("Free is offered wherever all three plans are" — PlanCards is modified in the in-flight diff). CI at HEAD is green → both attributable to in-flight diff / timing, not to HEAD. |
| `npm run test:render` (90 files) | 6 failed / 84 passed. Failures: "No `useIsAndroidApp` export on `@/lib/platform` mock" (tests mock platform.ts without the new hook the in-flight diff added), `android-sells-nothing` (untracked new test), iPhone-SE/13-Mini layout tests timing out (30 s setContent). Attributable to in-flight diff. |
| `npx next build` | success; 180 client chunks, 5,172 KB client JS; largest chunk 571 KB contains the `openai` SDK + zod in a client bundle. Sentry `disableLogger` deprecation warning printed. |
| `npm run kb:check` | 1 user-facing file changed since KB last touched (`PhotoFirst.tsx`, 93eca35f) — not recorded in `REVIEWED.md`. |
| `npm audit` | 20 advisories: 5 critical (next <16.4.0: RCE in next/og ImageResponse + `use cache` leak; @capacitor/android + @capacitor/ios remote-content-at-app-origin via internal HTTP proxy; vitest/tinypool RCE — dev-only), 12 high (sharp/librsvg, axios, passkit-generator→joi/node-forge, source-map-js, brace-expansion, eslint-config-next chain), 2 moderate, 1 low. |

## Production, credential-free
| Probe | Result |
|---|---|
| `health-check.mjs` (2 runs) | 12/15 ok; the 3 "aborted" checks (client-error POST, speed budget, dbMs) are a local-machine artifact — plain Node fetch answers all three in <700 ms and the CI uptime job is green. |
| `site-invisible-sweep.mjs` | all pages paint (Chromium). |
| `qa-offline.mjs` | 3/3 pass (card opens with no signal, vCard arrives, unknown page shows no-signal screen). |
| `perf-probe.mjs` (slow 4G) | `/` HTML 2,454,412 B, DOM 3,782 nodes, 46 req, JS 1,180 KB, FCP 4.2 s, LCP 4.9 s, TBT 6.4 s, load 16.9 s. `/templates` CLS 0.84. `/login` JS 1,275 KB. `/card/demo-sales` TTFB 1,958 ms (others ~80 ms). `/links/demo-sales` images 403 KB. |
| `qa-sweep` logged-out @390 | every screen clean (incl. not-found, history back/forward). (768/1280/1920 pending) |
| `qa-sweep` logged-out @768/1280/1920 | 0 findings at every width. |
| WebKit + Chromium public sweep (own script, 67 routes incl. sitemap × 390/768/1280/1920 = 536 loads) | No horizontal overflow, no zero-width card slots, no 4xx/5xx on real routes, every page has a title/h1. `/demo-realty` renders in headless WebKit at all widths (the production "invisible card" error did not reproduce here). Recurring: `/api/link-icon?host=northwind.io` → 404 on the demo card, rendered as a broken `<img>` in both engines. Pricing text is visible on /press, /blog, /compare*, /terms and two blog posts (fine on web; relevant to the iOS shell's commerce rules only if reachable there). `/join/not-a-real-token` answers 200 (no 404). Login page triggers Google One Tap "accounts list is empty"/FedCM console noise in Chromium. Tap targets <24 px: 10–16 on product pages (demo UI labels, phone/email links in mockups). |
| `qa-android-shell` logged-out (pixel-8, small-360) | clean except `status-bar-style-unset` on cold open: app never sets the status-bar style so Android uses the phone's dark mode over a light theme. |
| `qa-a11y` logged-out | 64 findings: 44 voice-control (aria-label ≠ visible text on homepage demo cards and template picker), 10 axe color-contrast (pricing summary, terms, templates lede, 9 px slate-400 text on home), 6 larger-text (only 32/60 text nodes scale when root font doubles), 2 focus-visible (home "Your full name" input), 2 aria-hidden-focus (home phone mockups). |
| Headers | HSTS preload, nosniff, X-Frame SAMEORIGIN, Referrer-Policy, Permissions-Policy present. **CSP is only `frame-ancestors 'self'`** (no script-src). `/` served `public, max-age=0, must-revalidate` with Vercel cache HIT (Age 20,938 s). Card/links/login `private, no-store`. |
| AASA | serves team-id `NHK8FA2RR2`, exclude-all (links never open the app, by design). `TEAMID_PLACEHOLDER` only when env unset. |
| robots/sitemap | robots disallows app routes; sitemap 200 (9.8 KB). |
| Slugs | `/admin`→login, `/api`→404, `/office`→login, `/settings`→/settings/flows, `/Demo-Sales`→308 lowercase. |
| OG | card pages emit og:title/description/image (`/<slug>/opengraph-image?v=…`, 1200×686), type=profile. |
| Password forms | `/login` form carries `method="post"` (rule from AGENTS.md holds on the live HTML). |
| Login page in owner's Chrome | signed out; browser offered saved credentials — **not used**. Signed-in look-only pass blocked; needs the owner to sign in first. |

## Production database (Supabase MCP, read-only aggregates — no PII read)
Advisors (security): RLS enabled with **no policy** on 56 tables (INFO); 4 functions with mutable search_path (`office_employee_lead_stats`, `office_employee_view_stats`, `office_daily_views_tz`, `office_unique_visitors`); **leaked-password protection disabled**. Advisors (performance): 18 unindexed FKs (incl. `profiles_free_live_card_id_fkey`, `contact_links_owner_id_fkey`, `contact_devices_link_id_fkey`, `media_assets_source_item_fkey`, rest `agent_*`); 17 auth-RLS-initplan warnings (policies call `auth.uid()` per row); 15 unused indexes; 1 duplicate index on `push_subscriptions` (`push_subscriptions_endpoint_key` = `uq_push_subscriptions_endpoint`); multiple permissive policies on `email_preferences` (redundant `owner_prefs` ALL) / `offices` / `office_members`.

RLS truth (settles July-audit item): policies exist only on profiles (Own insert/update/read), offices, office_members, email_preferences, user_devices, push_log, unsubscribe_events. anon+authenticated hold **full table grants (SELECT/INSERT/UPDATE/DELETE, some TRUNCATE) on ~50 tables** incl. cards, card_views, card_events, notifications, integrations (holds access_token/refresh_token), push_subscriptions, stripe_events, promo_codes, audit_logs — safe today only because RLS-without-policy denies everything. `profiles`: client roles have SELECT+DELETE only (no UPDATE grant) **and** trigger `profiles_guard_privileged_columns` blocks plan/office_id/plan_expires_at/stripe_*/referral_*/pro_trial_started_at/free_live_card_id (not `customization`). `least-privilege-2026-09-24.sql` is NOT applied. Storage: 4 buckets all **public** (card-shares, card-signatures, card-uploads up to 26 MB incl. video, pins with no limits), zero storage.objects policies (writes only via service role).

Postgres logs (24 h): 47 × `duplicate key value violates unique constraint "buckets_pkey"` — `api/card-share-image` and `api/card-signature` call `storage.createBucket` on every request.

Row facts (2026-10-12):
| Table | Count | Integrity |
|---|---|---|
| auth.users | 296 | **262 have no profile** (253 `@swiftcard-test.invalid` QA seed leftovers; 5 Apple private-relay + 3 gmail = real people, last sign-in Aug/Sep 2026) |
| profiles | 34 | free 20 / pro 7 / enterprise 7; 13 soft-deleted (`_deletion`); 2 enterprise with NULL office_id; 3 with NULL referral_code; 0 dup usernames |
| cards | 37 | 0 orphans; 1 office card; templates: classic-pro 13, luxury-minimal 5, modern-bold 4, photo-first 4, local-business 2, logo-first 1, custom 1 |
| offices | 10 | **2 whose owner profile no longer exists** |
| office_members | 7 | active 4, revoked 3; 0 orphans; seats never exceeded |
| leads | 245 | **205 reference an owner slug that exists in neither profiles nor cards** (11 distinct owners; 7 QA-pattern); 219 of 245 source=qr_code; 242 carry a follow_up_sequence; 3 locked; 226 created in last 30 d |
| card_views | 298 | 0 null visitor_id; 0 same-visitor duplicates within 30 min (dedupe works); **101 rows (34%) are `<slug>__links` Swift-Links views stored in the card_views table**; 101 rows reference deleted owners; ip column always null; location e.g. "Ashburn, US" (datacenter geo on some rows) |
| card_events | 354 | viewed_card 302 / downloaded_vcard 29 / clicked_link 23; surface null on 230; **109 viewed_card events have no card_views row for the same visitor within an hour (36% disagreement)**; 41 rows carry visitor email/phone |
| notifications | 82 | **67 unread**; 47 null visit_key (24 card_viewed, 6 contact_saved, 1 new_lead; 15 of them Sep–Oct, after the visit_key migration); 0 duplicate visit_keys |
| push_subscriptions | **1** | single apns: row (Pro user, Sep 2026); push_log 230: no_subscription 132, quiet_hours 68, sent 23 |
| user_devices | 286 | **246 belong to users with no profile**; 255 native; 8 seen in last 7 d |
| email_preferences | 132 | **108 belong to QA auth users with no profile** |
| wallet_passes | 921 | **893 serials match QA naming; 907 match no profile/card username**; wallet_registrations 19 |
| stripe_events | 41 | checkout.completed 10, invoice.payment_succeeded 15, subscription.updated 7, .deleted 9, **payment_failed 0 ever** |
| trial_ledger | 3 | all email_trial |
| promo_codes / redemptions | 15 / 6 | 6 active |
| product_events | 15,797 | page_viewed 12,462; card_creation_started 1,566 vs completed 340; upgrade_prompt_viewed 1,082 vs upgrade_started 14 vs checkout_completed 10 |
| site_pageviews | 7,832 | includes typo paths (`/pricingg`, `/signup`) |
| analytics_events | 101 | nudge_impression 60, contact_save 24, links_badge_open 18 |
| audit_logs | 1,089 | brand.updated 701, invite.accepted 351 (QA-driven) |
| integrations | 4 | google 1, linkedin 2, salesforce 1; no sync_error |
| error_events | 143 | last 7 d: CardScaler zero-width ×6, chunk-load ×1 |
| DB size | 43 MB | biggest: product_events 6 MB, card_views 4.2 MB, site_pageviews 2.8 MB |

## Vercel runtime errors (7 d)
- `client.cardscaler.collapsed` — "CardScaler slot has zero width — content rendering invisibly (natural=460px)" at `/demo-realty` on Safari macOS 26.5 (×4, 2026-10-07) and iOS 18.7 Safari (2026-10-06); also at `/` from a Chrome 152 UA (2026-10-08). Chromium paint-check passes → WebKit-specific or timing.
- `client.unhandledrejection` — "Failed to load chunk /_next/static/immutable/chunks/…" inside the iOS shell at `/login` (2026-10-10, right after a deploy).
- `api/design-transfer` — ~20 log lines containing users' emails, phone numbers and street addresses in plain text ("artwork attempt rejected for <card id>: <email>, <phone>, <address>").
- `/middleware` — "Invalid Refresh Token: Refresh Token Not Found" (expected for stale sessions).
- `/profile` — DOM TimeoutError (2026-08-27, 2026-10-06).

## Lead-auditor spot checks of High claims (2026-10-13)
| Claim | Production check | Verdict |
|---|---|---|
| B-14 users can rewrite `profiles.customization` via the REST API | `has_table_privilege` / `has_column_privilege`: anon + authenticated have no UPDATE and no INSERT on profiles; `/api/profile` strips incoming `_` keys (route.ts:61-67) | **Not exploitable today** → downgraded to Low (latent) |
| A-06 "219 QR leads" are the seeded demo contact | 223 of 245 leads carry tag `demo`; 220 of them source=qr_code; 0 non-demo QR leads; only 20 real leads, 14 with a live owner | **Confirmed** |
| N-01 nothing marks notifications read except a bell tap | `opened_at` is set on 0 of 82 rows; 14 read; 60 unread rows older than 7 days | **Confirmed** |
| SEC-06 admin can merge to main | `src/app/api/admin/agents/ship-fix/route.ts` merges Fixer PRs behind `requireAdmin` only; no MFA/aal2 code in src | **Confirmed** |
