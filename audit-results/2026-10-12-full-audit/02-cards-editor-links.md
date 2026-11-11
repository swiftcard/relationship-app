# Audit 02 — Cards, editor, templates, capture, links, offline, public page

Repo: relationship-app @ HEAD 655a4480 (2026-10-12). Read-only. Uncommitted peer changes audited via git show HEAD where noted.

### C02-001 createBucket called on every share-image / signature upload (47 duplicate-key DB errors a day)
- Severity: Medium
- Platform: all (server)
- Account type/plan affected: all signed-in users who save a card or open the Email signature box
- Feature/page: Share preview capture (POST /api/card-share-image), Email signature (POST /api/card-signature)
- File/component/function: src/app/api/card-share-image/route.ts:81 (`admin.storage.createBucket(BUCKET, { public: true }).catch(() => {})`), src/app/api/card-signature/route.ts:31 (same)
- Problem: Both routes call `storage.createBucket` unconditionally before every upload. The bucket already exists so Postgres rejects the insert with `duplicate key value violates unique constraint buckets_pkey`; the error is swallowed client-side, but each call is a wasted round trip to Storage + a logged DB error (47/24h in production logs).
- Expected behavior: Bucket created once (migration/setup) or lazily only on a "bucket not found" upload error.
- Actual behavior: Every capture upload (which fires after every card save, and on every signature box open) writes a DB error and adds ~100–300 ms latency.
- How to reproduce: Save any card; watch Supabase Postgres logs for buckets_pkey violations.
- Likely cause: "idempotent" comment assumes createBucket is a no-op when the bucket exists; it is not — it attempts an INSERT.
- User impact: Noise that hides real storage errors, extra latency on save, log quota.
- Confidence: Confirmed

### C02-002 Email-signature capture has no version gate or shape check (stale tabs can overwrite the hot-linked signature image)
- Severity: Medium
- Platform: web (desktop/mobile), iOS shell
- Account type/plan affected: all with a signature in use
- Feature/page: Email signature (POST /api/card-signature)
- File/component/function: src/app/api/card-signature/route.ts:15-29 vs src/app/api/card-share-image/route.ts:43-77
- Problem: /api/card-share-image rejects uploads from outdated capture code (`v < SHARE_CAPTURE_VERSION` → 409) and rejects non-card-shaped PNGs (ratio/min width). /api/card-signature accepts any base64 that starts with the PNG data-URL prefix — no version, no PNG magic check, no dimension check. The signature URL (`card-signatures/<username>.png`) is hot-linked from every email the user has ever sent, so a broken capture (logo/headshot missing on WebKit — see card-capture-webkit memory) from an old open tab replaces the good image everywhere, and cacheControl is 60s so it propagates immediately.
- Expected behavior: Same guards as share-image: capture version, PNG magic, card ratio; ideally verify pixels (capture-verify) before upload.
- Actual behavior: Any authenticated owner-tab can upload any blob ≤12MB labelled PNG.
- How to reproduce: Open /share?tab=signature in an old deployment tab (or a WebKit browser where html-to-image drops the headshot), click Copy signature → image replaced.
- Likely cause: Signature route was written before the capture-verification work and never updated.
- User impact: Email signatures silently show a blank/partial card.
- Confidence: Confirmed (by code inspection)

### C02-003 Reserved-slug list misses five live top-level pages (a card named "download" is unreachable)
- Severity: Medium
- Platform: all
- Account type/plan affected: all (card creation, custom URL rename, auto-rename)
- Feature/page: Card URL / public card page
- File/component/function: src/lib/slug.ts:28-45 (RESERVED_SLUGS); src/app/download/page.tsx, src/app/splash-preview/page.tsx, src/app/linkedin-connected/page.tsx, src/app/business-card-view-tracking/page.tsx, src/app/link-in-bio-with-analytics/page.tsx, src/app/review/route.ts
- Problem: RESERVED_SLUGS enumerates routes by hand. These top-level routes exist but are not in the set: `download`, `splash-preview`, `linkedin-connected`, `business-card-view-tracking`, `link-in-bio-with-analytics`, `review` (route handler). Static routes always beat `[username]`, so a card at any of those slugs (via hand-picked URL in the editor, or an auto-generated slug from a company literally named "Download"/"Review") resolves to the marketing/route page instead of the card. The rename RPC itself has no reserved list (production definition verified by caller), so the app list is the only guard. tests/username.test.ts:87 checks 11 hardcoded names, not the real `src/app` directory, so nothing catches a newly added route.
- Expected behavior: Every directory under src/app that owns a page.tsx/route.ts is refused as a slug; the test derives the list from the filesystem.
- Actual behavior: "download" / "review" are accepted; card is unreachable, QR codes dead.
- How to reproduce: Edit card → URL → type `download` → Save. Visit swiftcard.me/download → marketing download page.
- Likely cause: List maintained by hand; routes added later (download, splash-preview, SEO landing pages) never added.
- User impact: Rare but total (card gone from its own URL); also SEO landing pages could be shadowed if ordering ever changes.
- Confidence: Confirmed

### C02-004 Auto-rename copies the PRE-edit capture to the new slug, then the save deletes only the old one — the new URL unfurls with the old card
- Severity: High
- Platform: all (messengers/iMessage/WhatsApp/Slack previews, email signature)
- Account type/plan affected: all with an auto-managed slug (the default for every card)
- Feature/page: Edit card → change name or company (slug follows the card); share preview (og:image), email signature
- File/component/function: src/app/api/cards/[id]/route.ts:333-345 (autoRenameCardSlug runs AFTER the row update), src/lib/auto-rename-slug.ts:68-76 (copies card-shares/<old>.png and card-signatures/<old>.png → <new>.png), src/app/api/cards/[id]/route.ts:388-414 (then removes only `${username}.png` where username = OLD slug)
- Problem: Ordering. The name change is written, the slug is renamed, and the stored captures for the OLD slug — which picture the OLD name/company — are copied to the NEW slug. Only afterwards does the freshness block delete the old-slug objects. `storedCaptureIsCurrent` trusts the copy (updated_at is "now" ≥ card.created_at), so `/newslug` og:image and `/api/card-signature/newslug.png` serve the pre-edit picture until the owner next opens the dashboard with the new username (ShareCardCapture only re-captures from the dashboard, and only when the card is `active`). Someone who edits on the iOS app and shares immediately sends a preview with the old name/company. The signature route also contradicts itself: auto-rename says "KEEP the old files — installed signatures embed them", and the PATCH route then deletes them.
- Expected behavior: On a content change that also renames, delete captures at both old and new slug (or copy nothing), and let the live render serve until the verified re-capture.
- Actual behavior: Stale picture promoted to the new address and trusted as current.
- How to reproduce: Card with auto slug "janedoe-acme" and a stored capture; Edit → company "Beta Corp" → Save. `curl -I https://swiftcard.me/janedoe-betacorp/opengraph-image` → X-SC-Preview: capture, but picture says Acme. Reproduces until dashboard is opened on a device.
- Likely cause: Two freshness mechanisms written at different times (copy-on-rename for signatures vs delete-on-edit).
- User impact: Wrong company/title in link previews right after the edit that was meant to fix it; email signature keeps old job title.
- Confidence: Confirmed (code path); not run live

### C02-005 PATCH /api/cards/[id] accepts an empty name (POST refuses it)
- Severity: Low
- Platform: all (API; iOS shell uses same route)
- Account type/plan affected: all
- Feature/page: Edit card
- File/component/function: src/app/api/cards/[id]/route.ts:28-33 (ALLOWED copy, no validation); compare src/app/api/cards/route.ts:72-78
- Problem: Create validates `name` non-empty/≤120; edit copies any string straight through (clampCardWrite only truncates). An empty name saves and renders "Save 's contact", empty hero, vCard with empty FN (invalid per RFC 6350), and `autoRenameCardSlug` computes a target from "" → stays on the old slug silently. The editor validates client-side, but the native shell / older builds / curl do not.
- Expected behavior: Same server validation as create.
- Actual behavior: Empty/whitespace name accepted.
- How to reproduce: `PATCH /api/cards/<id> {"name":"  "}` as owner → 200.
- Likely cause: Validation added to create in "cards audit M5" and not to edit.
- User impact: Broken public card / vCard for API or stale-client saves.
- Confidence: Confirmed

### C02-006 Card edits are last-write-wins across tabs/devices (no version check)
- Severity: Medium
- Platform: web + iOS (two devices, or the editor open in two tabs)
- Account type/plan affected: all; Office members especially (admin propagation vs member edit)
- Feature/page: Edit card, Swift Links editor, Office Branding propagation
- File/component/function: src/app/api/cards/[id]/route.ts:130-176 (reads existing customization, merges, writes with no updated_at/etag compare); src/app/cards/[id]/edit/CardEditForm.tsx sends every design key + links on every save
- Problem: Each PATCH reads the row, merges the client's full key set, and writes. Two editors (phone + laptop, or Links tab + Design tab in separate windows) silently overwrite each other's `links`, colours and `photoUrl`; the losing tab still shows "Saved". The AGENTS memory already notes "concurrent sessions clobber edits" at the file level; the same holds for the card row.
- Expected behavior: Optimistic concurrency (send `updated_at`, 409 on mismatch with a "reload" prompt) or per-section PATCH payloads.
- Actual behavior: Last save wins; no notice.
- How to reproduce: Open the editor on two devices; add a link on A, change a colour on B, save A then B → link gone.
- Likely cause: Merge-on-server was introduced to fix wipe-on-save for keys the form does not send; it does not help for keys the form always sends.
- User impact: Lost edits with a success toast.
- Confidence: Confirmed (design); reproduction straightforward

### C02-007 design-transfer logs the user's name, phone, email and address (the "leaks") in plain text with their user id
- Severity: Medium (privacy / log hygiene)
- Platform: server (Vercel runtime logs → log drains)
- Account type/plan affected: Pro/Office using "Transfer my paper card design"
- Feature/page: Create/Edit card → Custom designer → design transfer (POST /api/design-transfer)
- File/component/function: src/app/api/design-transfer/route.ts:236-249 (`console.error(... rejected for ${user.id}:`, [...problems.leaks, ...])`), :174 (`measureRaw` slice includes the scan JSON with the card's text)
- Problem: `problems.leaks` is the list of readable strings the AI saw surviving on the generated artwork — i.e. the uploaded card's name, phone, email, address. They are concatenated into an error log line keyed by user id on every rejected attempt (up to 3 per request). The measurement-failure branch logs 300 chars of the raw scan JSON, which contains the same fields. Production logs confirm plain-text PII.
- Expected behavior: Log counts/kinds ("3 text leaks, photo look") and a request id; keep the strings out of logs or redact.
- Actual behavior: PII retained in Vercel logs / Sentry breadcrumbs for the retention period.
- How to reproduce: Upload a card photo whose text the model fails to mask; check runtime logs.
- Likely cause: Diagnostic logging added while tuning the prompt (2026-10-08) and never scrubbed.
- User impact: Personal data in operational logs (GDPR data-minimisation; third-party log drains).
- Confidence: Confirmed

### C02-008 Draft claim: concurrent claims of the same draft create two cards; claim skips name validation and field clamps
- Severity: Medium
- Platform: web (guest build → sign-up), iOS first launch
- Account type/plan affected: new accounts (guest drafts)
- Feature/page: /cards/new as guest → sign up → POST /api/drafts/claim
- File/component/function: src/app/api/drafts/claim/route.ts:128-141 (idempotency read-then-insert), :277-293 (23505 branch only catches same-username), src/lib/draft-claim.ts:93-150 (buildClaimInsert: no name required, no length clamp, no `photoUrl` key default)
- Problem: (a) Idempotency is read-before-insert: two claims in flight (the documented "double OAuth callback / second tab" case) both see no `_claimDraftId` match, both call `ensureUniqueUsername`, the second gets `<slug>-2` and inserts fine — two cards, a Free account over its 1-card cap, and the demo contact seeded twice. The 23505 fallback only handles an identical username. (b) Unlike /api/cards, the claim never requires `name` and never runs `clampCardWrite` — a draft with an empty name or a 2,000-char title inserts as-is. (c) /api/cards explicitly writes `photoUrl: null` when absent so the card is not read as "legacy" and shown with the ACCOUNT photo (lib/card-media cardHeadshot); the claim does not, so a guest card built without a headshot inherits whatever profile photo the account later sets — the cross-card bleed the create route guards against.
- Expected behavior: Unique partial index on `(user_id, customization->>'_claimDraftId')` or an advisory lock per user; same validation/clamp as create; always set `photoUrl`.
- Actual behavior: As described.
- How to reproduce: (a) Trigger claim twice within ~300 ms (two tabs returning from OAuth). (b) `POST /api/drafts/claim {payload:{username:"x", name:""}}`.
- Likely cause: Claim was written to "mirror /api/cards" and drifted as the create route gained guards (M5 validation, photoUrl default, clampCardWrite).
- User impact: Duplicate cards, unreachable limit messages later, cross-card headshot bleed.
- Confidence: Confirmed (code); race Suspected

### C02-009 CardScaler treats a transient 0-width measurement as "scale 0 / opacity 0" — the card stays invisible until something resizes (WebKit reports at /demo-realty)
- Severity: Medium
- Platform: Safari macOS 26.5, iOS 18.7 Safari (production reports 2026-10-06/07); one Chrome 152 UA at /
- Account type/plan affected: all visitors of any page holding a CardScaler (23 consumers: public card, dashboard, templates, editor previews, marketing)
- Feature/page: Public card page hero (/[username]), homepage previews
- File/component/function: src/components/CardScaler.tsx:60-69 (`recompute`: `const w = outerRef.current?.clientWidth ?? NATURAL; const s = Math.min(1, w / NATURAL);`), :93 boot script (`var w=o.clientWidth||460` — the OPPOSITE policy), :121 `contain: "size"` + `aspectRatio` on the outer box
- Problem: The pre-hydration script treats a 0 clientWidth as "not measurable, use natural"; the React effect treats it as a real width and sets `scale=0`, `opacity: 0`, `height: 0`. Any environment where the slot measures 0 at effect time — Safari/iOS link previews and Quick Look peeks (page rendered in a 0-width WKWebView, then promoted), Safari laying out a background tab lazily, bfcache restore, a parent whose width is content-derived (contain:size contributes 0 intrinsic width; percentage of an auto-width flex/grid track resolves differently in WebKit than Chromium) — hides the card that the server HTML and boot script had correctly shown. Recovery depends entirely on the ResizeObserver firing later; the owner's reports show the slot still 0 at the 2.5 s check. The Chromium paint check passes because headless Chromium always has a sized viewport. The Chrome 152 UA report at `/` is most likely a prerender/crawler with a 0-width viewport, which the collapse detector does not exclude (`document.prerendering`, `visibilityState`, `innerWidth===0`).
- Expected behavior: A 0 measurement is "unknown": keep the last/boot scale (`w || NATURAL`), never set opacity 0 once painted; the self-report ignores prerendering/hidden documents.
- Actual behavior: Card invisible (opacity 0, 0 height) with no error, Save contact moves up; nightly Chromium check cannot see it.
- How to reproduce: Safari macOS: hover a swiftcard.me/<slug> link in Messages/Mail → Quick Look preview, then click through; or iOS Safari: open the card link from a background-tab "Open in new tab", switch to it after >3 s. Watch for `cardscaler.collapsed` in /api/client-error.
- Likely cause: `??` vs `||` — null-coalescing only guards an unmounted ref; the two measurement paths were written at different times (UX audit 2026-09-30 added the boot script).
- User impact: Blank cream page where the card should be, on the most important surface, for the visitors who arrive from a link preview.
- Confidence: Suspected (mechanism confirmed in code; WebKit trigger not reproduced here)

### C02-010 Email-signature capture skips the pixel check the share capture and Download PNG run
- Severity: Medium
- Platform: WebKit (iOS Safari, iOS shell, macOS Safari) primarily; all browsers
- Account type/plan affected: all
- Feature/page: /share → Email signature → "Preview & copy"
- File/component/function: src/components/EmailSignatureBox.tsx (HEAD) renderOnce — only `dataUrl.length < 5000` blank guard before `fetch("/api/card-signature")`; compare src/components/ShareCardCapture.tsx:248 and src/lib/card-png.ts:128 which call `capturePainted()` (lib/capture-verify) and reject
- Problem: The share preview and the PNG download verify in the PIXELS that the name, logo and headshot painted (the WebKit "painted before decode" bug that produced empty logo slots in production 2026-10-06). The signature capture does not: it inlines images and does a WebKit double pre-render, then uploads whatever html-to-image returns. Combined with C02-002 (server accepts anything), a signature with the logo ring but no logo (the exact 2026-10-11 nightly finding for jordankhani-douglaselliman on the share side) can be stored and hot-linked from every email. The peer's uncommitted diff (toPngExact + drawnKey) changes type sizes and invalidation but still adds no pixel verification.
- Expected behavior: Same `capturePainted` gate (and retake) as the share capture; server-side version + shape check.
- Actual behavior: Unverified PNG stored; `urlKey` localStorage then marks it current for that device.
- How to reproduce: iPhone Safari, card with a logo on LogoFirst; open /share → signature while the logo is cold-cache; copy. Inspect card-signatures/<slug>.png.
- Likely cause: capture-verify was retrofitted to the share path (v8) and Download PNG only.
- User impact: Email signatures missing the logo/photo for Safari users; they only find out when a recipient mentions it.
- Confidence: Confirmed (code); frequency Suspected

### C02-011 NFC "Write to a tag" has no cancel/timeout; the button stays "Waiting for a tag…" until page reload
- Severity: Low
- Platform: Android Chrome (Web NFC) on mobile web
- Account type/plan affected: all
- Feature/page: /share → NFC
- File/component/function: src/components/NFCWriter.tsx:35-50 (`reader.write({records})` with no `signal`)
- Problem: NDEFReader.write resolves only when a tag is written; without an AbortController there is no way to cancel, and the button is `disabled` while `status === "writing"`. Walking away or deciding against it leaves the control stuck; a later tap on any tag in a pocket writes the URL to it. No unmount cleanup either (setState after unmount if the user navigates).
- Expected behavior: `write(msg, { signal })` with a Cancel button and a ~30–60 s timeout; abort on unmount.
- Actual behavior: As described.
- How to reproduce: Android Chrome → /share → Write to a tag → never present a tag.
- Likely cause: Minimal first implementation.
- User impact: Confusing stuck control; stray writes.
- Confidence: Confirmed (code)

### C02-012 Manual URL rename deletes Wallet registrations although passes resolve old serials through aliases; auto-rename keeps them
- Severity: Low
- Platform: iOS Wallet holders
- Account type/plan affected: all with Wallet passes
- Feature/page: Edit card → Card URL (POST /api/cards/[id]/rename) vs name/company change (auto-rename)
- File/component/function: src/app/api/cards/[id]/rename/route.ts:81 (`releaseSlugArtifacts(admin, [oldSlug])` deletes wallet_registrations + wallet_passes for the old serial); src/lib/wallet-pass.ts:40-55 (passInputs resolves an old serial via findSlugAlias so renamed cards keep updating); src/lib/auto-rename-slug.ts (does not release)
- Problem: Two rename paths disagree. After a manual rename the pass on every holder's phone silently stops updating (registrations gone) even though the pass web service could serve the current card under the old serial; after an auto-rename it keeps updating. Also, releasing the old slug's registrations is only justified if the slug can be re-registered by someone else, but the old slug stays in `_prevSlugs` of this card (it redirects here), so the "stranger's card pushed to their Wallet" scenario the comment guards against cannot occur while the alias exists.
- Expected behavior: Treat both renames the same: keep registrations while the old slug is an alias of this card; release only when the alias is dropped/card deleted.
- Actual behavior: Manual rename = frozen passes; auto-rename = live passes.
- How to reproduce: Add card to Wallet; rename via Card URL; edit the title; pass never updates.
- Likely cause: release-slug written for delete and reused for rename before alias-resolution landed in wallet-pass.
- User impact: Stale Wallet passes for exactly the users who customised their URL.
- Confidence: Confirmed (code)

### C02-013 Anonymous guest uploads (images 5 MB, videos 25 MB) land in the public bucket and are never cleaned up
- Severity: Medium (cost/abuse)
- Platform: web (guest builders on /, /cards/new, homepage mini-builders)
- Account type/plan affected: n/a (unauthenticated)
- Feature/page: POST /api/upload (guest branch), POST /api/upload/link-video (guest branch)
- File/component/function: src/app/api/upload/route.ts:64-70 and :170 (`guest/${randomUUID()}/…`), src/app/api/upload/link-video/route.ts:29-32,48-53; no reference to `guest/` anywhere in src/app/api, src/lib, supabase/ or .github (no sweep)
- Problem: Guests may write to `card-uploads` without an account: 15 images per IP per 10 min (re-encoded, ≤5 MB in) and 6 signed video-upload URLs per IP per 10 min (up to 25 MB each; the signed URL is not bound to the declared size or content type — the bucket's own limits are the only cap). Nothing deletes objects under `guest/` that were never claimed, so abandoned builders (the common case) and any script leave permanent public storage; a rotating-IP script can add ~9 GB/hour of video. Claimed drafts keep pointing at the `guest/<uuid>/…` path forever (claim does not move the file), so a future sweep cannot simply delete by prefix without first collecting referenced URLs.
- Expected behavior: Nightly sweep deleting `guest/` objects older than N days not referenced by any card/profile, or move-on-claim into the user's folder; bind signed video uploads to size.
- Actual behavior: Unbounded growth, public URLs for anything uploaded.
- How to reproduce: Open /cards/new logged out, upload a photo, leave. Object remains in Supabase storage.
- Likely cause: Guest uploads added 2026-09-17 without a lifecycle.
- User impact: Storage cost; public hosting of arbitrary images/videos under the product's domain.
- Confidence: Confirmed (absence of cleanup verified by grep); abuse volume Suspected

