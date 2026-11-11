# 06 - Security audit (read-only) - 2026-10-12
Repo: relationship-app @ main 655a4480 (working tree has uncommitted peer edits; audited as on disk)

## Findings

### SEC-01 Public lead form: contact-existence oracle + tampering of an existing contact by phone number
- Severity: Medium
- Platform: All (public API, web + app + any HTTP client)
- Account type/plan affected: Every card owner (all plans)
- Feature/page: Public card "Exchange contact" form -> POST /api/leads
- File/component/function: src/app/api/leads/route.ts:201-224 (dedupe branch), src/lib/same-contact.ts:15 (sameContactFill), src/lib/known-contact.ts:218 (bindFormDevice)
- Problem: Unauthenticated POST with {card_owner:<public slug>, name, phone:<victim's number>} is matched against the owner's existing contacts by exact phone. On a match the route (a) returns a distinguishable body `{success:true, deduped:true}`, (b) fills the stored contact's email/company if empty and APPENDS attacker text to its message (trimmed with slice(-6000), so two 3000-char sends push the original message out entirely), and (c) binds the attacker's visitor device to that contact (contact_devices), superseding the real device binding.
- Expected behavior: A visitor can only create a new submission; it must not reveal whether a phone number is already in someone's contacts, must not modify an existing contact, and must not claim another person's device identity.
- Actual behavior: Response reveals membership; existing contact record is mutated by an anonymous party; attacker's browser is now treated as that known contact (return-visit / "X viewed your card again" attribution and notifications).
- How to reproduce: (local/staging only) create card "alice"; add lead phone +15551234567 via the form; from another browser POST /api/leads {card_owner:"alice", name:"x", phone:"+15551234567", message:"<3000 chars>"} twice -> response has deduped:true; contacts drawer now shows the attacker text and the original message is gone; subsequent visits from the attacker browser are attributed to the original contact.
- Likely cause: Dedupe-by-phone was designed for the same person resubmitting, but identity is taken from an unverified client-supplied phone.
- User impact: Privacy leak (who is in whose contacts, by phone), CRM data integrity (owner's notes overwritten/injected, which also flows to CRM sync/Zapier), false visit attribution/notifications.
- Confidence: Confirmed (code path)
- Proposed fix: Return the same body for new and deduped submissions; never overwrite/append on the existing row from an anonymous request — insert a separate "repeat submission" event instead, or only merge when the request also carries the contact's existing bound visitor cookie; do not call bindFormDevice on the dedupe path unless the visitor id was already bound to that lead.

### SEC-02 Unauthenticated account-enumeration endpoint (/api/account-exists)
- Severity: Medium
- Platform: All
- Account type/plan affected: Every account holder (any email)
- Feature/page: Login / signup "do you already have an account?" check
- File/component/function: src/app/api/account-exists/route.ts:11-41
- Problem: Anyone can POST {email} and receive {exists:true|false} computed from profiles.email (service role) and cards.email. The signup flow deliberately uses Supabase's enumeration-safe shape (LoginForm.tsx:343), and this endpoint undoes that protection.
- Expected behavior: No unauthenticated oracle for "is this email a SwiftCard customer" (or a strongly throttled/captcha-gated one returning a uniform answer).
- Actual behavior: 30 lookups per 10 min per IP; when Upstash env vars are absent the limiter is per serverless instance (src/lib/rate-limit.ts:136), so the effective limit scales with instances; rotating IPs removes it.
- How to reproduce: POST /api/account-exists {"email":"someone@example.com"} with no cookies -> {"exists":true} for a registered address, {"exists":false} otherwise.
- Likely cause: UX convenience (route the user to Sign in vs Create account) implemented as a public oracle.
- User impact: Lets attackers confirm which emails/businesses use SwiftCard (targeted phishing, credential stuffing lists). profiles.email also covers office members and admins.
- Confidence: Confirmed
- Proposed fix: Drop the profiles lookup for unauthenticated callers (or remove the endpoint and rely on the signUp response), add a human gate (lib/human-gate.ts) and a global per-email limit; confirm Upstash is configured in Production so limits are global.

### SEC-03 PII (scanned card emails/phones/addresses, OCR text) written to platform logs by design-transfer
- Severity: Medium
- Platform: Server (Vercel runtime logs)
- Account type/plan affected: Pro users using "transfer my paper card design"; the PII is often third parties' (the scanned card's)
- Feature/page: Design transfer (scan a printed card into a design)
- File/component/function: src/app/api/design-transfer/route.ts:174-177 (logs up to 300 chars of raw AI measurement output), :236-239 and :248 (logs `problems.leaks`, which src/lib/design-transfer.ts:659-683 fills with the literal emails, phone numbers, street addresses and websites read off the card)
- Problem: Raw contact details are interpolated into console.error lines tied to user.id. Vercel log drains/retention and anyone with project log access can read them. Matches the production observation in the brief.
- Expected behavior: Log counts/categories only ("2 leaks: email, phone"), never values.
- Actual behavior: Values are logged verbatim.
- How to reproduce: (local) run design-transfer with a card image whose redraw keeps an email; observe "[design-transfer] artwork attempt 1 rejected for <uuid>: jane@acme.com, +1 555 ..." in the server log.
- Likely cause: Diagnostics added while debugging the redraw gate.
- User impact: Privacy/GDPR exposure; PII retained outside the data-deletion path (account purge cannot delete log lines).
- Confidence: Confirmed
- Proposed fix: Log `problems.leaks.length` and leak kinds; drop the `measureRaw` excerpt (or pass it through scrubString from lib/sentry-scrub.ts). Same treatment for related sites: src/lib/messaging.ts:437 reportError("email.send", e, { to, subject }) and src/app/api/contact/route.ts reportError("contact.send", ..., { from: email }) — reportError (src/lib/report-error.ts:34-52) writes `extra` unscrubbed to console, the error_events table and the alert webhook; only Sentry events are scrubbed.

### SEC-04 Anonymous public file hosting in the `card-uploads` bucket (guest uploads, never cleaned up)
- Severity: Medium
- Platform: All (API)
- Account type/plan affected: N/A (abuse by unauthenticated parties; cost/reputation to SwiftCard)
- Feature/page: Guest card builder image upload; Swift Links video upload
- File/component/function: src/app/api/upload/route.ts:47-53,116-118 (guest path `guest/<uuid>/...`, 15 uploads/10 min/IP, 5 MB); src/app/api/upload/link-video/route.ts:16-55 (guest gets a signed upload URL; size/content-type are only CLIENT-DECLARED, 6/10 min/IP); no code anywhere deletes `guest/` objects (grep finds only the two writers)
- Problem: With no account, anyone can obtain permanent public URLs on the Supabase project domain for up to 26 MB per object (bucket limit). For the video route the server never sees the bytes, so any content can be uploaded labelled video/mp4|quicktime|webm. For images, when sharp fails to decode (src/app/api/upload/route.ts:100-103) the raw bytes are stored unmodified with the client's declared image/* type (also keeping EXIF/GPS for JPEGs).
- Expected behavior: Guest media is short-lived (TTL purge), size enforced server-side, and only re-encoded media is stored.
- Actual behavior: Unbounded anonymous persistent storage; per-instance rate limit if Upstash is absent.
- How to reproduce: POST /api/upload/link-video {contentType:"video/mp4", size:1} without cookies -> signedUrl; PUT 25 MB of arbitrary bytes to it; GET the returned public url.
- Likely cause: Guest builder needs uploads before signup; no lifecycle job was added.
- User impact: Storage/egress cost, malware/abuse content served from the project's storage domain (domain reputation, takedown risk).
- Confidence: Confirmed (code); bucket-level size/MIME limits from the brief
- Proposed fix: Add a cron that deletes `card-uploads/guest/*` older than N days unless claimed (drafts/claim should move/copy them under user.id); reject on sharp failure instead of storing raw bytes; for guest video, require a human-gate token or sign-in.

### SEC-05 Unauthenticated open image proxy (/api/img-proxy)
- Severity: Low
- Platform: All
- Account type/plan affected: N/A (platform abuse)
- Feature/page: Link tiles / previews
- File/component/function: src/app/api/img-proxy/route.ts:33-80
- Problem: Any URL on the internet (SSRF-guarded by safeFetch) is fetched and re-served from swiftcard.me with `Access-Control-Allow-Origin: *` and a 1-day public CDN cache, 8 MB cap, 120 requests/10 min/IP, no auth, no referer/allow-list.
- Expected behavior: Proxy only images referenced by a real card/link (signed URL or allow-listed hosts), or require a signed `sig` parameter.
- Actual behavior: General-purpose image proxy/CDN under the swiftcard.me origin. Headers are good (CSP sandbox, nosniff), so no XSS — the risk is bandwidth cost, hiding the origin of abusive images behind swiftcard.me, and hot-linking.
- How to reproduce: GET /api/img-proxy?url=https://example.com/any.jpg from any client.
- Likely cause: Built for in-app tiles without binding to card data.
- User impact: Cost and domain-reputation risk; no direct user data exposure.
- Confidence: Confirmed
- Proposed fix: HMAC-sign proxy URLs server-side when rendering tiles (url+width+sig) and reject unsigned requests.

<!-- continued 2026-10-13 by resumed security auditor (read-only); SEC-01..05 above are unchanged -->

### SEC-06 Site-owner admin is "password + email allow-list" only: no MFA, leaked-password protection off, and the role can merge code to production
- Severity: High
- Platform: Web (/admin, /api/admin/*)
- Account type/plan affected: The ADMIN_EMAILS account(s); blast radius = every user + the production deploy
- Feature/page: Admin console, Agent Flow "Approve & Ship fix"
- File/component/function: src/lib/admin.ts:15-18 (`requireAdmin` = `getUser()` + `isAdminEmail(user.email)`; no `aal` check); src/app/admin/layout.tsx:11-13 (same); src/app/api/admin/agents/ship-fix/route.ts:26,69 (merges a PR on GitHub with GITHUB_AGENTS_TOKEN; merging to main auto-deploys); also /api/admin/broadcast (mail every user), /api/admin/set-plan, /api/admin/users/[id] (modify/delete any user), /api/admin/users/export (export all users). A repo-wide grep finds no `aal2` / `getAuthenticatorAssuranceLevel` / `mfa.` usage.
- Problem: Every admin route is correctly gated (verified: all 32 /api/admin/* route files call requireAdmin in every exported handler), but the gate is a single factor. Production also has Supabase leaked-password protection DISABLED (brief), so a breached/reused password is accepted.
- Expected behavior: Admin access requires a second factor (Supabase MFA, session `aal2`), re-checked on the most destructive actions (ship-fix merge, broadcast, user delete, set-plan).
- Actual behavior: Whoever obtains the admin password gets full user-data export, mass email to the whole user base from the product's domain, plan changes, account deletion, and one-click merge of agent-authored PRs to main.
- How to reproduce: Describe only - sign in with the admin email/password on any browser; /admin renders and /api/admin/* answer; no second factor is requested.
- Likely cause: Admin bolted onto the user auth model via an env allow-list.
- User impact: Single credential compromise = platform compromise (data exfiltration, phishing from swiftcard.me, code to prod).
- Confidence: Confirmed (code). MFA enrolment state in the Supabase dashboard not checked.
- Proposed fix: Enable Supabase MFA (TOTP) for admin accounts; in requireAdmin also require `auth.mfa.getAuthenticatorAssuranceLevel()` currentLevel === "aal2" (fail closed); enable leaked-password protection (Auth settings) - dashboard-only manual step.

### SEC-07 "Sign out" on a device in Settings -> Devices does not sign it out; the removed device silently re-claims its slot (and the 2-device limit is caller-controlled)
- Severity: Medium
- Platform: Web + iOS shell
- Account type/plan affected: All
- Feature/page: Settings -> Devices -> "Sign out" (src/app/settings/devices/page.tsx:174-178)
- File/component/function: src/app/api/devices/route.ts:29-66 (DELETE only deletes the `user_devices` row + push binding; `supabase.auth.signOut()` runs only when the caller removed ITSELF); src/proxy.ts:260-311 (the removed device's next protected page calls `claim_device_slot` again); supabase/device-limit.sql:65-116 (unknown device + count < limit -> re-insert, returns true), :41-42 (policy "own devices insertable"); p_limit is a caller argument and the function is SECURITY INVOKER.
- Problem: Removing device X frees a slot but X's Supabase session (refresh token) is untouched, so on X's next page view the proxy re-registers it and it carries on. The user who pressed "Sign out" (lost phone, ex-employee's laptop, shared computer) believes it is signed out. Separately, any signed-in user can call `rpc('claim_device_slot', {p_limit: 1000})` or INSERT into user_devices via PostgREST to register unlimited devices, and the limit is never applied to /api/* (the proxy matcher covers pages only).
- Expected behavior: "Sign out" revokes that device's access (at minimum tombstones the device id so claim_device_slot refuses it until a fresh sign-in), and the limit is server-fixed.
- Actual behavior: The removed device keeps working (bounced only if a third device grabs the freed slot first); limit bypassable by the account holder.
- How to reproduce: Describe only - sign in on browsers A and B; on A, Settings -> Devices -> Sign out B; reload /dashboard on B: it loads, and A's Devices list shows B again.
- Likely cause: Slots were built as a sharing deterrent, not session revocation; the server cannot revoke another session without its token.
- User impact: False sense of security after losing a device; account-sharing control ineffective.
- Confidence: Confirmed (code path)
- Proposed fix: Keep a `revoked_at` tombstone (don't delete) and make claim_device_slot return false for a revoked id; in the proxy, on false for a revoked id call `supabase.auth.signOut({ scope: "local" })` and redirect to /login. Apply the device section of supabase/least-privilege-2026-09-24.sql (SECURITY DEFINER, fixed limit, no direct INSERT) - manual production migration, owner's go-ahead required.

### SEC-08 Browser roles still hold full table grants on ~50 tables (incl. integrations OAuth tokens); RLS-with-no-policy is the only wall
- Severity: Medium (defense in depth; nothing readable today)
- Platform: Supabase (PostgREST with the public anon key / any user JWT)
- Account type/plan affected: All
- Feature/page: Database
- File/component/function: supabase/least-privilege-2026-09-24.sql:1-25 (header "NOT YET APPLIED"); production state per brief: anon+authenticated have SELECT/INSERT/UPDATE/DELETE on cards, card_views, card_events, notifications, integrations (access_token/refresh_token), push_subscriptions, stripe_events, promo_codes, audit_logs, email_logs, agent_*; 4 functions with mutable search_path; 4 public buckets with zero storage.objects policies.
- Problem: The app never touches these tables with a user session (verified: no client component queries a table; browser Supabase usage is auth-only in AccountIsolationGuard, EnablePushButton, GoogleSignInButton, LoginForm, ManageAccount, NativeAppBridge, ResetPasswordForm, lib/device-sign-out, lib/iap; no "use client" file imports supabase-admin). The grants serve nothing, and one mistaken `using (true)` policy, a new table created without RLS (default privileges still grant), or RLS toggled off while debugging exposes OAuth refresh tokens, promo codes and every lead to the internet.
- Expected behavior: Browser roles hold only SELECT on profiles, SELECT/DELETE on user_devices, EXECUTE on claim_device_slot; default privileges closed.
- Actual behavior: Supabase defaults.
- How to reproduce: Describe only - in the SQL editor query information_schema.role_table_grants for grantee in ('anon','authenticated'), schema public.
- Likely cause: Migration written 2026-09-24, held for owner approval.
- User impact: None today; a single future misconfiguration becomes a full data breach.
- Confidence: Confirmed (repo + production state in brief)
- Proposed fix: Owner-approved manual step: review and run supabase/least-privilege-2026-09-24.sql in the SQL editor (also fixes SEC-07's p_limit), then `alter function ... set search_path = public` on the 4 flagged functions. Not for an agent to run.

### SEC-09 Office "admin" role can remove peer admins and billing admins (no role hierarchy on member removal)
- Severity: Medium
- Platform: Web + iOS (Office console -> Team)
- Account type/plan affected: Office teams with more than one privileged member
- Feature/page: /office/admin team list -> Remove; DELETE /api/office/members?id=
- File/component/function: src/app/api/office/members/route.ts:27-38 (only `requireOfficeCapability(user.id, "remove_members")` + office scoping; the target's `role` is never read); src/lib/office-roles.ts:28-32 (admin has remove_members; billing_admin holds manage_billing/manage_seats, which admin lacks)
- Problem: An `admin` can remove any active member regardless of role, including other admins and the billing_admin, and removal cascades: plan downgraded, office cards taken offline, brand stripped, office_id cleared.
- Expected behavior: Only the owner removes admins/billing_admins (mirrors manage_roles = owner only); admins remove managers/employees.
- Actual behavior: Lateral/upward removal allowed; owner learns only via the audit log / team inbox.
- How to reproduce: Describe only - owner makes A and B admins and C billing_admin; as A, DELETE /api/office/members?id=<B or C member id> -> 200; B/C lose Office.
- Likely cause: Capability check without target-role comparison.
- User impact: A rogue or compromised admin can lock out co-admins and the billing contact of a paying team.
- Confidence: Confirmed (code)
- Proposed fix: Select `role` with the member row; 403 when target role is admin/billing_admin and !ctx.isOwner; add a regression test.

### SEC-10 One OAUTH_SECRET is the AES-256-GCM key AND the HMAC key for seven token types; CRON_SECRET is a fallback signing key; no key version / rotation path
- Severity: Low
- Platform: Server
- Account type/plan affected: All (CRM integrations, email links, downloads, OAuth)
- Feature/page: Token crypto
- File/component/function: src/lib/token-crypto.ts:3-7 (OAUTH_SECRET hex-decoded as the AES key for stored integration tokens); the same string keys HMACs in src/lib/oauth-state.ts:16-24 (OAuth state, connect handoff, bind cookie), src/lib/download-token.ts:34-42, src/lib/self-pass.ts:38-44, src/lib/native-google-login.ts:88-95, src/lib/email-token.ts:28-38 and src/lib/messaging.ts:22-30 (the last two fall back to CRON_SECRET, a bearer credential also held in GitHub Actions). Contact-unsubscribe tokens never expire. The connect handoff `?h=` (oauth-state.ts:62-84, lib/connect-user.ts:25-31) is a 5-minute bearer in a URL and not single-use.
- Problem: Key reuse across encryption and many MAC domains (separation only by payload shape for state/download/handoff, by prefix for email/self-pass). Rotating OAUTH_SECRET would make every stored CRM token undecryptable (ciphertext `v2:` carries no key id), so it will never be rotated. If OAUTH_SECRET is ever unset, email/unsubscribe tokens are signed with CRON_SECRET.
- Expected behavior: Per-purpose keys (HKDF subkeys), a key version in ciphertext, no fallback to a bearer secret.
- Actual behavior: As above. No forgery found: every verifier is HMAC-SHA256 + timingSafeEqual + expiry (contact-unsubscribe has no expiry by design).
- How to reproduce: Code reading.
- Likely cause: Incremental reuse of the one secret that existed.
- User impact: None directly; raises the cost of any leak and blocks rotation.
- Confidence: Confirmed (code)
- Proposed fix: `deriveKey(purpose) = HKDF(OAUTH_SECRET, "swiftcard:" + purpose)`; ciphertext `v3:<kid>:...`; remove the CRON_SECRET fallback (fail closed); single-use handoff (jti in KV for 5 min).

### SEC-11 One scheduler bearer secret authorises unrelated jobs, including the account-purge run; comparisons are not constant-time
- Severity: Low
- Platform: Server / GitHub Actions
- Account type/plan affected: N/A (operational)
- Feature/page: Cron/bot endpoints
- File/component/function: src/app/api/account/purge-due/route.ts:22-29, push/catchup/route.ts:123-131, push/recap/route.ts:48-55, push/activation/route.ts:26-33, billing/trial-notice/route.ts:21-32, src/lib/instagram-bot-auth.ts:7-13 (all accept PUSH_CATCHUP_SECRET and/or CRON_SECRET); those secrets are referenced by 8 workflows (agent-radar, agent-watchdog, facebook-bot, instagram-bot, linkedin-desk-check, pinterest-pins, push-catchup, trial-notice).
- Problem: All fail CLOSED when unset (verified, incl. reminders and wallet/sweep), but one leaked secret (e.g. a compromised third-party action in any of the 8 workflows) lets the holder trigger pushes to all users, the trial-notice mailer, bot posting/AI spend, and the hourly purge (purge acts only on accounts already due - not arbitrary deletion). `includes()`/`===` compares are not constant-time (low practical risk).
- Expected behavior: One secret per job family; purge on its own secret; timingSafeEqual.
- Actual behavior: Shared.
- How to reproduce: Code reading.
- Likely cause: Moving crons from Vercel to GitHub Actions.
- User impact: Notification/email spam and cost if leaked.
- Confidence: Confirmed (code)
- Proposed fix: PURGE_SECRET and BOT_SECRET; stop accepting PUSH_CATCHUP_SECRET on purge-due and bots; timingSafeEqual; pin third-party actions by SHA.

### SEC-12 Soft-deleted accounts keep full API access for the 30-day window (the proxy guard covers pages only)
- Severity: Low
- Platform: All
- Account type/plan affected: Accounts in the soft-delete window (incl. members deleted by an Office owner)
- Feature/page: All /api/* writers
- File/component/function: src/proxy.ts:185-248 (`_deleted` redirect only for 7 page prefixes; /api is outside the matcher, :350-374); only 16 route files check `_deleted` (account/*, several admin/*, cards/[id], leads/share-card, office/members/delete-account, profile, push/activation, push/recap, reminders). Sign-in is not blocked for deleted accounts (by design, to offer Reopen).
- Problem: A deleted account (or anyone with its password) can sign in and, without reopening, call POST /api/cards, /api/upload, /api/leads/manual, /api/stripe/checkout (a new paid subscription on a deleted account; reconcileDeletedSubscriptions cancels later), /api/integrations/*, /api/scanner, etc. Public pages stay hidden (isCardActive / resolve-card check the owner), so no public exposure.
- Expected behavior: A central "deleted -> 403 except reopen/delete" check on every session route.
- Actual behavior: Per-route and mostly absent.
- How to reproduce: Describe only - delete an account, sign in again (lands on /account-deleted), POST /api/cards with the session cookie -> 200.
- Likely cause: Guard lives in the page proxy.
- User impact: Billing/data-integrity confusion; contradicts the "account deleted" message. Complements F-AUTH-05.
- Confidence: Confirmed (code)
- Proposed fix: Shared `requireLiveUser()` (getUser + `_deleted`) for every session route, pinned by a source-scan test like tests/proxy-auth-hop.test.ts.

### SEC-13 Apple Wallet web service: anyone can register unlimited fake devices against any public card's pass; device log sink is unthrottled
- Severity: Low
- Platform: Apple Wallet web service
- Account type/plan affected: Any card with a Wallet pass
- Feature/page: Add to Apple Wallet
- File/component/function: src/lib/wallet-registry.ts:31-50 (ApplePass token = HMAC of the serial; embedded in every pass, and /api/wallet/pass serves any public card's pass to anyone at 120/10 min/IP); src/app/api/wallet/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]/[serialNumber]/route.ts:22-45 + wallet-registry.ts:61-81 (upsert with no length/shape check on deviceLibraryIdentifier or pushToken, no per-serial cap, no rate limit); src/app/api/wallet/v1/log/route.ts:15-27 (unauthenticated, no rate limit, parses the whole body before the 20x500 slice).
- Problem: Download one pass, read authenticationToken, loop POSTs with random device ids: unbounded wallet_registrations growth, and every sweep/card edit fans out APNs pushes to garbage tokens (risk to the pass-type certificate's standing). /v1/log can flood runtime logs.
- Expected behavior: Shape validation (bounded hex), per-serial cap, per-IP limits on register and log.
- Actual behavior: Unbounded.
- How to reproduce: Describe only - GET /api/wallet/pass?card=<slug>, unzip, read pass.json authenticationToken, POST registrations with `Authorization: ApplePass <token>` and {"pushToken":"x"} repeatedly -> 201 each time.
- Likely cause: Apple's protocol treats the pass token as the credential; public cards mean public passes.
- User impact: Cost/abuse; no user data exposure.
- Confidence: Confirmed (code)
- Proposed fix: Validate shapes, cap registrations per serial (e.g. 50), isRateLimited keyed on clientIp for both endpoints.

### SEC-14 No global AI spend cap; public /api/ai/sales is only per-IP limited
- Severity: Low
- Platform: Web
- Account type/plan affected: N/A (cost)
- Feature/page: Marketing sales chat; in-app helper; design generation
- File/component/function: src/app/api/ai/sales/route.ts:17-22 (20 req/10 min per IP; up to 10 x 1000-char messages; maxTokens 500); no global/daily budget anywhere in src/lib; per-user limits on ai/help (30/10 min), design-generate, design-transfer, scan-design (40/h), scanner (60/h).
- Problem: With IP rotation (or per-instance limits if KV is absent) the public chat is an unbounded LLM proxy billed to SwiftCard; signed-in limits multiply with free sign-ups.
- Expected behavior: Global daily budget in KV degrading to SALES_FALLBACK, plus provider-side hard limits.
- Actual behavior: Per-IP/per-user only.
- How to reproduce: Describe only.
- Likely cause: Not designed for adversarial traffic.
- User impact: Cost.
- Confidence: Confirmed (code). Whether KV_REST_API_* is set in Production was not verifiable read-only (docs/INTEGRATION-TESTING.md:256 lists it among pulled env names, suggesting yes).
- Proposed fix: A global `isRateLimited("ai:global:day", N, 86_400_000)` before every aiComplete; hard monthly limits in provider dashboards (manual).

### SEC-15 Unauthenticated telemetry sinks accept arbitrary data: analytics_events (write-only, never read) and error_events
- Severity: Low
- Platform: All
- Account type/plan affected: N/A
- Feature/page: Analytics / error monitoring
- File/component/function: src/app/api/analytics/event/route.ts:13-58 (event_type any string, any length; event_data up to 4 KB; limit keyed `${ip}:${username}`, so rotating public slugs multiplies it); `analytics_events` has no reader in src (only this insert and purge deletes) - orphan feature; src/app/api/client-error/route.ts:6-28 (20/10 min/IP into error_events via reportError).
- Problem: Anonymous parties can grow analytics_events without bound and inject fake client errors into the error stream the owner uses to judge deploy health.
- Expected behavior: Remove the orphan writer or allow-list event_type and cap length; mark client errors untrusted and dedupe.
- Actual behavior: As above.
- How to reproduce: POST /api/analytics/event {username:<public slug>, event_type:<10 KB string>} -> {ok:true}, row inserted.
- Likely cause: Legacy analytics path superseded by card_events.
- User impact: DB growth, noisy monitoring.
- Confidence: Confirmed (code)
- Proposed fix: Delete /api/analytics/event and its client call (orphan-feature rule), or enum-validate event_type.

### SEC-16 Content-Security-Policy is only `frame-ancestors 'self'` (no script-src / object-src / base-uri)
- Severity: Low (defense in depth)
- Platform: Web
- Account type/plan affected: All
- Feature/page: Every page
- File/component/function: next.config.ts:16-21, :54 (comment at :9 shows it is deliberate)
- Problem: Public card / Swift Links pages render attacker-chosen content (anyone can make a card) on the same origin as the dashboard. Current mitigations hold - React 19.2 blocks `javascript:` hrefs, JSON-LD is escaped (src/lib/brand.ts:119-121), escape.ts safeUrlAttr guards email HTML - but the 16 dangerouslySetInnerHTML sites and any future regression have no CSP backstop.
- Expected behavior: Nonce-based script-src (per-request nonce from the proxy), object-src 'none', base-uri 'self', rolled out first as Report-Only.
- Actual behavior: No report-only policy either.
- How to reproduce: Inspect response headers on /.
- Likely cause: Inline boot scripts make a strict CSP work.
- User impact: None today; larger blast radius for any future XSS.
- Confidence: Confirmed
- Proposed fix: Ship Content-Security-Policy-Report-Only with a report endpoint, observe, then enforce.

### SEC-17 safeFetch IPv6 private-range gaps (NAT64 / 6to4 / Teredo / multicast)
- Severity: Low
- Platform: Server (link-preview, link-icon, img-proxy, logo/site-logo, contact-photo, push endpoint check)
- Account type/plan affected: N/A
- Feature/page: Outbound fetches of user-supplied URLs
- File/component/function: src/lib/safe-fetch.ts isPrivateIp - blocks ::1, ::, fe80, fc/fd, ::ffff:/:: embedded v4; does NOT block 64:ff9b::/96 (NAT64 of 127.0.0.1 / 169.254.169.254), 2002::/16 (6to4 embedding a private v4), 2001::/32 (Teredo), ff00::/8, fec0::/10.
- Problem: Otherwise strong (connect-time DNS validation defeats rebinding, per-hop redirect re-check, manual redirects, scheme allow-list). NAT64 is normally not routed on Vercel/Lambda, so exploitability is low.
- Expected behavior: Only global unicast IPv6 allowed.
- Actual behavior: As above.
- How to reproduce: Describe only - a hostname whose AAAA is 64:ff9b::a9fe:a9fe passes isPrivateIp.
- Likely cause: IPv4-centric list.
- User impact: Theoretical SSRF on IPv6-capable runtimes.
- Confidence: Confirmed (code); exploitability unverified
- Proposed fix: Decode embedded v4 for 64:ff9b::/96 and 2002::/16 and re-check; reject 2001:0::/32, ff00::/8, fec0::/10.

### SEC-18 Personal leads CSV has no Cache-Control; office leads export has no rate limit; CSV escaping misses leading-whitespace formulas
- Severity: Low
- Platform: Web + iOS (?dl= token path)
- Account type/plan affected: Pro / Office
- Feature/page: Contacts -> Export CSV; Office console -> Export
- File/component/function: src/app/api/leads/export/route.ts:72-77 (no `Cache-Control: no-store`, unlike office/leads/export:68); src/app/api/office/leads/export/route.ts:16-28 (no isRateLimited; pages through EVERY office lead per call); esc() in both (`/^[=+\-@\t\r]/`) misses values with a leading space or fullwidth `＝`.
- Problem / Impact: Contact PII CSV may be stored by intermediaries/browsers; a manager can hammer full-office exports; minor formula-injection residue.
- Confidence: Confirmed (code)
- Proposed fix: `Cache-Control: no-store` + rate limit; escape after trimStart and include `＝`.

### SEC-19 GET /api/office returns `offices.*` with `office_members(*)` to the owner
- Severity: Info
- File/component/function: src/app/api/office/route.ts GET (`select("*, office_members(*)")`, scoped to owner_id)
- Problem: Over-return - every member row's invite_token (a join credential) and any billing columns on offices go to the browser. Owner-scoped, so not cross-tenant.
- Proposed fix: Explicit column list.
- Confidence: Confirmed

### SEC-20 GET /api/unsubscribe performs the unsubscribe
- Severity: Info
- File/component/function: src/app/api/unsubscribe/route.ts:26-31 (GET calls suppress(token))
- Problem: Mail security scanners that pre-fetch links unsubscribe users from marketing mail without consent. The newer one-click route is POST (RFC 8058); this legacy GET should render a confirm page and POST.
- Confidence: Confirmed

### SEC-21 Service worker will cache any same-origin path posted to it, including signed-in pages
- Severity: Info
- File/component/function: public/sw.js saveCard (~:200-226) accepts any `msg.path` starting with "/" (no denylist for /dashboard, /contacts, /settings, /office, /admin); navigate() serves a saved copy whenever the network is slower than SLOW_MS.
- Problem: Only same-origin script can post the message and today only public card pages do, so not exploitable now; one wrong call would persist a signed-in page in CacheStorage, surviving sign-out on a shared phone.
- Proposed fix: Refuse app paths (proxy matcher list / RESERVED_SLUGS) in saveCard and navigate; clear the cards cache on sign-out.
- Confidence: Confirmed (code)

## Verified SAFE (this pass)
- Admin: all 32 /api/admin/* route files gate every exported handler with requireAdmin(); /admin/layout.tsx gates all admin pages server-side. Admin connect OAuth: state verified `=== user.id` + browser-bind cookie + PKCE cookie (src/app/api/admin/connect/[provider]/callback/route.ts:35-37).
- CRM OAuth: google/linkedin callbacks check signed 15-min state + HMAC browser-bind cookie; salesforce relies on the PKCE verifier cookie (binds the browser equally). Handoff tokens are domain-separated from state (lib/connect-user.ts).
- Download tokens: 60 s, path-bound (path supplied by the route), allow-listed paths; an invalid token refuses instead of falling back (lib/download-auth.ts:21-31). Lead vCard / exports re-scope by owned usernames or office capability.
- Cron routes (reminders, wallet/sweep, push/catchup|recap|activation, billing/trial-notice, account/purge-due) and bot routes all fail CLOSED when the secret is unset.
- Webhooks: Stripe constructEvent (missing secret -> throws -> 400) + idempotency; RevenueCat timing-safe bearer, 503 if unset; Twilio signature, skip flag only when NODE_ENV !== production; Resend hand-rolled Svix: 300 s tolerance, multiple v1 signatures, timing-safe, 500 if unset; Meta X-Hub-Signature-256 timing-safe, false if secret unset; agent-email 404 without secret, fixed recipient.
- Office: every /api/office/* route maps to a capability (Appendix B); role assignment cannot grant owner; member delete-account is owner-only and cannot target the owner; /api/join requires session email == invite_email (fail closed); join/sign-in-link mails only invite_email, limited per token and per IP; invite tokens come from the DB default (not client).
- Mass assignment: /api/profile, /api/cards, /api/cards/[id] use field allow-lists, strip every `_`-prefixed customization key from input and restore server values, overlay office-managed fields; checkout sells only allow-listed price ids and checks unit_amount. Lead tags: public form allows only "scanned"; PATCH refuses RESERVED_LEAD_TAG. profiles.email is user-writable but every mailer/Stripe path prefers the auth email (getAccountEmail) and no authz decision reads it.
- Uploads: key = `${user.id}/<allow-listed field>-<ts>.<ext from re-encoded type>`; no client path parts; GIF magic-byte check; DELETE scoped by user_id. Drafts claim re-uploads data URLs under user.id.
- SSRF: link-preview, link-icon, img-proxy, logo/site-logo, contact-photo use safeFetch; photo-suggest fetches only gravatar/unavatar or *.googleusercontent.com (user_metadata host-checked) with redirect:"error".
- Client Supabase: no client component reads/writes tables; no "use client" file imports supabase-admin; the profiles "Own update" policy is unused (no client UPDATE attempts that could silently fail).
- Rate-limit IP: lib/client-ip.ts uses x-real-ip (Vercel-set) then the RIGHTMOST X-Forwarded-For hop - not spoofable.
- Rename: normalizeSlug maps to [a-z0-9-] before the reserved check (no case/unicode/homograph bypass). Missing reserved words already in C02-003; full list of live top-level routes absent from RESERVED_SLUGS: business-card-view-tracking, download, email, link-in-bio-with-analytics, linkedin-connected, pin, review, splash-preview (static routes win over [username], so the effect is an unreachable card, not a hijack).
- Public card endpoints (vcard, card-signature, wallet pass) honour isCardActive. Active-card cookie is checked against the caller's own cards on /share, /contacts, /settings/flows.
- Native Google login: state HMAC, ticket sealed to a handoff-secret hash, 3-min ticket - interception of the custom-scheme URL yields nothing usable.
- Sentry: bodies/cookies dropped, emails/phones regex-scrubbed. NEXT_PUBLIC_* names are all publishable values (URLs, anon key, price ids, VAPID public key, RevenueCat public SDK keys, DSN, PostHog key, Google client id).
- Proxy caches: device cache keyed `${userId}:${deviceId}`, caches only success, denial re-evaluated each request; deleted-check cache keyed by user id; both bounded at 5000 entries. Pages outside the login wall (/grow, /welcome, /welcome/team, /upgrade, /checkout, /checkout/success, /share, /join/[token], /admin/*) all call getUser() server-side; only /grow and /share also check `_deleted` (F-AUTH-05 stands).

## Appendix B - Office capability matrix
Capabilities (src/lib/office-roles.ts:28-32): owner = all; billing_admin = manage_billing, manage_seats, view_org_analytics; admin = invite_members, remove_members, manage_branding, manage_member_cards, view_org_analytics; manager = view_org_analytics; employee = none.

| route | method | capability required | owner | billing_admin | admin | manager | employee | notes |
|---|---|---|---|---|---|---|---|---|
| /api/office | GET | owner_id = caller | Y | - | - | - | - | returns offices.* + members(*) (SEC-19) |
| /api/office | POST | plan enterprise + not a sub-user | Y | - | - | - | - | creates office |
| /api/office/brand | PATCH | manage_branding | Y | N | Y | N | N | |
| /api/office/cards | GET | manage_member_cards | Y | N | Y | N | N | |
| /api/office/cards/[id] | PATCH | manage_member_cards + officeOwnsCard | Y | N | Y | N | N | |
| /api/office/contacts/[id] | GET | view_org_analytics | Y | Y | Y | Y | N | |
| /api/office/leads/list | GET | view_org_analytics | Y | Y | Y | Y | N | |
| /api/office/leads/export | GET | view_org_analytics (session or ?dl=) | Y | Y | Y | Y | N | no rate limit (SEC-18) |
| /api/office/analytics/export | GET | view_org_analytics (session or ?dl=) | Y | Y | Y | Y | N | 10/10 min |
| /api/office/notifications | GET/PATCH/DELETE | view_org_analytics | Y | Y | Y | Y | N | read state office-wide (N-14) |
| /api/office/invite | POST | invite_members | Y | N | Y | N | N | role always employee |
| /api/office/members | DELETE | remove_members | Y | N | Y | N | N | no target-role check (SEC-09) |
| /api/office/members/delete-account | POST | remove_members AND isOwner | Y | N | N | N | N | cannot target owner/self |
| /api/office/role | POST | manage_roles | Y | N | N | N | N | assignable: admin/manager/billing_admin/employee |
| /api/stripe/subscription/seats | GET/POST | manage_seats | Y | Y | N | N | N | billing agent scope |
| /api/stripe/subscription | GET | sub-user block unless delegated billing; resolveBillingSubjectId | Y | Y | N | N | N | |
| /api/office/decline | POST | invite token only | - | - | - | - | - | unauthenticated by design |
| /api/push/recap (cron) | GET | cron bearer | - | - | - | - | - | office-aware recap |
Pages: /office/admin/* gated by requireOfficeAdmin() (src/lib/office-admin-guard.ts) via canViewOfficeAdmin; /office/* behind the proxy login wall.

## Appendix C - Secrets scan
Command (names only, values never printed): grep -rIlE for sk_live_/rk_live_/whsec_/AIza/xox[bp]-/PRIVATE KEY/sk-ant-/sk-proj-/re_.../AKIA... excluding node_modules, .next, .git, qa-offline-out.
- .env.local - matches, NOT tracked (ignored by .gitignore:51 `.env*.local`). Expected local secrets file.
- android/app/build/** - matches (generated Firebase resources), NOT tracked (android/.gitignore:24).
- android/app/google-services.json - TRACKED; contains one Firebase Android `current_key` (AIza...). Standard for Firebase and not a server secret, but confirm in Google Cloud console that the key is restricted to the Android package + signing SHA and to the APIs used (manual check).
- tests/apple-offer-codes.test.ts:97 - false positive (a test asserting the string "BEGIN PRIVATE KEY" is NOT in source).
- No Stripe live keys, webhook secrets, Slack tokens, OpenAI/Anthropic keys, AWS keys or private keys found in tracked files.

## Appendix A - API route authorization matrix (178 route files)
Auth model: session = supabase.auth.getUser() then 401; admin = requireAdmin() (ADMIN_EMAILS); "see notes" = bearer / HMAC / token. Rate limit = an isRateLimited call exists in the file (KV/Upstash if configured, else per-instance memory). "office-cap" = requireOfficeCapability / office sub-user gate present. Input validation: session routes reviewed use typed parsing + allow-lists; exceptions are named in notes. Generated from a per-file scan, then hand-annotated; a route marked "session" may also serve a guest branch where noted.

| route | auth model | rate limit | notes (validation / scoping) |
|---|---|---|---|
| /api/account-exists | public (session optional) | yes | SEC-02 enumeration oracle |
| /api/account/ai-consent | session | no |  |
| /api/account/choose-plan | session | no |  |
| /api/account/delete | session | yes |  |
| /api/account/downgrade | session | no |  |
| /api/account/purge-due | see notes | no | Bearer PUSH_CATCHUP_SECRET/CRON_SECRET, fail-closed; SEC-11 |
| /api/account/reopen | session | no |  |
| /api/account/retain | session | no |  |
| /api/account/retention | session | yes |  |
| /api/admin/agents/chat | admin (ADMIN_EMAILS) | no |  |
| /api/admin/agents/comms | admin (ADMIN_EMAILS) | no |  |
| /api/admin/agents/control | admin (ADMIN_EMAILS) | no |  |
| /api/admin/agents/facebook | admin (ADMIN_EMAILS) | no |  |
| /api/admin/agents/history | admin (ADMIN_EMAILS) | no |  |
| /api/admin/agents/instagram | admin (ADMIN_EMAILS) | no |  |
| /api/admin/agents/items | admin (ADMIN_EMAILS) | no |  |
| /api/admin/agents/linkedin | admin (ADMIN_EMAILS) | no |  |
| /api/admin/agents/links | admin (ADMIN_EMAILS) | no |  |
| /api/admin/agents/radar | admin (ADMIN_EMAILS) | no |  |
| /api/admin/agents | admin (ADMIN_EMAILS) | no |  |
| /api/admin/agents/settings | admin (ADMIN_EMAILS) | no |  |
| /api/admin/agents/ship-fix | admin (ADMIN_EMAILS) | no | admin; merges agent-fix/* PR to main (SEC-06) |
| /api/admin/agents/usage | admin (ADMIN_EMAILS) | no |  |
| /api/admin/analytics | admin (ADMIN_EMAILS) | no |  |
| /api/admin/broadcast/logs/[id] | admin (ADMIN_EMAILS) | no |  |
| /api/admin/broadcast/logs | admin (ADMIN_EMAILS) | no |  |
| /api/admin/broadcast | admin (ADMIN_EMAILS) | no |  |
| /api/admin/connect/[provider]/callback | admin (ADMIN_EMAILS) | no |  |
| /api/admin/connect/[provider] | admin (ADMIN_EMAILS) | no |  |
| /api/admin/create-card | admin (ADMIN_EMAILS) | no |  |
| /api/admin/email-domain | admin (ADMIN_EMAILS) | no |  |
| /api/admin/promo-codes/log | admin (ADMIN_EMAILS) | no |  |
| /api/admin/promo-codes | admin (ADMIN_EMAILS) | no |  |
| /api/admin/promo-codes/send | admin (ADMIN_EMAILS) | no |  |
| /api/admin/referrals | admin (ADMIN_EMAILS) | no |  |
| /api/admin/set-plan | admin (ADMIN_EMAILS) | no |  |
| /api/admin/users/[id] | admin (ADMIN_EMAILS) | no |  |
| /api/admin/users/export | admin (ADMIN_EMAILS) | no |  |
| /api/admin/users | admin (ADMIN_EMAILS) | no |  |
| /api/admin/website/internal | admin (ADMIN_EMAILS) | no |  |
| /api/admin/website | admin (ADMIN_EMAILS) | no |  |
| /api/agent-email | see notes | no | Bearer AGENT_RELAY_SECRET (404 if unset); fixed recipient |
| /api/agents/facebook/tick | see notes | no | botAuthorized: INSTAGRAM_BOT/PUSH_CATCHUP/CRON (>=16 chars) |
| /api/agents/instagram/hashtags | see notes | no | botAuthorized |
| /api/agents/instagram/tick | see notes | no | botAuthorized |
| /api/agents/linkedin/selftest | see notes | no | botAuthorized; one model call per hit |
| /api/agents/pinterest/pin | see notes | no | botAuthorized |
| /api/ai/help | session | yes | office-cap; session; client 'area' only picks KB audience |
| /api/ai/sales | public | yes | public; 20/10min/IP; no global spend cap (SEC-14) |
| /api/ai/suggest-messages | session | yes |  |
| /api/analytics/event | public | yes | public; event_type unvalidated; write-only table (SEC-15) |
| /api/auth/apple-token | session | no |  |
| /api/auth/google/native/callback | public | no | public; sealed ticket bound to handoff hash |
| /api/auth/google/native/redeem | public | no | public; requires handoff secret |
| /api/auth/google/native/start | public | no | public; signs state |
| /api/billing/trial-notice | see notes | no | Bearer TRIAL_NOTICE/PUSH_CATCHUP/CRON, fail-closed |
| /api/card-events | session | yes | POST public (visitor), GET session+ownership |
| /api/card-share-image | session | no |  |
| /api/card-signature/[username] | public | no | public card data; isCardActive |
| /api/card-signature | session | no |  |
| /api/card/[username]/vcard | public | no | public card data; isCardActive |
| /api/cards/[id]/rename | session | no | session; reserved list incomplete (C02-003) |
| /api/cards/[id] | session | no | office-cap; session; .eq(user_id); _ keys stripped |
| /api/cards | session | no | office-cap; session; _ keys stripped; office overlay |
| /api/client-error | public | yes | public; 20/10min/IP; writes error_events (SEC-15) |
| /api/contact | public | yes | public; per-IP limit; HTML escaped |
| /api/contacts/seed-demo | session | no |  |
| /api/design-generate | session | yes |  |
| /api/design-transfer | session | yes |  |
| /api/devices | session | no | session; DELETE does not revoke session (SEC-07) |
| /api/download-token | session | no | session; path allow-list; 60s HMAC token |
| /api/drafts/claim | session | yes | office-cap;  |
| /api/email/one-click-unsubscribe | see notes | no | HMAC email token (90d) |
| /api/email/preferences | see notes | yes | HMAC email token |
| /api/events | session | yes |  |
| /api/health | public | no | public; no user data |
| /api/iap/revenuecat | see notes | no | Bearer REVENUECAT_WEBHOOK_TOKEN, timing-safe, 503 if unset |
| /api/iap/sync | session | no |  |
| /api/iap/trial-eligible | session | no | office-cap;  |
| /api/img-proxy | public | yes | public open proxy (SEC-05) |
| /api/integrations/google/callback | see notes | no | signed state + browser-bind cookie |
| /api/integrations/google/connect | see notes | no | session or ?h= handoff; paid plan |
| /api/integrations/google | session | no |  |
| /api/integrations/handoff | session | no |  |
| /api/integrations/highlevel/token | session | no |  |
| /api/integrations/hubspot | session | no |  |
| /api/integrations/hubspot/token | session | no |  |
| /api/integrations/linkedin/callback | see notes | no | signed state + bind cookie |
| /api/integrations/linkedin/connect | public | no | session, handoff or guest state |
| /api/integrations/linkedin | session | no |  |
| /api/integrations/pipedrive/token | session | no |  |
| /api/integrations/salesforce/callback | see notes | no | signed state + PKCE verifier cookie (no bind cookie; PKCE binds) |
| /api/integrations/salesforce/connect | see notes | no | session or handoff |
| /api/integrations/salesforce | session | no |  |
| /api/join | session | no |  |
| /api/join/sign-in-link | public | yes | public; invite token; 5/15min/token + 20/h/IP; mails only invite_email |
| /api/leads/[id]/generate-sequence | session | no |  |
| /api/leads/[id]/message | session | yes |  |
| /api/leads/[id]/reminders | session | no |  |
| /api/leads/[id] | session | no |  |
| /api/leads/[id]/wrong-person | session | no |  |
| /api/leads/export | see notes | yes | session or ?dl= token; paid; CSV-injection escaped |
| /api/leads/manual | session | no |  |
| /api/leads | public | yes | public lead form; SEC-01; tags allow-list |
| /api/leads/share-card | session | yes |  |
| /api/leads/vcard | see notes | no | session or ?dl=; ownership via card_owner |
| /api/link-icon | public | yes | public; safeFetch |
| /api/link-preview | public | yes | public; safeFetch |
| /api/logo-suggest | session | yes |  |
| /api/meta/webhook | see notes | no | HMAC X-Hub-Signature-256, timing-safe |
| /api/notifications | session | no |  |
| /api/office/analytics/export | see notes | yes | office-cap; session or ?dl=; view_org_analytics |
| /api/office/brand | session | no | office-cap;  |
| /api/office/cards/[id] | session | no | office-cap;  |
| /api/office/cards | session | no | office-cap;  |
| /api/office/contacts/[id] | session | no | office-cap;  |
| /api/office/decline | see notes | no | invite token only (no session); state-guarded |
| /api/office/invite | session | yes | office-cap;  |
| /api/office/leads/export | see notes | no | office-cap; session or ?dl=; view_org_analytics; no rate limit |
| /api/office/leads/list | session | no | office-cap;  |
| /api/office/members/delete-account | session | yes | office-cap; owner only (isOwner) |
| /api/office/members | session | no | office-cap; remove_members; no role hierarchy (SEC-09) |
| /api/office/notifications | session | no | office-cap;  |
| /api/office/role | session | no | office-cap;  |
| /api/office | session | no | session; GET returns offices.* + office_members(*) (SEC-19) |
| /api/photo-suggest | session or guest | yes |  |
| /api/profile/event | session | no |  |
| /api/profile/rate-us | session | no |  |
| /api/profile | session | no | office-cap; session; field allow-list; _ keys stripped; _deleted checked |
| /api/promo/check | session | yes |  |
| /api/promo/redeem | session | yes |  |
| /api/push/activation | see notes | no | Bearer PUSH_CATCHUP/CRON, fail-closed |
| /api/push/ask | session | yes |  |
| /api/push/catchup | see notes | no | Bearer PUSH_CATCHUP/CRON, fail-closed |
| /api/push/preferences | session | no |  |
| /api/push/recap | see notes | no | office-cap; Bearer PUSH_CATCHUP/CRON, fail-closed |
| /api/push/subscribe | session | yes | POST session; DELETE by endpoint possession |
| /api/referrals/claim | session | no |  |
| /api/reminders | see notes | no | Bearer CRON_SECRET, fail-closed |
| /api/resend/webhook | webhook signature | no | Svix HMAC, 300s tolerance, multi-sig, 500 if unset |
| /api/scan-design | session | yes |  |
| /api/scanner | session | yes |  |
| /api/scanner/send | session | yes |  |
| /api/self-view | see notes | no | HMAC self-link; path allow-list redirect |
| /api/settings/crm-scope | session | no |  |
| /api/settings/crm | session | no |  |
| /api/settings/email-preferences | session | no |  |
| /api/settings/flows | session | no |  |
| /api/settings/zapier | session | no |  |
| /api/site-view | session | yes | public; 120/10min/IP; bounded fields |
| /api/sms/send | session | yes |  |
| /api/stripe/checkout | session | no | session; price allow-list + amount check |
| /api/stripe/portal | session | no |  |
| /api/stripe/subscription/cancel | session | no |  |
| /api/stripe/subscription/change-plan | session | no |  |
| /api/stripe/subscription/discount | session | no |  |
| /api/stripe/subscription/extend-trial | session | no |  |
| /api/stripe/subscription/keep | session | no |  |
| /api/stripe/subscription/preview | session | no |  |
| /api/stripe/subscription | session | no | office-cap;  |
| /api/stripe/subscription/seats | session | no | office-cap;  |
| /api/stripe/webhook | webhook signature | no | office-cap; constructEvent signature; idempotency table |
| /api/twilio/inbound | webhook signature | no | Twilio signature; skip flag only non-production |
| /api/twilio/status | webhook signature | no | Twilio signature |
| /api/unsubscribe/contact | see notes | no | HMAC token, no expiry |
| /api/unsubscribe | see notes | no | random DB token; GET mutates (SEC-20) |
| /api/upload/link-video | see notes | yes | session or guest (SEC-04); signed upload URL |
| /api/upload | see notes | yes | session or guest (SEC-04); user-scoped path; field allow-list |
| /api/views/[username] | public | no | public retired sink (DD-05) |
| /api/visit-identity/reset | public | no | public; clears own cookie only |
| /api/wallet/pass | public | yes | public card; 120/10min/IP |
| /api/wallet/sweep | see notes | no | Bearer CRON_SECRET, fail-closed |
| /api/wallet/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]/[serialNumber] | see notes | no | ApplePass HMAC per serial (SEC-13) |
| /api/wallet/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier] | public | no | Apple spec: no auth (lists serials for device id) |
| /api/wallet/v1/log | public | no | public; 20x500 chars; no rate limit (SEC-13) |
| /api/wallet/v1/passes/[passTypeIdentifier]/[serialNumber] | see notes | no | ApplePass HMAC per serial |
| /api/watch/card | session | no |  |
| /api/welcome | session | no |  |
