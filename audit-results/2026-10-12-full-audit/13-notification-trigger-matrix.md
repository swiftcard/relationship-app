# Appendix — Notification trigger matrix (committed HEAD 655a4480, read-only, 2026-10-14)

Companion to `05-notifications.md` (N-01..N-21). This lists every distinct notification `type` or kind the product writes to `notifications` (the personal bell) or `office_notifications` (the team inbox), or sends by push (APNs / FCM / web push), email (Resend) or SMS (Twilio). Line numbers are for HEAD (`git show HEAD:<path>`). The uncommitted worktree diff (NotificationBell.tsx, native-notification-copy.ts and others; see N-19) is NOT reflected here.

## Legend and shared rules (these apply to every push row and are not repeated per row)

- **Push path.** Every push goes through `sendPushToUser` (src/lib/push.ts:42). One call reaches every `push_subscriptions` row for the user: `apns:` endpoints go to APNs, `fcm:` endpoints go to FCM (the Android shell), and everything else goes to web push (VAPID). "Push" below means all three; there is no per-channel choice.
- **Policy** (`decidePush`, src/lib/push-policy.ts:343). Checks run in this order:
  1. category switch off
  2. quiet hours: 22:00–08:00 local, `prefs.quietHours` (default ON), timezone from `customization._push.timezone`, falling back to America/New_York
  3. the `catchup` short-circuit
  4. card_view batching: one alert an hour, then a silent rollup at most every 5 minutes
  5. SOFT ceiling of 8 a day across card_view, contact_saved, contact_return and team_alert
  6. contact_return caps: 1 per contact a day, 5 a day
  7. team_alert cap: 2 a day
  8. weekly_recap and getting_started are uncapped by construction
  9. DAILY_CAP of 5, which excludes the UNCAPPED categories (new_lead, lead_reply, billing_problem) and the OWN_CAP categories
- **Push preferences.** Stored in `profiles.customization._push.<category>` (`readPushPrefs`, push-policy.ts:215) and written by /api/push/preferences. Checked in `decidePush` (push-policy.ts:346) and checked earlier by the recap, activation and catch-up crons.
- **Plan redaction on push** (push.ts:205-214). Free: names become "A contact" (`genericNames`) and places are shaded (`teaseLocation`). Paid: the marks are stripped. Uses `isPaidProfile` (the effective plan). This is not a native-copy rule; it applies on every device.
- **Native copy (bell, iOS app only).** NotificationBell.tsx:99-102 hides `referral_claim` and `NATIVE_HIDDEN_TYPES` (`personal_sub_reminder`). It swaps bodies via `NATIVE_BODY_REMAP` for sequence_paused, pro_ended, lead_cap_reached and plan_downgraded (src/lib/native-notification-copy.ts). Push copy is never remapped for native.
- **Bell read filters** (GET api/notifications/route.ts):
  - Only the latest 20 rows (N-03).
  - `hideForReader`: Office accounts drop referral_*. A team member with no subscription of their own also drops payment_failed and personal_sub_reminder.
  - `redactForPlan`: paid readers drop FREE_STATE_TYPES (pro_ended, plan_downgraded, sequence_paused, lead_cap_reached). Free readers get names and places blocked out.
- **Insert dedupe.** `insertNotification` (src/lib/notify.ts:43-62) drops a row identical in user + type + title + body + card_owner within 10 minutes, unless `allowRepeat` is set (N-06). It returns false on ANY insert error (N-04).
- **Visit rows** go through `notifyVisit` (src/lib/visit-notify.ts:186) instead:
  - One row per visitor per 30-minute visit.
  - A later event upgrades the row only if it ranks higher. `VISIT_RANK` (visit-notify.ts:31): card_viewed 1 < contact_returned 1.5 < contact_engaged 1.7 < milestone 2 < contact_saved 3 < new_lead 4.
  - A mid-visit upgrade pushes again only for UNCAPPED categories (visit-notify.ts:221).
- **8am catch-up.** /api/push/catchup re-announces unread bell rows created inside last night's quiet window, as ONE push: the top-ranked row plus "Plus N more".
  - Personal rows: only types in `CATEGORY_FOR_TYPE` (catchup/route.ts:54-62): card_viewed, contact_saved, contact_returned, contact_engaged, new_lead, lead_reply, payment_failed.
  - Team rows: unread rows of `TEAM_PUSH_TYPES` (route.ts:92).
  - Anything else held by quiet hours is never pushed later.
- **Plans.** "All" means Free, Pro (including trial or grant), Office owner and Office member. "Office admin" means the office owner plus active members whose role has `view_org_analytics` (team-alerts.ts:33-50), and only while the office is live, i.e. the owner is on the Office plan (`officeIsLive`, office-notify.ts:47).

## Table 1 — Personal bell rows (`notifications` table) and their pushes

| # | Notification (`type`) | Trigger event | Origin file:line | Recipient | Plan eligibility | Bell row? | Push (APNs/FCM/web)? | Email? | SMS? | Dedupe / cap rule | Quiet hours / 8am catch-up | User preference that disables it (where checked) | Native-copy variant (iOS no-selling) | Test that pins it | Notes / defect |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `card_viewed` | Public card or Swift Links view (`viewed_card` event) | src/app/api/card-events/route.ts:695 (notice from src/lib/card-event-notify.ts:119) | Card owner | All | Yes, one per visit | Yes, `card_view` | No | No | Visit ledger (30-min visit_key); 1 alert an hour, then a silent rollup at most every 5 min; SOFT 8/day; DAILY_CAP 5; per-IP flood cap 6/h per card (route.ts:653, N-08) | Held, then caught up (card_viewed → card_view) | `_push.card_view` (decidePush); no switch turns off the bell row | None needed (Free redaction only) | one-notification-per-visit, view-visit-window, notification-matrix, card-activity-tracking | N-02 (NULL visit_key), N-08 |
| 2 | `contact_saved` (anonymous) | vCard download (`downloaded_vcard`) | card-events/route.ts:695 (card-event-notify.ts:140) | Card owner | All | Yes (opens or upgrades the visit row) | Yes, `contact_saved`, but only when it OPENS the visit; a mid-visit upgrade is silent | No | No | Visit ledger; SOFT 8/day; DAILY_CAP 5; flood cap | Held, then caught up | `_push.contact_saved` | None | notification-matrix, card-activity-tracking, card-events-hardening | — |
| 3 | `contact_returned` | A known contact (captured lead) re-opens the card | card-events/route.ts:695 (src/lib/contact-return-notify.ts:107-118) | Card owner | All; on Free only if the contact is not locked over the cap (route.ts:597) | Yes | Yes, `contact_return`, if the lead status is not closed (`contactMayPush`) | No | No | Visit keyed on `lead:<id>`; 1 per contact a day, 5 a day; SOFT 8/day | Held, then caught up; closed-status leads filtered (catchup:280-286) | `_push.contact_return` | Free push body "Open SwiftCard to see who" | contact-return-alerts, contact-alerts-feed, notification-matrix | — |
| 4 | `contact_returned` (forwarded variant) | The contact's personal link opened on another browser (`confidence==="forwarded"`) | contact-return-notify.ts:93-99 | Card owner | All | Yes | **No live push** (bell only, rule D3) | No | No | Visit ledger | **Caught up anyway** (type maps to contact_return) | — | None | contact-return-alerts | **NM-01** |
| 5 | `contact_engaged` | A known contact taps a link | contact-return-notify.ts:121-128 | Card owner | All (Free: not if locked) | Yes (upgrades the visit row) | **No live push** (no pushCategory) | No | No | Visit ledger (rank 1.7) | **Caught up as contact_return** (catchup:61) | — | None | contact-return-alerts, contact-alerts-feed | **NM-01** |
| 6 | `contact_saved` (known contact) | A known contact downloads the vCard again | contact-return-notify.ts:132-138 | Card owner | All (Free: not if locked) | Yes | Yes, `contact_saved`, if `contactMayPush` | No | No | Visit ledger; SOFT and DAILY caps | Caught up, but **the closed-status filter is not applied** (catchup:286 filters contact_return only) | `_push.contact_saved` | None | contact-return-alerts | **NM-02** |
| 7 | `milestone_<N>` (10/25/50/100/250/500/1000/2500…) | A view that crosses a view-count threshold (card + Links summed) | card-events/route.ts:810-830 (src/lib/milestones.ts:129) | Card owner | All | Yes, folded into the visit's row (upgrade, rank 2) | No push of its own; it retitles the card_view push that is already going out (route.ts:719) | No | No | Once-ever ledger in `notifications.milestone` (milestones.ts:134-150) | The row type becomes `milestone_N`, which is **not in CATEGORY_FOR_TYPE**, so the overnight view it absorbed is never caught up | `_push.card_view` (for the retitle) | None | milestone-on-the-lock-screen, one-notification-per-visit, notification-matrix | **NM-03** |
| 8 | `new_lead` | A visitor submits the share-your-info form | src/app/api/leads/route.ts:411-455 (via notifyVisit) | Card owner (including an Office member's own card) | All; Free over the cap gets a marked, locked name | Yes (upgrades the visit row) | Yes, `new_lead` (UNCAPPED; pushes again on upgrade) | **No** | No | Visit ledger; no cap | Held, then caught up (locked → "New contact"; paid → `unlockedLeadBody`) | `_push.new_lead` | The locked copy never says "upgrade" | notification-matrix, notification-reach, notification-audit-2026-10-02/06, free-location-privacy | N-07 (catch-up plan), N-20 (URL); **NM-07** (no email fallback) |
| 9 | `lead_cap_reached` | A Free account's last free lead of the month | leads/route.ts:462-470 | Card owner | Free only | Yes | No (bell only) | No | No | Once a month by construction (`lastFreeLead`), plus the 10-min words dedupe | n/a | none | `NATIVE_BODY_REMAP` (drops "Pro") | free-notification-hooks, notification-matrix | Hidden for paid readers (FREE_STATE_TYPES) |
| 10 | `lead_reply` | A lead replies by SMS to a follow-up | src/app/api/twilio/inbound/route.ts:179-200 | Card owner | All (Free with a locked lead: body hidden) | Yes | Yes, `lead_reply` (UNCAPPED), only if the row was written | No | No | MessageSid dedupe (route.ts:141-149); `allowRepeat` | Held, then caught up | `_push.lead_reply` | None | notification-audit-2026-10-02/06, push-per-plan, push-delivery-truth | N-15 (raw plan). Email replies never produce this type: there is no inbound email handling |
| 11 | `payment_failed` | Stripe `invoice.payment_failed` | src/app/api/stripe/webhook/route.ts:225-238 (email :187-210) | Paying account (Stripe) | Pro/Office paid via Stripe (not Apple) | Yes | Yes, `billing_problem` (UNCAPPED), only if the row was written | Yes (`paymentFailedEmail`, sent FIRST) | No | Stripe event idempotency (route.ts:325) plus the 10-min words dedupe | Held, then caught up → `/settings/flows?billing=1` | `_push.billing_problem`; email: none | **Not remapped**: "Your Pro payment didn't go through." shows in the app | email-send-failures, notification-matrix, office-member-notifications, pro-trial-safeguards | N-18; **NM-04** (an email failure kills the bell row and push); hidden for team members without their own subscription |
| 12 | `pro_ended` | Stripe subscription deleted → Free; Apple expiry (RevenueCat); manual downgrade | stripe/webhook/route.ts:1132; src/lib/pro-ended.ts:32 (callers iap/revenuecat:109, account/downgrade:79) | Account owner | Pro → Free | Yes | No | No | 10-min words dedupe (covers the Stripe + Apple double path) | n/a | none | `NATIVE_BODY_REMAP` | pro-notifications-2026-09-23, pro-trial-safeguards, notification-matrix | Hidden for paid readers |
| 13 | `plan_downgraded` (+ `trial_ended` email) | A timed grant, trial or free month expires (daily cron) | src/app/api/reminders/route.ts:293-300 (email :306-338) | Account owner | Grant holders (Pro or Office grant) | Yes | No | Yes, `trialEndedEmail` (marketing headers) | No | Once per expiry (the cron flips the plan) | n/a | Email: `marketing_emails`, `product_updates` (route.ts:310-316); bell: none | `NATIVE_BODY_REMAP` | free-notification-hooks, pro-notifications-2026-09-23, email-account-types | N-09, N-10 |
| 14 | `sequence_paused` | A Free owner's follow-up reaches an SMS step | reminders/route.ts:689-697 | Card owner | Free | Yes | No | No | `_seqPaused` flag (once, until the account is paid again) plus a per-run Set | n/a | none | `NATIVE_BODY_REMAP` (still says "only available on the Pro plan") | free-automations-are-pro, notification-matrix | Next to N-12 |
| 15 | `signature_stale` | The owner (or an admin) edits card content the signature shows | src/app/api/cards/[id]/route.ts:417-426; src/app/api/office/cards/[id]/route.ts:178-185 | Card owner | All | Yes | No | No | One unread row per card (checked before insert) | n/a | none | None | signature-stale-gating | — |
| 16 | `office_brand_updated` | An Office admin saves Branding that changes members' cards | src/app/api/office/brand/route.ts:362-379 | Each verified member except the one who saved | Office members | Yes | No | No | Deletes the earlier unread row of this type, then inserts | n/a | none | None | notification-matrix | — |
| 17 | `card_taken_offline` | An Office admin takes a member's card offline | office/cards/[id]/route.ts:209-218 | The card's owner (member) | Office member | Yes | No | No | 10-min words dedupe only | n/a | none | None | **none** | NM-08 (untested) |
| 18 | `card_brought_online` | An Office admin turns the card back on | office/cards/[id]/route.ts:209-218 | The card's owner | Office member | Yes | No | No | 10-min words dedupe | n/a | none | None | **none** | NM-08 |
| 19 | `office_joined` | An invitee accepts and activates | src/app/api/join/route.ts:362-367 | Joiner | Office member | Yes | No (they are on screen) | No | No | `didActivate`; words dedupe | n/a | none | None | office-member-notifications, notification-matrix | — |
| 20 | `personal_sub_reminder` | The joiner still has their own Stripe or Apple Pro | join/route.ts:400-407 | Joiner | Office member with their own subscription | Yes | No | No | `didActivate` | n/a | none | **Hidden in the app** (NATIVE_HIDDEN_TYPES) | personal-sub-visibility, office-member-notifications | — |
| 21 | `office_plan_downgraded` | An admin removes the member (office/members), OR the office is torn down (account delete, admin set-plan, change-plan, referral expiry, webhook :964) | src/app/api/office/members/route.ts:140-145; src/lib/office-billing-sync.ts:219-224 | Removed member | Office member → fallback plan | Yes | No | No | words dedupe | n/a | none | Not remapped (copy from `officeRemovedMessage` / `officeAccessEndedMessage`) | push-audit-2026-09-23 | N-12; **NM-06** (three type names, one title) |
| 22 | `office_seat_trimmed` | Seat count reduced below the number of active members | stripe/webhook/route.ts:1015-1020 | Members over the new seat count | Office member | Yes | No | No | words dedupe | n/a | none | Not remapped | **none** | N-12, NM-06, NM-08 |
| 23 | `office_subscription_ended` | The Office owner's Stripe subscription is deleted | stripe/webhook/route.ts:1169-1174 | Every active member | Office member | Yes | No | No | words dedupe | n/a | none | Not remapped | **none** | N-12, NM-06, NM-08 |
| 24 | `office_restored` | The office is re-provisioned for its owner | office-billing-sync.ts:145-150 | Re-seated member | Office member | Yes | No | No | words dedupe | n/a | none | None | **none** | NM-08 |
| 25 | `referral_progress` | A referred friend signs up (1/3, 2/3, max reached, Apple-billed 3/3) | src/lib/referral-server.ts:546-573 (trigger :293) | Referrer | Free/Pro (not Office: early return at :523, plus hideForReader) | Yes | No | No | words dedupe (N-06) | n/a | none | **Not remapped** ("…free month of Pro", "billed through the App Store") | notification-matrix, office-member-notifications | N-12 |
| 26 | `referral_claim` | 3/3 reached and claimable (web-billed or Free) | referral-server.ts:556-561 | Referrer | Free/Pro | Yes | No | No | words dedupe | n/a | none | Hidden in the app (NotificationBell.tsx:101) | native-suppression, free-notification-hooks | The icon badge excludes it (push.ts:370) |
| 27 | `weekly_recap` (personal) | Monday from 09:00 local, for someone with at least one card and a non-empty week | src/app/api/push/recap/route.ts:229-232 | Account owner (not office admins; they get #39) | All | Yes | Yes, `weekly_recap` | No | No | `push_log` outcome `recap` within 6 days (route.ts:122) | The recap hour is 09:00 or later, so it is never held | `_push.weekly_recap`, which **also suppresses the bell row** (route.ts:186) | None | notification-audit-2026-10-06, notification-matrix | **NM-05**; N-21 |

## Table 2 — Push-only and badge-only sends (no bell row of their own)

| # | Notification | Trigger event | Origin file:line | Recipient | Plan | Bell? | Push? | Email? | SMS? | Dedupe / cap | Quiet hours / catch-up | Preference (where checked) | Native copy | Test | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 28 | `getting_started` | Account 48 hours to 7 days old, has a card, zero views, 10:00–19:00 local, has a device | src/app/api/push/activation/route.ts:80-95 | Account owner | All | No | Yes, `getting_started` | No | No | `push_log` outcome `activation`, once ever, written BEFORE the send | The window is daytime | `_push.getting_started` (route.ts:58), but there is no Settings switch for it (not in LIVE_CATEGORIES) | None | notification-audit-2026-10-06 | A failed send is never retried (by design) |
| 29 | 8am catch-up | First hourly run between 08:00 and 20:00 local after quiet hours, when unread held rows exist | src/app/api/push/catchup/route.ts:298-357 (send at :316) | Device holders | All | No (it reads the bell) | Yes, in the top row's category, with `catchup:true` | No | No | `push_log` outcome `catchup` within 13h | It IS the catch-up | `quietHours=false` skips it; per-category switches filter rows (route.ts:251) | Free name / locked copy | push-quiet-hours-catchup, notification-audit-2026-10-02/06, contact-return-alerts | N-05, N-07, N-14, N-20, NM-01..03, NM-09 |
| 30 | Icon badge sync | Bell read, unread or delete on the WEBSITE (not inside the app) | src/lib/app-badge-sync.ts (→ push.ts:398-421 `syncAppBadge`) | The owner's iOS devices | All | — | APNs badge only (no alert) | No | No | none; not in push_log; ignores quiet hours | n/a | none | n/a | app-badge-sync, badge-universal | N-03, N-13 |

## Table 3 — Office team inbox (`office_notifications`, shown only on the /office/admin bell)

Rules shared by every row in this table:

- All rows go through `alertTeam` (src/lib/team-alerts.ts:119) or `notifyOffice` (src/lib/office-notify.ts:66).
- Recipients are the Office admins of a LIVE office.
- The bell write is best-effort and fails silently.
- When a push is sent, it uses category `team_alert`, at most 2 a day, with a "Team · <office>" subtitle and thread `team-<officeId>`.
- Read state is shared across the whole office (N-14).
- No native remap is needed (the copy does not sell).
- Preference: `_push.team_alert` turns off the push only; the inbox row is always written.

| # | `type` | Trigger | Origin file:line | Bell | Push | Dedupe / ledger | Quiet / catch-up | Test | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 31 | `member_joined` | An invitee accepts | join/route.ts:340-353 | Yes | Yes (skips the joiner) | Collapse tag per userId | Caught up (TEAM_PUSH_TYPES), but **ignores skipPushFor** | office-admin-notifications, push-quiet-hours-catchup | NM-09 |
| 32 | `member_left` | A member moves to another office | join/route.ts:369-375 | Yes | No | none | Not caught up | **none** | NM-08 |
| 33 | `invite_declined` | An invitee declines | src/app/api/office/decline/route.ts:47-54 | Yes | No | Only when rows were actually updated | Not caught up | office-admin-notifications | — |
| 34 | `invite_expired` | A pending invite is past `expires_at` (expired within the last 7 days) at the team-check hour | push/recap/route.ts:414-431 | Yes | No | Ledger by meta.memberId (:415) | n/a | office-team-metrics (indirect) | — |
| 35 | `member_first_lead` | A teammate's first real lead | team-alerts.ts:159-186 (called from leads/route.ts:472) | Yes | Yes (skips the teammate) | Ledger = the inbox row with meta.userId | Caught up, but ignores skipPushFor | team-alerts, office-admin-notifications | NM-09, NM-10 |
| 36 | `leads_waiting` | Team-check hour (hourly from 09:00 owner tz): leads 1–7 days old with no follow-up | push/recap/route.ts:318-345 (send at :337) | Yes | Yes (custom pushBody) | `noticeGivenToday` plus new leadIds only | Caught up | office-admin-notifications, office-not-a-race, notification-audit-2026-10-02 | N-21 |
| 37 | `members_no_card` | Team check: members who joined 2–30 days ago and have no card | push/recap/route.ts:388-407 (send at :398) | Yes | Yes | `noticeGivenToday` plus new userIds only (:393) | Caught up | office-admin-notifications, office-not-a-race | — |
| 38 | `team_milestone` | Team check: all-time team views or leads cross a rung of the ladder | push/recap/route.ts:350-377 (send at :370; ladders team-alerts.ts:191-192) | Yes | Yes for leads; views only when no lead rung fired in the same run | Ledger = inbox rows with meta.kind/n/also (:355) | Caught up | office-admin-notifications, office-console-numbers | NM-10 |
| 39 | `team_weekly_recap` | Monday recap hour (admins) / Monday team check (inbox) | push/recap/route.ts:191-205, :293-304 | Yes (once per office per 6 days) | Yes, per admin, in category `weekly_recap` (not team_alert) | push_log `recap` per admin; one inbox row per office | Not caught up | office-admin-notifications | With `_push.weekly_recap` off, the admin's push is skipped AND the bell path at 191-205 is skipped (the team-check path still writes the row) |

## Table 4 — Email-only (Resend) and SMS-only sends

| # | Kind | Trigger | Origin file:line | Recipient | Plan | Channel | Dedupe / claim | Opt-out / preference (where checked) | Bounce suppression (`message_opt_outs`) | Test | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 40 | `welcome` | Card is live and plan settled (10 call sites: cards POST, choose-plan, drafts/claim, iap, promo, join, stripe webhook :584, /api/welcome) | src/lib/welcome-email.ts:118-148 | Account email | All | Email (marketing headers) | `email_logs` claim row, deleted if the send fails (so it can be retried) | none (not gated on marketing_emails); test mailboxes skipped | **Not checked** (N-09) | welcome-email-waits-for-the-card, welcome-email-skips-test-domains, email-deliverability | — |
| 41 | `receipt` / `trial_started` | Checkout / invoice paid | stripe/webhook/route.ts:42-140 (calls at :599, :691, :743) | Account email | Stripe payers | Email | Stripe event idempotency | `email_preferences.receipt_emails` (route.ts:63), except for a trial's first charge | Not checked | billing-receipts, email-preference-center | — |
| 42 | `trial_charge_soon` | A Stripe trial ends within 7 days + 1 hour and is not set to cancel | src/lib/trial-notice.ts:98-145 (crons: trial-notice.yml hourly at :17, plus reminders daily) | Account email | Stripe trialists (Pro/Office) | Email (transactional) | `_trialChargeWarnedFor` stamped **before** the send | none | Not checked | trial-notice | **NM-11** |
| 43 | `trial_ending_soon` | A non-Stripe timed grant expires within 3 days | reminders/route.ts:362-412 | Account email | Grant holders | Email (marketing) | `_proWarnedFor` stamped before the send | `marketing_emails`, `product_updates`; needs an unsubscribe token | Not checked | email-account-types, email-send-failures | N-09, N-10; same pattern as NM-11 |
| 44 | Office invite | An admin invites someone by email | src/app/api/office/invite/route.ts:286 | Invitee | Office | Email | Rate limit 60 per 10 min | `isOptedOut("email")` (route.ts:68) | Yes (isOptedOut) | office-invite-email, email-sender-routing | — |
| 45 | Join sign-in link | An invitee requests a link | src/app/api/join/sign-in-link/route.ts:94 | Invitee | Office | Email | 5 per 15 min per token, 20 an hour per IP | none | No | auth-email-links, office-invite-followups | — |
| 46 | "Your SwiftCard account is ready" | A site admin creates a card for someone | src/app/api/admin/create-card/route.ts:138 | New user | any | Email | — | none | No | — | — |
| 47 | "Your SwiftCard account was deleted" | An Office admin deletes a member's account | src/app/api/office/members/delete-account/route.ts:133 | Deleted member | Office | Email | Rate limit 10 an hour | none (transactional) | No | office-admin-account-review | — |
| 48 | Admin broadcast | A site admin sends a campaign | src/app/api/admin/broadcast/route.ts:103 (test send), :336 | Users | Per audience | Email (marketing) | — | `marketing_emails`, `marketingAudience` | Yes (`emailOptOutSet`) | email-preference-center, email-suppression | — |
| 49 | Promo code email | A site admin sends codes | src/app/api/admin/promo-codes/send/route.ts:164 | Users | Per audience | Email | — | `marketing_emails`, `canSendMarketing("promotions")` | Yes | email-suppression, copy-truth | — |
| 50 | Follow-up sequence step | Daily cron at 18:00 UTC, when a step is due | reminders/route.ts:742-786 → src/lib/messaging.ts:446 `deliverToLead` | Lead (contact) | Email on all plans; SMS on Pro/Office only | Email or SMS | Per-step claim (`stampStep`), released on failure so the next run retries it | Lead side: `isOptedOut` for email/SMS. SMS also needs `sms-ok` and not `sms-paused`, and must fall inside `withinSmsQuietHours` (18:00–01:00 UTC, route.ts:29). Skipped for leads tagged `flow-paused` | Yes | automation-hardening, background-reliability, sms-consent, cron-timing | The owner hears about a reply only via SMS (#10) |
| 51 | Manual message to a lead | The owner sends from a contact | src/app/api/leads/[id]/message/route.ts:122; src/app/api/sms/send/route.ts:82 | Lead | SMS on Pro/Office | Email/SMS | Rate limits 60 an hour, 30 per 10 min | `isOptedOut` | Yes | sms-consent, inbox-placement | — |
| 52 | Share card with a lead | The owner shares their card | src/app/api/leads/share-card/route.ts | Lead | All | Email/SMS | 1 per lead per window, 60 an hour | `isOptedOut` for email and SMS | Yes | share-signature-email, contact-links | — |
| 53 | Scanner send | The owner emails a scanned contact | src/app/api/scanner/send/route.ts:58 | Scanned contact | All | Email | 20 per 10 min | `isOptedOut("email")` | Yes | share-signature-email | — |

## Table 5 — Site-admin / operator alerts

| # | Kind | Trigger | Origin | Recipient | Channel | Notes |
|---|---|---|---|---|---|---|
| 54 | Contact form | Public /contact submit | src/app/api/contact/route.ts:35 | `INBOX_ADDRESS` (email-senders.ts:97) | Email | Rate limited by IP |
| 55 | Uptime / nightly-QA / paint-check issues | health-check every 15 min, nightly QA, paint sweep | .github/workflows/uptime.yml, nightly-qa.yml, paint-check.yml | Repo owner | GitHub issue → GitHub email | One open issue per label |
| 56 | Marketing-agent digests, weekly scorecard | agent-*.yml schedules, weekly-scorecard.yml (Sunday 22:00 UTC) | marketing-agents/lib/agentkit.mjs:139-152 | `sys.digest_email` only | Email (Resend) | Not customer-facing |
| 57 | Supabase Auth mail (confirm, reset, magic link) | Supabase Auth | Supabase project SMTP (no app code) | Account email | Email | Outside this codebase; `message_opt_outs` does not cover it |
| — | `push.delivery` / `email.send` / `sms.send` errors | Any failed delivery | src/lib/report-error.ts → `error_events` | Read by the uptime and nightly probes | DB row | Not a notification sent to anyone directly |

**Owner-facing SMS: none.** No producer texts an account owner. Twilio is used only to reach leads (#50-52).
**Owner-facing activity email: none.** There is no email for new_lead, lead_reply or contact activity (see NM-07).

Row count: 57 numbered rows. That is 27 personal bell types and variants, 3 push-only or badge-only sends, 9 team-inbox types, 14 email/SMS kinds and 4 operator channels.

## Table 6 — Delivery channels × failure handling

| Channel | Retry | Dead-token / dead-address handling | Logging / visibility | Gaps |
|---|---|---|---|---|
| Personal bell insert (`insertNotification`, notify.ts:43) | None. A missing column (42703/PGRST204) is retried without `card_owner` | n/a | **None.** Any error returns `false`, which callers read as "duplicate" | N-04 |
| Visit bell insert (`notifyVisit`, visit-notify.ts:186) | Fallbacks for missing columns (lead_id → milestone → visit_key); 23505 → upgrade, or an insert without a key | n/a | Returns "failed" to card-events (recorded as `notified`). The leads route calls `reportError("leads.notify")` only on a throw | N-02 |
| Team inbox (`notifyOffice`, office-notify.ts:66) | None | n/a | **Silent** catch. `officeIsLive` fails OPEN on a read error | NM-10 (the push still goes out when the inbox write fails) |
| APNs (src/lib/apns.ts) | One attempt. BadDeviceToken is retried once on the other Apple environment (apns.ts:381-391). 10 s timeout; a fresh HTTP/2 connection per POST | `gone` (Unregistered, 410, or BadDeviceToken in BOTH environments) → row deleted (push.ts:278) | `push_log` outcome `sent`/`failed`/`rollup`/policy reason; `reportError("push.delivery")` with Apple's reason (push.ts:345) | N-05 (no retry, and daytime failures are never caught up) |
| FCM (src/lib/fcm.ts) | One attempt | 404 / UNREGISTERED / NOT_FOUND → row deleted (fcm.ts:173-186, push.ts:297). A 400 INVALID_ARGUMENT counts only if the body names the token | Same as APNs. A missing service account (`not_configured`) is recorded as a failure string | N-05 |
| Web push (web-push, push.ts:306-330) | One attempt; no TTL or urgency set (library default is 4 weeks) | 404/410 → row deleted (push.ts:327); an SSRF-unsafe endpoint counts as a failure | Same as APNs. **If the VAPID keys are missing, web subscriptions are skipped silently** and logged only as `no_deliverable_endpoint` when there is no native subscription | NM-12 |
| Badge-only APNs (`syncAppBadge`, push.ts:398) | None | `gone` → row deleted (push.ts:420) | Not in push_log; all errors swallowed | N-03/N-13 |
| Email via `sendRawEmail` / `sendBrandedEmail` (messaging.ts:379, :628) | None inside. Callers differ: the sequence releases its claim (retried the next day); welcome deletes its claim (retried on the next trigger); trial-notice and trial_ending_soon stamp first (never retried) | The Resend bounce/complaint webhook → `addOptOut` → `message_opt_outs` (resend/webhook/route.ts:101-135). Lead-facing, broadcast and promo mail honour it; **owner lifecycle mail does not** | `reportError("email.send")` or a named key; `email_logs` row on success | N-09; NM-11 |
| Direct `resend.emails.send` (webhook receipts and payment_failed, reminders trial mail, welcome, trial-notice, broadcast, promo, contact) | None | As above | `reportError(...)` keyed per site; `email_logs` row on success | NM-04 (payment_failed returns early) |
| SMS (Twilio `sendSms`, messaging.ts:330) | None inside. A sequence step is released and retried on the next daily run | Inbound STOP → opt-out. The status callback (/api/twilio/status) updates delivery status | `reportError("sms.send")`; `lead_messages` log; `not_configured` is silent | — |
| Crons (GitHub Actions: push-catchup.yml hourly, trial-notice.yml hourly; Vercel: `/api/reminders` at 18:00 UTC) | The next hourly run. Recap, activation and catch-up are idempotent via push_log marks | n/a | A non-200 fails the step, and GitHub emails the repo owner. A missing secret exits 1 only in the catch-up step | N-21; NM-13 |

## Defects surfaced by the matrix

These existing findings are referenced rather than repeated:

- N-02: rows 1-7
- N-03, N-13: row 30
- N-04: every row written by `insertNotification`
- N-05: Table 6
- N-06: #25 and #21-23
- N-07, N-20: #8 and #29
- N-08: #1-7
- N-09, N-10: #13 and #40-43
- N-12: #21-25
- N-14: #31-38
- N-15: #10
- N-18: #11 and #29
- N-21: #27 and #36-39

### NM-01 The 8am catch-up pushes two kinds of news that are bell-only during the day
- Neither of these rows has a `pushCategory`, so neither pushes live:
  - `contact_engaged` (contact-return-notify.ts:121-128)
  - the forwarded-link `contact_returned` variant (contact-return-notify.ts:93-99, commented "bell only (D3)")
- Both map to `contact_return` in `CATEGORY_FOR_TYPE` (src/app/api/push/catchup/route.ts:58, :61). So a link tap or a forwarded-link open at 23:00 buzzes the phone at 08:00, while the same event at 14:00 never does.
- If it is the only held row, it becomes the morning push's headline, e.g. "Your link was opened on another device".
- Confidence: Confirmed by code trace. The forwarded row carries `leadId` (card-events/route.ts:706), so it passes the closed-status filter at catchup:280-286 unless the lead is closed.
- Severity: Low–Medium. At night it breaks two rules: one buzz per visit, and D3 (bell only).

### NM-02 Catch-up does not apply the closed-contact rule to a returning contact's `contact_saved` row
- A contact marked not_interested or dissolved who downloads the vCard again gets no live push (`mayPush` is false, contact-return-notify.ts:137). The bell row still carries `lead_id`.
- Catch-up keeps the row as category `contact_saved`. It filters closed leads only where `category === "contact_return"` (catchup/route.ts:286), so the row is pushed the next morning.
- Confidence: Confirmed by code trace. Severity: Low.

### NM-03 An overnight view that crosses a milestone vanishes from the morning catch-up
- The milestone fold upgrades the visit's row in place, and its `type` becomes `milestone_<N>` (visit-notify.ts:323-331; card-events/route.ts:816).
- `milestone_*` is not in `CATEGORY_FOR_TYPE` (catchup:54-62). That view is never caught up, nor is the visitor name or place in its body. A plain view at the same minute would have been.
- A returning contact's `contact_returned` row loses its catch-up the same way once a milestone outranks it (rank 2 > 1.5).
- Confidence: Confirmed by code trace. Severity: Low, but it silently loses the one view the product most wants to celebrate.

### NM-04 A failed payment leaves no bell row and no push if the email can't be sent
- `sendPaymentFailedEmail` returns early in two cases: there is no account email (stripe/webhook/route.ts:173), or Resend fails (:198-201).
- The bell row and the `billing_problem` push come after both checks (:225-238), so they are skipped too.
- The comment at :213-224 says the row exists so a failed payment "is never lost". In practice the row depends on the email succeeding. A Resend outage or a suppressed address leaves no trace in the app, on the phone or in the catch-up.
- Confidence: Confirmed by code trace. Severity: Medium (billing_problem is one of the three UNCAPPED "must-know" categories).

### NM-05 Turning off the "Weekly recap" push also removes the weekly recap from the bell
- recap/route.ts:186 runs `if (prefs.weekly_recap === false) continue;` before the personal bell insert at :231.
- The setting is labelled as a push switch ("Weekly recap — Your week in numbers…", push-policy.ts:129). Every other category's switch silences only the push.
- For an admin, the per-user team-recap bell path at :191-205 is skipped too. The office-wide team-check path at :293-304 still writes the row.
- Confidence: Confirmed by code trace. Nothing says whether this is intended. Severity: Low.

### NM-06 Three `type` names for one "Your Office access ended" message, so screens and the dedupe treat them as different
- Three types share the title "Your Office access ended":
  - `office_plan_downgraded` (office/members/route.ts:140; office-billing-sync.ts:219)
  - `office_seat_trimmed` (stripe/webhook:1015)
  - `office_subscription_ended` (stripe/webhook:1169)
- The 10-minute dedupe keys on `type` (notify.ts:52). A member caught by two of these paths in one billing sequence (a seat trim, then the subscription deletion; or a teardown plus the cascade) gets two rows that look the same.
- No surface knows all three names: none of them is in N-12's native remap, and none is in the notification-matrix test.
- Confidence: the duplicate is Suspected (it needs a real double-path event); the naming drift is Confirmed. Severity: Low.

### NM-07 No out-of-app channel for a new lead when the owner has no push device
- `new_lead`, `lead_reply` and contact activity have no email fallback: there is no template in src/lib/email-templates.ts, and leads/route.ts:411-470 writes only the bell row and push. Owners never get SMS.
- N-11 found one registered device across the whole system. So for almost every account, a new lead is seen only the next time they open the dashboard bell. The push-policy header calls a new lead "the whole product".
- Confidence: Confirmed by code trace (no producer exists). Severity: Medium. This is a product gap rather than a bug.

### NM-08 Six notification types have no test that names them
- `card_taken_offline`, `card_brought_online`, `office_seat_trimmed`, `office_subscription_ended`, `office_restored` and `member_left` have no match anywhere in tests/ (`git grep`).
- The ROWS list in tests/notification-matrix.test.ts (lines 30-49) leaves out all six, plus `contact_engaged`, `signature_stale` and `office_plan_downgraded`. So for these nine types, neither the who-sees-what checks nor the native no-selling sweep ever run.
- Confidence: Confirmed. Severity: Low (test coverage).

### NM-09 Catch-up ignores `skipPushFor`, so an admin-role teammate can be told about their own join or first lead
- Live team pushes skip the person the news is about (join/route.ts:352 `skipPushFor: [user.id]`; team-alerts.ts:183).
- Catch-up rebuilds team pushes from `office_notifications` rows for every user in `teamAlertRecipients` (catchup/route.ts:172, :256-262). It never reads `meta.userId`.
- So a joiner or first-lead teammate whose role has `view_org_analytics` (admin, manager or billing admin) gets "X joined your team" or "First contact for X 🎉" about themselves at 8am, if the event fell in their quiet hours.
- Confidence: Confirmed by code trace; it only affects admin-role members. Severity: Low.

### NM-10 A team alert can push even when its once-only ledger row failed to write, so it repeats every hour
- `alertTeam` writes the inbox row through `notifyOffice`, which swallows every error (office-notify.ts:72-83), and then pushes regardless (team-alerts.ts:122-137).
- For these types the inbox row IS the once-only ledger:
  - `team_milestone` (recap/route.ts:355)
  - `member_first_lead` (team-alerts.ts:170-175)
  - `members_no_card` (recap/route.ts:393)
  - `invite_expired` (recap/route.ts:415)
- If the insert fails, the next hourly team check pushes the same alert again. Only the 2-a-day team cap limits it.
- Confidence: Suspected (needs a failed insert). Severity: Low.

### NM-11 Trial-charge and trial-ending emails are marked "sent" before sending and never retried
- trial-notice.ts:98-102 stamps `_trialChargeWarnedFor` before calling `resend.emails.send` (:134). On failure it reports and moves on (`continue`, :136-138). reminders/route.ts:378 does the same with `_proWarnedFor`.
- One Resend error means the trialist never gets the notice that they are about to be charged.
- The welcome email does it the safe way: it deletes its claim on failure (welcome-email.ts:142-146).
- Confidence: Confirmed by code trace. Severity: Medium for `trial_charge_soon` (an auto-renewal disclosure), Low for `trial_ending_soon`.

### NM-12 Web push fails silently when the VAPID keys are missing
- push.ts:306 builds web sends only when both VAPID env vars are set. Otherwise web subscriptions are skipped with no failure string, so no `push.delivery` error is raised.
- A user with only browser subscriptions is logged as `no_deliverable_endpoint`, which looks like an ordinary policy outcome.
- Confidence: Confirmed by code trace; it only matters if the env is misconfigured. Severity: Low.

### NM-13 Monday recap and team checks share one 60-second run that walks every profile
- recap/route.ts reads every profile (:174-178). On Monday from 09:00 local it runs 4–6 queries per eligible user before the team-check loop starts (:261). `maxDuration = 60` (:40).
- As the user base grows, a Monday run that times out never reaches that hour's team checks, and users late in the scan order are pushed to later hours.
- `isRecapHour` is true only on Monday, so a user who keeps being reached too late misses that week's recap entirely.
- N-21 covers the dependency on the schedule; this is the capacity side of the same problem.
- Confidence: Suspected (depends on user count). Severity: Low now, growing with scale.

### NM-14 Notification flags overwrite the whole `customization` object from a stale copy, which can undo a just-saved push setting
- Push switches live in `profiles.customization._push`.
- Several writers write back `{ ...cust, flag }` from a copy read earlier in the same run:
  - trial-notice.ts:101
  - reminders/route.ts:378 and :697
  - pro-ended.ts:25-28
- If someone saves a push switch or quiet-hours change between that read and the write, their change is silently undone.
- Confidence: Suspected (a timing race). Severity: Low.
