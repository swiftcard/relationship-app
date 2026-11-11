# Appendix — Dead-code inventory (HEAD 655a4480)

Companion to `01-dead-duplicate-legacy.md`. Narrative for DD-01 to DD-05 and DD-08 lives there. This appendix is the full table, so the same items are listed here again by reference only.

## Method

- **Source of truth:** committed HEAD `655a4480`, read with `git ls-tree` / `git cat-file --batch`. The uncommitted worktree changes from another session were not read.
- **Import graph:** every `src/`, `tests/`, `scripts/` and root `.ts/.mjs/.js` file (1,388 files) was scanned for `import ... from`, `export ... from`, side-effect `import "x"`, `import()`, `require()`, `vi.mock()` and `vi.importActual()`. Specifiers resolve through `@/*` -> `src/*` (tsconfig) and through relative paths, trying `.ts/.tsx/.js/.jsx/.mjs/.cjs` and `/index.*`.
- **Entry points (not dead by definition):** 287 Next.js convention files under `src/app` (`page`, `layout`, `route`, `loading`, `error`, `not-found`, `global-error`, `template`, `default`, `opengraph-image`, `twitter-image`, `icon`, `apple-icon`, `sitemap`, `robots`, `manifest`) plus `src/proxy.ts`, `src/instrumentation.ts` and `src/instrumentation-client.ts`.
- **Classes:**
  - **DEAD** means zero importers anywhere.
  - **TEST-ONLY** means it is imported only from `tests/` or `scripts/`.
  - **LIVE** means it is reachable from an entry point. A reachability pass (BFS from the entry points over `src` edges) found **no** unreachable island beyond the files below: the other 858 of the 862 `src` code files are reachable.
- **Spot check:** every DEAD and TEST-ONLY claim was re-checked with `git grep -w <basename>` over the whole repo, to catch string reads and comments.
- **Unused exports:** export declarations were parsed (`export function/const/let/class/type/interface/enum`, `export {}`, re-exports, `export default`). Each was matched against named, default and namespace (`ns.member`) imports, `export {..} from`, `export *` and dynamic `import()`. For dynamic imports the name only has to appear in the importing file.
  - "Unused" means no importer anywhere and the name occurs only once in its own file (the declaration). Every hit was then re-checked with `git grep -w`.
- **API routes:** each of the 178 `src/app/api/**/route.ts` files was turned into a URL regex (a dynamic segment matches any non-slash token, including `${id}`). That regex was searched in `src`, `scripts`, `ios`, `android`, `capacitor-shell`, `.github`, `public`, `supabase`, `tests`, `docs`, `marketing-agents`, `vercel.json` and root files.
  - The tables list routes with **no** hit in `src`/native/`public`/`supabase`/`vercel.json`/root.
  - **Limitation:** a URL that appears only in a comment in `src` counts as a "caller", so this list is a lower bound.

## (a) Dead files (zero importers in src/, tests/, scripts/)

| Path | Lines | Last commit | Evidence | Confidence |
|---|---|---|---|---|
| src/components/AddSeatButton.tsx | 131 | 2026-09-09 (4ba06444) | 0 importers. Only reference is a string read in `tests/native-suppression.test.ts:130` (asserts `if (native) return null`). Last consumer replaced 2026-07-14 (3a409ba9). See DD-01. Deleting it also needs that test entry removed. | Confirmed |
| src/components/HeroPhone.tsx | 222 | 2026-09-10 (8d1c1dba) | 0 importers. Its own header says "SUPERSEDED ... Nothing imports this component". Read as a string by `tests/landing-content.test.ts:35`. Comments in `card-templates/shared.tsx:283`, `tests/render/card-logo.test.ts:80-84`, `tests/render/card-overflow.test.ts:44-52` and `globals.css:76` describe it as a live renderer, so those comments are stale too. See DD-02. | Confirmed |
| src/components/Skeleton.tsx | 8 | 2026-09-28 (36830881) | 0 importers. `SkeletonBlockLight` occurs only in its own declaration. See DD-03. | Confirmed |

**Effectively dead (live only through an uncalled route):**

| Path | Lines | Last commit | Evidence | Confidence |
|---|---|---|---|---|
| src/lib/watch-contract.ts | 79 | 2026-08-19 | Only `src` importer is `src/app/api/watch/card/route.ts`, which has no caller (table d2). The watch actually syncs over WatchConnectivity (`ios/App/App/WatchSessionBridge.swift`), and no native code requests any `/api/` path. Also imported by `tests/watch-contract.test.ts`. The file header says "a FUTURE native watchOS/iOS companion app would fetch". | High |

No other import chain is reachable only through a dead file. The reachability pass confirms the 3 files above plus `office-attention.ts` are the only unreachable `src` modules.

## (b) Test-only / script-only files

| Path | Lines | Last commit | Imported / read by | Note | Confidence |
|---|---|---|---|---|---|
| src/lib/office-attention.ts | 119 | 2026-07-14 (c2b8071f) | `tests/office-team-metrics.test.ts` (`computeAttention`) | UI consumer `AttentionList.tsx` was deleted in 91bc15b6 (2026-07-27). See DD-04. | Confirmed |
| src/lib/splash/markup.html | 558 | 2026-09-03 | `scripts/build-splash-assets.mjs`, `build-splash-v2.mjs`, `build-splash-transition.mjs`, `verify-splash.mjs` | Not served at runtime: `NativeSplash.tsx:99-103` and `/splash-preview` only load `markup-v3`, `markup-v2to3` and `markup-v1to3`. Kept as a build input (the v1 frame for the transition files). | Confirmed (by design) |
| src/lib/splash/markup-v2.html | 559 | 2026-09-17 | `scripts/build-splash-v2.mjs`, `build-splash-v3.mjs`, `build-splash-transition.mjs`, `tests/native-splash.test.ts:170` | Same as above: a build input, not served. | Confirmed (by design) |
| src/lib/knowledge/REVIEWED.md | 101 | 2026-09-16 | `scripts/kb-drift.mjs` | A marker file for `npm run kb:check`. Intentional. | Confirmed (by design) |

## (c) Unused exports

### c1. src/lib: exported, never imported anywhere, not used in its own file

| File | Export | Kind | Evidence (`git grep -w` outside the file) |
|---|---|---|---|
| src/lib/agent-org.ts | `displayName` | function | Other hits are unrelated identifiers (Swift `displayName`, `email-senders`, `messaging`, `office-team` locals). |
| src/lib/ai.ts | `hasImageEditProvider` | function | none |
| src/lib/apns.ts | `sendApnsNotification` | function | none |
| src/lib/apple-offer-codes.ts | `appleCodeStatus` | re-export | The consumer (`MarketingClient.tsx:13`) imports it from `@/lib/apple-offer-plan`, so the re-export is redundant. |
| src/lib/apple-offer-codes.ts | `appleWebOnlyReason` | re-export | same as above |
| src/lib/custom-layout.ts | `contentPx` | function | none |
| src/lib/events.ts | `SERVER_EVENTS` | const | Only a string assertion in `tests/agent-instagram.test.ts:300`. |
| src/lib/events.ts | `analyticsEnabled` | const | none |
| src/lib/events.ts | `identify` | function | Other `identify` hits are prose and unrelated. No call site imports it. |
| src/lib/events.ts | `resetIdentity` | function | none. Nothing calls this helper, so no sign-out resets the analytics identity through it. |
| src/lib/external-purchase.ts | `canOpenInDefaultBrowser` | function | Tests read it only as text (`android-shell.test.ts:188`, `in-app-browser-selling.test.ts:103`). Related to DD-08. |
| src/lib/external-purchase.ts | `openInDefaultBrowser` | function | Only test prose and string checks. Related to DD-08. |
| src/lib/fcm.ts | `fcmConfigured` | function | none |
| src/lib/fcm.ts | `resetFcmTokenCache` | function | none |
| src/lib/iap.ts | `IAP_PRODUCT_ANNUAL` | re-export | Consumers import from `iap-shared` / `apple-offer-plan`. |
| src/lib/iap.ts | `IAP_PRODUCT_MONTHLY` | re-export | same as above |
| src/lib/lead-status.ts | `WORKED_STATUS_VALUES` | const | Tests assert that it is **not** used (`office-admin-notifications.test.ts:129`, `office-leads-capacity.test.ts:85`). |
| src/lib/office-analytics.ts | `getOfficeKeys` | function | Only a comment in `office/admin/analytics/page.tsx:60` ("used to re-resolve"). |
| src/lib/office-analytics.ts | `sumOfficeTotals` | function | none |
| src/lib/office-leads.ts | `LEAD_STATUS_OPTIONS`, `LEAD_STATUS_VALUES`, `LeadStatusLabel`, `LeadStatusValue`, `LeadStatusView` | re-exports (5) | Consumers import from `@/lib/lead-status` directly. |
| src/lib/office-team.ts | `MEMBER_STATUS_LABEL` | re-export | Consumers import from `@/lib/member-status`. |
| src/lib/platform.ts | `useIsIosApp` | function (hook) | none |

Total: **26** (15 declarations + 11 redundant re-exports).

### c2. src/components: unused exports (beyond the dead files in table a)

| File | Export | Kind | Evidence |
|---|---|---|---|
| src/components/card-templates/shared.tsx | `panelBackground` | re-export | no importer through `shared` |
| src/components/site/useProductSketch.ts | `EMPTY_SOCIALS` | const | no importer, no local use |

### c3. Exports used only by tests (production never runs them)

These are exported, imported only by tests, and **not used inside their own file either**, so production never runs them. This is distinct from the ~240 test-only exports that the module uses internally, which is the normal "export for testing" pattern.

| File | Export | Test importer | Note |
|---|---|---|---|
| src/lib/account-state.ts | `GUEST_FLOW_STORAGE_KEYS` | tests/account-isolation.test.ts | |
| src/lib/agent-chat.ts | `isResponder` | tests/agent-chat.test.ts | |
| src/lib/ai-consent.ts | `aiConsentAllows` | tests/ai-consent.test.ts | |
| src/lib/card-finishes.ts | `DEFAULT_FINISH`, `FREE_FINISH_IDS` | tests/card-finishes.test.ts | |
| src/lib/crm-scope.ts | `isScoped` | tests/crm-card-scope.test.ts | |
| src/lib/draft-claim.ts | `findOwnCardByUsername` | tests/guest-draft.test.ts | |
| src/lib/email-senders.ts | `MUST_RECEIVE` | tests/email-sender-routing.test.ts | |
| src/lib/email-token.ts | `EMAIL_TOKEN_TTL_DAYS` | tests/email-preference-center.test.ts | |
| src/lib/guest-reset.ts | `resetGuestFlow` | tests/guest-reset.test.ts | The test covers a reset path that no screen calls. |
| src/lib/knowledge/derived.ts | `PLACEHOLDER_KEYS`, `placeholdersIn` | tests/knowledge-truth.test.ts | Guardrail helpers. Intentional. |
| src/lib/knowledge/index.ts | `UNDOCUMENTED_ROUTES` | tests/knowledge-truth.test.ts | Guardrail list. Intentional. |
| src/lib/link-anything.ts | `everythingLinked` | tests/render/create-link.interactive.test.ts | |
| src/lib/location-privacy.ts | `withoutLocation` | tests/card-events-hardening, tests/free-location-privacy | The `withoutLocation` in `api/card-events/route.ts:513` is a local variable, not this function. |
| src/lib/messaging.ts | `senderFrom` | tests/email-deliverability, tests/office-invite-email | `office-invite-email.ts:148` only mentions it in a comment. |
| src/lib/office-attention.ts | `computeAttention` | tests/office-team-metrics.test.ts | The whole file is test-only (table b). |
| src/lib/office-contact-detail.ts | `__test` | tests/office-contact-detail.test.ts | Explicit test hook. Intentional. |
| src/lib/office-invite.ts | `inviteDaysLeft` | tests/office-invite.test.ts | |
| src/lib/office-leads.ts | `isLeadStatusValue`, `leadStatusView` (re-exports) | tests/office-team-metrics, tests/office-team-ui | |
| src/lib/plan-intent.ts | `peekPlanIntent`, `writePlanIntent` | tests/guest-reset.test.ts | |
| src/lib/request-geo.ts | `requestLocation`, `resolveLocation` | tests/request-geo.test.ts | Superseded by `resolveGeo`. Comments in `api/leads/route.ts:132` and `record-view.ts:84` say "resolveGeo, not resolveLocation". |
| src/lib/store-os.ts | `detectStoreOsClient`, `resolveStoreOs` | tests/store-os.test.ts | |
| src/lib/swiftlink-looks.ts | `familyOfLook` | tests/swiftlink-looks.test.ts | |
| src/lib/wallet-band.ts | `bandBackground` | tests/wallet-pass-face.test.ts | |
| src/components/card-templates/shared.tsx | `fitGrownPx` | tests/render/card-contact-fit-and-name-color.test.ts | (component) |
| src/components/card-templates/shared.tsx | `fitOneLineLimit` | tests/card-text-fitting.test.ts | (component) |

Each `src` occurrence was re-checked with `git grep -w`. Only the three cross-file hits needed a closer look (`withoutLocation`, `senderFrom`, `resolveLocation`), and all three are a local variable or a comment.

### c4. Counts for the remaining export categories (not listed one by one)

| Scope | Test-only exports (all) | of which production never runs (in c3) | Exported but used only inside own file ("needless export") |
|---|---|---|---|
| src/lib | 250 | 29 | 294 (many are types) |
| src/components | 20 | 2 | 56 |

<details><summary>Full list of src/lib test-only exports by file (250)</summary>

account-purge.ts: PURGE_GRACE_DAYS, isPurgeDue, purgeUserData · account-state.ts: GUEST_FLOW_STORAGE_KEYS, PERSON_SCOPED_STORAGE_KEYS · activation-nudge.ts: ACTIVATION_MIN_AGE_MS · agent-chat.ts: TEAM_LEAD, everyoneResponders, isResponder, teamResponders · ai-card-design.ts: DesignSpec, contrast, enforceContrast, paletteFromColors · ai-consent-sequence.ts: AFTER_ANSWER_DELAY_MS, AI_ASK_FALLBACK_MS · ai-consent.ts: aiConsentAllows · apns.ts: APNS_PREFIX, ApnsEnv, ApnsPostDetail, buildApnsAlert, buildApnsBadge · app-review.ts: ACTIVE_DAYS_NEEDED, MIN_DAYS_INSTALLED, REASK_DAYS, SHARES_NEEDED, shouldAskForReview · capture-verify.ts: mustPaint, overlaps, paintedIn · card-changed.ts: ON_CARD_SCALARS, canonicalize · card-data.ts: cardInitials, formatCardAddress · card-finishes.ts: DEFAULT_FINISH, FREE_FINISH_IDS, cssUrl · card-flatten.ts: LOCATE_CARD_PROMPT, applyHomography, cardKindFromScan, cardQuadFromScan, flatSize, gridOverlay, homography, warpQuad · card-frame-detect.ts: ANALYSIS_GUIDE_H, ANALYSIS_GUIDE_W, ANALYSIS_MARGIN, CARD_ASPECT · chat-avoid.ts: overlaps · contact-links.ts: CONTACT_LINK_PARAM, MAX_DEVICES_PER_LINK, newContactToken, withContactToken · contact-photo.ts: escapeIlikeLiteral · contact-privacy.ts: NAME_MARK · contact-qr.ts: CONTACT_QR_MAX_BYTES · contact-return-notify.ts: metContext · crm-events.ts: CRM_WEBHOOK_TIMEOUT_MS · crm-scope.ts: isScoped · custom-layout.ts: LAYOUT_PRESETS · design-transfer.ts: artworkLeaks, findLeaks, leakRetrySuffix · download-link.ts: detectStoreOs · download-token.ts: DOWNLOADABLE_PATHS · draft-claim.ts: findOwnCardByUsername, sanitizeUsername · effective-plan.ts: effectivePlan · email-senders.ts: ALIASES_LIVE, MUST_RECEIVE, SENDERS · email-token.ts: EMAIL_TOKEN_TTL_DAYS, signEmailToken · email-typo.ts: COMMON_DOMAINS, KNOWN_GOOD_DOMAINS, levenshtein · event-tag.ts: EVENT_MAX_MS · events.ts: FUNNEL_PATHS, isFunnelPath · external-purchase.ts: externalPurchaseUrl · facebook-bot.ts: FACEBOOK, fbPostCode, parseFacebookWebhook · fcm.ts: FCM_CHANNEL_ID, FCM_PREFIX, buildFcmMessage · guest-draft.ts: CLAIM_CONSENT_MAX_AGE_MS, flushDraft, saveDraft · guest-reset.ts: resetGuestFlow · instagram-bot.ts: IgEventRow, IgQueueItem, buildDm, isQuestion, matchKeyword, parseWebhook, pickPublicReply, postCode · knowledge/derived.ts: CRM_PROVIDER_NAMES, PLACEHOLDER_KEYS, placeholdersIn · knowledge/index.ts: UNDOCUMENTED_ROUTES · knowledge/retrieval.ts: normalize, visibleDocs · known-contact.ts: confidenceOf, decideKnownContact, isOwnersOwnDetails, normalizeEmail, normalizePhone · link-anything.ts: everythingLinked · linkedin-desk.ts: ProspectFacts, buildDraftPrompt, clamp, fallbackDrafts, parseDrafts · linkedin-photo.ts: SMALL_PHOTO_PX, linkedInPhotoCandidates · location-display.ts: LOCATION_UNAVAILABLE · location-privacy.ts: PLACE_MARK, TEASED_PLACE, withoutLocation · logo-provider.ts: LogoDevProvider, normalizeLogoInput, parseLogoDevMatches · marketing-consent.ts: allowsMarketing · messaging.ts: nanpE164, senderFrom · native-google-login.ts: hashHandoff · office-account-notifications.ts: NotificationReader, ORDINARY_READER, PERSONAL_BILLING_TYPES, REFERRAL_TYPES · office-analytics-csv.ts: EmployeeCsvRow · office-attention.ts: computeAttention · office-brand.ts: EMPTY_OFFICE_BRAND, OWN_BIO, OWN_INSTAGRAM, extractDesign, pinOfficeLinks, refreshCardSurfaces · office-contact-detail.ts: __test · office-invite-email.ts: emailSafeImageUrl · office-invite.ts: inviteDaysLeft · office-leads.ts: isLeadStatusValue, leadStatusView · office-notification-links.ts: LEADS_NO_FOLLOW_UP_PATH · office-roles.ts: Capability, OfficeContext · office-scheduled-seats.ts: applicableTarget · office-team.ts: ACTIVE_WINDOW_MS, memberStatus · password-policy.ts: COMMON_PASSWORDS, emailLocalPart · plan-intent.ts: peekPlanIntent, writePlanIntent · plan.ts: nearestPreset · profile-customization.ts: canonicalJson · promo.ts: freeDaysLabel · push-ask.ts: PUSH_ASK_GAP_MS, PUSH_ASK_MAX, PUSH_ASK_TYPES · push-policy.ts: DAILY_CAP, MAX_BODY_CHARS, MAX_CARD_TAG_CHARS, MAX_PLACE_BODY_CHARS, SOFT_DAILY_CEILING, TEAM_ALERT_DAILY_CAP, VIEW_BATCH_MS, inQuietHours · rate-us.ts: RATE_US_HIDE_DAYS, RATE_US_VIEWS_NEEDED · referral.ts: CARD_CTA, NUDGE_COPY, SIGNUP_SOURCES · request-geo.ts: GeoGuess, edgeGeo, formatLocation, isCloudHostingOrg, reconcile, reconcileDetailed, requestLocation, resolveLocation · retention.ts: FREE_REASONS, PRO_REASONS · same-contact.ts: MAX_MERGED_MESSAGE · seeded-views.ts: isInternalCardSlug · self-traffic.ts: baseSlugForOwnerLookup, isSelfTraffic · sentry-scrub.ts: scrubDeep, scrubString, scrubUrl · share-preview.ts: ogImageFromHtml, previewVersion · signature-content.ts: cardImageData · site-logo.ts: extractSiteLogoUrls, extractSiteName, websiteToDomain · slug.ts: RESERVED_SLUGS · social-url.ts: handleLabel · source-labels.ts: SOURCE_LABELS · square-corners.ts: CARD_RADIUS_FRAC · store-os.ts: StoreOs, detectStoreOsClient, resolveStoreOs · subscription.ts: planForPriceId, priceIdFor · swiftlink-looks.ts: DEFAULT_BUTTON_STYLE, DEFAULT_HERO_CONTENT, DEFAULT_HERO_STYLE, DEFAULT_ICON_FILL, DEFAULT_ICON_SHAPE, DEFAULT_PAGE_DIM, FREE_SWIFTLINK_LOOKS, SWIFTLINK_LOOKS, familyOfLook, isLightSurface · swiftlink-tiles.ts: resolveTileSize · team-alerts.ts: teamPushTag, whoList · test-mailbox.ts: QA_MAIL_DOMAIN · track-link-click.ts: linkTarget · trial-extension.ts: TRIAL_EXTENSION_TOTAL_DAYS · trial-ledger.ts: ledgerKey · trial-notice.ts: trialNoticeDue · usage.ts: currentPeriod · vcard.ts: escapeVCardText · viewer-identity.ts: SessionViewer · visit-identity.ts: decideVisitIdentity, isVisitorId · visit-notify.ts: VISIT_RANK, visitKeys, visitPushTag · wallet-band.ts: bandBackground · wallet-fit.ts: textEm, wrapLines · wallet-palette.ts: hexStops, readableAccent, yiq · wallet-pass.ts: PassInputs · wallet-strip.tsx: bandVariant, passThemeFrom, renderPassStrips, sampleSurface · wallet.ts: EMAIL_SHARES_ROW_MAX, passCertDaysLeft · watch-contract.ts: WATCH_API_VERSION, buildWatchCard · weekly-recap.ts: TEAM_NOTICE_GAP_MS · welcome-email.ts: sendWelcomeEmail

</details>

## (d) API routes with no in-app caller

178 route files were checked. 20 have no caller in `src`, native, `public`, `supabase`, `vercel.json` or root files. 15 of them have an external caller; 5 have none.

### d1. External caller (expected, not dead)

| Route | Methods | Caller |
|---|---|---|
| /api/account/purge-due | GET | GitHub Actions cron `.github/workflows/push-catchup.yml` |
| /api/push/activation | GET | `.github/workflows/push-catchup.yml` |
| /api/push/recap | GET | `.github/workflows/push-catchup.yml` |
| /api/billing/trial-notice | GET | `.github/workflows/trial-notice.yml` |
| /api/agents/facebook/tick | GET | `.github/workflows/facebook-bot.yml` |
| /api/agents/instagram/tick | GET | `.github/workflows/instagram-bot.yml` |
| /api/agents/linkedin/selftest | GET | `.github/workflows/linkedin-desk-check.yml` |
| /api/agents/instagram/hashtags | GET | `marketing-agents/lib/radar.mjs` (out-of-app agent tooling) |
| /api/agent-email | POST | `marketing-agents/lib/agentkit.mjs`, `scripts/agent-flow-setup.mjs` |
| /api/iap/revenuecat | POST | RevenueCat webhook (configured in the RevenueCat dashboard; see `docs/IAP-SETUP.md`) |
| /api/wallet/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]/[serialNumber] | POST, DELETE | Apple Wallet PassKit web service (the pass's `webServiceURL`) |
| /api/wallet/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier] | GET | Apple Wallet PassKit web service |
| /api/wallet/v1/passes/[passTypeIdentifier]/[serialNumber] | GET | Apple Wallet PassKit web service |
| /api/wallet/v1/log | POST | Apple Wallet PassKit web service |
| /api/views/[username] | POST | Retired. Only `scripts/qa-prod-probe.mjs` calls it. See DD-05. |

(The Vercel crons `/api/reminders` and `/api/wallet/sweep` are referenced from `vercel.json`, so they do not appear here.)

### d2. No caller found

| Route | Methods | Lines | Last commit | Evidence | Confidence |
|---|---|---|---|---|---|
| /api/leads/[id]/reminders | GET | 31 | 2026-07-10 | Its last caller, `fetch(`/api/leads/${lead.id}/reminders`)` in `LeadCard`, was removed with that component in becccd89 (2026-07-29, "delete dead LeadCard"). No reference anywhere in HEAD. | High |
| /api/office/role | POST | 47 | 2026-07-14 | Its only UI caller was removed in d477d143 (2026-07-14, "Settings: section rail ... trim for office employees"). Now referenced only in `tests/office-invite.test.ts`. The owner-only role assignment endpoint is still deployed with no UI. | High |
| /api/watch/card | GET | 48 | 2026-07-10 | No iOS, watchOS or web caller. The watch syncs over WatchConnectivity instead. Mentioned only in `docs/APPLE_WATCH.md`. Keeps `lib/watch-contract.ts` alive (table a). | High |
| /api/scanner/send | POST | 94 | 2026-09-23 | Its caller went with the dashboard scanner button (845b6a28, 2026-07-09). `/api/scanner` is still live, but `/send` has no fetch. Mentioned in `docs/plans/warm-lead-alerts.md` and tests only. Hardened as late as 2026-09-23 (rate cap) despite having no caller. | High |
| /api/email/one-click-unsubscribe | POST, GET | 58 | 2026-09-06 | Added in 9643909f. No email header points at it: `email-templates.ts` `unsubUrl()` builds `/api/unsubscribe?token=`, and `messaging.ts:34` builds `/api/unsubscribe/contact`. Referenced only in `docs/EMAIL-PREFERENCE-CENTER.md` and `tests/email-preference-center.test.ts`. Either the headers were meant to use it and do not, or it is dead. | Medium (mail already sent with this URL cannot be ruled out from code) |

## Counts summary

| Category | Count |
|---|---|
| `src` code files analysed / Next.js entry points | 862 / 287 |
| Dead files (zero importers) | **3** (AddSeatButton, HeroPhone, Skeleton): 361 lines |
| Effectively dead (only reachable through an uncalled route) | **1** (lib/watch-contract.ts, 79 lines) |
| Test-only code files | **1** (lib/office-attention.ts, 119 lines) |
| Script/test-only non-code files in src | 3 (splash `markup.html`, `markup-v2.html`: build inputs; `knowledge/REVIEWED.md`: kb marker), all by design |
| Unused exports, src/lib | **26** (15 declarations + 11 redundant re-exports) |
| Unused exports, src/components (beyond dead files) | **2** |
| Test-only exports that production never runs (lib + components) | **31** (29 lib, 2 components) |
| Test-only exports, total (lib / components) | 250 / 20 |
| Exports used only in their own file (lib / components) | 294 / 56 |
| API routes checked | 178 |
| API routes, external caller only | 15 (7 GitHub Actions crons, 2 marketing-agents, 1 RevenueCat, 4 Apple Wallet, 1 retired probe) |
| API routes, **no caller found** | **5** (leads/[id]/reminders, office/role, watch/card, scanner/send, email/one-click-unsubscribe) |
