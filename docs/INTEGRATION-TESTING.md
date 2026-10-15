# Testing SwiftCard's Integrations

## CRMs, Google Contacts and Zapier — current state (2026-10-14)

The "no test mocks anything" note below is from July and is out of date for the
CRM integrations. What exists now, from fastest to most real:

| What | Command | Sees |
|---|---|---|
| Contract tests — every provider, the runner, the retry queue, Zapier, against fakes that answer like each real API | `npx vitest run tests/crm-provider-contract.test.ts tests/crm-sync-behaviour.test.ts` | duplicates, overwrites, 401/403/409/429/5xx/timeouts, refresh, Office routing, card scope, the queue |
| The routes, executed | `npx vitest run tests/integrations-routes.test.ts` | connect / test / disconnect / Zapier / event switches as the button sees them |
| Every Settings state, rendered at 390 and 1280px | `npx vitest run --config vitest.render.config.ts tests/render/integrations-settings-states.test.ts` | Reconnect vs Needs attention, Paused, Last sent / waiting, Disconnect after a plan ends |
| **Live** — the real sync code against real test accounts, read back through each CRM's own API, cleaned up after | `npx vitest run --config vitest.live.config.ts` | HubSpot, Pipedrive, GoHighLevel for real |

The live suite needs test-account tokens in the environment or `.env.local`
(never commit them): `QA_HUBSPOT_TOKEN` (HubSpot service key with contact
read + write), `QA_PIPEDRIVE_TOKEN` (personal API token), `QA_HIGHLEVEL_TOKEN`
+ `QA_HIGHLEVEL_LOCATION_ID` (Private Integration with contacts.write +
locations.readonly). A provider without its token is skipped and says so. It
never touches the SwiftCard database — only the CRM accounts it is given.

Google Contacts and Salesforce are OAuth, so they are checked through the
product itself: connect them on a test Pro account in Settings → Notifications
and preferences, press **Send test contact** on each (it says "Added" / "Updated"
and links to the record), then share a contact on that account's card and see
"Last contact sent just now". Zapier: paste a Catch Hook URL, press **Test**,
then "Test trigger" in Zapier.

How it works, briefly: every provider's `push` (src/lib/sync-*.ts) only talks
to its CRM; `runCrmSync` (src/lib/crm-run.ts) does everything around it —
destination (Office), card scope, token refresh (and one forced refresh after a
401), remembering the record (`crm_links`), the Settings line (`sync_error`,
`last_synced_at`), and queueing busy/down sends (`crm_sync_outbox`, drained
daily by /api/reminders via src/lib/crm-outbox-drain.ts). Schema:
supabase/crm-sync-reliability.sql.

---


**Repo:** `/Users/menashharooni/Desktop/relationship-app` · **Written:** 2026-07-29 · **Baseline verified this session:** `npx vitest run` → **62 files, 708/708 passing, 14.2s**

> **Read this first.** I grepped the whole test suite for provider mocking:
> ```
> grep -l "vi.mock\|vi.stubGlobal" tests/*.ts   # → 0 files
> grep -rn "@/app/api" tests/*.ts               # → 1 hit, and it imports pure helpers, not a handler
> grep -l "readFileSync" tests/*.ts | wc -l     # → 23 of 62
> ```
> **Not one test in this repo mocks an SDK, executes an API route handler, or exercises an integration code path.** 23 of 62 files are static source scans (`readFileSync` + regex). Only two files (`tests/guest-draft.test.ts`, `tests/guest-reset.test.ts`) use `vi` at all, and neither mocks a module. The 708 green tests are a very good *lint*. They are not evidence that Stripe, Resend, Twilio, APNs, web push, HubSpot, Google Contacts, Zapier, Upstash, PostHog, or Apple Wallet work. Everything in Tier 1 below is about closing that gap.

---

## The 5-minute version

The shortest sequence that tells you whether something is broken **today**. Everything here is read-only, unauthenticated, or offline. No writes, no sends, no charges.

```bash
cd /Users/menashharooni/Desktop/relationship-app

# 1. Does the code still hold together? (~15s)
npx vitest run

# 2. Is the site up and does the webhook route fail closed?
curl -s -o /dev/null -w 'home            %{http_code}\n' https://swiftcard.me
curl -s -o /dev/null -w 'webhook nosig   %{http_code}\n' -X POST https://swiftcard.me/api/stripe/webhook -d '{}'
curl -s -o /dev/null -w 'webhook badsig  %{http_code}\n' -X POST https://swiftcard.me/api/stripe/webhook \
  -H 'stripe-signature: t=1,v1=deadbeef' -d '{"id":"evt_probe","type":"ping"}'
curl -s -o /dev/null -w 'cron nobearer   %{http_code}\n' https://swiftcard.me/api/reminders
curl -s -o /dev/null -w 'twilio inbound  %{http_code}\n' -X POST https://swiftcard.me/api/twilio/inbound \
  -d 'From=%2B15551234567' -d 'Body=STOP'
curl -s -o /dev/null -w 'twilio status   %{http_code}\n' -X POST https://swiftcard.me/api/twilio/status \
  -d 'MessageSid=SMfake' -d 'MessageStatus=undelivered'
curl -s -o /dev/null -w 'admin users     %{http_code}\n' https://swiftcard.me/api/admin/users

# 3. Is billing actually flowing? (the only check that proves webhooks are ALIVE)
set -a; . ./.env.local; set +a
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/stripe_events?select=event_id,type,created_at&order=created_at.desc&limit=5" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

# 4. Are the optional integrations configured or silently off?
curl -s -X POST https://swiftcard.me/api/logo-suggest -H 'content-type: application/json' \
  -d '{"input":"stripe.com"}' | head -c 200; echo
curl -s -X POST https://swiftcard.me/api/scanner -H 'content-type: application/json' -d '{}' | head -c 120; echo
curl -s -o /dev/null -w 'wallet          %{http_code}\n' 'https://swiftcard.me/api/wallet/pass?card=<live-slug>'
```

**Expected today:** `200 / 400 / 400 / 401 / 403 / 403 / 403`. `stripe_events` should show rows from **2026-07-29 18:53 UTC** (`checkout.session.completed` + `invoice.payment_succeeded`) — that pair is the *only* proof the live webhook is being delivered and verified. `logo-suggest` → `{"status":"ok",…}`. `scanner` → `{"error":"no_ai"}` (no AI key in prod — known). `wallet` → `501` (Apple Wallet not configured in prod — known, not a regression).

**The one deviation that means "stop and investigate":** Twilio returning **503** instead of **403**. 403 means `TWILIO_AUTH_TOKEN` is present and the signature was rejected. 503 means the token is *missing in production* (`src/app/api/twilio/inbound/route.ts:43`), which means every legitimate STOP and every delivery-status callback from Twilio is also being dropped. Same-looking response, opposite meaning.

---

## Inventory

Status column is from the live read-only probe (2026-07-29 ~19:30 UTC) plus the env-gap audit.

| Integration | What it does | Testable locally? | Cost/risk to test | Current status |
|---|---|---|---|---|
| **Stripe** (checkout, subs, seats, promos, webhook) | All revenue. Provisions `profiles.plan` from webhook events | Yes — offline unit (signed events, zero creds) + full e2e with `stripe listen` in test mode | Unit: none. E2E: test-mode objects, $0 | **Live and working.** New live sub `sub_1Tycb8…` created 18:52:55 UTC; matching `stripe_events` rows at 18:53:00; `profiles.plan='pro'`. Account = `acct_1TlGkfE81bCYGRbV`, live mode |
| **Supabase** (auth, RLS, service-role) | Every read/write; tenant isolation is 100% app-layer | Auth callback + proxy: yes (mocked). RLS: only against a real DB | Read-only advisors are free | `grxmovpmlgmjncnyiyrt`, ACTIVE_HEALTHY, 25 tables, **RLS on all 25**. 18 tables have RLS with **zero policies** (deny-by-default). Leaked-password protection **disabled** |
| **Resend** (email) | Every lead-facing email, welcome, broadcast, sequence steps | Yes — unit with a mocked `resend` module | Unit: none. E2E: ~$0.0004/email | Configured in prod. **Send result is discarded** (`src/lib/messaging.ts:224-238`) — see Traps |
| **Twilio SMS** (outbound) | Follow-up SMS fallback | Partially — magic test credentials work, $0 | $0 with test creds | **Half-wired locally**: `.env.local` has `TWILIO_AUTH_TOKEN` but **not** `TWILIO_ACCOUNT_SID`, so outbound short-circuits to `not_configured` (`src/lib/messaging.ts:180-181`) |
| **Twilio webhooks** (inbound STOP / status) | TCPA opt-out; corrects "delivered" lies in the thread | Yes — HMAC-SHA1 signature is reproducible offline in 3 lines | None | Prod returns 403 on unsigned → token present and working |
| **Web push (VAPID)** | Browser notifications for new leads | Yes (mocked). Real delivery needs a public URL | None | **Total no-op in prod.** `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` absent from every Vercel env → guard at `src/lib/push.ts:53` skips silently |
| **Apple APNs** | Native iOS push | Yes — a throwaway P-256 key proves the JWT cryptographically, offline | None | **Not configured** anywhere. All four `APPLE_PUSH_*` absent from Vercel |
| **Apple Wallet** | "Add to Wallet" pass | Only with real certs; signing is fully local (no Apple API) | None (handle PEMs as secrets) | **Off.** Prod returns `501 not_configured`. All five vars required by `src/lib/wallet-config.ts:13-20` absent |
| **HubSpot CRM** | Contact sync on lead capture | Yes — free test portal, instant, no card | Free test portal only | Untested end-to-end. Connect route has **zero** coverage |
| **Google Contacts** | Contact sync on lead capture | Only with a real Google Cloud project + People API enabled | Writes a real contact to a real Google account | Blocked locally: `OAUTH_SECRET` unset → `src/lib/token-crypto.ts` throws |
| **Zapier webhook** | Fire lead/view events to a Catch Hook | Only with a real `hooks.zapier.com` URL (allowlist rejects webhook.site, ngrok, localhost) | Free Zapier tasks | **No `sync_error` field exists for Zapier at all** — a dead Zap is invisible forever |
| **LinkedIn** | Photo import | Yes — kill-switch + state HMAC are pure | None | Intentionally off (`LINKEDIN_CLIENT_*` unset) → routes 501 |
| **Upstash / Vercel KV** | Rate limiting across lambdas | Yes — mocked; live check needs a Redis `SCAN` | ~12 counter keys | Configured locally and reachable (`/ping` → PONG). **Zero `sc-rl` keys currently in the DB** — could mean no traffic, or the fallback |
| **AI providers** | Follow-up drafts, help chat, card scan | Yes (fetch stubbed) | None | **None configured in prod.** `/api/scanner` → `{"error":"no_ai"}`. All AI paths on templates |
| **PostHog** | Funnel analytics | Yes (mocked) | Free tier | **Inert.** `NEXT_PUBLIC_POSTHOG_KEY` unset everywhere → `posthog-js` never imported (`src/lib/events.ts:96-102`) |
| **logo.dev** | Company logo suggestions | Yes; token is set locally | 1 free-quota call per test | Working in prod (`status:"ok"`) |
| **Vercel cron** | `/api/reminders` daily at `0 13 * * *` (`vercel.json`) | Auth boundary yes; the run itself writes to **prod** | Positive-path run sends real mail/SMS and **permanently purges accounts** | Auth boundary correct (`src/app/api/reminders/route.ts:77-81`). Whether the daily run *succeeds* is unverified |

---

## Tier 1 — Free, offline, right now

### What the 708 existing tests actually cover

| File | What it really asserts |
|---|---|
| `tests/integrations-error-surfacing.test.ts` | Static scan: does `sync-hubspot.ts` / `sync-google.ts` source text still *contain* `setSyncError(...)`. Uses `readFileSync` + brace-matching |
| `tests/linkedin-oauth.test.ts` | **Genuinely executing.** `signState` / `verifyState` HMAC round-trip and forgery |
| `tests/safe-fetch.test.ts` | **Genuinely executing.** SSRF allowlist / private-IP rejection (pure functions) |
| `tests/logo-provider.test.ts` | 19 pure tests on parsing/normalization. **Zero** on `LogoDevProvider.suggest()` |
| `tests/email-deliverability.test.ts:9-15` | Feeds `marketingHeaders()` a **hardcoded** `https://swiftcard.me/unsubscribe?token=abc` and checks it's wrapped in `<>`. It never calls `unsubUrl()`, so it cannot see that the URL points at a dead page route |
| `tests/native-capabilities.test.ts:35` | A source regex: `/result === "gone"[\s\S]*?delete\(\)\.eq\("endpoint", sub\.endpoint\)/`. Green if the code was *typed*, regardless of whether it runs |
| `tests/plan-check-single-source.test.ts`, `tests/plan-gate*.ts`, `tests/office-*.ts` | Pure plan/seat/role logic. Solid, and genuinely useful |
| `tests/ios-final-audit.test.ts` | Static audit of native suppression + a grep for the string `isRateLimited` |

### Integrations with literally ZERO coverage

`src/proxy.ts` (the auth boundary) · `src/app/auth/callback/route.ts` · `src/lib/rate-limit.ts` · `src/lib/client-ip.ts` · `src/lib/events.ts` (PostHog) · `src/lib/ai.ts` · `src/lib/wallet-config.ts` · `src/lib/crm-events.ts` (`dispatchCrmEvent`) · `src/app/api/settings/zapier/route.ts` · `src/app/api/integrations/hubspot/token/route.ts` · `src/app/api/stripe/**` (every route) · `src/lib/messaging.ts` (every function) · `src/lib/apns.ts` · `src/lib/push.ts` · `src/lib/stripe-idempotency.ts`.

### The 12 new tests worth writing, ranked by what they'd catch

Everything below needs no credentials and no network. `vitest.config.ts` already aliases `@ → ./src` and sets `environment: "node"`, so `await import("@/app/api/…/route")` works today.

---

**1. Resend result is discarded — the highest-blast-radius bug in the repo** *(new: `tests/messaging-send-outcome.test.ts`)*

`src/lib/messaging.ts:224-238` and `:388-401` both do `await resend.emails.send({...}); return "sent";` with a bare `catch { return "failed" }`. **Resend v6 never throws** — it resolves `{ data, error }` even for network failures. So the catch is dead code and every rejection reports `"sent"`.

```ts
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));
send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "domain not verified" } });
expect(await sendRawEmail({ to: "x@e.com", subject: "s", html: "<p>h</p>" })).toBe("failed");
```

**Fails RED today** with `expected 'sent' to be 'failed'`. That red is the point. Fix is one line at each site: `const { error } = await resend.emails.send(...); if (error) return "failed";`

**Do not** write it as `send.mockRejectedValue(new Error(...))` — that passes green today and certifies the bug as fixed.

---

**2. Failed sends must not be logged into the lead thread as delivered** *(new: `tests/messaging-delivery.test.ts`)*

`deliverToLead` writes a `lead_messages` row only when `status === "sent"`. Given #1, a rejected email produces a thread row that says Sent.

```ts
expect(r.status).toBe("failed");
expect(logged).toHaveLength(0);   // assert the CAPTURED insert array, not the return value
```

---

**3. Stripe webhook: fails closed, and releases the dedup marker on handler failure** *(new: `tests/stripe-webhook-route.test.ts`)*

`stripe@22.2.2` can generate a real signature offline with a fake secret, so `constructEvent` runs for real. Three cases:

- no `stripe-signature` header → 400, and `isDuplicateStripeEvent` never called (`src/app/api/stripe/webhook/route.ts:125`)
- signature from the *wrong* secret → 400 (the rotated-secret failure mode, `:129-132`)
- handler throws → **500** *and* `clearStripeEvent(event.id)` called (`:587-592`)

That third assertion is load-bearing. `src/lib/stripe-idempotency.ts` INSERTs the marker *before* the handler runs; if the handler fails and the marker isn't released, Stripe's retry sees a duplicate and the event is lost forever — a paid customer never provisioned. Mock only `@/lib/stripe-idempotency`, `@/lib/supabase-admin`, `@/lib/report-error`. **Never** mock `@/lib/stripe` — that kills `webhooks.constructEvent` and makes every signature test pass vacuously.

---

**4. Checkout: the client cannot choose the price** *(new: `tests/stripe-checkout-route.test.ts`)*

`EXPECTED_CENTS` is built at **module load** from env (`src/app/api/stripe/checkout/route.ts:28-33`), so set env at file top-level, never in `beforeEach`.

- crafted `priceId` outside the allow-list → 400 `{error:"Unknown plan price."}` (`:145`)
- live Stripe `unit_amount` ≠ `PLAN_PRICES` → 409 (`:204`)
- already-subscribed → 409 `already_subscribed` (`:62`)
- `idempotencyKey` matches `/^checkout:u1:price_pro_m:1:\d+$/` (`:265`)

**Pair every status assertion with `expect(created).toEqual([])`.** The route 500s on any internal throw, so a broken mock produces a non-200 for the wrong reason and the whole "rejects…" suite passes green while never reaching the allow-list.

---

**5. A failed Stripe cancel must block the plan change** *(new: `tests/stripe-cancel-failclosed.test.ts`)*

Verified this session:

```
src/app/api/account/downgrade/route.ts:33-37   → catch { console.error; return 502 }   ✅
src/app/api/account/delete/route.ts:42-45      → catch { /* ignore */ }                ❌
```

Three routes fail closed. `/api/account/delete` soft-deletes the account and keeps billing the card, with no UI left to cancel from. A static scan asserting `status: 502` in the catch block adjacent to `subscriptions.cancel` goes green on three and **RED on delete** — that red converts a prose finding into a build breaker.

---

**6. APNs provider token, verified cryptographically** *(new: `tests/apns-provider-token.test.ts`)*

Generate a throwaway P-256 key in the test, stub `node:http2`, and verify the JWT with `crypto.verify(..., { dsaEncoding: "ieee-p1363" })`. Assert the signature is exactly **64 bytes** and the token contains no `+/=`. This is the only offline way to distinguish "APNs configured correctly" from "APNs 403s InvalidProviderToken forever" — because `src/lib/apns.ts:118` collapses 403 to `"error"`, `push.ts` discards it via `Promise.allSettled`, and every caller re-discards with `.catch(() => {})`.

Plus the regression guard that fails RED today:

```ts
statusRef.value = 400;   // BadTopic from a wrong APPLE_PUSH_TOPIC is SYSTEMIC
expect(await sendApnsNotification("apns:tok", {...})).toBe("error");
```

`src/lib/apns.ts:117` reads `if (status === 410 || status === 400) return done("gone")` — and `src/lib/push.ts:45-46` deletes the row on `"gone"`. One misconfigured topic mass-deletes **every** iOS device token on the platform.

---

**7. Rate limiter is actually Redis-backed** *(new: `tests/rate-limit.test.ts`)*

`src/lib/rate-limit.ts:41-42` accepts either `UPSTASH_REDIS_REST_*` **or** `KV_REST_API_*`. Assert the mocked `Ratelimit.limit()` spy was called when `KV_REST_API_*` is set. A test that only checks "4th call returns true" passes identically against the weak per-instance fallback.

Delete `KV_*` in `beforeEach` or your shell env silently makes the "in-memory" test hit the network.

---

**8. `x-forwarded-for[0]` must never win** *(new: `tests/client-ip.test.ts`)*

`src/lib/client-ip.ts:15-24` trusts `x-real-ip`, then the **last** XFF hop. Test the two-hop spoof case (`"attacker-1, 9.9.9.9"` → `9.9.9.9`). A single-hop test returns the same value under both the correct and the broken implementation.

---

**9. The auth boundary** *(new: `tests/proxy-auth.test.ts`)*

`src/proxy.ts:41` gates `["/dashboard","/onboarding","/profile","/cards","/settings","/office","/contacts"]`; `:77` is the Next matcher. Assert **both**, and assert they agree — a path removed from the matcher but left in `protectedPaths` is publicly reachable while the test passes. Also assert the soft-delete bounce (`:67-69`) sends a `_deleted` profile to `/account-deleted`.

Assert the **location header**, not the status. `NextResponse.next()` is 200, so status alone passes even when the redirect goes somewhere wrong.

---

**10. OAuth callback fails closed** *(new: `tests/auth-callback.test.ts`)*

The single assertion that matters:

```ts
exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid grant" } });
const res = await GET(req);
expect(res.headers.get("location")).toBe("https://swiftcard.me/login?error=oauth");
expect(getUser).not.toHaveBeenCalled();   // ← THE guard
```

A regressed version that calls `getUser()` first and *then* redirects produces the identical location while silently resuming a previous user's session from a stale cookie.

---

**11. Cron auth, negative paths only** *(new: `tests/cron-auth.test.ts`)*

`src/app/api/reminders/route.ts:77-81`. Test: no header → 401; `Bearer undefined` with `CRON_SECRET` **deleted** → 401; wrong secret → 401; missing `Bearer` prefix → 401.

**Never add a positive-path test.** A valid-secret call runs `purgeExpiredDeletedAccounts` and the whole send loop against the **production** Supabase project. There is no test DB.

---

**12. Admin MRR cannot drift from `PLAN_PRICES`** *(new: `tests/analytics-mrr.test.ts`)*

`src/app/api/admin/analytics/route.ts:8-9` hardcodes `PRO_PRICE = 4.99` / `OFFICE_PRICE = 3.99` in dollars, duplicated from `src/lib/plan.ts:26,28` in cents. Pin them. Then assert the reducer at `:72-78`:

```ts
sum + (a.plan === "enterprise" ? OFFICE_PRICE : PRO_PRICE)
```

No `seats`, no `quantity`, no `interval`. A 20-seat Office account counts as $3.99/mo, and an annual subscriber counts at the monthly rate. Two RED tests here turn "MRR is structurally wrong" into something someone must fix or explicitly skip with a reason.

**Also worth adding:** a service-role guard lint. 85 route files call `getAdminSupabase()` (which bypasses RLS entirely); exactly 9 have no auth marker, all intentionally public. Walk `src/app/api`, filter for `getAdminSupabase` without `/getUser|requireAdmin|CRON_SECRET|constructEvent|validateRequest/`, and allow-list those 9. It goes RED the day someone ships a new service-role route with no caller check.

---

## Tier 2 — Local end-to-end with sandbox credentials

### Prerequisite: fix the local env, carefully

```bash
cd /Users/menashharooni/Desktop/relationship-app
cp .env.local /tmp/.env.local.bak        # vercel env pull OVERWRITES, it does not merge
```

`.env.local` currently holds **14** names (confirmed this session, values never read):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL`, `LOGO_DEV_TOKEN`, `VERCEL_OIDC_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_AUTH_TOKEN`.

Vercel's **Development** scope has only 9 vars; **Production** has 37. `vercel env pull` without `--environment=production` gives you the 9 and destroys the four hand-restored keys. That has already happened once — the file header says so.

Two additions unblock most of Tier 2:

```bash
printf '\nOAUTH_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env.local
printf 'NEXT_PUBLIC_APP_URL=http://localhost:3000\n' >> .env.local
```

`OAUTH_SECRET` is the **only hard-throw in the codebase** (`src/lib/token-crypto.ts`, `src/lib/oauth-state.ts`) and blocks all three CRM connects. `NEXT_PUBLIC_APP_URL` has a `|| "https://swiftcard.me"` fallback in **all 10** prerender-critical sites, so leaving it unset silently points local OAuth redirects, Twilio callbacks, email links and wallet passes at **production**.

---

### Stripe — full checkout → webhook → DB

```bash
brew install stripe/stripe-cli/stripe
stripe login

# Terminal A — capture the whsec_ it prints and put it in .env.local
stripe listen --forward-to localhost:3000/api/stripe/webhook \
  --events checkout.session.completed,invoice.payment_succeeded,invoice.payment_failed,customer.subscription.updated,customer.subscription.deleted

# Terminal B
npm run dev

# Terminal C — a REAL checkout, not `stripe trigger`
open 'http://localhost:3000/checkout?plan=pro&interval=monthly'   # card 4242 4242 4242 4242
```

**Pass signal — all four, not any one:**
1. Terminal A prints `checkout.session.completed [evt_…] -> 200`
2. `profiles.plan='pro'` **with** a non-null `stripe_subscription_id`
3. A matching row appears in `public.stripe_events`
4. `stripe events resend evt_…` → 200 `{"received":true,"duplicate":true}` and the profile is **not** written twice

You need test-mode Products at the `PLAN_PRICES` amounts — test and live catalogs are separate objects. Point `SUPABASE_*` at a **branch**, not prod.

---

### Stripe — proving the dead-webhook failure mode

```bash
sed -i '' 's/^STRIPE_WEBHOOK_SECRET=.*/STRIPE_WEBHOOK_SECRET=whsec_wrong_on_purpose/' .env.local
npm run dev 2>&1 | tee /tmp/swiftcard-dev.log
stripe trigger customer.subscription.updated
grep -c '\[error\]' /tmp/swiftcard-dev.log            # expect 0 — that zero IS the finding
grep -c 'No signatures found matching' /tmp/swiftcard-dev.log   # expect > 0
```

`src/app/api/stripe/webhook/route.ts:130-132` returns 400 **without calling `reportError`**. A rotated secret kills all billing with zero alerting. The remediation is a `reportError` on that branch; after adding it the same run must produce a non-zero count.

---

### Twilio — outbound with magic test credentials ($0)

A2P 10DLC is irrelevant here; test credentials bypass the carrier entirely.

```bash
cat > /tmp/twilio-test.env <<'EOF'
TWILIO_ACCOUNT_SID=<TEST_ACCOUNT_SID_AC...>
TWILIO_AUTH_TOKEN=<TEST_AUTH_TOKEN>
TWILIO_PHONE_NUMBER=+15005550006
EOF
set -a && . ./.env.local && . /tmp/twilio-test.env && unset TWILIO_MESSAGING_SERVICE_SID && set +a && npm run dev
```

**You must unset `TWILIO_MESSAGING_SERVICE_SID`.** `src/lib/messaging.ts:197-199` prefers `messagingServiceSid` over `from`, and test credentials reject a messaging service — you'd get a 502 that looks like a code bug.

Magic numbers: `to +15005550001` → invalid (21211); `+15005550009` → cannot receive SMS. **Pass signal:** success case returns 200 *and* the `lead_messages` row's `provider_sid` starts with `SM` — without that SID captured, the status callback can never correct the row.

---

### Twilio — inbound webhook signature, offline signer

The signature is `base64(HMAC-SHA1(url + concat(sorted k+v), authToken))` — three lines, no SDK:

```bash
cat > /tmp/tw-sign.mjs <<'EOF'
import { createHmac } from "node:crypto";
const [,, url, ...kv] = process.argv;
const p = Object.fromEntries(kv.map(s => { const i = s.indexOf("="); return [s.slice(0,i), s.slice(i+1)]; }));
const data = Object.keys(p).sort().reduce((a,k) => a + k + p[k], url);
process.stdout.write(createHmac("sha1", process.env.TWILIO_AUTH_TOKEN).update(Buffer.from(data,"utf8")).digest("base64"));
EOF

curl -s -o /dev/null -w 'unsigned=%{http_code}\n' -X POST http://localhost:3000/api/twilio/inbound -d 'From=%2B15550001111' -d 'Body=STOP'

SIG=$(node /tmp/tw-sign.mjs 'https://localhost:3000/api/twilio/inbound' 'From=+15550001111' 'Body=STOP')
curl -s -i -X POST http://localhost:3000/api/twilio/inbound -H "x-twilio-signature: $SIG" -H 'host: localhost:3000' \
  --data-urlencode 'From=+15550001111' --data-urlencode 'Body=STOP'
```

Sign with the **`https://`** scheme — `src/app/api/twilio/inbound/route.ts:46` rebuilds the URL as `https://<host>`. Signing `http://` gives a 403 and you'll wrongly conclude the endpoint is broken.

**Pass:** `unsigned=403`, signed=200 with `<Response></Response>`, and exactly one `message_opt_outs` row `{"channel":"sms","contact":"5550001111"}` — the normalized last-10-digit form, which is what makes a STOP from any formatting of that number stick.

**Never set `TWILIO_SKIP_VALIDATION=true` to make this pass.** It short-circuits the entire signature branch (`inbound/route.ts:39`), and you'd green-light a webhook where anyone can POST `Body=STOP` for arbitrary numbers.

---

### Resend — reproducing the silent false-success against the real API

> **The old recipe no longer works.** It forced a rejection by overriding
> `RESEND_FROM_EMAIL`, and no send site reads that variable any more — every
> address comes from `src/lib/email-senders.ts`, which reads no environment at
> all. Setting it now changes nothing, the send SUCCEEDS, and you would read
> that as "the error-propagation fix regressed" when it has not.
>
> To force a rejection, temporarily point `DOMAIN` in `src/lib/email-senders.ts`
> at an unverified domain (revert before committing — a test pins the real one).

```bash
# edit src/lib/email-senders.ts: const DOMAIN = "definitely-not-verified.test"
npm run dev
curl -s -i -X POST http://localhost:3000/api/leads/<LEAD_ID>/message \
  -H 'Content-Type: application/json' -b cookies.txt -d '{"message":"probe","channel":"email"}'
```

Then compare three observables: (A) the HTTP status, (B) the **Resend dashboard** at https://resend.com/emails, (C) your inbox.

**Before the fix:** A = 200, the thread row says `sent`, B shows a rejection, C is empty. **After the one-line fix:** A = 502 `{"error":"failed"}` and no `lead_messages` row. That inversion is the pass signal.

If `RESEND_API_KEY` is unset, `sendRawEmail` returns `not_configured` at `src/lib/messaging.ts:221` and you never reach the send — a misleadingly clean result.

---

### HubSpot — free test portal, 45 minutes

Create a test account at app.hubspot.com/developers, a Private App with `crm.objects.contacts.write`, paste the token at `/settings/flows`. Then:

```bash
curl -sS -X POST http://localhost:3000/api/leads -H 'Content-Type: application/json' \
  -d '{"name":"Recipe Tester","phone":"555-0100","email":"recipe+1@example.com","card_owner":"<your-slug>"}'
# repeat VERBATIM with phone 555-0199 to exercise the 409 → PATCH duplicate path
```

**Pass:** the *same* contact's phone reads 555-0199 — one contact, updated. A second contact means the PATCH at `src/lib/sync-hubspot.ts:50-53` silently failed.

**Then run the scope-trap variant.** Create a second Private App **without** write scope. `/api/integrations/hubspot/token` validates against `account-info/v3/details`, which needs no scopes — so a write-less token connects with a green "Connected" badge. Capture a lead, wait ~2s (the sync is deliberately not awaited), reload: the badge must flip amber with "HubSpot refused the last contact (403) — reconnect HubSpot and allow contact access."

The test user must be **pro/enterprise** or `src/app/api/leads/route.ts:225` short-circuits, the lead saves fine, curl returns 200, and nothing syncs at all.

---

### Zapier — only a real hook works

`isZapierWebhookUrl` (`src/lib/safe-fetch.ts:91`) rejects webhook.site, requestbin, ngrok and localhost by design. Use a real `hooks.zapier.com` Catch Hook. **Pass:** three distinct records in Zapier's *task history* — `_test:true`, `lead.created`, `view.card` — and after toggling views off, no fourth.

---

### Reminders cron — the mandatory pre-flight

This route writes to **production Supabase**. Abort unless both return `[]`:

```bash
set -a; . ./.env.local; set +a
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/profiles?select=id&customization->>_deleted=eq.true" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/leads?select=id&limit=5" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

Then `CRON_SECRET=localtest npm run dev` and `curl -H 'Authorization: Bearer localtest' http://localhost:3000/api/reminders`.

**Pass:** 200 with all five keys — `{"sent":0,"checkedHour":<0-23>,"downgraded":0,"purged":0,"seatReductionsApplied":0}`. The presence of `checkedHour` proves the handler ran past the auth gate; `sent:0` alone is ambiguous.

---

## Tier 3 — Preview deployment

Things localhost cannot prove:

| What | Why localhost can't do it |
|---|---|
| **Google OAuth redirect URI** | The registered URI must match exactly; verifying the real consent screen (including that the *granular contacts checkbox* was ticked) requires the deployed origin |
| **Web push (VAPID)** | FCM/Mozilla push services must reach a public endpoint. Also the only way to prove the 404/410 prune at `src/lib/push.ts:68-69` executes |
| **Apple Wallet on device** | A 200 with a non-zero body is not a valid pass. Only iOS opening the `.pkpass` proves it |
| **iOS shell / AASA** | Universal Links resolve against the deployed domain's `apple-app-site-association` |
| **Twilio status callback behind a proxy** | `src/app/api/twilio/status/route.ts:39` rebuilds the signed URL from `x-forwarded-host`. That code path only exists behind Vercel |
| **Stripe portal live configuration** | Test-mode and live-mode portal configurations are separate objects |
| **Preview env scoping** | Whether `STRIPE_*` really resolves to test mode in a deployed context |

```bash
cd /Users/menashharooni/Desktop/relationship-app
vercel --yes                     # capture the preview URL
export PREVIEW=https://<preview>.vercel.app

for K in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID \
         NEXT_PUBLIC_STRIPE_ANNUAL_PRICE_ID NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID \
         NEXT_PUBLIC_STRIPE_ENTERPRISE_ANNUAL_PRICE_ID NEXT_PUBLIC_APP_URL CRON_SECRET; do
  vercel env add $K preview
done
vercel --yes --force             # NEXT_PUBLIC_* are inlined at BUILD time — redeploy is mandatory
vercel env ls preview            # verify each key exists with a Preview scope

stripe webhook_endpoints create --url "$PREVIEW/api/stripe/webhook" \
  --enabled-events checkout.session.completed --enabled-events invoice.payment_succeeded \
  --enabled-events invoice.payment_failed --enabled-events customer.subscription.updated \
  --enabled-events customer.subscription.deleted | jq '{id, status}'

curl -s -o /dev/null -w 'fails closed %{http_code}\n' -X POST "$PREVIEW/api/stripe/webhook" \
  -H 'stripe-signature: t=1,v1=deadbeef' -d '{}'      # 400 before any real traffic
```

**Deployment protection is the trap here.** The live probe confirmed Vercel SSO protection is **ON** with `deploymentType: all_except_custom_domains` — both `.vercel.app` aliases return 302 to an auth wall while `swiftcard.me` returns 200. That is the correct shape, but it means Stripe's delivery attempts get a 307/401 from Vercel, not from your app, and the Dashboard renders it as a failed delivery. Use a protection-bypass token scoped to the preview. **Do not** disable protection project-wide — that includes production.

Sanity check for "am I measuring Vercel or the app?": if `$PREVIEW/login` itself returns 401, you are measuring the protection wall.

Also: preview deployments share the **production** Supabase project and the **production** Upstash DB unless you explicitly repoint them. Check `NEXT_PUBLIC_SUPABASE_URL` for the preview before running anything that sends.

---

## Tier 4 — Production smoke tests

### Safe — run these any time

```bash
# Route liveness + fail-closed (all rejected before any handler runs)
curl -s -o /dev/null -w 'webhook  %{http_code}\n' -X POST https://swiftcard.me/api/stripe/webhook -H 'stripe-signature: t=1,v1=deadbeef' -d '{}'
curl -s -o /dev/null -w 'cron     %{http_code}\n' https://swiftcard.me/api/reminders
curl -s -o /dev/null -w 'tw-in    %{http_code}\n' -X POST https://swiftcard.me/api/twilio/inbound -d 'From=%2B15551234567' -d 'Body=STOP'
curl -s -o /dev/null -w 'cards    %{http_code}\n' https://swiftcard.me/api/cards            # 401
curl -s -o /dev/null -w 'admin    %{http_code}\n' https://swiftcard.me/api/admin/users      # 403

# Dedup table EXISTS (200 vs 404, not row count) + recent real traffic
set -a; . /Users/menashharooni/Desktop/relationship-app/.env.local; set +a
curl -s -o /dev/null -w 'stripe_events %{http_code}\n' "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/stripe_events?select=event_id&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

# Env presence — NAMES ONLY, never values
cd /Users/menashharooni/Desktop/relationship-app
vercel env ls production | awk '{print $1}' | grep -E 'STRIPE|RESEND|TWILIO|CRON_SECRET|OAUTH_SECRET|VAPID|APPLE_PUSH|ALERT_WEBHOOK_URL|POSTHOG' | sort

# Stripe↔DB drift, with a RESTRICTED READ-ONLY key (Dashboard → API keys → Restricted)
curl -s 'https://api.stripe.com/v1/subscriptions?status=all&limit=100' -u "$STRIPE_RO_KEY:" \
  | jq -r '.data[] | [.id,.status,.customer,.items.data[0].price.id,(.items.data[0].quantity|tostring)] | @tsv' | sort > /tmp/stripe-subs.tsv
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/profiles?select=id,plan,stripe_customer_id,stripe_subscription_id&or=(plan.eq.pro,plan.eq.enterprise,stripe_subscription_id.not.is.null)" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | jq -r '.[] | [.id,.plan,(.stripe_subscription_id // "-")] | @tsv' | sort > /tmp/db-paid.tsv
wc -l /tmp/stripe-subs.tsv /tmp/db-paid.tsv       # require a non-zero denominator FIRST
cut -f1 /tmp/stripe-subs.tsv | while read S; do grep -q "$S" /tmp/db-paid.tsv || echo "STRIPE-ONLY: $S"; done
```

Read-only SQL in the Supabase editor:

```sql
select provider, count(*) from public.integrations where sync_error is not null group by 1;
select indexname from pg_indexes where schemaname='public' and tablename='integrations';
select user_id, provider, count(*) from public.integrations group by 1,2 having count(*) > 1;
select p.email, p.plan, i.provider from public.integrations i
  join public.profiles p on p.id = i.user_id where p.plan not in ('pro','enterprise');
```

Plus `get_advisors(project_id: "grxmovpmlgmjncnyiyrt", type: "security")` via the Supabase MCP.

### NOT safe in production

- **`/api/reminders` with the real `CRON_SECRET`.** Sends real email and SMS, downgrades plans, cancels Stripe grace periods, and **permanently purges** soft-deleted accounts. Read the cron log; never invoke it.
- **`/api/admin/promo-codes` POST.** Creates real live-mode coupons and promotion codes.
- **`/api/integrations/hubspot/token` with a session cookie.** For an authenticated paid user this makes a real outbound call to `api.hubapi.com`.
- **The Stripe billing portal against a live customer.** If `subscription_update` is enabled, reducing quantity fires `customer.subscription.updated`, and the webhook's seat-trim loop **hard-DELETEs** `office_members` rows.
- **Any Twilio send.** Costs money and, per the compliance state, would be dropped by carriers anyway.
- **`vercel env pull` into `.env.local` without a backup.** It overwrites; it does not merge.
- **Rotating `OAUTH_SECRET` in production.** Every stored OAuth token becomes undecryptable for the whole account base, and — see Traps — it reports nothing.

---

## The traps

The most valuable section. Each is a place where a green test or a 200 response coexists with a broken integration.

---

### 1. Resend reports success it cannot have

`src/lib/messaging.ts:224-238` (and `:388-401`) discard the SDK's return value. Resend v6 resolves `{data, error}` for **every** failure including DNS and network — it never throws — so the `catch` at `:237` is unreachable and every rejection returns `"sent"`.

Downstream, three observables **agree with each other and are all wrong**: the HTTP 200, the `lead_messages` thread row, and the UI. They are three views of the same discarded value. Two agreeing signals sharing a broken source are one signal. Only the Resend dashboard and an actual inbox are independent.

Worst consequence: `src/app/api/reminders/route.ts` stamps `sent_at` on a sequence step whenever `r.status === "sent"`. The retry gate is written **correctly** — it's being fed a lie. Reading the consumer and concluding "retries are safe" is exactly how this survived.

---

### 2. `stripe trigger` is the most seductive false green in the billing domain

`stripe trigger checkout.session.completed` returns 200. The fixture has **no `client_reference_id`**, so `src/app/api/stripe/webhook/route.ts:149` reads `undefined`, the entire provisioning block is skipped, and the handler returns a cheerful `{"received":true}` having done nothing. Only a session created by your own `/api/stripe/checkout` carries that field.

---

### 3. A 400 from the production webhook is indistinguishable from total death

`curl -X POST https://swiftcard.me/api/stripe/webhook -H 'stripe-signature: t=1,v1=deadbeef'` → 400. That is *exactly* the response a wrong `STRIPE_WEBHOOK_SECRET` produces for **legitimate Stripe traffic**. You cannot tell "healthy" from "every event rejected for a week" from outside.

Compounding it: `:130-132` returns 400 with **no `reportError`**, so there is no alert. And plan gating reads `profiles.plan` (`src/lib/plan.ts:64`), never Stripe — so a completely dead webhook is invisible from inside the product; users just keep showing as Pro on stale data.

Only two things distinguish them: the Stripe Dashboard delivery log, or a recent row in `public.stripe_events`.

---

### 4. An empty `stripe_events` table is not the same as a missing one

After the 2026-07-28 reset there is legitimately little traffic. **The HTTP 200-vs-404 on the PostgREST probe is the signal, not the row count.** A 404/`PGRST205` means the dedup table was never migrated and `src/lib/stripe-idempotency.ts:31` has been failing open (with an alert, at least) on every delivery.

---

### 5. `subscriptions.cancel` failure is swallowed in exactly one place

`src/app/api/account/delete/route.ts:42-45` is `catch { /* ignore */ }`. The account soft-deletes, the card keeps being charged, and the user has no UI left to cancel from. The three sibling routes return 502. A test that extracts "the catch block near `subscriptions.cancel`" can easily match a *different* nearby try/catch in `delete/route.ts` and go green — print the extracted body once, and confirm by deliberately deleting the `status: 502` from `downgrade/route.ts:37` and watching that test go red.

---

### 6. `/api/account/retain` always says it worked

`src/app/api/account/retain/route.ts:46` swallows the Stripe error and `:51` returns `{ok: true}` regardless. If `STRIPE_RETENTION_COUPON_ID` is unset (`:31`), the branch is skipped entirely — still `ok: true`. The user is told they got a free month they did not get.

---

### 7. The MRR number on the admin dashboard is structurally wrong

`src/app/api/admin/analytics/route.ts:72-78`:

```js
subscribed.reduce((sum, a) => sum + (a.plan === "enterprise" ? OFFICE_PRICE : PRO_PRICE), 0)
```

No seat count, no billing interval. A 20-seat Office account contributes $3.99/mo. An annual subscriber contributes the monthly rate. And `PRO_PRICE`/`OFFICE_PRICE` at `:8-9` are hand-copied dollars, duplicated from `src/lib/plan.ts:26,28` in cents — changing a price in `plan.ts` silently leaves the dashboard on the old one.

---

### 8. A rotated `OAUTH_SECRET` breaks every CRM sync and reports **nothing**

`src/lib/crm-connection.ts:80` calls `decryptToken(data.access_token)` with **no try/catch**. The throw propagates out of `getCrmConnection`, is swallowed by `.catch(console.error)` at `src/app/api/leads/route.ts:227`, and **no `sync_error` row is ever written**. Settings shows a green "Connected" badge forever.

This makes the production drift query at Tier 4 dangerous to read optimistically: *"zero rows with `sync_error`"* means *"nothing that can report has reported."* It is the exact shape of a healthy system and of a totally dead one. The memory note about a Google secret rotated in Supabase but stale in Vercel is precisely this class of drift.

---

### 9. `tests/integrations-error-surfacing.test.ts` has a hole you can drive through

Verified this session: `src/lib/sync-hubspot.ts` calls `setSyncError(...connectionErrorMessage(...))` at **`:59`** (the 409→PATCH duplicate branch) and again at **`:71`** (the create branch). The existing regex matches the **first** occurrence. Delete the one at `:59` and the suite stays **9/9 green** while the duplicate-contact failure path reports nothing.

Prove it, then restore — **this directory is not a git repo, so `git checkout` will not save you**:

```bash
cd /Users/menashharooni/Desktop/relationship-app
cp src/lib/sync-hubspot.ts /tmp/sync-hubspot.orig.ts
perl -0pi -e 's/await setSyncError\("hubspot", userId, connectionErrorMessage\(LABEL, updateRes\.status\)\);/\/* MUTANT *\/;/' src/lib/sync-hubspot.ts
npx vitest run tests/integrations-error-surfacing.test.ts   # still 9 passed ← the false green
cp /tmp/sync-hubspot.orig.ts src/lib/sync-hubspot.ts
diff /tmp/sync-hubspot.orig.ts src/lib/sync-hubspot.ts && echo RESTORED
```

---

### 10. The account-holder unsubscribe link is a dead end, and the test that "covers" it can't see that

Verified this session:
- `src/lib/email-templates.ts:292-294` → `return \`${APP_URL}/unsubscribe?token=${token}\``
- `src/app/unsubscribe/` contains `page.tsx` + `UnsubscribeContent.tsx` — **no `route.ts`**
- `src/app/api/unsubscribe/route.ts:5,20` exports both `GET` and `POST` — the handler that actually works
- No rewrite exists in `next.config.ts` or `src/proxy.ts`

Gmail and Yahoo **POST** the `List-Unsubscribe` URL directly (RFC 8058 one-click). A POST to a Next page route returns **405**, which providers count as a broken unsubscribe and a spam signal.

`tests/email-deliverability.test.ts:9-15` passes because it feeds `marketingHeaders()` a **hardcoded literal string** and checks it comes back wrapped in `<>`. It never calls `unsubUrl()`. And `curl -I https://swiftcard.me/unsubscribe?token=x` returns 200 and renders a plausible confirmation screen — `UnsubscribeContent.tsx:7-9` only reads `?success`/`?error` and mutates nothing. GET-200 is the trap; only the POST status code or an actual `marketing_emails=false` row change is evidence.

The **lead-side** path (`contactUnsubUrl` → `/api/unsubscribe/contact`) is wired correctly. One line fixes the other: change `:293` to `/api/unsubscribe`.

---

### 11. Web push is a complete no-op in production and the UI hides it

`VAPID_PRIVATE_KEY` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` are absent from every Vercel environment, so the guard at `src/lib/push.ts:53` skips the entire browser-push block. Meanwhile:

- `/api/push/subscribe` never checks whether VAPID is configured — users happily register devices into a channel that will never send
- The in-app bell writes to `notifications`, which is completely independent of `lib/push.ts` and lights up either way
- `src/app/api/leads/route.ts:271` calls `sendPushToUser(...).catch(() => {})`, so lead capture returns 200 regardless

Rows in `push_subscriptions` are evidence of *registration*, not delivery. The in-app bell is exactly why this outage has been invisible. Only an OS-level notification counts.

---

### 12. `tests/native-capabilities.test.ts:35` is a source grep, not a test

```js
expect(src).toMatch(/result === "gone"[\s\S]*?delete\(\)\.eq\("endpoint", sub\.endpoint\)/);
```

Stays green if the delete targets the wrong column, if the branch is unreachable, or if VAPID keys are missing so nothing is ever attempted. **Every current push test in this repo is of that kind.**

---

### 13. One wrong APNs topic mass-deletes every iOS device token

`src/lib/apns.ts:117`: `if (status === 410 || status === 400) return done("gone")`. 410 Unregistered is per-device and correct. **400 BadTopic is systemic** — a wrong `APPLE_PUSH_TOPIC` returns 400 for every device, and `src/lib/push.ts:45-46` deletes each row. Before turning APNs on, count the blast radius:

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/push_subscriptions?select=endpoint" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | node -pe 'const r=JSON.parse(require("fs").readFileSync(0)); `apns: ${r.filter(x=>x.endpoint.startsWith("apns:")).length}, web: ${r.filter(x=>!x.endpoint.startsWith("apns:")).length}`'
```

Related: asserting only `expect(jwt.split(".")).toHaveLength(3)` stays green with a DER-encoded signature or base64 padding, both of which Apple answers with 403 InvalidProviderToken — which `apns.ts:118` collapses to `"error"` and every caller discards. The signature must be **cryptographically verified** in the unit test or it is never verified at all.

---

### 14. Rate limiting: 429s prove nothing

`src/lib/rate-limit.ts:76` degrades to the in-memory fallback when Upstash throws, and the fallback produces **byte-identical 429 responses**. Confirmed empirically: the Upstash DB currently holds **zero `sc-rl` keys**. Skip the Redis `SCAN` and you cannot tell a working shared limiter from a silently degraded one:

```bash
set -a; . ./.env.local; set +a
curl -s "$KV_REST_API_URL/scan/0/match/sc-rl*/count/200" -H "Authorization: Bearer $KV_REST_API_READ_ONLY_TOKEN"
```

An empty scan is also ambiguous — sliding-window keys expire with the window. Generate traffic immediately before scanning.

Second trap: local requests without `x-real-ip` all key on the literal string `"unknown"` (`src/lib/client-ip.ts:24`), so "two clients" share one bucket and you'll hit 429 far earlier than expected.

---

### 15. Supabase `200 []` under the anon key proves nothing right now

PostgREST returns `200 []` for an RLS-blocked SELECT — never 403. It also returns `200 []` for an empty table. The prod DB was wiped on 2026-07-28 (`profiles` = 2, `leads` = 1), so **every** anon probe returns `200 []` and the result is uninterpretable. To make it meaningful you must compare an anon count against a service-role count on a table known to be non-empty (`site_pageviews` = 302 is your only candidate).

---

### 16. Zapier: `{ok:true, status:200}` is not delivery

Zapier's Catch Hook returns 200 whether the Zap is on, off, or broken downstream. SwiftCard has **no `sync_error` for Zapier at all** — a dead Zap is invisible forever. Open the Zap's task history.

Separately: `lead.created` fires **inline** at `src/app/api/leads/route.ts:233`, not through `dispatchCrmEvent`, so it ignores the CRM toggles. Seeing a lead arrive with "views" off does not mean the toggles are broken.

---

### 17. A 402 from change-plan can arrive *after* Stripe already swapped the item

If `payment_behavior: 'error_if_incomplete'` (`src/app/api/stripe/subscription/change-plan/route.ts:136`) is ever removed, a declined upgrade produces an identical-looking 402 while Stripe has already changed the subscription item and left an open uncollectable invoice. **The status code is not the signal.** `stripe subscriptions retrieve` showing the OLD price id is.

---

### 18. `/api/reminders` returns 200 even when its sub-jobs silently failed

`src/lib/office-scheduled-seats.ts:57` is `catch { continue }`. Purge and seat-reduction failures go through `reportError` and the run still returns 200 — and `ALERT_WEBHOOK_URL` is absent from Vercel, so nothing is notified. The only proof a seat reduction applied is `stripe subscriptions retrieve` showing the new quantity.

---

### 19. A 401 in the production cron log is a FAILURE, not a pass

The same 401 that is the *pass signal* for your unauthenticated curl is a *total outage* when it appears on the 13:00 UTC scheduled invocation — it means `CRON_SECRET` is unset in Vercel, and account purges, trial expiry, seat reductions and every follow-up sequence have silently stopped. Context flips the meaning of an identical status code.

---

### 20. Twilio 403 vs 503

Covered in the 5-minute section, repeated because it is easy to misread: **403 = healthy** (token present, signature rejected). **503 = total inbound outage** (`src/app/api/twilio/inbound/route.ts:43`) — Twilio's own callbacks are being rejected too, so every STOP is dropped on the floor. It looks like a passing security check.

---

### 21. `stripe listen` vs the module-load env read

`EXPECTED_CENTS` is built at module scope (`src/app/api/stripe/checkout/route.ts:28-33`). Setting `process.env` inside a `beforeEach` after the first `await import()` has no effect — the allow-list is already frozen and every test passes against a stale map.

---

### 22. PostHog caches `null` forever

`src/lib/events.ts:96-116`: if the dynamic `import("posthog-js")` is blocked by an ad-blocker, `getPostHog()` caches null for the rest of the session. The page works perfectly, no console errors, nothing recorded. "No errors" is not evidence. And `NEXT_PUBLIC_POSTHOG_KEY` is inlined at **build** time — setting it in Vercel after the last build changes nothing until you redeploy.

---

### 23. Preview inheriting production env

The worst outcome in this document: a preview that silently inherits live Stripe or prod Supabase keys turns a "staging" checkout into a real charge on a real card and mutates production data. Run `vercel env ls preview` and confirm each `STRIPE_*` has a **Preview** scope before the first test card.

---

## Blocked / not testable today

| Blocked | Reason | Unblock condition |
|---|---|---|
| **Twilio outbound SMS locally** | `.env.local` has `TWILIO_AUTH_TOKEN` but not `TWILIO_ACCOUNT_SID`; `src/lib/messaging.ts:180-181` short-circuits | Add `TWILIO_ACCOUNT_SID` + one of `TWILIO_MESSAGING_SERVICE_SID`/`TWILIO_PHONE_NUMBER`, **or** use magic test credentials (Tier 2, $0, works today) |
| **Real SMS delivery to US carriers** | A2P 10DLC brand pending; carriers drop with error 30034 **after** Twilio returns 200 | Brand clearance ~**2026-08-04**. Until then only the `/api/twilio/status` callback rewriting a row to `delivered` proves anything |
| **Google Contacts locally** | `OAUTH_SECRET` unset → `src/lib/token-crypto.ts` throws. Also needs People API enabled + granular contacts scope ticked | `openssl rand -hex 32` into `.env.local`, plus a Google Cloud project with the People API on and your Gmail as a test user |
| **Apple Wallet anywhere** | All five vars in `src/lib/wallet-config.ts:13-20` absent from Vercel and `.env.local` → prod returns 501 | Add the Pass Type ID cert, key, WWDR PEM, team id, pass type id |
| **APNs / native iOS push** | All four `APPLE_PUSH_*` absent everywhere | Generate an APNs auth key. Fix `apns.ts:117` **first** (trap #13) |
| **Web push** | `VAPID_*` absent from every Vercel env | `npx web-push generate-vapid-keys`, add to Preview first |
| **All AI features** | No `OPENAI_API_KEY`/`GEMINI_API_KEY`/`ANTHROPIC_API_KEY` in prod. `/api/scanner` → `{"error":"no_ai"}` | Set one. Note `src/lib/ai.ts:14-80` is **first-configured-wins**, not a failover chain — see below |
| **PostHog funnel** | `NEXT_PUBLIC_POSTHOG_KEY` unset. Build-time inline | Set it, then **redeploy** |
| **Stripe webhook endpoint config audit** | The connected MCP key lacks permission on `GetWebhookEndpoints` | A restricted read-only key with Webhook Endpoints read, or the Dashboard |
| **HubSpot OAuth flow** | `HUBSPOT_CLIENT_ID`/`SECRET` absent from Vercel entirely | The Private App **token** path works today and needs no env var — test that instead |
| **LinkedIn** | Deliberately off (`LINKEDIN_CLIENT_*` unset) → 501 | Intentional. Test the kill switch, not the flow |
| **Any Supabase branch testing** | No branch provisioned; every e2e recipe writes to **production** | Create a Supabase branch and repoint `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |

---

## What the live probe found

### Stripe account identity — resolved from data, not assumed

The repo contains **no** `acct_`, `price_`, or `prod_` id, so the question could not be answered from source. It was answered by matching object-id fragments:

| Evidence | Value |
|---|---|
| Connected Stripe account | `acct_1TlGkfE81bCYGRbV` (display name "Evercard" — stale) |
| Newest row in prod `public.stripe_events` | `evt_1Tycb9E81bCYGRbVeFyhyYdF` |
| Newest subscription in that account | `sub_1Tycb8E81bCYGRbVcm045FnG`, `livemode: true` |
| SwiftCard prod `profiles.stripe_subscription_id` | `sub_1Tycb8E81bCYGRbVcm045FnG` — exact match |

Same account, live mode. Confirmed, not inferred.

### Billing is working end-to-end, verified in a 5-second window

- **18:52:55 UTC** — live subscription created: $4.99/mo, `price_1TrLSqE81bCYGRbVMxaidfVa`, qty 1, `status: trialing`, trial ends 2026-08-10, discount `di_1Tycb5…`, customer `cus_UyZkj5DbMjpfYV`
- **18:53:00 UTC** — `evt_1Tycb9E81bCYGRbVr5kLVLDD` (`invoice.payment_succeeded`) and `evt_1Tycb9E81bCYGRbVeFyhyYdF` (`checkout.session.completed`) landed in `stripe_events`
- `profiles` now reads `plan='pro'` with the matching customer and subscription ids

Checkout → Stripe → webhook → signature verify → dedup insert → DB write → entitlement, all working in production.

**This contradicts the Stripe domain map**, whose prod-smoke recipe states *"the expected result today is 0 active Stripe subscriptions and 0 profiles with `stripe_subscription_id`"* based on the 2026-07-28 reset. That pass signal is **stale as of 18:52 UTC on 2026-07-29**. Update it to "1 trialing subscription, 1 matching profile" before running the drift reconciliation, or you'll flag a healthy customer as drift.

### Entitlement drift worth confirming

`hello@swiftcard.me` has `plan='enterprise'` and `stripe_customer_id='cus_UtLt5fRNh2gh66'`, but `stripe_subscription_id` is **NULL** — and that customer's only subscription, `sub_1TtZCEE81bCYGRbVRrtHErYB`, is **canceled** (2026-07-16). A paid tier with no active subscription behind it.

Most likely deliberate (owner account granted via `/api/admin/set-plan` during the reset, which also nulls the subscription id). But it is **exactly** the shape a genuine downgrade-on-cancel failure takes, and the two are indistinguishable from the data. Confirm intent rather than assuming.

### Supabase

`grxmovpmlgmjncnyiyrt`, us-west-2, Postgres 17.6.1.127, **ACTIVE_HEALTHY**. 25 tables in `public`, **RLS enabled on all 25**, zero `rls_disabled_in_public` lints.

**Security advisors — 19 findings:**

- **18 × `rls_enabled_no_policy` (INFO)** — RLS on, **zero policies**, so these are fully closed to the anon/authenticated key and reachable only via service-role: `analytics_events`, `audit_logs`, `card_events`, `cards`, `email_logs`, `integrations`, `lead_messages`, `lead_reminders`, `message_opt_outs`, `office_notifications`, `promo_code_redemptions`, `promo_codes`, `push_subscriptions`, `referrals`, `signup_invite_uses`, `signup_invites`, `site_pageviews`, `stripe_events`.

  **Deny-by-default is not a leak.** It is a correctness risk in the other direction — anything expecting to reach these from a browser client silently gets zero rows. `cards` is the one worth a deliberate answer, since public card pages are the core product; the live site serves card content, so it appears to be service-role-backed by design.

- **1 × `auth_leaked_password_protection` (WARN)** — HaveIBeenPwned checking is **disabled**. One dashboard toggle, no code change.

**Performance — 32 findings:** 12 × `auth_rls_initplan` (`auth.<fn>()` re-evaluated per row instead of `(select auth.<fn>())`, on `profiles`, `leads`, `card_views`, `notifications`, `email_preferences`, `offices`, `office_members`), 2 × `multiple_permissive_policies` on `offices`/`office_members`, 18 × `unused_index` (expected after a wipe — stats reset, not actionable yet). Invisible at 2 rows; a cliff later.

### Vercel

Project `relationship-app` (`prj_EzWN9Tr6aw70RelIihfuwJS6pNGP`), team `team_dT8Xgx9E4475Q2TVbptBtmeW`, Next.js, Node 24.x. Prod URL `https://swiftcard.me` (200); `www` → 308.

Last 20 deployments **all `READY`, all `target: production`** — 11 on 2026-07-29 between 15:27 and 19:20 UTC, 9 the day before. Zero `ERROR` states. Newest READY: `dpl_BfamPSAxSPnKgQamJ76Gh3LXkLsC` @ 19:20:37 UTC.

One deployment (`dpl_HmNC44YPuqE2mmH3ZNYQVf9N5qMb`, created 19:29:49 UTC) was still `BUILDING` when the probe ended and was **not** triggered by the probe session. Final state unknown.

Deployment protection: password **off**, trusted IPs **off**, **Vercel SSO ON** with `deploymentType: all_except_custom_domains` — the correct shape, confirmed empirically (both `.vercel.app` aliases → 302, `swiftcard.me` → 200). The project's `domains` array omits `swiftcard.me`; that is an artifact of the summary endpoint, not a misconfiguration.

### Public surface

`GET https://swiftcard.me` → 200 in 0.59s, `x-vercel-cache: HIT`, prerendered. Headers: HSTS `max-age=63072000; includeSubDomains; preload`, `nosniff`, `X-Frame-Options: SAMEORIGIN`, CSP `frame-ancestors 'self'`, `referrer-policy: strict-origin-when-cross-origin`, a scoped `permissions-policy`. `robots.txt` disallows `/dashboard`, `/contacts`, `/admin`, `/settings`, `/onboarding`, `/profile`, `/cards`, `/office`, `/api`, `/auth`.

Auth gating verified by GET (no side effects): `/api/stripe/webhook` 405, `/api/twilio/status` 405, `/api/cards` 401, `/api/admin/users` 403.

**There is no health endpoint.** No `health`, `status`, `ping`, `version` or diagnostic route exists under `src/app/api` (38 route groups; the only `status`-named route is the Twilio callback). Every conclusion above had to be inferred from headers, status codes and DB state. A `/api/health` that reports Supabase reachability, `stripe_events` freshness, and which optional integrations are configured would collapse most of Tier 4 into one curl.

---

## Where the maps disagree, or are uncertain

Stated plainly rather than smoothed over:

1. **The Stripe prod-smoke pass signal is stale.** It expects 0 active subscriptions per the 2026-07-28 reset memory; the live probe found 1 trialing subscription created 2026-07-29 18:52 UTC. Update before reconciling, or you'll report a false positive.

2. **The env-gap report names `isAIConfigured()`.** The actual export is `hasAiProvider()` at `src/lib/ai.ts:6-7`. Minor, but it means a test written against the documented name won't compile.

3. **Line numbers in the messaging map are off by one or two.** Verified this session: `sendRawEmail`'s `return "sent"` is at `src/lib/messaging.ts:236` with `catch` at `:237`; `sendBrandedEmail`'s are at `:399`/`:400`. The map cites `:237` and `:400` — the catch lines. Same bug, cite the range `:224-238` and `:388-401`.

4. **`tests/native-capabilities.test.ts` — the "gone" regex is at line 35, not 37.**

5. **`ENV_KEYS_NEEDED.md` contradicts itself on HubSpot.** Lines 35-40 claim "HubSpot needs no env var" (Private App token model), while `src/lib/sync-hubspot.ts` reads `HUBSPOT_CLIENT_ID`/`SECRET` and line 176 of the same doc lists them as required. Both paths exist in code; the token path is the one that works today.

6. **`ADMIN_SECRET` is documented as a security control that does not exist.** Referenced in `ENV_KEYS_NEEDED.md` twice (lines 25 and 143, the latter claiming `/api/admin/promo-codes/send` returns 403 without it), plus `PROJECT_CONTEXT.md` and `NEXT_STEPS.md`. **Zero references in `src/` or `scripts/`.** The claim is false. Verify that route's actual auth before trusting the docs on it.

7. **`UPSTASH_REDIS_REST_URL`/`_TOKEN` are undocumented** in both `.env.example` and `ENV_KEYS_NEEDED.md`, yet `src/lib/rate-limit.ts:41-42` treats them as the *primary* naming with `KV_REST_API_*` as the alias. Anyone provisioning Upstash by hand would find no documented name.

8. **The CRM map's mutation drill is correct but dangerous.** It edits a source file, and **this directory is not a git repo** — `git diff` and `git checkout` will not help. The `/tmp` copy is the only safety net.

9. **Whether the Stripe live webhook endpoint subscribes to every event the code handles is unverified.** The MCP key lacks `GetWebhookEndpoints` permission. Delivery is proven empirically for `checkout.session.completed` and `invoice.payment_succeeded`; `invoice.payment_failed` has **zero rows ever**, which could mean "no failures yet" or "not subscribed." Those are very different, and the grace-period flow depends entirely on it.