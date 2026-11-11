# Office console + Site admin (read-only audit)

Rules checked: "contacts" never "leads" in Office copy — PASS. Team tiles all-time — PASS. Every Office number via getOfficeEmployeeMetricsForTeam — PASS (names differ, F-OFFICE-01). Admin-only controls hidden for members and re-checked at API — PASS. Double-submit guards on every mutating Office button — PASS. Invite token TTL/reuse/revoke — PASS. No dead hrefs in Office or admin.

## Office console

### F-OFFICE-01 Member name differs between Team tab and Analytics tab / person analytics / CSV
- Severity: Medium · Platform: web + iOS shell · Account: Office owner/admin/manager/billing_admin · Page: /office/admin/analytics, /analytics/[id], CSV
- File: src/lib/office-team.ts:240-243 (Team adds invite_name→invite_email fallback) vs src/lib/office-analytics.ts:67 (name = profiles.name || card name || username); consumers EmployeeAnalyticsTable.tsx:117, analytics/[id]/page.tsx:87, api/office/analytics/export/route.ts:42
- Problem/Actual: accepted member without card and empty profiles.name is "Dana Lee" on Team but "dana-3f9a2c" on Analytics, person page header and CSV. Expected one name ladder everywhere.
- Repro: invite "Dana Lee", accept, no card, open Analytics. Cause: 2026-09-23 fallback only added to getTeamOverview. Impact: admin cannot match rows; CSV shows handles. Confidence: Confirmed.

### F-OFFICE-02 Contacts tab shows "No contacts yet" when the load fails
- Severity: Medium · web+iOS · all admin roles · /office/admin/leads
- File: office/admin/leads/page.tsx:34 (`.catch(() => ({ leads: [], total: 0 }))`) → LeadsTable.tsx:240-241; Export hidden by knownTotal>0 (:178)
- Expected error panel with retry (Team and Analytics tabs have one). Actual false empty state. Confidence: Confirmed.

### F-OFFICE-03 "Edit details" on a teammate's card has no validation or length caps
- Severity: Medium · web+iOS · owner, admin · /office/admin/cards/[id]
- File: components/office/OfficeCardActions.tsx:151-159 (plain inputs, no type/maxLength/trim); api/office/cards/[id]/route.ts:49-51 copies name/title/phone/email/socials/customization/label from body into cards (non-strings accepted, no email format check)
- Repro: paste 10k chars into Name → Save. Impact: broken public card/vCard/preview for the employee. Confidence: Confirmed.

### F-OFFICE-04 Invite API accepts any string as email and an uncapped name
- Severity: Low · owner, admin · Add team member
- File: api/office/invite/route.ts:60-62 (only non-empty), :81 (invite_name raw); client relies on type="email" only. "bob" reserves a paid seat; invite email bounces. Seat gate :130-141 is check-then-insert (concurrent invites can both pass — Suspected). Confidence: Confirmed (validation).

### F-OFFICE-05 Branding save hides the server's error; inputs uncapped
- Severity: Medium · owner, admin · /office/admin/branding
- File: components/OfficeBranding.tsx:182-191 (`setStatus(res.ok ? "saved" : "error")`, body unread) — 403 "active Office subscription required", 401 session expiry, 500 all show "Something went wrong". Company/website/phone/fax/address have no maxLength (:297-330); brand_company is written as label of every member card (brand/route.ts:264) and into invite emails. No unsaved-changes guard. Confidence: Confirmed.

### F-OFFICE-06 Person page and per-person Analytics crash to the root error page on a data failure
- Severity: Low · all admin roles · /office/admin/team/[id], /analytics/[id]
- File: team/[id]/page.tsx:22 (getMemberDetail unguarded); analytics/[id]/page.tsx:65-71 (only metrics call has .catch); no src/app/office/admin/error.tsx. Confidence: Confirmed (path).

### F-OFFICE-07 Orphan Office API routes: no way to assign roles from the console
- Severity: Low · /api/office/role (POST), /api/office/cards (GET), /api/office (GET) have no UI caller
- File: api/office/role/route.ts:11, api/office/cards/route.ts:8, api/office/route.ts:17
- Problem: the role system (manager, billing_admin, admin; Billing tab, canBrand, tour cut-down) cannot be assigned anywhere in the UI — only by editing the database. Confidence: Confirmed.

### F-OFFICE-08 Expired session mid-form shows "Unauthorized"/generic error, never sends to login
- Severity: Low · all roles · TeamActions.tsx:160,531; OfficeCardActions.tsx:53; OfficeBranding.tsx:182; ContactDrawer.tsx:93-97; LeadsTable.tsx:140-156; OfficeNotificationBell (silent revert). No 401 → /login handling. Confidence: Confirmed.

### F-OFFICE-09 Team drawer offers View card / Copy link / QR for an offline card
- Severity: Low · TeamList.tsx:118,184-197 (gated on cardUrl, not liveCards). Admin can hand out a QR that opens nothing. Confidence: Confirmed.

### F-OFFICE-10 Analytics CSV rate limit shows raw JSON
- Severity: Low · api/office/analytics/export/route.ts:25-27 (10/10 min → 429 JSON) opened via DownloadLink; Contacts export has no limit. Confidence: Confirmed.

### F-OFFICE-11 Setup checklist regresses to "2 of 3" when the brand read fails
- Severity: Low · office/admin/page.tsx:81,92,130. Confidence: Confirmed (path).

### F-OFFICE-12 "Name your team" and invite name uncapped
- Severity: Low · CreateOfficeForm.tsx:63-70; api/office/route.ts:68-77. Confidence: Confirmed.

### F-OFFICE-13 "Back to my team" after removal is a full page reload
- Severity: Low · TeamActions.tsx:633 (window.location.href) — re-runs the boot hop in the iOS shell. Confidence: Confirmed.

## Site admin

### F-ADMIN-01 Users list plan dropdown changes plans with no confirmation and swallows every error
- Severity: High · web · site admin · /admin/users
- File: app/admin/users/UsersClient.tsx:72-81 (onChange → fetch, response unread, no try/catch); server api/admin/set-plan/route.ts:47-58 cancels Stripe on free, :84-87 tears down the Office team leaving enterprise, :28-33 409, :53-56 502
- Impact: one mis-scroll cancels a paying subscription or releases a whole office; refusals are invisible. Confidence: Confirmed.

### F-ADMIN-02 User detail: plan buttons, "Grant 1 month of Pro", "Take offline" — no confirm, errors dropped
- Severity: High · /admin/users/[id] · UserDetailClient.tsx:56-69 (only referralCode errors shown; 409/502 from api/admin/users/[id]/route.ts:172-208 discarded), buttons :154-172, :237-244. "Take offline" notifies nobody (Office path does). Confidence: Confirmed.

### F-ADMIN-03 Promo "Email to users" — no confirm, no idempotency, no daily cap, no campaign log
- Severity: Medium · MarketingClient.tsx:703-706, 839-842; api/admin/promo-codes/send/route.ts:15-194. Broadcast composer has all four protections; promo send has none and shows the segment count, not the filtered target count. Confidence: Confirmed.

### F-ADMIN-04 "Create card for business" always claims the login email was sent
- Severity: Medium · UsersClient.tsx:316 static copy; API returns loginEmailed + setupLink (create-card/route.ts:164-172) which the client ignores. Confidence: Confirmed.

### F-ADMIN-05 Loading/busy state sticks forever on network failure across admin pages
- Severity: Medium · UsersClient.tsx:72-81, 115-123; UserDetailClient.tsx:56-69; PlansClient.tsx:38-53; MarketingClient.tsx:140-147; AgentFlowClient.tsx:365-369 (disconnect optimistic, no rollback). Confidence: Confirmed.

### F-ADMIN-06 Email composer and create-card inputs have no server-side length caps
- Severity: Low · api/admin/broadcast/route.ts:74; promo-codes/send/route.ts:26; create-card/route.ts:17-25. Confidence: Confirmed.

### F-ADMIN-07 Plan limits and referral rules hardcoded in admin copy
- Severity: Low · AnalyticsClient.tsx:158 ("More than 5 leads a month"); ReferralsClient.tsx:32; UserDetailClient.tsx:264; api/admin/users/[id]/route.ts:44-48 — instead of PLAN_LIMITS / referral.ts SIGNUPS_PER_REWARD, MAX_REFERRAL_REWARDS. Confidence: Confirmed.

### F-ADMIN-08 Agent Flow: one-click post/publish/merge; bulk bar copy is false when a connector is armed
- Severity: Low (owner-only) · AgentFlowClient.tsx:1147, 1160, 1168 (Approve & Ship fix merges to main), bulk bar :1203 says "Nothing gets sent" but items route :154-166 executes armed connectors. Monthly budget labelled "$" stores tokens (:1422-1424). Confidence: Confirmed.

### F-ADMIN-09 Promo Delete uses window.confirm and has no busy guard
- Severity: Low · MarketingClient.tsx:707-717. Confidence: Confirmed.

### F-ADMIN-10 Website analytics device toggle fails silently
- Severity: Low · WebsiteAnalyticsClient.tsx:109-122. Confidence: Confirmed.

### F-ADMIN-11 Label mismatches
- Severity: Low · "Sandbox" vs "Plan sandbox" vs title "Plan tester"; "Analytics" vs "Company analytics"; "lead(s)" in admin copy (AnalyticsClient.tsx:158-159, 377; PlansClient.tsx:19). Office: "Contacts" vs "Contacts captured"; "Swift Link views" vs "Link views". Confidence: Confirmed.

## Control inventory (summary)
Office: Team (invite, pay-and-add-seat, remind, retract, remove, drop seat, owner delete account, drawer view/copy/QR/manage), Analytics (range, search, sort, CSV), Contacts (filters, export, drawer, load more), Branding (all fields, Save & apply), person page, card page (edit details, take offline/online), bell (poll 30 s, optimistic + rollback). Every mutating control has loading + double-submit guard; error display gaps listed above.
Admin: Overview, Users (plan select, create card, export), User detail (plan, grant, offline, referral code), Plans sandbox, Marketing (domain check, broadcast with confirm+idempotency+cap, promo create/log/email/delete), Referrals (read-only), Retention (read-only), Website (internal device toggle), Analytics (read-only), Agent Flow (controls, settings, queue approve/publish/ship, chat, radar, connectors, bots, LinkedIn desk).
