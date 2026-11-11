# 05 — Notifications audit (read-only, 2026-10-12)

Scope: push (APNs/FCM/web push), bell, email (Resend), SMS (Twilio), lead/warm-lead alerts, account/office notifications, badges, preferences, crons.
Audited COMMITTED tree (HEAD 655a4480); uncommitted diffs to NotificationBell.tsx / native-notification-copy.ts / notification tests noted separately at the end.
Findings appended incrementally as confirmed.

### N-08 Per-IP notify flood cap silences the BELL ROW and the CRM mirror, and is burned by link taps that never notify
- Severity: High
- Platform: server (affects every surface)
- Account type/plan affected: all
- Feature/page: /api/card-events → bell / push / CRM for views & contact downloads
- File/component/function: src/app/api/card-events/route.ts:653 (`flooded = isRateLimited(notify-ip:<slug>:<ip>, 6, 1h)`), :690-691 (`if (flooded) notified="suppressed"; if (notice && !flooded) { notifyVisit… dispatchCrmEvent… milestone… }`)
- Problem: The comment says "events above the cap still record, they just don't buzz", but the guarded block contains the bell row (`notifyVisit`), the CRM `dispatchCrmEvent` and the milestone fold — all three are skipped. The counter is also incremented for EVERY event type before `notice` is checked, so eight `clicked_link` taps (which can never notify) from one IP exhaust the per-card hourly budget. Shared egress (venue Wi-Fi, office NAT, iCloud Private Relay, carrier CGNAT) means several real visitors share one IP — exactly the trade-show situation card views are supposed to shine in.
- Expected behavior: Cap only the PUSH (sendPushToUser already has hourly batching + daily caps); always write the bell row and the CRM event; only count events that could notify.
- Actual behavior: 7th+ event per hour per IP per card: no bell row, no CRM event, no milestone fold; `analytics_ingest_log.notified = "suppressed"`.
- How to reproduce: From one IP, tap 6 Swift Links buttons on a card, then download the vCard → no "Contact downloaded" row in the bell, nothing in HubSpot/Zapier. Appendix B SQL #5 counts `notified='suppressed'` rows.
- Likely cause: HANDOFF §2 "IP rate-limit swallowing" — the backstop was written when it only guarded a push.
- User impact: Lost contact-download notifications and lost CRM records at busy events; "the bell says fewer saves than the chart".
- Confidence: Confirmed (code)

### N-09 Lifecycle / transactional owner emails ignore bounce & complaint suppression (message_opt_outs)
- Severity: Medium
- Platform: email
- Account type/plan affected: all
- Feature/page: welcome email, trial-ended, trial-ending-soon, trial charge notice, payment_failed email
- File/component/function: src/lib/welcome-email.ts (no isOptedOut/emailOptOutSet), src/app/api/reminders/route.ts:304-340, :379-411, src/lib/trial-notice.ts:104+, src/app/api/stripe/webhook/route.ts:196-213; suppression writer src/app/api/resend/webhook/route.ts:130-135 (addOptOut → message_opt_outs)
- Problem: The Resend webhook records hard bounces and complaints in `message_opt_outs` ("the SAME list the broadcast, lead, invite and follow-up senders already consult"). The owner-directed senders above consult only `email_preferences` (marketing_emails / categories) and never `message_opt_outs`, so an address that hard-bounced or hit "Report spam" keeps receiving welcome, trial and payment mail — the list-hygiene failure the webhook was built to stop.
- Expected behavior: Every sender checks `isOptedOut("email", to)` (or `emailOptOutSet`) before sending to an account address.
- Actual behavior: Only broadcast / promo / lead / invite / scanner / follow-up paths check it.
- How to reproduce: Simulate `email.complained` for an account address via the webhook, then trigger a trial-ending notice → it sends.
- Likely cause: Two suppression stores that never converged.
- User impact: Domain reputation (swiftcard.me) — every team invite and card share rides on it.
- Confidence: Confirmed (code)

### N-10 Trial-ended / trial-ending-soon emails are silently skipped for any account without an email_preferences row
- Severity: Medium
- Platform: email
- Account type/plan affected: accounts created before `ensureEmailPreferences` existed, or that never completed /onboarding (writers: onboarding page, admin create-card, welcome-email)
- Feature/page: /api/reminders lifecycle mail
- File/component/function: src/app/api/reminders/route.ts:316 (`if (!unsub) continue;`), :388 (`marketingOk && unsub && …`), src/lib/email-prefs.ts:33
- Problem: The route refuses to send without a working unsubscribe token (correct) but never provisions the row before deciding, so an older account loses the "your plan ends in 3 days" and "your trial has ended" emails for good. The bell row is written, nothing else. `email_logs` shows only 34 emails ever (3 in Oct), consistent with most lifecycle mail being skipped.
- Expected behavior: Call `ensureEmailPreferences(u.id)` before `getEmailPrefs`, then send.
- Actual behavior: Skipped with no log line and no reportError.
- How to reproduce: Appendix B SQL #6 — profiles with plan_expires_at set and no email_preferences row.
- Likely cause: Provisioning added at signup only.
- User impact: Pro ends without an email warning.
- Confidence: Confirmed (code) / Suspected (how many accounts lack a row)

### N-11 Only ONE device is registered for push in the whole system — registration is opt-in only, silently retried, and failures are visible only in error_events
- Severity: High
- Platform: iOS app (Android: FCM env not configured → `not_configured`), web push
- Account type/plan affected: all
- Feature/page: EnablePushButton / PushNudge / PushAskCallout / NativeAppBridge silent refresh
- File/component/function: src/components/EnablePushButton.tsx:181-236 (reconfirm only where the component mounts and only if `swiftcard_push_uid` matches), :238-343 (enable), src/components/NativeAppBridge.tsx:444-471 (re-register only when `swiftcard_push_uid` is set; `.catch(() => {})`), src/components/PushNudge.tsx (two-stage dismiss in localStorage), src/app/api/push/subscribe/route.ts
- Problem: After the Sept 2026 APNs env mismatch deleted every row, a phone only comes back if (a) its localStorage still holds `swiftcard_apns_endpoint` + `swiftcard_push_uid` (silent re-register at launch) or (b) the person taps the switch again. A reinstall/upgrade that cleared WKWebView storage, or anyone who dismissed PushNudge twice and never visits Settings → Notifications, never re-registers. Silent-path failures are swallowed with no `reportPushFailure`. Net effect today: 132/230 push_log rows are `no_subscription` (57%), 13 of the last 7 days' 20; every producer fires into the void for all but one account. TimezoneSync's comment still says "two people subscribed in production".
- Expected behavior: Re-ask once after the outage (server can identify users whose push_log has `sent` rows and who now have no subscription), report silent re-register failures, and derive the switch state from the SERVER row rather than localStorage.
- Actual behavior: Switch shows "On for this device" from localStorage while the server has no row (reconfirm closes the gap only where the component mounts AND the uid matches).
- How to reproduce: Appendix B SQL #7.
- Likely cause: Opt-in-only design + storage-based state + the outage.
- User impact: Nobody is getting pushes; the lead/reply alerts the product is built around are bell-only in practice.
- Confidence: Confirmed (production aggregate + code)

### N-12 Native-copy remap misses bell rows that reach the iOS app with plan/billing words
- Severity: Medium (App Review 3.1.1 exposure)
- Platform: iOS app
- Account type/plan affected: Free / Pro (referral rows), Office members (office_* rows)
- Feature/page: NotificationBell in the shell
- File/component/function: src/lib/native-notification-copy.ts (NATIVE_BODY_REMAP covers sequence_paused, pro_ended, lead_cap_reached, plan_downgraded [+ referral_claim uncommitted]; NATIVE_HIDDEN_TYPES = personal_sub_reminder only), src/lib/referral-server.ts:546-575 (`referral_progress` bodies: "One more to earn a free month of Pro.", "…you've got Pro free for one month. Tap here to get it.", "…comes off your next bill" — the last is referral_claim), src/app/api/office/members/route.ts:142 and webhook `officeAccessEndedMessage(fallback)` / `officeRemovedMessage(plan)` (office_seat_trimmed, office_subscription_ended, office_plan_downgraded — copy not in the remap)
- Problem: `referral_progress` ("earn a free month of Pro", "Pro free for one month") is shown verbatim in the app for non-Office accounts; office_* bodies are rendered verbatim and name plans by construction (they say which plan the person lands on). The remap is a hand-kept list with no test enumerating every `type:` literal written through insertNotification.
- Expected behavior: Every type whose stored body can name a plan, price, upgrade or billing has a remap (or is hidden), enforced by a test over all producers.
- Actual behavior: Hand-kept list; gaps above.
- How to reproduce: Free account with one referral signup → open the bell in the iPhone app.
- Likely cause: Rows written once for all surfaces.
- User impact: App Review risk; inconsistent with the "iOS shell sells nothing" rule.
- Confidence: Confirmed for referral_progress; Suspected for office_* copy (billing-state helpers not fully read)

### N-13 iPhone badge count disagrees with the bell for Office accounts (hideForReader not applied in unreadBadgeCount)
- Severity: Low
- Platform: iOS app
- Account type/plan affected: Office owners/members
- Feature/page: app icon badge
- File/component/function: src/lib/push.ts:364-381 vs src/app/api/notifications/route.ts:55-61 (`hideForReader`)
- Problem: The bell hides referral rows for every Office account and personal-billing rows for team members without their own subscription; the badge count excludes only referral_claim, NATIVE_HIDDEN_TYPES and FREE_STATE_TYPES, so `referral_progress` / `payment_failed` rows a team member never sees still count on the icon.
- Expected behavior: One `visibleUnreadCount(userId)` helper used by the GET, the push and the badge sync.
- Actual behavior: Badge > bell count; cannot be cleared from the bell.
- Confidence: Confirmed (code)

### N-14 Team inbox read state is office-wide, so one admin reading clears every admin's bell AND their overnight catch-up
- Severity: Low
- Platform: all
- Account type/plan affected: Office with 2+ admins/managers
- Feature/page: /office/admin bell, /api/push/catchup team rows
- File/component/function: src/app/api/office/notifications/route.ts:41-56 (PATCH by office_id), src/app/api/push/catchup/route.ts:157-161 (`.eq("read", false)`)
- Problem: `office_notifications` has no per-reader state. Admin A marks all read at 7am; admin B (another timezone) gets no held `member_joined` / `leads_waiting` morning push and sees no unread dot.
- Expected behavior: Per-user read receipts, or catch-up keyed on push_log for that admin rather than row.read.
- Confidence: Confirmed (code)

### N-15 `isPaidPlan(plan)` used instead of the effective plan in lead_reply (and catch-up, N-07)
- Severity: Low
- Platform: server
- Account type/plan affected: accounts whose `plan` column still says pro/enterprise after `plan_expires_at`
- Feature/page: Twilio inbound reply notifications
- File/component/function: src/app/api/twilio/inbound/route.ts:170 (`isPaidPlan(owner.plan)`)
- Problem: A locked lead's name and reply text go into the bell/lock screen unmasked for an account whose grant expired by date (effective plan Free). The bell GET redacts names only when MARKED; this body is unmarked when `hidden` is false, so the words stay visible.
- Expected behavior: `isPaidProfile(profileRow)` everywhere (push.ts and notification-privacy already do).
- Confidence: Confirmed (code)

### N-16 `/api/notifications` is polled every 30s per tab with 3–4 round trips per poll
- Severity: Low (performance)
- Platform: web + app
- File/component/function: src/components/NotificationBell.tsx:114-176, src/app/api/notifications/route.ts:24-61 (notifications query + `notificationReader` profile read + `isPaidUser` profile read + offices read for Office accounts)
- Problem: Two separate `profiles` reads per poll for the same row; the office bell adds another 30s poll on /office/admin. Multiplies with open tabs.
- Expected behavior: One profile read; or an ETag/`since` parameter.
- Confidence: Confirmed (code)

### N-17 Supabase advisor: duplicate unique index on push_subscriptions.endpoint; "unused" user_id / user_device indexes are only unused because the table has one row
- Severity: Low
- Platform: DB
- File/component/function: supabase/view-visit-window.sql (adds `uq_push_subscriptions_endpoint` beside the pre-existing `push_subscriptions_endpoint_key`), supabase/push-subscription-device.sql
- Problem: Two identical unique indexes on `endpoint` (double write cost). `push_subscriptions_user_id_idx` backs every `sendPushToUser` read and `user_device_idx` backs /api/devices DELETE — neither should be dropped on the advisor's say-so.
- Expected behavior: Drop one endpoint index only.
- Confidence: Confirmed (advisor + SQL files)

### N-18 `payment_failed` push and catch-up billing destination open `/settings/flows?billing=1` inside the iOS shell
- Severity: Low
- Platform: iOS app
- Account type/plan affected: Stripe subscribers using the app
- File/component/function: src/app/api/stripe/webhook/route.ts:236, src/app/api/push/catchup/route.ts:103
- Problem: The app is forbidden from showing billing; the push body ("Your Pro payment didn't go through.") and its destination are web billing. Whether /settings/flows hides the billing panel in the shell was not verified here.
- Confidence: Unable to Verify

### N-19 Uncommitted working-tree diff (another session) — noted, not audited as shipped
- Files: src/components/NotificationBell.tsx (referral_claim no longer filtered in-app; relies on NATIVE_HIDDEN_TYPES only), src/lib/native-notification-copy.ts (adds `referral_claim` remap "You've earned a free month of Pro. Tap here to claim it."), tests/free-notification-hooks.test.ts, tests/notification-matrix.test.ts, tests/render/bell-plans.interactive.test.ts.
- Note: the new in-app referral_claim body names a plan ("free month of Pro") — see N-12. The badge count in src/lib/push.ts:370 still excludes `referral_claim` explicitly, so after this change the app bell will COUNT referral_claim rows while the icon badge does not — a new instance of N-03/N-13.

### N-20 Lead push URL and catch-up URL for a Free account's returning contact disagree with the live push on which screen opens
- Severity: Low
- Platform: iOS app / web push
- File/component/function: src/app/api/card-events/route.ts:736-742 (contact_return: Pro → /contacts?lead=, Free → /dashboard?card=), src/app/api/push/catchup/route.ts:342-350 (same rule, but only when `extra === 0`; with extras falls to `destinationFor` → /contacts?card= for contact_return even on Free)
- Problem: Minor inconsistency; on Free with 2+ held rows the morning tap lands on /contacts?card= where the withheld contact is listed blurred.
- Confidence: Confirmed (code), impact Low

### N-21 Weekly recap / activation / catch-up / trial-notice all depend on ONE GitHub Actions secret and schedule that the route comment documents as firing "a few times a day"
- Severity: Medium
- Platform: server
- Feature/page: .github/workflows/push-catchup.yml (hourly cron, 4 sequential curl steps, `--max-time 90` each), trial-notice.yml (hourly at :17)
- File/component/function: src/app/api/push/catchup/route.ts:205-213 (window widened to 8am–8pm because "GitHub's scheduler … runs only a few times a day — 01:42, 08:35 and 18:04 UTC on 2026-10-05"), src/app/api/push/recap/route.ts:16-37, src/lib/trial-notice.ts
- Problem: GitHub scheduled workflows on a busy repo (60+ agent-*.yml workflows) are delayed or dropped; the routes compensate with wide windows but the Monday recap (`isRecapHour` from 9am) and the trial charge notice (7-day Visa/Mastercard window, backstopped daily at 18:00 UTC) can still slip. `maxDuration = 60` on catchup/recap vs `--max-time 90`: a slow run is cut by Vercel at 60s with the catch-up mark already written for the users processed — fine — but the GitHub step then fails and the next steps (`if: always()`) still run; nothing alerts when a step fails repeatedly except the Actions list.
- Expected behavior: A Vercel cron (plan permitting) or an external pinger with alerting; a `monitoring-wiring` test that the workflow exists already pins the file, not its success.
- Actual behavior: Best-effort scheduling; no alert on failure.
- Confidence: Suspected (schedule reliability from the route's own comment); Confirmed (no failure alerting)

---
## Recovered first batch (N-01..N-07) — re-derived 2026-10-13 from HEAD 655a4480

### N-01 Nothing marks a notification read except an explicit tap in the bell — pushes, push taps, the Contacts page and the dashboard never do, so 67 of 82 rows are unread
- Severity: High
- Platform: iOS app, web push, desktop web
- Account type/plan affected: all
- Feature/page: bell badge, iPhone icon badge, /api/push/catchup "while you were away"
- File/component/function: src/components/NativeAppBridge.tsx:394-413 (`pushNotificationActionPerformed` → `window.location.href = path`, no PATCH), public/sw.js:296-316 (`notificationclick` → navigate only), src/app/api/notifications/route.ts:64-97 (the ONLY `read: true` writer; grep confirms no other), src/components/NotificationBell.tsx:400-402 (read only on a row tap), src/lib/push.ts:364-381 (badge = every unread row)
- Problem: The push payload carries no notification id, so a tap on the lock screen cannot mark the row it was about. The destination screens (/contacts?lead=, /dashboard?card=) do not touch `notifications.read` either. The only ways a row becomes read are the bell row tap, the per-row "Read" button and "Mark all read". A person who answers every push from the lock screen therefore never reads anything: the bell badge shows "9+", the iPhone icon carries the full count (67 → capped at 99), and `/api/push/catchup` treats every overnight row as unseen (`.eq("read", false)`, catchup/route.ts:236) even when the person tapped the push at 11pm.
- Expected behavior: Push payload carries `notificationId`; the tap handler (native + sw.js) PATCHes `{ id, read: true }` before navigating; opening a contact from a deep link marks rows with that `lead_id` read.
- Actual behavior: 67/82 production rows unread; badge never falls without a bell visit.
- How to reproduce: Receive a new_lead push, tap it, view the contact, return to home screen → icon badge unchanged; open the bell → row still blue.
- Likely cause: Read state was designed around the bell; the push path was added later without an id round-trip.
- User impact: "The red number never goes away" + the morning catch-up re-announces news already acted on.
- Confidence: Confirmed (code + production counts)

### N-02 Visit dedupe silently degrades to NULL visit_key on two live paths, and the 15 post-migration NULL rows prove one of them is firing
- Severity: Medium
- Platform: server
- Account type/plan affected: all
- Feature/page: /api/card-events, /api/leads → lib/visit-notify.ts
- File/component/function: src/lib/visit-notify.ts:266-287 (42703/PGRST204 → insert without visit_key, "exactly the old behaviour"), :292-309 (23505 + no own row → insert `unkeyed`), src/app/api/card-events/route.ts:810-830 (milestone fold goes through notifyVisit — keyed, so not the source)
- Problem: Production shows 47 NULL visit_key rows, 15 of them created after supabase/notifications-visit-key.sql ran (24 card_viewed, 6 contact_saved, 1 new_lead). Only two code paths write NULL after the migration: (a) PGRST204 — PostgREST's schema cache not reloaded after a column add (visit_key, then milestone, then lead_id were each added separately; every migration window re-opens this hole), where the code quietly drops the key and the row escapes the ledger; (b) the 23505 branch when the key is held by ANOTHER user's row (slug reuse), which also writes unkeyed. Either way a NULL-keyed row is invisible to `openVisit` (`.in("visit_key", [...])`), so the next event from the same visitor opens a second row and a second push — the duplicate the file exists to stop. Nothing logs which branch fired (no reportError in either).
- Expected behavior: Report the fallback branch with the error code; after a schema change run `NOTIFY pgrst, 'reload schema'`; treat PGRST204 after the migration date as an error, not a feature flag.
- Actual behavior: Silent, unkeyed rows; dedupe off for those visits.
- How to reproduce: Appendix B SQL #8 (NULL-key rows after the migration grouped by day — a cluster on the day of each column migration = branch (a)).
- Likely cause: Pre-migration compatibility fallbacks left in place permanently.
- User impact: Occasional double bell rows / double buzz for one visitor; bell and chart disagree.
- Confidence: Confirmed (code) / Suspected (which branch)

### N-03 Three different "unread counts": the icon counts every unread row, the bell counts at most 20, and the app overwrites the icon with the bell's number
- Severity: Medium
- Platform: iOS app (web shows the bell number only)
- Account type/plan affected: all with >20 unread (the production Pro account has 67)
- Feature/page: NotificationBell badge, app icon badge
- File/component/function: src/app/api/notifications/route.ts:29 (`.limit(20)`), src/components/NotificationBell.tsx:104-110 (`unread = shown.filter(...).length; setAppBadge(unread)`), src/lib/push.ts:364-381 (`unreadBadgeCount` — no limit), src/lib/app-badge.ts:29-38
- Problem: A push sets the icon to 67 (server count). The person opens the app, the bell receives 20 rows, computes unread=20 and calls `setAppBadge(20)`; the icon drops from 67 to 20 with nothing read. The next push sets it back to 67. "Mark all read" PATCH clears everything (good), but "Clear read" / per-row reads only ever move within the 20-row window, so the icon flaps between two numbers that are both wrong. HANDOFF already flagged the 20-row cap; this is the concrete symptom.
- Expected behavior: GET returns `{ rows, unreadTotal }`; the bell badge and `setAppBadge` use `unreadTotal`; or `unreadBadgeCount` uses the same window.
- Actual behavior: Icon 67 → open app → 20 → next push → 67.
- How to reproduce: Account with >20 unread rows in the iPhone app; watch the icon before/after opening the app.
- Likely cause: The 20-row cap predates the badge feature (2026-10-06).
- User impact: Badge is untrustworthy; the owner's 2026-10-07 "icon stuck on 1" report is the same family.
- Confidence: Confirmed (code)

### N-04 `insertNotification` returns `false` for EVERY non-column error, and every caller treats `false` as "duplicate" — a DB blip silently drops the bell row AND the push that rides on it
- Severity: Medium
- Platform: server
- Account type/plan affected: all
- Feature/page: payment_failed, pro_ended, lead_reply, office_* rows, weekly_recap, referral rows
- File/component/function: src/lib/notify.ts:64-78 (`if (!error) return true; … return false;` — the comment says "23505 = duplicate" but the branch catches timeouts, 5xx, RLS, FK violations alike; no reportError), src/app/api/stripe/webhook/route.ts:225 (`const wrote = await insertNotification(...)` gates the billing_problem push), src/app/api/twilio/inbound/route.ts:179 (same gate for lead_reply), src/lib/pro-ended.ts:32 / stripe webhook :1132 (`.catch(() => {})`)
- Problem: The return value conflates "someone else already wrote it" with "the write failed". Callers are told to gate their push on it, so a transient Supabase error at the moment a payment fails means no bell row, no push, no log line and no error event — the account loses access later with no warning ever delivered. The 10-minute pre-check SELECT also runs on every insert (an extra round trip for every producer).
- Expected behavior: Tri-state result (`created | duplicate | failed`) with `reportError` on `failed`; callers push on `created`, and on `failed` still push for UNCAPPED categories (a lost billing push is worse than a rare double).
- Actual behavior: Any error → false → caller stays silent.
- How to reproduce: In a test env point the service role at a paused project and fire `invoice.payment_failed` → 200, nothing written, nothing reported.
- Likely cause: Return contract written for the 23505 case only.
- User impact: Rare but total loss of the two notifications the policy calls "the ones a person would be angry to have withheld".
- Confidence: Confirmed (code)

### N-05 A push that fails in transit is never retried and never caught up — the catch-up replays quiet-hours rows only, so a 2pm lead whose APNs POST timed out is gone from the phone for good
- Severity: Medium
- Platform: iOS app / Android / web push
- Account type/plan affected: all
- Feature/page: lib/push.ts delivery
- File/component/function: src/lib/push.ts:268-354 (one attempt per endpoint; `failed` logged; `reportServerError("push.delivery")`), src/lib/apns.ts:141-153 (fresh `http2.connect` per POST, 10s timeout, closed on `close` — no connection reuse, no PING), src/app/api/push/catchup/route.ts:232-245 (window = quiet hours only; rows created 8am–10pm are never candidates)
- Problem: No retry queue, no backoff, no "deliver what failed" sweep. `error`/`timeout`/`connection_error`/5xx from APNs or FCM is logged once as `failed` and forgotten. The daytime failure has no second chance because the morning catch-up deliberately reads only rows created between 10pm and 8am. Separately, every send opens and tears down its own HTTP/2 connection — the pattern Apple documents as grounds for throttling at volume.
- Expected behavior: Retry transient results (never `gone`) with backoff inside `after()`, or a short-lived `push_outbox` swept by the hourly job; keep one APNs session per lambda instance.
- Actual behavior: One shot; `push_log.outcome='failed'` is the only trace (Appendix B SQL #9).
- How to reproduce: Block api.push.apple.com egress for 15s during a test lead submit → `failed` row, never resent.
- Likely cause: Best-effort design ("pushes are best-effort", apns.ts:152).
- User impact: Intermittent "I never got a push for that lead" with nothing in the product to explain it.
- Confidence: Confirmed (code)

### N-06 The 10-minute identical-words dedupe in `insertNotification` drops DISTINCT events that happen to share a sentence
- Severity: Low
- Platform: all
- Account type/plan affected: Free/Pro referrers, Office owners
- Feature/page: referral_progress, office seat/subscription rows, lead_cap_reached, pro_ended
- File/component/function: src/lib/notify.ts:49-62 (match on user_id+type+title+body+card_owner within 10 min; only `allowRepeat` bypasses it — used solely by twilio/inbound:190), src/lib/referral-server.ts:546-575 (fixed bodies: "One more to earn a free month of Pro."), src/app/api/office/members/route.ts:140 (templated seat-removal copy)
- Problem: Two referees signing up within ten minutes produce two `referral_progress` rows with identical words → the second is rejected as a "retry" and the referrer's progress in the bell is wrong. Two members trimmed in one admin session → one row. Every producer with fixed copy and no per-event key is affected; the comment assumes "two different replies differ in body", which holds only for free-text producers. The rejection is indistinguishable from N-04's failure (`false`).
- Expected behavior: Dedupe on an explicit idempotency key per producer, or include the entity id (`lead_id`/`meta`) in the comparison.
- Actual behavior: Silent drop; no log.
- How to reproduce: Two referral signups within 10 minutes on one referral code; bell shows one row.
- Likely cause: A global retry guard on a function with no event identity.
- User impact: Under-counted progress / missed seat notices; rare.
- Confidence: Confirmed (code)

### N-07 Catch-up decides "paid" from the raw `plan` column (`isPaidPlan`), not the effective plan, so an expired grant gets a locked lead's NAME on the morning lock screen (and the reverse)
- Severity: Medium (paywall / privacy)
- Platform: iOS app / web push
- Account type/plan affected: accounts whose `plan` says pro/enterprise past `plan_expires_at` (trial stretches, gifted months, delete-flow offers)
- Feature/page: /api/push/catchup
- File/component/function: src/app/api/push/catchup/route.ts:4 (`import { isPaidPlan } from "@/lib/plan"`), :188 (profiles read selects `id, plan, customization`, not PLAN_COLUMNS), :196 (`paid = isPaidPlan(plan)`), :312 (`lockedLead = !paid && …`), :328-329 (`paid && new_lead ? unlockedLeadBody(body)` strips the name marks), :347-349 (contact_return URL opens the contact when "paid"); contrast src/lib/push.ts:82 (`isPaidProfile(profile)`) and api/notifications (`isPaidUser`)
- Problem: The live push, the bell and the Contacts page use the effective plan; the morning push alone uses the column. For an account whose timed grant expired overnight the catch-up sends "New contact: Dana Whitfield" with the unmarked body and deep-links to `/contacts?lead=` — the name and contact the paywall has just locked. Conversely an account whose `plan` column lags a fresh Apple purchase gets "Someone shared their info — open to unlock" after paying.
- Expected behavior: Select `PLAN_COLUMNS` and use `isPaidProfile(profile)` like lib/push.ts.
- Actual behavior: Column-only check.
- How to reproduce: plan='pro', plan_expires_at=yesterday, a locked new_lead row written at 11pm; run catch-up at 8am local → push body is the real name.
- Likely cause: Written before effective-plan.ts existed (same family as N-15).
- User impact: Paywall leak on the lock screen; wrong "open to unlock" for a paying user.
- Confidence: Confirmed (code)
