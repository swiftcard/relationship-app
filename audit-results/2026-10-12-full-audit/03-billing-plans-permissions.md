# 03 — Billing, plans, trials, permissions, office, promo, lifecycle, admin
Audit of COMMITTED code at HEAD 655a4480 (read-only; uncommitted diff noted separately at end).

## Findings

### B-01 Scheduled Office seat reduction is applied AFTER the renewal invoice — customer pays a full extra cycle at the old seat count (July open item #3: NOT fixed)
- Severity: High
- Platform: All (server cron)
- Account type/plan affected: Office owner / billing_admin who reduces seats (monthly and especially annual)
- Feature/page: Settings → Plan and billing → seats; daily cron /api/reminders
- File/component/function: src/app/api/stripe/subscription/seats/route.ts:222-227 (stores scheduled_seats_at = current period end); src/lib/office-scheduled-seats.ts:24-56 (`applyDueSeatReductions`, `.lte("scheduled_seats_at", now)`, `proration_behavior: "none"`)
- Problem: The reduction is stored with `scheduled_seats_at = period end` and only applied by a once-a-day cron that selects rows whose time has already PASSED. Stripe renews (and invoices the full quantity) exactly at period end, i.e. before the cron can ever see the row. The cron then lowers quantity with `proration_behavior: "none"`, which gives no credit for the already-billed cycle.
- Expected behavior: The new cycle is billed at the reduced quantity.
- Actual behavior: Renewal invoice uses the old (higher) quantity; the lower quantity only applies from the cycle after. Annual Office = one extra YEAR of the removed seats.
- How to reproduce (BLOCKED — test mode + test clock): 5-seat monthly Office sub; POST /api/stripe/subscription/seats {seats:3}; advance test clock past period end; observe renewal invoice qty 5; run /api/reminders; observe qty 3 with no credit.
- Likely cause: Applying a period-end change from a post-hoc daily job instead of in Stripe.
- Fix: At schedule time call `subscriptions.update(items:[{id, quantity: requested}], proration_behavior: "none")` immediately (Stripe bills the NEXT cycle at the new quantity; the current paid cycle is untouched) and keep `offices.seats` at the higher number until `scheduled_seats_at` (cron only flips the DB number and re-checks in-use; if in-use grew, raise quantity back). Or use a Subscription Schedule with a second phase. Regression test: the cron must never call Stripe after period end with proration "none".
- User impact: Direct overcharge (removed seats x one full cycle).
- Confidence: Confirmed (code); amount BLOCKED on a test-clock run.

### B-02 Out-of-order / stale customer.subscription.updated trims Office members and overwrites seats (July open item #2: NOT fixed)
- Severity: High
- Platform: All (Stripe webhook)
- Account type/plan affected: Office owners and their members
- Feature/page: Webhook seat sync / trim; Pro<->Office reconcile
- File/component/function: src/app/api/stripe/webhook/route.ts:867-1027 (event payload quantity :869, `offices.seats` write :977, trim :990-1023, plan reconcile :935-966)
- Problem: The handler trusts the snapshot in the event payload. It never compares `event.created` with the last applied state and never re-fetches the subscription. Stripe does not guarantee ordering, and a 500'd event is retried hours later (up to 3 days) after newer events were applied.
- Expected behavior: A stale event cannot lower `offices.seats`, suspend members, or flip the plan.
- Actual behavior: 5 -> 8 seats (event A qty 5 delayed/retried, event B qty 8 applied) then A applied -> `offices.seats=5`, the 3 newest active members suspended, cards un-flagged, "Your Office access ended" — while Stripe bills 8. A stale Office-price event after a Pro swap re-provisions the office; a stale Pro event after an Office upgrade tears it down.
- How to reproduce (BLOCKED — test mode): add seats twice quickly; `stripe events resend <older evt_id>`; inspect offices.seats and office_members.status.
- Likely cause: No ordering guard; stripe_events only dedups identical ids.
- Fix: First line of the branch: `const sub = await getStripe().subscriptions.retrieve(obj.id)` and use the live object for quantity/price/status/trial/cancel flags. Never trim below the live Stripe quantity.
- User impact: Paid seats lose access; DB seat count below what is billed (invite gate refuses paid seats).
- Confidence: Confirmed (code)

### B-03 Concurrent webhook handlers clobber profiles.customization (whole-JSON read-modify-write)
- Severity: High
- Platform: All
- Account type/plan affected: Every Stripe buyer (checkout fires checkout.session.completed, customer.subscription.updated and invoice.payment_succeeded within the same second); also cancel/keep/change-plan
- Feature/page: Webhook; plan-chosen marker; trial mirror; _planSource; _everPaid; _paymentFailedAt
- File/component/function: src/app/api/stripe/webhook/route.ts:551-577, :656-669, :848, :878-969, :299-302; src/app/api/stripe/subscription/cancel/route.ts:60-66; keep/route.ts:51-55; change-plan/route.ts:175-182
- Problem: Each writer SELECTs customization, mutates a copy, and UPDATEs the entire object. Parallel deliveries for one profile overwrite each other's keys (last writer wins).
- Expected behavior: Each writer changes only its own keys atomically.
- Actual behavior: e.g. subscription.updated reads before checkout writes and writes after -> `_planSource:"stripe"` and `_planChosen` are lost. Missing `_planChosen` on an account created after PLAN_STEP_REQUIRED_SINCE makes card-active treat a paying customer as "never chose a plan" (card dark / sent to /welcome). Missing `_planSource` weakens the Apple/Stripe source guard. Consistent with prod: 15 invoice.payment_succeeded stored, `_everPaid` on 0 rows (see also B-04).
- How to reproduce (BLOCKED): test-mode checkout; resend checkout.session.completed and customer.subscription.updated concurrently; inspect customization.
- Likely cause: JSON blob used as multi-writer state without jsonb_set/RPC.
- Fix: Postgres RPC `merge_customization(uid, patch jsonb, remove text[])` = `customization = (customization - remove) || patch` in one statement; use it for every server write. Better: move billing state (_planSource, _everPaid, _trialEndsAt, _paymentFailedAt, _cancelAt*) into real columns covered by the privileged-columns trigger (see B-20).
- User impact: Paying users intermittently treated as plan-not-chosen; wrong source guard; lost grace clock.
- Confidence: Confirmed (code pattern); production symptom Suspected

### B-04 First invoice.payment_succeeded is processed before checkout stored stripe_customer_id, so it is dropped (200) — `_everPaid` never set by the first payment
- Severity: Medium
- Platform: All
- Account type/plan affected: New Stripe subscribers
- Feature/page: Webhook; payment-failed grace decision; receipt labels
- File/component/function: src/app/api/stripe/webhook/route.ts:638-671 (lookup by stripe_customer_id), :826 (consumer)
- Problem: A new customer's profile gets stripe_customer_id only inside the checkout.session.completed handler (:533). The first invoice event is often handled first/concurrently, finds no profile, and is acknowledged 200 (never retried).
- Expected behavior: First paid invoice marks the account as paying.
- Actual behavior: Flag missing (prod: 0 profiles carry `_everPaid` despite 15 succeeded invoices). The renewal-failure path then needs a live Stripe list call to avoid treating a payer as never-paid (it fails safe today).
- How to reproduce: `select count(*) from profiles where customization ? '_everPaid'` (=0) vs paid invoices in Stripe.
- Likely cause: Lookup keyed on a value another concurrently-processed event writes.
- Fix: Set `subscription_data.metadata.user_id` at checkout and resolve by that in invoice handlers; or 500 (retry) when an invoice for a subscription < 10 min old matches no profile.
- User impact: Low today, latent wrong decisions.
- Confidence: Confirmed (code + prod count)

### B-05 Insert-marker-first idempotency loses events if the function is killed before the catch runs
- Severity: Medium
- Platform: All (Vercel function)
- Account type/plan affected: Any Stripe event
- Feature/page: Webhook idempotency
- File/component/function: src/lib/stripe-idempotency.ts:19-36; src/app/api/stripe/webhook/route.ts:325, :1195-1201 (route exports no maxDuration)
- Problem: The stripe_events row is inserted before processing; clearStripeEvent only runs from the JS catch. A platform timeout (checkout handler does about 6 Stripe calls, a Resend send and office provisioning), OOM or deploy cut-off never reaches it; Stripe retries and gets `duplicate:true`.
- Expected behavior: Dedup records completion, not start.
- Actual behavior: Started-but-unfinished events count as done -> paid-not-provisioned or cancelled-still-active.
- How to reproduce (BLOCKED): inject delay > maxDuration in test mode; retry returns duplicate.
- Fix: `status='processing'|'done'` + `started_at`; a retry re-processes a 'processing' row older than a few minutes; mark done at the end. Export `maxDuration = 60`.
- User impact: Rare, high per-incident.
- Confidence: Confirmed (code); occurrence Unable to Verify

### B-06 Unhandled Stripe terminal states: `unpaid`, `paused`, `incomplete_expired` never downgrade; and invoice.payment_failed has never been recorded in production
- Severity: High (conditional on Dashboard settings — BLOCKED for confirmation)
- Platform: All
- Account type/plan affected: Pro/Office subscribers whose card fails
- Feature/page: Stripe webhook, grace-period sweep in /api/reminders
- File/component/function: src/app/api/stripe/webhook/route.ts:936-937 (`liveStatuses = active|trialing|past_due`; anything else is silently ignored), :766-861 (payment_failed is the ONLY arm of the 7-day fuse); src/app/api/reminders/route.ts:449-505
- Problem: Access is removed only by `customer.subscription.deleted`. If the Stripe Billing setting "when all retries fail" is "mark subscription unpaid" (or "leave past_due"), Stripe never deletes the sub; customer.subscription.updated with status `unpaid` hits no branch, so plan stays pro/enterprise. The only backstop is the `_paymentFailedAt` fuse, which is armed solely by `invoice.payment_failed`. Production stripe_events contains ZERO invoice.payment_failed events across 41 events — either no renewal has ever failed, or the endpoint is not subscribed to that event (stored types are exactly checkout.session.completed, invoice.payment_succeeded, customer.subscription.updated/deleted).
- Expected behavior: A subscription that stops paying ends paid access within the grace window regardless of Dashboard dunning settings.
- Actual behavior (if either condition holds): non-paying customer keeps Pro/Office indefinitely; Office members too.
- How to reproduce (BLOCKED): Stripe Dashboard → Developers → Webhooks → the swiftcard.me endpoint → check the event list includes `invoice.payment_failed`; Billing → Subscriptions and emails → "Manage failed payments" → note the final action. Test mode: card 4000 0000 0000 0341, test clock past renewal and retries; observe events and profiles.plan.
- Likely cause: Plan derived from event types, not from subscription status.
- Fix: In subscription.updated, treat `unpaid | canceled | incomplete_expired | paused` as ended (run the same downgrade as subscription.deleted, guarded by subscription id), and arm `_paymentFailedAt` when status becomes `past_due` (not only on invoice.payment_failed). Owner action: subscribe the endpoint to invoice.payment_failed (and customer.subscription.paused/resumed); set "cancel subscription" as the final dunning action.
- User impact: Revenue leak; inconsistent access.
- Confidence: Code Confirmed; production configuration Unable to Verify

### B-07 Two simultaneous Pro<->Office provisioning paths can create duplicate `offices` rows for one owner (no unique owner_id in repo SQL)
- Severity: Medium
- Platform: All
- Account type/plan affected: Office owners (new purchase or Pro->Office upgrade)
- Feature/page: Office provisioning
- File/component/function: src/lib/office-billing-sync.ts:44-65 (`select ... maybeSingle()` then `insert`); callers webhook :627-629 (checkout) and :960-962 (subscription.updated), change-plan/route.ts:184-186; repo SQL only has non-unique `idx_offices_owner` (supabase/scaling-indexes.sql:50)
- Problem: Check-then-insert without a unique constraint. On a new Office checkout, checkout.session.completed and customer.subscription.updated (plan read as free before the checkout write) both call provisionOfficeForOwner; on an in-app Pro->Office swap the route and the webhook both do.
- Expected behavior: Exactly one office per owner.
- Actual behavior: Two rows; every `.eq("owner_id").maybeSingle()/.single()` afterwards errors -> resolveOfficeContext returns null for the owner (src/lib/office-roles.ts:71-83), the owner loses the console, invites fail, seat sync (`webhook :975 .single()`) silently no-ops.
- How to reproduce: `select owner_id, count(*) from offices group by 1 having count(*)>1` (prod has 10 offices); test-mode: resend checkout.session.completed and customer.subscription.updated concurrently.
- Fix: `create unique index offices_owner_uidx on offices(owner_id)`; make provision an `upsert(..., {onConflict:"owner_id"})`.
- Confidence: Suspected (race is real in code; the base DDL is not in the repo, so the constraint may exist in prod — verify with `\d offices`)

### B-08 Members of an office whose owner profile is gone (2 such offices in prod) keep Office forever and are locked in
- Severity: Medium
- Platform: All
- Account type/plan affected: Members of orphan offices
- Feature/page: Office membership, account deletion, checkout
- File/component/function: src/lib/office-roles.ts:63-95 (member context resolved without checking the owner exists), :219-252 (officeSubUserBlockMessage), src/app/api/account/delete/route.ts:26-29, src/app/api/stripe/checkout/route.ts:57-60; src/lib/account-purge.ts:114-134
- Problem: Every cascade that releases members is keyed on the owner (Stripe sub deleted, teardown, purge). If the owner row disappears any other way (auth user deleted in the Supabase dashboard / by QA cleanup — profiles cascade, offices.owner_id has no FK), nothing ever releases the members. They stay `plan='enterprise'` with an active membership; `requireOfficeCapability` fails for everyone (owner profile null), so no admin can remove them; as "sub-users" they are refused account deletion, checkout, the portal and promo codes.
- Expected behavior: Membership in an ownerless/unpaid office is released; the member can delete their account or buy their own plan.
- Actual behavior: Free Office access indefinitely AND no self-service exit (Apple 5.1.1(v) risk).
- How to reproduce: `select o.id, m.user_id, m.status from offices o left join profiles p on p.id=o.owner_id join office_members m on m.office_id=o.id where p.id is null;`
- Fix: (1) In resolveOfficeContext treat a member whose owner profile is missing or not on Office as NOT a sub-user (return null for sub-user purposes). (2) One-off: run tearDown semantics for the 2 orphan offices. (3) Add FK `offices.owner_id references auth.users on delete cascade` or a trigger that tears down on profile delete.
- Confidence: Confirmed (code); member impact depends on whether those 2 offices have active members (Unable to Verify)

### B-09 Office members cannot delete their own account (or leave the team) in-app
- Severity: Medium
- Platform: iOS app (App Review 5.1.1(v)), web
- Account type/plan affected: Any active Office member (employee/manager/admin/billing_admin)
- Feature/page: Settings → Delete account
- File/component/function: src/app/api/account/delete/route.ts:26-29 (403 "Ask your Office admin to remove you"); no member self-leave route exists under src/app/api/office/*
- Problem: A personal account that joined a team (often pre-existing, with its own contacts and possibly its own paid subscription) can only be deleted or detached by the company.
- Expected behavior: A user can always delete their own account (Apple requires in-app deletion for any account the app lets you create/sign in to); deleting should first release the seat.
- Actual behavior: Hard refusal; if the admin is unresponsive or the office is orphaned (B-08) the person is stuck.
- Fix: Allow delete for members: run the same release as api/office/members DELETE for their row (stamping contacts to the office), then the normal soft delete. Add a "Leave team" action.
- Confidence: Confirmed

### B-10 Referral reward credit for annual subscribers is a full YEAR, not a month
- Severity: Medium
- Platform: All
- Account type/plan affected: Paying annual Pro (and annual Office) referrers claiming a reward
- Feature/page: Refer a friend → Claim
- File/component/function: src/lib/referral-server.ts:124-137 (`amount = price.unit_amount * months`)
- Problem: `unit_amount` of an annual price is the yearly amount. REFERRER_FREE_MONTHS=1, so the customer balance gets −(annual price) — 12x the promised "one month free". For Office it takes one seat's price, ignoring quantity (under-credits). Up to 3 claims per referrer.
- Expected behavior: Credit = one month's worth (annual/12, or the monthly list price) x quantity.
- Actual behavior: 12x over-credit for annual; 1/N for Office.
- How to reproduce (BLOCKED): test-mode annual Pro customer with 3 valid referral rows; POST /api/referrals/claim; inspect customer balance transactions.
- Fix: `const monthly = price.recurring?.interval === "year" ? Math.round(unit/12) : unit; amount = monthly * (item.quantity ?? 1) * months` (or use PLAN_PRICES.PRO_MONTHLY_CENTS).
- Confidence: Confirmed (code)

### B-11 Apple-billed Pro + an Office grant code = permanent free Office
- Severity: Medium
- Platform: All (grant redeemed anywhere; the Apple sub came from iOS)
- Account type/plan affected: Apple Pro subscriber who redeems an Office grant (tester) code
- Feature/page: Promo code box (/pricing, Settings)
- File/component/function: src/app/api/promo/redeem/route.ts:183-234 (only refuses `stripe_subscription_id`, not Apple), src/lib/referral-server.ts:629-633 (expireFreeMonths skips `isApplePaid` rows and just clears the expiry), src/lib/effective-plan.ts:35, src/lib/iap-entitlement.ts:95-96 (later Apple EXPIRATION on an Office plan only "forgets" Apple)
- Problem: The grant writes plan=enterprise + plan_expires_at and provisions an office, but `_planSource` stays "apple". The expiry job treats the row as a real subscriber, clears plan_expires_at and never downgrades; when the Apple sub ends, decideRcEvent sees an Office plan and only removes `_planSource`.
- Expected behavior: The grant ends after free_days.
- Actual behavior: Office (with seats) forever, free.
- How to reproduce: Apple sandbox allow-listed account with Pro; redeem an Office grant code; set plan_expires_at to the past; run expireFreeMonths; plan remains enterprise.
- Fix: In promo/redeem refuse grants when `isApplePaid(cust)` (same as Stripe), or record grant expiry separately from subscription source (e.g. `_grantPlan`, `_grantEndsAt`) and have the expiry job revert only the granted tier.
- Confidence: Confirmed (code)

### B-12 RevenueCat EXPIRATION delivered late revokes a re-subscribed Apple customer; grant/revoke DB write errors return 200
- Severity: Medium
- Platform: iOS
- Account type/plan affected: Apple Pro subscribers
- Feature/page: /api/iap/revenuecat
- File/component/function: src/app/api/iap/revenuecat/route.ts:85 (grant re-checks RevenueCat), :102-111 (revoke does NOT), :86-89/:104-107 (update errors ignored)
- Problem: Grants consult `rcProActive` to reject stale events, but revokes don't. An EXPIRATION retried after a new INITIAL_PURCHASE/RENEWAL (RevenueCat retries failed deliveries) sets plan=free for a paying customer until the next renewal event (a month or a year). Separately, supabase-js returns `{error}` instead of throwing, so a failed write is acknowledged 200 and never retried — a paying Apple user stays Free.
- Expected behavior: Revoke only if RevenueCat says the entitlement is not active; a failed write returns 500.
- Fix: `if ((await rcProActive(uid)) === true) return "stale_revoke";` before revoking; check `error` on both updates and throw.
- Confidence: Confirmed (code)

### B-13 Card-fingerprint "one trial per card" guard appears dead in production (0 `card` ledger rows)
- Severity: Medium
- Platform: Web (Stripe)
- Account type/plan affected: Pro trial abusers / all new trialists
- Feature/page: Checkout trial; webhook repeat-card rule
- File/component/function: src/app/api/stripe/webhook/route.ts:377-385 (fingerprint read only from `sub.default_payment_method`), :460, :477
- Problem: Production trial_ledger has 3 rows, all `email_trial`, and 2 profiles currently carry `_trialEndsAt` (Stripe trials) — yet zero `card` rows. `ledgerAdd("card", null)` is a no-op, so the fingerprint was null for every trial. When Checkout leaves the PM on the customer's `invoice_settings.default_payment_method` (or the session's setup_intent) instead of the subscription, the repeat-card check never fires and nothing is recorded. The same null leaves `profiles.payment_fingerprint` empty, which disables the referral same-card fraud check (referral-server.ts:597-604) and the per-card retention-discount rule.
- Expected behavior: Every trial records its card; a repeat card ends the trial.
- How to reproduce (BLOCKED): test-mode trial checkout with 4242; retrieve the subscription — check `default_payment_method`; check `customers.retrieve(...).invoice_settings.default_payment_method`; `select kind,count(*) from trial_ledger group by 1`.
- Fix: Resolve the PM as `sub.default_payment_method ?? customer.invoice_settings.default_payment_method ?? setupIntent.payment_method` (expand `customer` and `setup_intent` on the session), and alert when a trial checkout yields no fingerprint.
- Confidence: Suspected (strong production signal; needs one test-mode run)


## Findings, continued (resumed session, HEAD 655a4480)

### B-14 (LATENT, not exploitable today) The guard trigger does not cover profiles.customization, where all server-only billing state lives
- **Lead-auditor verification 2026-10-13 — downgraded from High to Low (latent):** production `has_table_privilege` / `has_column_privilege` show anon and authenticated have NO UPDATE (table or `customization` column) and NO INSERT on `profiles`, so the PATCH below is refused at the grant layer before RLS. The server path `src/app/api/profile/route.ts:61-67` deletes every incoming `_`-prefixed key and restores current `_` values. So no current path lets a user set `_planSource`/`_usage`. The risk is latent: the repo SQL still defines an "Own update" policy, and the trigger skips `customization`, so restoring default grants (or applying a migration that re-grants UPDATE) would open it immediately. Original write-up kept below for the reasoning.
- Severity: Low (latent; was High)
- Platform: All (Supabase REST with the public anon key and the user's own JWT)
- Account type: Any signed-in account; worst case a Free account that ever received a timed grant (referral gift, promo grant, delete-flow gift, admin comp)
- Feature/page: Plan entitlement, Free monthly lead meter
- File:line: supabase/rls-initplan-fk-indexes-2026-09-28.sql:42 ("Own update" policy on profiles, USING auth.uid() = id); supabase/pro-trial-safeguards.sql:52-86 (guard trigger covers plan, office_id, plan_expires_at, stripe_*, referral_*, pro_trial_started_at, free_live_card_id, but NOT customization); src/lib/iap-entitlement.ts:136-137 (isApplePaid = customization._planSource === "apple"); src/lib/effective-plan.ts:35; src/lib/referral-server.ts:629-633 (expireFreeMonths skips isApplePaid rows and only clears the date); src/lib/usage.ts:24-28 (_usage read from customization); src/app/api/leads/route.ts:235-239
- Problem: All billing and entitlement state that is not a real column lives in `customization`, and the browser role can write that column on its own row. SEC-08 notes the browser roles still hold default grants, and the repo defines an "Own update" policy, so `PATCH /rest/v1/profiles?id=eq.<me>` with `{"customization": {...}}` passes RLS and the guard trigger.
- Expected: Only the server writes _planSource, _usage, _trialEndsAt, _paymentFailedAt, _cancelAt*, _retention*, _deleted/_deletion, _proEndedChoicePending, _planChosen.
- Actual (code path): (1) A user on a referral or promo grant sets `_planSource:"apple"`. effectivePlan never expires the grant, the daily expireFreeMonths clears plan_expires_at as if they were an Apple subscriber, and plan stays pro (or enterprise from an Office grant) indefinitely at no charge. (2) A Free user resets `_usage.leads` to 0 before captures, so new leads are never tagged sc-locked and the 5-a-month cap stops working. (3) Removing `_paymentFailedAt` stops the 7-day past_due downgrade clock in /api/reminders:456. (4) Removing `_deleted` gets past the page guard (proxy.ts:238) on a cold cache.
- Repro (BLOCKED, needs a test project and no production writes): sign in as a Free test user holding a 30-day grant; with the anon key and the session JWT run PATCH /rest/v1/profiles?id=eq.<uid> body {"customization":{..., "_planSource":"apple"}}; set plan_expires_at to the past (service role); run expireFreeMonths. Plan stays pro. Before the run, confirm grants with `select privilege_type from information_schema.role_table_grants where table_name='profiles' and grantee='authenticated'`.
- Likely cause: The privileged-column guard predates server state moving into the JSON blob, and SEC-08 found no client code that writes profiles, so the update grant and policy do nothing useful.
- User impact: Unlimited free Pro or Office (lost revenue); Free cap bypass; dunning bypass.
- Fix (fail-closed): Drop the "Own update" policy and revoke UPDATE on profiles from anon and authenticated (all writes already go through service-role routes, per SEC-08). Or extend the trigger: `if new.customization is distinct from old.customization then raise`. Longer term, move _planSource, _usage and the dunning/cancel/trial keys into guarded columns. Regression test: a source test that the guard SQL names customization, or that no policy grants UPDATE on profiles.
- Confidence: Confirmed in repo SQL and code. Production policy and grant state still need to be verified (query above).

### B-15 checkout.session.completed "supersede" immediately cancels the account's other subscription with no refund, and a late or retried event cancels the NEWER subscription
- Severity: High
- Platform: Web (Stripe)
- Account type: Buyers who end up with two Checkout sessions (two tabs, a double click across a minute boundary, back button to /checkout after paying, Pro in one tab and Office in another)
- Feature/page: Checkout, then the webhook
- File:line: src/app/api/stripe/webhook/route.ts:507-525 (reads profiles.stripe_subscription_id, then subscriptions.cancel(priorSubId)), :533 (then writes the new id); src/app/api/stripe/checkout/route.ts:73 (the 409 only fires once the DB holds a sub), :258-279 (the dedup only looks at COMPLETE sessions from the last hour), :454 (idempotency key changes every minute)
- Problem: Each tab can open its own Checkout session, and both can be paid. Whichever completion is processed second cancels the other subscription at once. subscriptions.cancel with default settings gives no proration credit and no refund. The decision depends only on what the DB holds when the event runs, not on which subscription is newer. A first event that 500'd (for example from B-03/B-04 contention) and is retried hours later finds the newer subscription in the DB and cancels it.
- Expected: Duplicate checkouts cannot both charge. If they do, the surviving subscription is the newest one, and the cancelled one is refunded or prorated.
- Actual: The customer pays twice. Example: $54 annual in tab A, then $4.99 monthly in tab B. The annual is cancelled the moment B is processed and nothing is returned. With retry ordering, the customer can be left on the older plan they meant to replace.
- Repro (BLOCKED, test mode): open /checkout in two tabs, wait more than 60 s, pay in both with 4242. List subscriptions (one canceled, no credit note). Then `stripe events resend <evt for session A>`: the live subscription B is cancelled and the profile points at A.
- Likely cause: The double-billing guard sits after payment instead of before session creation, and it has no ordering check.
- User impact: Direct overcharge, and possibly losing the plan the user just bought.
- Fix: (1) Before creating a session, expire any OPEN session for this user: checkout.sessions.list({customer, status:"open"}) then sessions.expire. Or reuse a still-open session for the same selection. (2) In the webhook, only supersede when this session's subscription is newer (compare sub.created). Otherwise cancel THIS subscription instead. (3) Cancel with { prorate: true, invoice_now: true } and refund the resulting credit, or refund the latest invoice of the cancelled subscription. Add a unit test on a pure "which subscription survives" helper.
- Confidence: Confirmed (code); money amounts BLOCKED on a test-mode run

### B-16 Office seat reduction through change-plan applies immediately with a prorated credit, bypassing the period-end rule the seats route enforces
- Severity: Medium
- Platform: Web
- Account type: Office owner / billing_admin
- Feature/page: Settings → Plan and billing (plan switcher), POST /api/stripe/subscription/change-plan
- File:line: src/app/api/stripe/subscription/change-plan/route.ts:85-95 (allows seats < currentQty down to seats in use), :140 (create_prorations for non-upgrades), :185 (provisionOfficeForOwner writes the lower seats now); compare src/app/api/stripe/subscription/seats/route.ts:224 (reductions are scheduled for period end with no credit)
- Problem: There are two reduction paths with opposite money rules. {plan:"office", interval:<same>, seats:<lower>} is accepted (the "already on that plan" check skips office), cuts quantity at once and credits the unused part. The route's own 409 text says "reduce seats from the billing page", so the period-end path is the intended one. change-plan also does not clear offices.scheduled_seats, so an earlier scheduled reduction still fires later through the cron, with proration_behavior "none".
- Expected: Every seat reduction follows one rule (period end, no mid-cycle credit), and any immediate change clears a pending scheduled one.
- Actual: An annual Office owner can drop from 10 seats to 3 in month 2 and get roughly 10 months x 7 seats credited. A pending schedule can also apply a second time on top.
- Repro (BLOCKED, test mode): 5-seat Office monthly; POST change-plan {plan:"office",interval:"monthly",seats:3} with 3 seats in use; check the upcoming invoice for a negative proration line; check offices.scheduled_seats.
- Fix: In change-plan, when wasOffice && targetPlan === "office" && seats < currentQty, either return 409 "use the seats control" or call the same scheduling helper the seats route uses. Always null scheduled_seats/scheduled_seats_at when quantity changes here.
- Confidence: Confirmed (code)

### B-17 Account purge leaves data behind: delete failures are silently swallowed, several tables are never purged, and QA scripts delete auth users without running the purge at all
- Severity: Medium (privacy/retention; production evidence: 205 leads and 101 card_views of deleted owners, 246 user_devices and 108 email_preferences with no profile)
- Platform: Server (daily purge-due) and scripts
- Account type: Deleted accounts; nightly QA throwaway accounts
- Feature/page: Delete account → 30-day grace → /api/account/purge-due
- File:line: src/lib/account-purge.ts:38-44 (safeDelete only catches THROWN errors, but supabase-js resolves with {error}, so a failed or timed-out delete is ignored and the run continues to delete the profile and the auth user at :193-194, after which the leftovers are unreachable forever); :99-106 (leads/card_events/card_views deleted only by the current slugs); tables never purged: user_devices, contact_devices, contact_links, wallet_registrations, wallet_passes, apple_refresh_tokens, push_log, product_events, office_notifications, media_assets, unsubscribe_events; scripts/appstore-capture.mjs:526, appstore-explore.mjs:152, native-flows.mjs:211, office-ui-shots.mjs:209, qa-a11y.mjs:402, plus qa-flows.mjs, qa-notifications.mjs, qa-office-links-brand.mjs, qa-mac.mjs (DELETE /auth/v1/admin/users/<id> directly)
- Problem: Two independent leaks. (a) The production purge cannot see its own failures. (b) Nightly QA against production creates real accounts and deletes only the auth user. profiles/cards cascade, but slug-keyed rows (leads, card_views, card_events) and user-id rows without an FK (user_devices, email_preferences) stay. That matches the production orphan counts.
- Expected: A purge either removes every row tied to the user or does not delete the profile and retries the next day. QA cleanup uses the same purge.
- Actual: Orphan PII (leads hold names, phones and emails) is kept with no owner to export or delete it. Orphan lead rows keyed by a slug can be inherited if that slug is registered again: card DELETE cleans them up (cards/[id]/route.ts:451-467), but deleting only the auth user does not.
- Repro: select count(*) from leads l where not exists (select 1 from cards c where c.username=l.card_owner) and not exists (select 1 from profiles p where p.username=l.card_owner); select count(*) from user_devices d where not exists (select 1 from profiles p where p.id=d.user_id).
- Fix: Make safeDelete check {error}, ignore only 42P01/42703 (missing table or column), and return false so purgeUserData stops before deleting the profile. Add the missing tables. Add FKs on delete cascade to auth.users for user-id tables. Add a scripts/lib/purge-test-user.mjs that calls purgeUserData (or an admin route) and use it in every QA script. One-off: an owner-approved cleanup of the existing orphans (not to be run by an agent).
- Confidence: Confirmed (code); attributing the production counts to QA cleanup is Likely

### B-18 Capped promo-code uses are spent when the user taps Apply (or opens a session they abandon), never when they actually buy
- Severity: Medium
- Platform: Web
- Account type: Signed-in users entering a money-off or free-days code with max_uses
- Feature/page: /pricing promo box, PromoCodeBox, /checkout
- File:line: src/app/api/promo/redeem/route.ts:155-173 (inserts a redemption and calls claimPromoUse for every signed-in Apply, grant or not); src/app/api/stripe/checkout/route.ts:216-233 (claims a use when the session is created); src/app/api/stripe/webhook/route.ts:491-498 (only stamps consumed_at); nothing ever releases an unconsumed redemption
- Problem: uses_count counts people who applied the code, not purchases. A flyer code with max_uses 50 runs out after 50 people try it, even if nobody buys. The unconsumed redemption also stays on the account forever.
- Expected: A use is spent when a purchase completes, or held only for the life of the Checkout session (24 h) and released when the session expires.
- Actual: Owner-made codes report "reached its usage limit" to real buyers while conversions stay low.
- Repro: create a test code with max_uses 1; account A taps Apply and leaves; account B taps Apply and gets 410.
- Fix: For non-grant codes, have /api/promo/redeem only validate (checkPromoForPurchase) without inserting or claiming. In checkout, claim as today, and handle checkout.session.expired in the webhook by deleting the unconsumed redemption and decrementing uses_count.
- Confidence: Confirmed (code)

### B-19 Referral Stripe credit is not idempotent: a timed-out balance transaction releases the claim, so the reward can be credited twice
- Severity: Low
- Platform: Web
- Account type: Paying (Stripe) referrers
- Feature/page: Refer a friend → Claim
- File:line: src/lib/referral-server.ts:132 (createBalanceTransaction without an idempotencyKey); the catch :137-150 throws, which releases the claimed referral rows (:476, :492-503)
- Problem: If Stripe applied the credit but the response was lost (timeout, 5xx after commit), the rows go back to claimable and the next tap credits again. A credit added after cancel_at_period_end is also never used, but the rows are still consumed.
- Fix: idempotencyKey "referral-credit:<userId>:<sorted claimed referral ids>". Refuse a credit (keep the reward claimable) when sub.cancel_at_period_end is set.
- Confidence: Confirmed (code); rare in practice

### B-20 Expired timed grants keep paid server features for up to a day: 59 server checks use the raw plan instead of effectivePlan
- Severity: Low
- Platform: All
- Account type: "Grant expired, not yet cleared" (referral/promo/gift/admin comp past plan_expires_at, before the daily expireFreeMonths)
- Feature/page: Lead capture lock, CRM/Zapier sync, scanner, AI drafts, card editing, vCard, design-generate, integrations connect
- File:line: src/lib/effective-plan.ts:30-43 (correct helper, 16 call sites); raw isPaidPlan(profile.plan) at, e.g., src/app/api/leads/route.ts:235 and :321, leads/manual/route.ts:46, cards/[id]/route.ts:98 and :169, scanner/route.ts:28, ai/suggest-messages/route.ts:45, leads/[id]/generate-sequence/route.ts:49 and :79, card/[username]/vcard/route.ts:65, settings/zapier/route.ts:20 (git grep "isPaidPlan(" under src/app/api lists 40+)
- Problem: The notification and place-name paths use effectivePlan, but the lead cap and most Pro features do not. Leads captured in the gap are stored without sc-locked and are not counted, so they stay unlocked permanently.
- Fix: Replace isPaidPlan(row.plan) with isPaidProfile(row) (selecting PLAN_COLUMNS) in server routes. Add a source test that bans isPaidPlan( on a .plan field under src/app/api except checkout's subscription guards.
- Confidence: Confirmed (code)

### B-21 Free monthly cap: concurrent captures each decide "unlocked" from the same stale snapshot
- Severity: Low
- File:line: src/app/api/leads/route.ts:236-239 (locked comes from readUsage(ownerProfile.customization) read earlier in the request; bumpUsage's return value, the real post-increment count, is ignored)
- Problem: Two or three leads arriving together when 4 are used are all saved unlocked, so the account gets 6-7 instead of 5. The counter itself is correct (high-water mark).
- Fix: n = await bumpUsage(...); locked = n > PLAN_LIMITS.FREE_LEADS_PER_MONTH; lastFreeLead = n === LIMIT; compute the tags after it.
- Confidence: Confirmed (code)

### B-22 Trial "charge soon" notice is marked sent before it is sent; a failed send is never retried
- Severity: Low-Medium (card-network notice rules, the charge-dispute risk the file itself describes)
- File:line: src/lib/trial-notice.ts:99-102 (writes _trialChargeWarnedFor first), :133-139 (on a send error it only reports and continues); :58 skips anyone the DB marks _cancelAtPeriodEnd, which can be stale (B-02/B-03)
- Problem: A Resend outage or a missing account email (:68 continue after marking) means the trialist gets no 7-day notice and is charged without one. It also writes the whole customization blob (the B-03 pattern).
- Fix: Stamp only after sent.id is returned; on failure, leave it unstamped so the hourly run retries. Read cancel state from Stripe (or re-fetch) before skipping.
- Confidence: Confirmed (code)

### B-23 STRIPE_RETENTION_DISCOUNT_COUPON_ID override is unvalidated, while the UI promises exactly "50% off for 3 months"; the variable is missing from .env.example
- Severity: Low
- File:line: src/app/api/stripe/subscription/discount/route.ts:20-21 (any coupon id is trusted); src/components/BillingManager.tsx:818, :903, :909 (fixed "50% off ... 3 months" copy); ENV_KEYS_NEEDED.md:197 documents it, but .env.example only has STRIPE_RETENTION_COUPON_ID (:171)
- Problem: Setting the override to any other coupon (or confusing it with STRIPE_RETENTION_COUPON_ID, which ENV_KEYS_NEEDED itself warns about) changes the discount without changing the promise. A typo or test-mode id in production causes a 502 on every save-offer.
- Fix: When the override is set, retrieve it and require percent_off===50 && duration==="repeating" && duration_in_months===3 && valid; otherwise fall back to the built-in coupon and report. Add the key to .env.example.
- Confidence: Confirmed (code)

### B-24 Prices hardcoded outside plan.ts (admin MRR and compare pages)
- Severity: Low
- File:line: src/app/api/admin/analytics/route.ts:10-11, :74-79 (MRR = 4.99 or 3.99 per subscription: Office counted as ONE seat, annual counted as monthly list price, trialing/cancelling/discounted/past_due subscriptions all counted as paying); src/app/compare/[slug]/page.tsx:71, 108, 126, 145, 163, 165, 182, 201, 222, 240, 242, 261, 279, 281 and src/app/compare/page.tsx:31, 36 ($4.99 and $3.99/seat literals)
- Problem: A price change in plan.ts leaves the compare pages and the admin revenue number wrong. The admin MRR undercounts Office (min 2 seats) and overcounts trials, so the owner acts on a wrong number. tests/knowledge-truth only checks the knowledge docs.
- Fix: Format from PLAN_PRICES in the compare pages. Compute MRR from Stripe (active subscriptions: quantity x unit_amount, divided by 12 for annual, minus discounts), or at minimum multiply by offices.seats and exclude _trialEndsAt. Extend the knowledge-truth price scan to src/app/compare.
- Confidence: Confirmed (code)

Checked and found sound (no finding): server lead lock on every by-id route (vcard, message, sms, share-card, generate-sequence, card-events, twilio inbound, PATCH); manual add returns 402 at the cap; CSV export is paid-only; render-time sanitize on the card page, share image, Wallet and signature (resolve-card.ts:131-155); grant redemption is unique per code+user (23505); referral claim uses a conditional row update; trial extension is keyed to trial_start and stamped in Stripe metadata (it cannot stack); retention discount is once per email and card plus refused when already_discounted (no promo stacking); trial eligibility checks account, email ledger (normalized gmail/plus) and Stripe history, and fails open by design; checkout re-verifies price id and unit_amount; Upgrade, seat and plan buttons disable while busy, and the server has idempotency keys.
Note: B-03 refers to "B-20" for a privileged-columns item that was never written under that number. That content is now B-14.

## Appendix A - State matrix
Legend: eff = effectivePlan(); D/U/B = dashboard / upgrade+pricing / Settings → Plan and billing (BillingManager).

| State | eff | What D/U/B shows | Gated features | Prompts | Issues |
|---|---|---|---|---|---|
| Logged out | - | Marketing /pricing; /upgrade and /checkout send to login | everything behind the proxy | sign-up CTAs | promo Apply preview only (no use spent) |
| Free | free | D: 1 live card, 5 leads/mo meter; U: Pro/Office cards; B: no subscription, Upgrade | 1 card, 2 Swift Links, no custom designer/colours/finish media, no CRM/Zapier/scanner/AI drafts/CSV | upgrade nudges, trial offer if eligible | B-14 (meter reset), B-18 |
| Free over lead cap | free | D/Contacts hide sc-locked leads, count shown; bell "open to unlock" with masked name | locked leads 404 on every by-id route | unlock = upgrade | B-21 (cap overshoot), B-20 |
| Stripe trial (Pro) | pro | B: trial end date + first charge; stretch offer on cancel | all Pro | 7-day charge notice email | B-13 (card guard dead), B-22 |
| Trial cancelled | pro until trial_end | B: "ends on" + Keep | Pro until end, then the webhook downgrades | Keep / stretch hidden (cancel_at_period_end) | trial notice skipped by the DB flag (B-22) |
| Pro monthly | pro | B: renewal, Change plan, Cancel (reason → 50% offer → confirm) | none | retention offer once per email/card | B-03, B-15 |
| Pro annual | pro | B: same; 50% offer refused ("monthly plans") | none | - | B-10 (referral = a year) |
| Pro via Apple | pro (_planSource apple) | B: "billed through the App Store"; checkout 409 for Pro, Office needs acknowledgeApple | none | manage in iOS Settings | B-11, B-12, B-14 (spoofable source) |
| Pro granted (referral/promo/gift/admin) | pro until plan_expires_at | D/B: days left; no Stripe subscription | none | checkout bridges the gift into trial_end | grants stack (max(now, expiry) + days); B-14 |
| Grant expired, not cleared | free per effectivePlan, pro per raw plan | mixed: notifications Free, most APIs Pro | inconsistent | - | B-20 (up to 24 h) |
| Pro ended, choice pending | free + _proEndedChoicePending | D: ProEndedPanel (pick the card to keep live) | extras view-only/offline | choose the live card | cleared by the next checkout (webhook :559) |
| cancel_at_period_end | pro | B: "Cancels on <date>", Keep button | Pro until period end | Keep | Cancel and Keep not serialized (webhook reconciles, subject to B-02) |
| past_due | pro for 7 days after _paymentFailedAt | B: payment failed banner, portal | Pro during grace | dunning email | B-06 (unpaid/paused), B-14 (flag removable) |
| Office owner | enterprise | /office/admin console; B: seats control + plan switcher | Pro + team | seat add charges now, reduction at period end | B-01, B-02, B-07, B-16 |
| Office "trial" (grant code) | enterprise until expiry | as owner; no Stripe sub | team features | - | Office has no Stripe trial (Pro trial → Office ends trial now); B-11 |
| Office ended | free (owner); members fall back via memberFallbackPlan | console gone; members get the "access ended" email | member cards un-flagged | re-subscribe restores suspended members up to seats | B-02 (stale event can end it) |
| Office admin / manager / billing_admin / employee | enterprise | per role (see 06 Appendix B); sub-users blocked from checkout/promo/referral/delete | org-managed fields locked | - | B-09 (cannot leave or delete), SEC-09 |
| Removed member | memberFallbackPlan (own Pro survives, else free) | personal dashboard again | Free limits | upgrade | contacts stamped to the office stay with the office |
| Owner lapsed / owner deleted | members: enterprise until teardown | members keep the console view | - | - | B-08 (orphan offices keep Office forever) |
| Pending invite | invitee's own plan | join page /join/[token]; counts as a seat | - | accept/decline | pending invites consume seats (by design) |
| Soft-deleted | free (_deleted) | proxy redirects pages to /account-deleted; reopen within 30 days | APIs still reachable (SEC-12) | reopen | B-17 (purge leftovers), B-14 (flag removable) |
| Device limit | unchanged | proxy redirects to /settings/devices?full=1 (DEVICE_LIMIT 2) | everything until a slot frees | remove a device | SEC-07 (sign-out does not revoke) |

## Appendix B - Office role capability matrix
See 06-security.md Appendix B (route x role matrix from src/lib/office-roles.ts:28-32). Billing-specific notes: billing_admin may change plan (including Office → Pro, which tears down the office immediately, change-plan/route.ts:186-188) and reduce seats; members holding manage_billing act on the owner's subscription through resolveBillingSubjectId.
