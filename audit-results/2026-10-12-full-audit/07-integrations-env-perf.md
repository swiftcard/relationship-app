# Audit 07 — Integrations, Env/Config/Build, Performance
Repo: relationship-app (Next.js 16 + Supabase). Read-only audit, 2026-10-12. Findings appended incrementally.

## Domain C — Performance

### P-01 Home page HTML is 2.4 MB because 27 inline QR SVGs carry ~1.8 MB of unrounded float path data
- Severity: High
- Platform: Web (desktop + mobile), also the iOS/Android shell when it falls back to "/"
- Account type/plan affected: Every visitor (logged-out marketing traffic)
- Feature/page: `/` (statically prerendered `.next/server/app/index.html` = 2,444,223 bytes; RSC payload only 184 KB)
- File/component/function: `src/components/card-templates/MiniQR.tsx:28-36` (`rr()` path builder) and `:56-70` (one rounded-rect path per dark module); consumers on the home page: `src/components/site/TemplateGallery.tsx`, `HeroShowcase`, `HomeCardPhone`, `ShareWaysPhones`, `TeamsDashboard`, `DashboardDemo`, `WideDemo` (every template preview renders a full QR)
- Problem: Measured breakdown of index.html: 343 `<svg>` elements total 1,925,213 bytes; 27 of them are QR codes (`viewBox="0 0 29 29"`) at 65–73 KB EACH. Each dark module is emitted as a 9-command rounded-rect path with raw JS float arithmetic (`c + inset` → `2.5999999999999996`, `MODULE - 2*R` → `0.31999999999999995`), so a 29×29 code of ~350 modules produces ~65 KB of text. Inline `<script>` is 214 KB and `self.__next_f` RSC is 200 KB — the rest of the page is ordinary.
- Expected behavior: A marketing page HTML of ~300–400 KB; QR previews either a shared `<symbol>`/`<use>`, a tiny raster, or rounded to 2 decimals (~4× smaller) and rendered only for the one card actually shown.
- Actual behavior: 2.4 MB HTML (≈ 350–450 KB after gzip/brotli but the browser still parses 3,782 DOM nodes and 1.9 MB of path data), FCP 4.2 s / LCP 4.9 s / load 16.9 s on slow 4G.
- How to reproduce: `grep -oP "<svg.*?</svg>" .next/server/app/index.html | awk '{print length($0)}' | sort -rn | head` → 27 entries of 65–73 KB. Or view-source on swiftcard.me.
- Likely cause: `rr()` interpolates unrounded floats; every demo/preview card on the homepage renders a real, full-fidelity QR for a demo URL; no memo/dedupe across the 27 identical/near-identical codes.
- User impact: Slow first paint on mobile, high TBT (6.4 s measured), worse Core Web Vitals / SEO for the landing page; mobile data cost.
- Confidence: Confirmed (static output measured)

### P-02 The 585 KB "openai/zod" client chunk is the lazily-loaded @sentry/nextjs browser SDK (with Replay + AI-instrumentation code), not an OpenAI SDK
- Severity: Medium
- Platform: Web + shells
- Account type/plan affected: all, only when `NEXT_PUBLIC_SENTRY_DSN` is set in the deploy
- Feature/page: every page (post-hydration)
- File/component/function: `src/instrumentation-client.ts:66-70` (`import("@sentry/nextjs")`), `src/lib/sentry-options.ts:81-84` (replay rates 0)
- Problem: `.next/static/chunks/1hev7w6rqmp0v.js` (584,755 B) contains 326× "sentry", 107× "replay", and the strings "openai"/"anthropic"/"langchain" belong to Sentry's AI-provider span instrumentation (`auto.ai.openai`), not to the `openai` npm package (`npm ls openai` → not installed; `zod` only via eslint-plugin-react-hooks dev dep). The chunk is NOT in any page's required chunk list (no page manifest references it) — it is only fetched when `sentryEnabled` is true. However, `import("@sentry/nextjs")` pulls the whole barrel including `replayIntegration`, `feedbackIntegration` and the AI integrations even though replay is explicitly disabled, so if a DSN is set every visitor downloads ~585 KB (~160 KB compressed) of mostly-dead code right after hydration.
- Expected behavior: Either keep DSN unset (current prod state per the 2026-09-14 comment, and `.env.local` has no DSN) or import `@sentry/browser`'s tree-shakable pieces / use `@sentry/nextjs` bundler option `excludeReplay/feedback` (`webpack.treeshake` / `bundleSizeOptimizations: { excludeReplayIframe, excludeReplayShadowDom, excludeReplayWorker, excludeDebugStatements }`) in `next.config.ts`.
- Actual behavior: `withSentryConfig` in `next.config.ts` sets no `bundleSizeOptimizations`; `disableLogger: true` is the deprecated option the build warns about.
- How to reproduce: `grep -c replay .next/static/chunks/1hev7w6rqmp0v.js`; `npm ls openai`.
- Likely cause: Barrel dynamic import; missing bundle-size options.
- User impact: None today (DSN unset ⇒ chunk never requested); becomes a 585 KB regression the day Sentry is switched on (which `deploy-watchdog.yml` wants).
- Confidence: Confirmed (chunk contents); DSN-unset-in-prod is Suspected (no Vercel access in this audit)

## Domain A — Integrations

### I-01 No CRM/provider HTTP call has a timeout; a hung provider pins the lambda until Vercel's hard limit
- Severity: High
- Platform: Server (all)
- Account type/plan affected: Pro/Office with any CRM connected; everyone for AI routes
- Feature/page: Lead capture → CRM sync (share form, Add contact, scan, edit); AI scanner/designer/help
- File/component/function: `src/lib/crm-connection.ts:262-270` (token refresh fetch), `src/lib/sync-google.ts:42-45,88-92,105-109`, `src/lib/sync-hubspot.ts:36-40,64-68,104-112`, `src/lib/sync-salesforce.ts:77,96-108,129,139`, `src/lib/sync-pipedrive.ts:44-46,69-83,123-150`, `src/lib/sync-highlevel.ts:66,125-129,146-150,159-163`, `src/lib/ai.ts` (every fetch in aiComplete/aiVision/aiImageEdit)
- Problem: Only the Zapier webhook (`crm-sync.ts:143`, `AbortSignal.timeout(5000)`) is bounded. Every native CRM call (Google People warm-up/search/create/patch, HubSpot create/patch/note, Salesforce SOQL/Lead/Task, Pipedrive search/org/person/note, HighLevel upsert/tags/note) and every AI call uses bare `fetch()` with no `AbortSignal`. The CRM calls run inside `after()` on the lead routes, so a stalled provider keeps the function alive to its maxDuration on every captured lead; the user-facing AI routes can hang the request for the full function timeout.
- Expected behavior: Every outbound call bounded (5–15 s), like Zapier.
- Actual behavior: Unbounded.
- How to reproduce: `grep -n "fetch(" src/lib/sync-*.ts src/lib/ai.ts | grep -vc signal` — every call lacks a signal.
- Likely cause: Timeout only added where a pinned instance was noticed (Zapier).
- User impact: Slow/failed scans and designs; wasted function time; a provider outage can exhaust concurrent function slots on the Hobby plan.
- Confidence: Confirmed

### I-02 A failed CRM sync is lost forever — "New leads will keep trying" is not true for the lead that failed
- Severity: Medium
- Platform: Server
- Account type/plan affected: Pro/Office with any CRM or Zapier connected
- Feature/page: Settings → Integrations banner; lead capture
- File/component/function: `src/lib/crm-connection.ts:321-325` (`connectionErrorMessage`), `src/lib/crm-sync.ts:38-61` (one-shot `allSettled`), `src/lib/crm-sync.ts:137-151` (Zapier single POST)
- Problem: Each lead is pushed once at capture time inside `after()`. A transient 5xx, timeout, refresh race, or Zapier "Zap paused" (410) drops that lead; nothing records which leads reached which CRM (no synced marker on `leads`, no outbox, no retry, no "Resync" button). The banner copy promises retries that do not exist.
- Expected behavior: Per-lead sync status + retry on the next cron, or honest copy and a manual resend.
- Actual behavior: Fire-and-forget; only the latest error string is kept in `integrations.sync_error`.
- How to reproduce: Connect Pipedrive, revoke the token, capture a lead (banner appears), reconnect — the lead captured in between is never sent.
- Likely cause: Design choice; missing outbox.
- User impact: Silent gaps in the customer's CRM.
- Confidence: Confirmed

### I-03 Leads without an email create duplicates in HubSpot, Pipedrive and Salesforce on every edit; Google silently drops the edit
- Severity: Medium
- Platform: Server
- Account type/plan affected: Pro/Office with CRM connected
- Feature/page: Contact edit → CRM `update` mode; phone-only share-form leads; scanned cards without email
- File/component/function: `src/lib/sync-google.ts:67,94-99`, `src/lib/sync-hubspot.ts:36-40` (dedupe only via email 409), `src/lib/sync-pipedrive.ts:97`, `src/lib/sync-salesforce.ts:72-84`
- Problem: Dedupe is keyed on email only. SwiftCard never stores the provider record id (Google `resourceName`, HubSpot id, Pipedrive person id, SF Lead Id) on the lead, so a phone-only lead is re-created on every `update` sync (HubSpot/Pipedrive/Salesforce) or never updated (Google returns early). HighLevel's upsert is the only one that can match on phone (delegated to the location's duplicate preference).
- Expected behavior: Persist provider ids per lead at first sync; update by id; fall back to phone match.
- Actual behavior: Duplicates or dropped edits.
- How to reproduce: Capture a phone-only lead with Pipedrive connected; rename it twice in /contacts → three Persons.
- Likely cause: No persisted provider ids.
- User impact: CRM clutter; distrust of the integration.
- Confidence: Confirmed (source)

### I-04 OAuth token refresh: no single-flight guard, and a missing client secret in one environment can mark PRODUCTION connections broken
- Severity: Medium
- Platform: Server
- Account type/plan affected: Pro/Office with Google or Salesforce connected
- Feature/page: CRM sync token refresh
- File/component/function: `src/lib/crm-connection.ts:255-297`
- Problem: (a) Two captures inside the 5-minute pre-expiry window both refresh; last write wins — with a provider that rotates refresh tokens the stored one can be the revoked one → permanent "reconnect". (b) `client_id: refresh.clientId ?? ""` / `client_secret: … ?? ""` — a preview deploy without `GOOGLE_CLIENT_SECRET`/`SALESFORCE_CLIENT_SECRET` attempts the refresh with an empty secret, gets 401, and `setSyncError` writes "Token refresh failed (401) — reconnect …" into the shared Supabase row that production reads. (c) No timeout (I-01).
- Expected behavior: Skip and report a config error when env is missing; optimistic-lock the refresh (`UPDATE … WHERE expires_at = seen`).
- Actual behavior: As described.
- How to reproduce: Deploy a preview without `GOOGLE_CLIENT_SECRET`, capture a lead there for a Google-connected test account, open production Settings → Integrations.
- Likely cause: Shared refresh path assumes env present; previews share the production database.
- User impact: Spurious reconnect banners; reconnect loops.
- Confidence: Confirmed (b); Suspected (a)

### I-05 AI "waterfall" is not a fallback — the first configured provider's failure returns null, silently
- Severity: Medium
- Platform: Server
- Account type/plan affected: All (scanner, follow-up generator, support/sales chat, design transfer)
- Feature/page: `/api/scanner`, `/api/leads/[id]/generate-sequence`, `/api/ai/help`, `/api/ai/sales`, `/api/ai/suggest-messages`, `/api/scan-design`, `/api/design-generate`
- File/component/function: `src/lib/ai.ts:31-50,52-85,87-104` and the same shape in `aiVision`
- Problem: Each provider block ends with `return null` on success *or* failure, so a 429/5xx on the first configured key never tries the next. `aiComplete`/`aiVision` log nothing on failure (`catch {}` and non-ok fall to `return null`), so an expired key or exhausted quota is invisible and every feature degrades to "generic template". `ENV_KEYS_NEEDED.md` documents Gemini as primary and OpenAI as optional fallback; the code does the opposite, and `aiProviderName()` (the Apple 5.1.1 disclosure) therefore names OpenAI whenever both keys exist.
- Expected behavior: Real chain; `reportError("ai.provider", …)` on non-ok; doc matches code.
- Actual behavior: As described.
- How to reproduce: Set a bogus `OPENAI_API_KEY` next to a valid `GEMINI_API_KEY`; POST `/api/scanner` → failure with no server log.
- Likely cause: Early returns inside each provider block.
- User impact: Features silently stop; owner can't see it in logs.
- Confidence: Confirmed

## Domain C — Performance (continued)

### P-03 /card/<u> costs a full serverless render just to 308, then the card page pays up to 3 serial DB round trips on every cache miss and is uncacheable by design
- Severity: High
- Platform: Web (every QR / NFC / Wallet / email-signature scan that still carries a /card/ URL)
- Account type/plan affected: Card recipients (logged-out), all plans' cards
- Feature/page: `/card/[username]` → `/[username]`
- File/component/function: `src/app/card/[username]/page.tsx:17-33` (redirect implemented as an async Server Component); `src/app/[username]/page.tsx:200-215` (`cookies()` read → route is dynamic ⇒ `private, no-store`); `src/lib/card-page-data.ts:50-68` (cache-miss loader: `cards` → `profiles` → `cardWithinPlanLimit` = 3 serial awaits); `src/lib/resolve-card.ts:77` (generateMetadata re-runs `cardWithinPlanLimit` OUTSIDE the cache); `src/lib/card-active.ts:93-96,104-112`
- Problem: (1) The legacy hop is a dynamic page, not a `redirects()` rule, so every /card/ scan invokes a lambda (rarely warm → cold start) before the 308 is even sent, then the browser makes a second request to `/<u>`. Measured TTFB 1,958 ms vs ~80 ms for other routes. (2) `/[username]` reads `cookies()` to detect "owner viewing own card", which opts the whole page out of static/ISR, so Vercel serves `Cache-Control: private, no-store` and MISS on every view; the only caching is `unstable_cache` with `revalidate: 60`, so any card scanned less than once a minute (most of them) pays the serial `cards → profiles → (cards+profiles)` chain. (3) For Free-plan owners `resolveCardMeta()` (generateMetadata) calls `cardWithinPlanLimit()` again uncached — 2 extra queries per view, duplicating the value already in the cached `withinLimit`.
- Expected behavior: `/card/:username` → `/:username` as a `next.config.ts` `redirects()` entry (edge, query string preserved automatically; single-segment source does not catch `/card/x/opengraph-image`); card page static/ISR with the owner check moved client-side (or to the view-tracking API, which already has to decide it), revalidate ≥ 5 min + tag invalidation on edit; `resolveCardMeta` use cached `withinLimit`.
- Actual behavior: 2-hop, function-bound, uncached, serial.
- How to reproduce: `curl -sI https://swiftcard.me/card/demo-sales` (308, ~2 s) then `curl -sI https://swiftcard.me/demo-sales` (`private, no-store`, `x-vercel-cache: MISS`).
- Likely cause: Redirect written as a page to keep query params (Next `redirects()` already keeps them); `cookies()` added for owner-view suppression.
- User impact: The first thing a recipient sees after scanning is a ~2 s blank screen on mobile; a card can't be served from the CDN even though it is identical for every visitor.
- Confidence: Confirmed (source + measured TTFB); cold-start share of the 2 s is Suspected

### P-04 /templates CLS 0.841 (home, which uses the same components, scores 0.001) — CardScaler re-measures the six template tiles and twelve AI "stills" after hydration/font swap
- Severity: Medium
- Platform: Web, phone width (measured at slow-4G mobile profile)
- Account type/plan affected: Logged-out marketing visitors; anyone opening "Templates" from nav/footer
- Feature/page: `/templates`
- File/component/function: `src/components/CardScaler.tsx` (inline `boot` script sets `height = inner.offsetHeight*k` at parse time; placeholder is `aspect-ratio: 460/263`; `useEffect` + `ResizeObserver` re-sets `height` when the inner card's natural height changes); `src/app/templates/page.tsx:126-172` (2-col grid of 6 `CardScaler` tiles directly below the hero, each in a `[data-reveal]` wrapper); `src/components/site/AiDesignerShowcase.tsx:122-129,217,283,303` (`Still` = CardScaler inside fixed-aspect `absolute inset-0` boxes; 3+3+3 stacked slides); `src/app/layout.tsx:24` (`Bricolage_Grotesque … display: "swap"`)
- Problem: Every tile's box height is a JS measurement of a 460px-wide card. The first measurement (inline boot script) happens before web fonts and the sample headshot/logo have loaded; when the font swaps or an image decodes, the card's natural height changes, ResizeObserver fires, and the tile height changes by Δ×scale — moving the tile captions, "best for" tags, every row below, and the footer. In a 2-column phone grid six tiles re-flow at once. The page is a `"use client"` page, so the grid is also re-rendered at hydration (state `scale=0,height=0` → effect sets real values), giving a second chance to shift if boot and effect disagree (e.g. boot ran before the grid's final width was known). Placeholder ratio 1.75 does not match templates whose real ratio differs (PhotoFirst/LocalBusiness), so any tile whose boot script did not run (client-side navigation into /templates — React does not execute `dangerouslySetInnerHTML` scripts) jumps from 263k to its real height.
- Expected behavior: CLS < 0.1. Give each template a known natural height (static per template) so the outer box is sized in CSS (`aspect-ratio: 460 / H`) and never measured, or reserve with `min-height` and use `font-display: optional`/size-adjusted fallback for the display face inside cards.
- Actual behavior: CLS 0.841 measured (perf-probe, 2026-10-12).
- How to reproduce: Chrome DevTools → Performance → mobile slow-4G → load `/templates` → "Layout shifts" track; or `new PerformanceObserver(l=>l.getEntries().forEach(e=>console.log(e.value,e.sources?.map(s=>s.node)))).observe({type:'layout-shift',buffered:true})`.
- Likely cause: Measured-height scaling pattern (CardScaler) applied to a dense grid near the top of a client-rendered page.
- User impact: Content jumps while the visitor reads/taps; taps land on the wrong template; poor CWV for an SEO landing page.
- Confidence: CLS value Confirmed (measured); attribution to CardScaler re-measure is Suspected (no live layout-shift trace in this read-only pass — the PerformanceObserver snippet above will name the nodes)

### P-05 Dashboard pulls up to 50,000 raw card_views rows in up to 50 SERIAL page requests on every load to draw a 60-day chart
- Severity: Medium
- Platform: Web + iOS/Android shell (dashboard is the app's home)
- Account type/plan affected: All plans; cost scales with card traffic (Office/Pro power users worst)
- Feature/page: `/dashboard` → Traffic graph, unique/repeat split
- File/component/function: `src/app/dashboard/page.tsx:420-440` (`for p < MAX_PAGES(50)` → `.range(p*1000, …)` awaited one after another); fallback loop `:464-488` (10 more serial pages, only when the `card_location_counts` RPC is missing); preceding serial chain `:108` getClaims → `:119` Promise.all → `:133/:140` one-time migrations → `:222` Promise.all → `:406` Promise.all
- Problem: The big `Promise.all` is only as fast as its slowest member, and that member is a sequential pager. A card with N views in 60 days costs ceil(N/1000) round trips (≈20–60 ms each from a Vercel lambda to Supabase) plus N rows of JSON deserialised in the lambda, every time the owner opens the app, switches card, or changes the range. The other dashboard queries are already well parallelised (and `card_location_counts` shows the right pattern) — this one is the remaining long pole. The source indexes needed are present in SQL (`idx_card_views_username_viewed_at`, `idx_card_views_username_visitor_id`), so the cost is transfer + serial latency, not scans.
- Expected behavior: One aggregate RPC returning per-bucket counts and unique/repeat visitor counts (like `card_location_counts`), O(1) round trips.
- Actual behavior: O(views/1000) serial round trips.
- How to reproduce: Seed 15k views on a card in 60 days; open /dashboard; Supabase logs show 15 sequential `card_views?…&offset=` requests per render.
- Likely cause: Fix for the 1000-row cap was paging instead of aggregation.
- User impact: Dashboard (the app's landing screen) gets slower exactly for the most engaged customers; extra DB egress.
- Confidence: Confirmed (source)

### P-06 /contacts selects ALL of an owner's leads, every column, with no range — PostgREST's 1000-row cap silently hides contacts alphabetically after #1000
- Severity: High
- Platform: Web + shells
- Account type/plan affected: Pro/Office accounts with >1000 contacts across their cards (Office admins most likely); everyone pays payload size
- Feature/page: `/contacts` (list, search, export entry point)
- File/component/function: `src/app/contacts/page.tsx:116-128` (`admin.from("leads").select(LEAD_COLS).in("card_owner", allUsernames).order("name")` — no `.range()`/paging)
- Problem: The same 1000-row PostgREST `max-rows` cap the dashboard comments document (`dashboard/page.tsx:416-419`) applies here, so once an account passes 1000 leads, every contact sorted after the 1000th name (e.g. everything from "M" onward) disappears from the list and client-side search with no indication. Separately, every row ships `notes`, `message`, `convo_details`, `company_description` and the `follow_up_sequence` JSON into the RSC payload, so the page weight grows linearly with the address book even though the list shows only name/company/status.
- Expected behavior: Paginated or virtualised list (server-side search), list columns only, detail fetched on open; or at minimum page through like the dashboard and show the true total.
- Actual behavior: Silent truncation at 1000; multi-MB payloads for large books.
- How to reproduce: Account with 1,050 leads → /contacts shows 1,000; the last 50 alphabetically are unreachable from the list (still reachable via `?lead=<id>` deep link).
- Likely cause: Unbounded select written when accounts were small.
- User impact: "My contacts disappeared" for the best customers; slow contacts tab on phones.
- Confidence: Confirmed (source); the exact cap value is per the project's own comments (Supabase default 1000)

### P-07 Proxy: two independent DB round trips run serially in front of every protected navigation/prefetch on a cold or new instance, and the device check is a row-locking write
- Severity: Low
- Platform: Web + shells (every in-app tap to /dashboard, /contacts, /cards, /settings, /office, /onboarding, /profile, and their prefetches)
- Account type/plan affected: Signed-in users
- Feature/page: `src/proxy.ts`
- File/component/function: `src/proxy.ts:216-238` (soft-delete `profiles` read) then `:271-311` (`claim_device_slot` RPC) — awaited one after the other; caches `:8-20` are per-instance `Map`s keyed `userId` / `userId:deviceId`, 60 s TTL, cleared wholesale at 5,000 entries; `supabase/device-limit.sql:88-112` (`SELECT … FOR UPDATE` + upsert on every cache miss)
- Problem: The two checks don't depend on each other but are serial, so a cache miss costs 2× DB latency before any page code runs. Vercel spreads requests across many instances, so the in-memory 60 s cache hit-rate is low for a single user's taps (each new instance pays both again), and every miss is a write that takes a row lock on that user's device rows. Prefetches (`next-router-prefetch`) also pass through and pay it. The `getClaims()` call itself is local (ES256) and fine. Denials are correctly not cached.
- Expected behavior: `Promise.all` the two checks; skip both for `next-router-prefetch`/RSC prefetch requests; consider moving `_deleted`+device status into JWT custom claims or a signed short-lived cookie so the hot path needs no DB.
- Actual behavior: Up to 2 serial DB trips + 1 write per protected request on a cold instance.
- How to reproduce: Supabase logs while tapping between tabs after a deploy — `profiles?select=customization` followed by `rpc/claim_device_slot` per navigation.
- Likely cause: Device limit added after the delete guard, copying its shape.
- User impact: 50–200 ms added to app taps on cellular after every deploy/scale-out; DB write load proportional to navigation.
- Confidence: Confirmed (source); hit-rate is Suspected

### P-08 Polling: bell polling is well-guarded; /checkout/success re-renders the whole page (getUser + DB + Stripe API) every 2 s with no upper bound for Pro checkouts
- Severity: Low
- Platform: Web + shells
- Account type/plan affected: New Pro/Office purchasers while the Stripe webhook is late or failed
- Feature/page: `/checkout/success`
- File/component/function: `src/app/checkout/success/AwaitingPlan.tsx:21-24` (`setInterval(router.refresh, 2000)`, `giveUp` only when `fallbackHref` is set, which is only when the plan already landed); `src/app/checkout/success/page.tsx:52,62,80` (each refresh = `auth.getUser()` network call + `profiles` read + `stripe.checkout.sessions.retrieve`)
- Problem: If the webhook never lands, an open tab calls Stripe and Supabase auth 30×/minute indefinitely (the 45 s "slow" note only changes copy). Other intervals checked and fine: `NotificationBell.tsx:115-176` and `OfficeNotificationBell.tsx:49-90` poll every 30 s, skip when hidden, de-dupe focus+visibility and clear on unmount; `AiDesignerShowcase.tsx:163-172` and `HeroShowcase.tsx:844` clear their timers; `AgentFlowClient.tsx` (admin only) clears all six. No leaked intervals/listeners/object URLs found in `NewCardWizard.tsx` or `ContactsClient.tsx` (only fire-and-forget 0.9–2.5 s status-reset `setTimeout`s at `ContactsClient.tsx:451,455,809`, harmless).
- Expected behavior: Exponential backoff (2→4→8 s) and a hard stop (~2 min) with a "we'll email you" state; cache the Stripe session check after first success.
- Actual behavior: Fixed 2 s forever.
- How to reproduce: Complete a test-mode checkout with the webhook endpoint disabled; leave the tab open; Stripe dashboard → Logs shows a `GET /v1/checkout/sessions/cs_…` every 2 s.
- Likely cause: Give-up path only covers the office-row case.
- User impact: Wasted function/Stripe calls; potential Stripe read rate-limit pressure during a webhook incident.
- Confidence: Confirmed (source)

### P-09 No image optimisation anywhere on public pages — raw Supabase-storage originals in `<img>` (next/image used in 2 files; no `images` config)
- Severity: Low
- Platform: Web (card recipients on phones)
- Account type/plan affected: Card/Links recipients
- Feature/page: `/[username]`, `/links/[username]` (measured 403 KB images on /links/demo-sales)
- File/component/function: `src/components/SwiftLinkProfile.tsx:375,399,422,488,517,597,601` (bg media, blurred photo backdrop, headshot, hero — all raw `<img>` with no `width/height/sizes/srcset/loading/fetchpriority`); `next/image` only in `src/components/AddContactModal.tsx`, `src/components/SwiftCardLogo.tsx`; 26 .tsx files use raw `<img>`; uploads are downscaled client-side (`ImageUpload.tsx:50-58`, JPEG q0.92) but bg/hero media are served at upload size.
- Problem: A recipient on cellular downloads the full-size hero/background (hundreds of KB) to display it in a ~390 px column; no responsive variants, no AVIF/WebP, no lazy loading for below-fold images, and no intrinsic size (relies on absolutely positioned boxes, which is why CLS is 0 here).
- Expected behavior: Supabase image transformations (`/render/image/…?width=`) or `next/image` with a `remotePatterns` entry for the storage host; `fetchpriority="high"` on the LCP hero.
- Actual behavior: Originals.
- How to reproduce: Network tab on `/links/demo-sales` at 390 px.
- Likely cause: Raw `<img>` chosen for html-to-image/WebKit capture compatibility (see card-capture notes) and carried over to pages that are never captured.
- User impact: Slower LCP (2.4 s on slow 4G for /links) and data cost for recipients.
- Confidence: Confirmed (source + measured bytes)

## Domain A — Integrations (continued)

### I-06 Zapier: a failing Zap is invisible to the user, the payload has no lead id (no idempotency), and its plan gate disagrees with the native CRMs'
- Severity: Medium
- Platform: Server
- Account type/plan affected: Pro/Office users with a Zapier webhook (and Office sub-users inheriting the owner's)
- Feature/page: Settings → Integrations → Zapier; lead capture (`/api/leads`, `/api/leads/manual`)
- File/component/function: `src/lib/crm-sync.ts:142-160` (`sendLeadToZapier`: non-2xx → `console.warn` only; exceptions → `reportError`), `:116-136` (`zapierLeadPayload` — no `id`/`lead_id`), `:90-91` (`isPaidPlan(own.plan)` raw plan) vs `:38-40` (`isPaidProfile` effective plan for native CRMs); `src/app/settings/flows/page.tsx:410` (`zapierConnected={!!profile.zapier_webhook_url}`)
- Problem: (1) Zapier answers 410 when a Zap is turned off/deleted and 4xx/5xx on hook errors; SwiftCard logs a warning and moves on — no `sync_error` equivalent for Zapier, so Settings keeps showing it connected while every lead is dropped (native CRMs DO surface `sync_error` with a "Reconnect" state — `IntegrationsSettings.tsx:157-220`). (2) The `lead.created` payload carries no SwiftCard lead id, so a Zap cannot de-duplicate a retried/double-submitted capture and cannot link later updates to the same record. (3) Plan gate: Zapier and the lead route's lock logic use the raw `plan` column (`isPaidPlan`), native CRMs use `isPaidProfile` (honours `plan_expires_at`). An expired timed grant (gift/promo) that the cron hasn't downgraded yet keeps sending full lead PII to Zapier while the native CRMs have stopped. Locked (over-cap) Free leads are correctly never sent (both paths require paid).
- Expected behavior: Persist Zapier delivery failures (e.g. `profiles.customization.crm.zapier_error` or an `integrations` row) and show "Your Zap stopped accepting contacts"; include `id` and `created_at` as a stable key; one effective-plan gate for all destinations.
- Actual behavior: Silent drop; no id; split gate.
- How to reproduce: Save a Zapier hook URL, turn the Zap off in Zapier, capture a lead → Vercel log `[crm-sync] Zapier webhook answered 410`; Settings unchanged.
- Likely cause: Zapier treated as fire-and-forget webhook rather than an integration with state.
- User impact: Contacts silently missing from the customer's downstream CRM/Sheet.
- Confidence: Confirmed (source)

### I-07 Disconnecting Google / Salesforce / HubSpot only deletes SwiftCard's row — the OAuth grant is never revoked at the provider
- Severity: Low
- Platform: Server
- Account type/plan affected: Pro/Office users who disconnect an OAuth CRM
- Feature/page: Settings → Integrations → Disconnect
- File/component/function: `src/app/api/integrations/google/route.ts:5-13`, `src/app/api/integrations/salesforce/route.ts`, `src/app/api/integrations/hubspot/route.ts` (14-line DELETE handlers: `integrations.delete()` only); no call to `https://oauth2.googleapis.com/revoke` or Salesforce `/services/oauth2/revoke` anywhere (`grep -rn revoke src/app/api/integrations` → LinkedIn comment only). Token-paste providers (`pipedrive/token/route.ts:80-93`, `highlevel/token/route.ts`) can't be revoked by API — acceptable, but the UI doesn't tell the user to rotate the token in Pipedrive/HighLevel.
- Problem: "SwiftCard" stays listed under the user's Google Account → Third-party access / Salesforce Connected Apps with contacts-write scope after they disconnect; any copy of the refresh token (logs, backups, a preview DB snapshot) remains usable. Connect validation itself is good: Pipedrive verifies the token (`fetchPipedriveDomain`), HighLevel verifies token+location and distinguishes missing scope; both clear `sync_error` on reconnect.
- Expected behavior: Best-effort revoke (decrypt → POST revoke, 3 s timeout) before deleting; for paste-token providers, a line "also delete the token in Pipedrive → Personal preferences → API".
- Actual behavior: Local delete only.
- How to reproduce: Connect Google, Disconnect, open myaccount.google.com/permissions — SwiftCard still has access.
- Likely cause: Not implemented.
- User impact: Lingering third-party access; trust/compliance expectation ("disconnect" = revoke).
- Confidence: Confirmed (source)

### I-08 Every card view and every captured lead sends the visitor's IP to a third-party geo API (ipwho.is when IPINFO_TOKEN is unset) — the privacy policy says location comes from "our hosting provider"
- Severity: Medium
- Platform: Server
- Account type/plan affected: Every card recipient / lead (data subjects who never signed up)
- Feature/page: View tracking, lead capture, card events
- File/component/function: `src/lib/request-geo.ts:293` (`LOOKUP_TIMEOUT_MS = 600`), `:316-320` (`https://ipinfo.io/<ip>/json?token=` or, with no token, `https://ipwho.is/<ip>`), callers `src/lib/record-view.ts:89`, `src/app/api/leads/route.ts:136`, `src/app/api/card-events/route.ts:252,438`; `src/app/privacy/page.tsx:97` ("city/country derived from IP address by our hosting provider"); `IPINFO_TOKEN` absent from `.env.local` and from `ENV_KEYS_NEEDED.md`
- Problem: Fail-open is correct (600 ms timeout, `catch → guess = null`, edge headers stand alone, private IPs skipped). But: (1) disclosure mismatch — raw visitor IPs go to ipwho.is/ipinfo.io, neither named in the privacy policy; ipwho.is is a free, keyless service with no DPA. (2) The lookup is awaited on the request path, so a slow geo API adds up to 600 ms to every lead submit and view beacon. (3) Without a token the free ipwho.is quota is shared/limited, so under load most lookups silently fall back to edge geo — the "city-level" accuracy the dashboard advertises degrades with no signal.
- Expected behavior: Name the geo sub-processor in /privacy (and in the knowledge base), set `IPINFO_TOKEN` in production and document it, or drop the second lookup; move it off the response path (`after()`) where the row can be updated later.
- Actual behavior: Undisclosed third-party IP sharing; blocking lookup.
- How to reproduce: Read `request-geo.ts:316-320`; check Vercel env for `IPINFO_TOKEN`.
- Likely cause: Accuracy improvement added after the policy text was written.
- User impact: Privacy-policy inaccuracy (GDPR/CCPA disclosure risk); added latency.
- Confidence: Confirmed (source); whether production has `IPINFO_TOKEN` is Unable to Verify

## Domain B — Env / Config / Build

### E-01 ENV_KEYS_NEEDED.md has drifted: 68 keys read by src are undocumented; `ADMIN_SECRET` is documented as required but read nowhere
- Severity: Medium
- Platform: Server / build / ops
- Account type/plan affected: n/a (operator); indirectly every feature behind an undocumented key
- Feature/page: Wallet passes, Android push, App Store offer codes, RevenueCat, Salesforce, Web Push, crons, rate limiting, AI model pins, social agents
- File/component/function: `ENV_KEYS_NEEDED.md` (200 lines) vs `grep -rhoE "process\.env\.[A-Z0-9_]+" src` (121 distinct keys; Twilio is read by destructuring and IS documented)
- Problem: Product-critical keys with no entry: `CRON_SECRET` (every cron route), `SALESFORCE_CLIENT_ID/SECRET`, `VAPID_PRIVATE_KEY` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (web push), `FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY` (Android push), `APPLE_PASS_*` + `APPLE_TEAM_ID` + `APPLE_WWDR_PEM` + `WALLET_AUTH_SECRET` (Wallet), `ASC_*` (Apple offer codes, which must be set in Vercel), `REVENUECAT_SECRET_KEY/WEBHOOK_TOKEN` + `NEXT_PUBLIC_RC_APPLE_API_KEY`, `UPSTASH_REDIS_REST_URL/TOKEN` (only the KV_* alias is documented), `IPINFO_TOKEN` (see I-08), `NEXT_PUBLIC_SENTRY_DSN/RELEASE/TRACES_SAMPLE_RATE`, `NEXT_PUBLIC_APP_STORE_ID/URL`, `NEXT_PUBLIC_PLAY_STORE_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_APPLE_SIGNIN_ENABLED`, `TRIAL_NOTICE_SECRET`, `PUSH_CATCHUP_SECRET`, model pins (`ANTHROPIC_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL`, `GEMINI_IMAGE_MODEL`), plus the admin-agent/social keys (Appendix B). `ADMIN_SECRET` is documented twice (lines 30 and 148: "Admin broadcast + promo code routes return 403") but `/api/admin/promo-codes/send` now uses `requireAdmin()` and no file reads it. `RESEND_FROM_EMAIL`/`MARKETING_FROM_EMAIL` are correctly marked RETIRED.
- Expected behavior: One row per key with "missing => symptom", checked by a test (tests/ already pins other source invariants).
- Actual behavior: About 56% of keys undocumented.
- How to reproduce: the grep above vs the backticked keys in ENV_KEYS_NEEDED.md (`comm -23 used documented`).
- Likely cause: Features added faster than the doc.
- User impact: A rebuilt/forked Vercel project silently loses push, Wallet, Salesforce, crons or offer codes; troubleshooting relies on memory.
- Confidence: Confirmed

### E-02 The `NEXT_PUBLIC_APP_URL || "https://swiftcard.me"` fallback is copy-pasted 85 times — preview deploys send OAuth callbacks, Stripe return URLs, emails and OG URLs to PRODUCTION
- Severity: Medium
- Platform: Server + client bundle (NEXT_PUBLIC is inlined at build)
- Account type/plan affected: Developers/QA on preview deploys; real users if a preview link is shared
- Feature/page: Stripe checkout (`src/app/api/stripe/checkout/route.ts:434` success_url), Google/Salesforce connect (`src/app/api/integrations/google/connect/route.ts:39` redirect_uri), card metadata/canonical (`src/app/[username]/page.tsx:71,232`), CRM payload URLs (`src/lib/crm-sync.ts:16`), emails, sitemap
- File/component/function: 85 identical inline fallbacks across src; no central `appUrl()` helper; only 7 files consult `VERCEL_ENV`/`VERCEL_URL`
- Problem: If `NEXT_PUBLIC_APP_URL` is unset (or set to swiftcard.me) for the Preview environment, a preview build hard-codes production as its own origin: a checkout started on a preview returns to swiftcard.me, OAuth completes against production's callback (and writes the shared Supabase row, compounding I-04), canonical/OG tags on preview pages point at production, and email links in preview-triggered mails open production. Same class of problem AGENTS.md already forbids for `warmSharePreview` ("Local work must not generate production traffic"). In local dev without the var, every absolute link points at production too.
- Expected behavior: One `appUrl()` in src/lib that prefers `NEXT_PUBLIC_APP_URL`, else `https://${VERCEL_BRANCH_URL or VERCEL_URL}` on previews, else localhost in dev, and only falls back to swiftcard.me when `VERCEL_ENV === "production"`; a test forbidding the inline literal.
- Actual behavior: 85 independent fallbacks to production.
- How to reproduce: Deploy a preview without NEXT_PUBLIC_APP_URL; start a Stripe test checkout; it returns to swiftcard.me/checkout/success.
- Likely cause: Pattern copied per file.
- User impact: Confusing QA, cross-environment writes, preview traffic touching production.
- Confidence: Confirmed (source); Vercel Preview env value Unable to Verify

### E-03 Non-null-asserted env reads crash at request time instead of failing fast (25 files)
- Severity: Low
- Platform: Server
- Account type/plan affected: Whoever hits the route when a key is missing
- Feature/page: Stripe webhook, Google/Salesforce callbacks, push enable, Supabase clients, social-agent connects
- File/component/function: `NEXT_PUBLIC_SUPABASE_URL!` x15, `NEXT_PUBLIC_SUPABASE_ANON_KEY!` x14 (incl. `src/proxy.ts:68-69`), `STRIPE_WEBHOOK_SECRET!` (`src/app/api/stripe/webhook/route.ts:317`), `GOOGLE_CLIENT_SECRET!` (`src/app/api/integrations/google/callback/route.ts:87`), `SALESFORCE_CLIENT_SECRET!` (`src/app/api/integrations/salesforce/callback/route.ts:61`), `STRIPE_PRICE_ID!` (`src/app/api/stripe/checkout/route.ts:117`, documented as optional), `NEXT_PUBLIC_VAPID_PUBLIC_KEY!` (`src/components/EnablePushButton.tsx:366`), `ASC_*!`, `META_*!`, `X_CLIENT_ID!`, `LINKEDIN_CLIENT_*!`, `REDDIT_*!`, `PINTEREST_APP_ID!`, `SUPABASE_SERVICE_ROLE_KEY!`
- Problem: `!` silences the type checker only; a missing value becomes `undefined` at runtime: the Stripe webhook's `constructEvent` throws and returns 400 to Stripe (which then retries for days), the OAuth callbacks post `client_secret=undefined`. Contrast `crm-connection.ts`'s `?? ""` (I-04): two different wrong defaults for the same secrets.
- Expected behavior: One validated `env` module read at boot / in `instrumentation.ts`; optional keys typed `string | undefined` and handled.
- Actual behavior: Assertions scattered across 25 files.
- How to reproduce: `grep -rhoE "process\.env\.[A-Z0-9_]+!" src | sort | uniq -c`.
- Likely cause: Convenience.
- User impact: Misconfiguration shows up as user-facing 500s instead of a failed deploy.
- Confidence: Confirmed

### E-04 next.config.ts: CSP is clickjacking-only, no `images` config, and the Sentry options are deprecated/no-ops under Turbopack
- Severity: Low
- Platform: Web
- Account type/plan affected: All
- Feature/page: Global headers / build
- File/component/function: `next.config.ts:15-22` (`Content-Security-Policy: frame-ancestors 'self'` plus HSTS/XFO/nosniff/Referrer/Permissions, a good baseline otherwise), no `images:` key (see P-09), `next.config.ts:118-134` (`withSentryConfig({ ... disableLogger: true })`, no `bundleSizeOptimizations`), `next.config.ts:41-46` (`experimental.staleTimes.dynamic: 30`)
- Problem: (1) No `script-src`/`connect-src`/`img-src`, so an injected script (CardScaler boot, JSON-LD and sc-boot already use `dangerouslySetInnerHTML`) would run unrestricted; a nonce-based CSP in Report-Only mode is a safe first step. (2) The build prints "[@sentry/nextjs] DEPRECATION WARNING: disableLogger is deprecated ... Use webpack.treeshake.removeDebugLogging instead. (Not supported with Turbopack.)" twice (baseline/build.txt); Next 16 builds with Turbopack, so the option does nothing, and replay/feedback code is not excluded either (P-02). (3) `staleTimes.dynamic: 30` means a client navigation can show a 30-s-old dynamic page (dashboard counts, contacts); intentional per the comment, but relevant to "my new contact isn't showing" reports.
- Expected behavior: CSP-Report-Only with nonces via the proxy; drop `disableLogger`; add Sentry `bundleSizeOptimizations` if/when the DSN is enabled.
- Actual behavior: As above.
- How to reproduce: `curl -sI https://swiftcard.me | grep -i content-security`; build log.
- Likely cause: Headers added for one issue (framing); Sentry config predates the Turbopack default.
- User impact: Defence-in-depth gap; build-log noise.
- Confidence: Confirmed

### E-05 ESLint: 0 errors, 69 warnings; 27 are one real-bug-class rule, most of the rest are in scripts/
- Severity: Low
- Platform: Web
- Account type/plan affected: n/a
- Feature/page: Checkout and other client redirects
- File/component/function: by ruleId (baseline/eslint.txt): 27 `@next/next/no-location-assign-relative-destination` (e.g. `src/app/checkout/CheckoutClient.tsx:152,180`), 16 `@typescript-eslint/no-unused-vars` (mostly `scripts/*.mjs`), 12 `@typescript-eslint/no-unused-expressions` (scripts), 8 `@next/next/no-img-element` (`src/app/card/[username]/opengraph-image.tsx:140,160,191`; correct inside an ImageResponse, should be disabled per file), 2 `react-hooks/exhaustive-deps` (`src/app/cards/new/NewCardWizard.tsx:1162`, `src/app/checkout/CheckoutClient.tsx:214`), remainder unused `eslint-disable` directives (e.g. `src/components/ThemeToggle.tsx:27`).
- Problem: Relative `location` assignments force a full document reload (re-downloading about 1 MB of JS on mobile) and bypass the router. The two exhaustive-deps warnings sit in the card builder and checkout, the two flows where a stale closure costs data or money. Warnings in scripts/ dilute the signal so these go unnoticed.
- Expected behavior: Scope lint warnings to src/ (or fix scripts), disable `no-img-element` in OG routes, review the two hook-deps warnings, use `router.push`/`replace` where a full reload is not required.
- Actual behavior: 69 standing warnings.
- How to reproduce: `npx eslint -f json` and count by `ruleId`.
- Likely cause: Warnings don't fail CI.
- User impact: Indirect.
- Confidence: Confirmed (counts); runtime impact of the hook-deps warnings Unable to Verify

## Appendix A — Integration status

| Provider | Status | Token refresh | Revocation on disconnect | Error shown to user | Idempotent |
|---|---|---|---|---|---|
| Google Contacts (OAuth) | Live | Yes, 5-min pre-expiry; no single-flight; empty-secret refresh in previews (I-04) | No (local delete only, I-07) | Yes: `sync_error` -> amber "Reconnect" (`IntegrationsSettings.tsx:157-220`) | Email-keyed search; phone-only leads not updated (I-03) |
| HubSpot (private-app token) | Live | n/a | n/a (user-owned token) | Yes, `sync_error` | Email 409 only; phone-only duplicates (I-03) |
| Salesforce (OAuth) | Live | Yes, same path as Google (I-04) | No (I-07) | Yes, `sync_error` | Email SOQL only; duplicates (I-03) |
| Pipedrive (API token) | Live | n/a | n/a; UI does not tell user to rotate token | Yes, 401/403 -> `sync_error`; cleared on next success | Email search only; duplicates (I-03) |
| HighLevel (PIT + location) | Live; connect validates token, location and scope | n/a | n/a | Yes, incl. missing-scope copy | Upsert (location duplicate rules) |
| Zapier (webhook) | Live; 5 s timeout; allowlisted URL; scope re-checked at send | n/a | n/a | No: non-2xx only `console.warn` (I-06) | No: payload has no lead id (I-06) |
| All CRMs | One-shot in `after()`, no retry/outbox (I-02); no timeouts except Zapier (I-01) | | | | |
| Sentry | DSN unset in prod (suspected); replay 0/0, `sendDefaultPii:false`, scrubbed `beforeSend` | | | | |
| Rate limit | Upstash/KV when `KV_REST_API_*` or `UPSTASH_*` set (KV keys present in .env.local); falls back to per-instance memory on error | | | | |
| IP geo | ipinfo.io (token) or ipwho.is; 600 ms timeout; fail-open (I-08) | | | | |

## Appendix B — Env vars (undocumented or unused only)

| Key | State | Read at |
|---|---|---|
| CRON_SECRET, TRIAL_NOTICE_SECRET, PUSH_CATCHUP_SECRET, WALLET_AUTH_SECRET, AGENT_RELAY_SECRET, INSTAGRAM_BOT_SECRET | Undocumented secrets | cron/admin/wallet/agent routes |
| SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET | Undocumented (`!`-asserted) | `src/app/api/integrations/salesforce/*` |
| VAPID_PRIVATE_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY | Undocumented (public key `!`) | web push, `EnablePushButton.tsx:366` |
| FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY | Undocumented | Android push |
| APPLE_PASS_TYPE_ID, APPLE_PASS_CERT_PEM, APPLE_PASS_KEY_PEM, APPLE_PASS_KEY_PASSWORD, APPLE_WWDR_PEM, APPLE_TEAM_ID | Undocumented | Wallet pass |
| ASC_APP_ID, ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY | Undocumented (`!`) | Apple offer codes |
| REVENUECAT_SECRET_KEY, REVENUECAT_WEBHOOK_TOKEN, NEXT_PUBLIC_RC_APPLE_API_KEY | Undocumented | IAP |
| UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN | Undocumented alias (KV_* documented) | `src/lib/rate-limit.ts:23-24` |
| IPINFO_TOKEN | Undocumented; absent from .env.local | `src/lib/request-geo.ts` |
| NEXT_PUBLIC_SENTRY_DSN, NEXT_PUBLIC_SENTRY_RELEASE, NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE | Undocumented | Sentry |
| NEXT_PUBLIC_APP_STORE_ID, NEXT_PUBLIC_APP_STORE_URL, NEXT_PUBLIC_PLAY_STORE_URL, NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXT_PUBLIC_APPLE_SIGNIN_ENABLED, NEXT_PUBLIC_VERCEL_ENV | Undocumented | store links, sign-in |
| ANTHROPIC_MODEL, OPENAI_MODEL, GEMINI_MODEL, GEMINI_IMAGE_MODEL | Undocumented model pins | `src/lib/ai.ts` |
| GITHUB_AGENTS_TOKEN, AGENTS_GITHUB_REPO, CLAUDE_CODE_OAUTH_TOKEN | Undocumented (admin agents) | `src/app/api/admin/agents/*` |
| HIGGSFIELD_API_KEY_ID/SECRET, HIGGSFIELD_ENDPOINT, HIGGSFIELD_VIDEO_ENDPOINT | Undocumented | marketing media |
| LINKEDIN_ACCESS_TOKEN, LINKEDIN_AGENT_CLIENT_ID/SECRET, LINKEDIN_AGENT_SCOPES, LINKEDIN_ALLOW_MEMBER_POSTS, LINKEDIN_AUTHOR_URN, META_APP_ID/SECRET, META_PAGE_ID, META_SCOPES, META_WEBHOOK_VERIFY_TOKEN, PINTEREST_APP_ID/SECRET, REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD, X_CLIENT_ID/SECRET, YOUTUBE_CLIENT_ID/SECRET | Undocumented (social agent) | admin social connectors |
| ADMIN_SECRET | Documented, read nowhere | ENV_KEYS_NEEDED.md:30,148 |
| RESEND_FROM_EMAIL, MARKETING_FROM_EMAIL | Documented as RETIRED, unused (correct) | n/a |

## Appendix C — Performance hot spots

1. `src/components/card-templates/MiniQR.tsx:28-36,56-70` — float path data, 27 QR SVGs = ~1.8 MB of homepage HTML (P-01)
2. `src/app/card/[username]/page.tsx:17-33` — legacy redirect as a dynamic page; 1,958 ms TTFB (P-03)
3. `src/app/[username]/page.tsx:200-215` — `cookies()` makes every card view `private, no-store` (P-03)
4. `src/lib/card-page-data.ts:50-68,82-84` — 3 serial queries on miss, 60 s TTL (P-03)
5. `src/lib/resolve-card.ts:77` — uncached duplicate `cardWithinPlanLimit` in generateMetadata (P-03)
6. `src/app/contacts/page.tsx:116-128` — unbounded, all-column leads select; 1000-row truncation (P-06)
7. `src/app/dashboard/page.tsx:420-440` — up to 50 serial 1000-row pages of card_views (P-05)
8. `src/components/CardScaler.tsx` + `src/app/templates/page.tsx:126-172` — measured heights, CLS 0.841 (P-04)
9. `src/proxy.ts:216-238,271-311` — serial delete-check + device-claim write per protected request on miss (P-07)
10. `src/app/checkout/success/AwaitingPlan.tsx:21` — 2 s `router.refresh` with Stripe retrieve, unbounded (P-08)
11. `src/lib/request-geo.ts:293,316-320` — up to 600 ms awaited third-party lookup on lead/view paths (I-08)
12. `src/lib/sync-*.ts`, `src/lib/ai.ts` — untimed outbound fetches (I-01)
13. `src/components/SwiftLinkProfile.tsx:375-601` — raw full-size `<img>` on public pages (P-09)
14. `src/instrumentation-client.ts:66-70` — 585 KB Sentry chunk if DSN is ever set (P-02)
