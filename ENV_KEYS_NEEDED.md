# Environment Variables — Swisscard

Add these to `.env.local` for local dev AND to Vercel (Settings → Environment Variables) for production.
Do NOT commit `.env.local` to git.

---

## Already Set (do not touch)

| Variable | What it does |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role — bypasses RLS (keep secret) |

---

## Needed Now (emails + AI)

| Variable | Where to get it |
|---|---|
| `RESEND_API_KEY` | resend.com → Login → API Keys → Create API Key |
| `RESEND_FROM_EMAIL` | **RETIRED — no send site reads it.** Sender addresses now live in `src/lib/email-senders.ts`: `connect@` (user→person), `support@` (platform→user), `billing@` (money), `news@` (campaigns), with `hello@` receive-only. Safe to delete from Vercel. |
| `MARKETING_FROM_EMAIL` | **RETIRED — it never worked.** `getMarketingFrom()` returned `RESEND_FROM_EMAIL` first and the broadcast routes spread `from` *after* the template, so this var was always overridden and the marketing/transactional split never existed. Campaigns now send from `news@swiftcard.me` via `src/lib/email-senders.ts`. NOTE: `news@` is on the ROOT domain, so reputation is still shared — moving it to `news.swiftcard.me` is the change that would isolate it, and it costs a cold-start warm-up. |
| `EMAIL_DAILY_SEND_CAP` | **Deliverability.** Max marketing emails per rolling 24h; `/api/admin/broadcast` returns 429 rather than exceeding it. Default `200`. This is the warm-up ramp — raise it as reputation builds (50 → 100 → 250 → 500 → 1000), never more than doubling day over day. A cold domain that suddenly emits thousands of messages is indistinguishable from a spammer's first run. |
| `RESEND_WEBHOOK_SECRET` | **Deliverability — the feedback loop.** resend.com → Webhooks → add `https://swiftcard.me/api/resend/webhook` subscribed to `email.bounced` + `email.complained`, then copy the signing secret (`whsec_…`). Without it the endpoint refuses every event, so hard bounces and spam complaints are never suppressed and we keep mailing them — the fastest way to lose a young sending domain. |
| `COMPANY_POSTAL_ADDRESS` | **Deliverability + legal.** The physical postal address printed in every email footer. CAN-SPAM requires a real street address or a registered PO/private mailbox — a city alone ("New York, NY") satisfies neither the law nor the filters that look for a parseable address block. A virtual-mailbox address is fine. Unset = a non-compliant fallback is used. |
| `UNSUBSCRIBE_MAILTO` | **Deliverability.** Optional second unsubscribe method (e.g. `unsubscribe@swiftcard.me`) added to the `List-Unsubscribe` header alongside the https one-click URL. Outlook/Hotmail only surface the mailto form. **Only set this once the mailbox actually receives mail** — advertising a dead address bounces every opt-out and is worse than omitting it. |
| `ADMIN_EMAILS` | Comma-separated emails allowed into the **Admin Panel** at `/admin` (plan toggling, analytics, promo codes, broadcast). e.g. `you@gmail.com,partner@company.com`. Your email MUST be here to see `/admin`. |
| `ADMIN_SECRET` | Long random string. Only protects the automated `/api/admin/promo-codes/send` endpoint. The Admin Panel itself is gated by `ADMIN_EMAILS`, not this. |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key. Primary AI provider for follow-up generation (cheaper than Anthropic). Optional fallbacks: `OPENAI_API_KEY` (used first if set), `ANTHROPIC_API_KEY`. |
| `NEXT_PUBLIC_APP_URL` | Your production URL: `https://swiftcard.me`. Used for card links, email links, AND OAuth redirect URIs — must match the domain registered in your OAuth apps. |

---

## Needed for CRM Integrations (Google Contacts, Salesforce)

> Zapier needs no env var — each user pastes their own webhook URL in Settings → Notifications and preferences, which also carries conversation-notification and view events to any CRM.
>
> HubSpot, Pipedrive and GoHighLevel need no env var either — each user pastes
> their own token (HubSpot service key or private-app token with contact read
> AND write; Pipedrive personal API token; GoHighLevel Private Integration token
> with contacts.write + locations.readonly, plus the Location ID) in Settings →
> Notifications and preferences. No Client ID/Secret, no redirect URI.
>
> Leaving Google or Salesforce unset is safe: their Connect button lands back on
> Settings with "isn't switched on yet" instead of failing. A deployment
> WITHOUT the secrets (e.g. a preview build — it shares the production
> database) never refreshes tokens, so it can't mark live connections broken.

| Variable | Where to get it |
|---|---|
| `OAUTH_SECRET` | **Required** for every CRM: encrypts all stored CRM tokens and signs the OAuth state. A 32-byte key as 64 hex chars. Generate with `openssl rand -hex 32`. Changing it makes every stored token unreadable (everyone has to reconnect). |
| `GOOGLE_CLIENT_ID` | console.cloud.google.com → APIs & Services → Credentials → Create OAuth client ID (Web application). Also enable the **People API**. Redirect URI: `https://swiftcard.me/api/integrations/google/callback`. |
| `GOOGLE_CLIENT_SECRET` | Same OAuth client. |
| `SALESFORCE_CLIENT_ID` / `SALESFORCE_CLIENT_SECRET` | Salesforce Setup → External Client App (or Connected App) with OAuth: scopes `api` + `refresh_token`, PKCE required, callback `https://swiftcard.me/api/integrations/salesforce/callback`. Production orgs only (login.salesforce.com). |

Register this **redirect URI** in the Google OAuth app (must match `NEXT_PUBLIC_APP_URL` exactly):
- Google → `https://swiftcard.me/api/integrations/google/callback` · scope `https://www.googleapis.com/auth/contacts`

---

## Needed for LinkedIn Profile-Photo Import (optional)

Lets a signed-in user import their **own** LinkedIn profile photo onto a card.
Uses official LinkedIn OAuth (OpenID Connect) with explicit consent; the photo is
clearly labelled LinkedIn-sourced and the user must **approve** it before it's
applied. No scraping, no matching photos by name. **The Connect button stays
hidden until BOTH vars below are set AND the LinkedIn app is approved** — the
architecture is built but is not operational until you complete the app setup.

| Variable | Where to get it |
|---|---|
| `LINKEDIN_CLIENT_ID` | linkedin.com/developers → your app → **Auth** tab → Client ID. |
| `LINKEDIN_CLIENT_SECRET` | Same LinkedIn app → **Auth** tab → Client Secret. |
| `OAUTH_SECRET` | Reused from the CRM section above — required to encrypt stored LinkedIn tokens and sign OAuth state. |

**External setup steps you must still perform:**
1. Create an app at **linkedin.com/developers** (associate it with a Company Page — LinkedIn requires one).
2. On the **Products** tab, add **"Sign In with LinkedIn using OpenID Connect"** and wait for it to be **approved/granted**.
3. On the **Auth** tab, add the redirect URL: `https://swiftcard.me/api/integrations/linkedin/callback` (must match `NEXT_PUBLIC_APP_URL` exactly).
4. Confirm the granted **scopes** include `openid`, `profile`, `email`.
5. Copy the Client ID / Secret into the env vars above (local + Vercel).

Without these, `isLinkedInEnabled()` is false → the card is hidden and the connect route redirects back with `status=error` instead of hitting a broken LinkedIn page.

---

## Needed for Company Logo Suggestion (optional)

Suggests a company's **official** logo/name/domain when a user types a company
name, business email, or domain while building a card — provider API only (no
Google/image scraping), and the user must **confirm** a match (never auto-applied).

| Variable | Where to get it |
|---|---|
| `LOGO_DEV_TOKEN` | **Logo.dev** Brand Search API secret key (format `sk_...`). Sign up at **logo.dev** → Dashboard → API key. |

**External setup steps you must still perform:**
1. Sign up at **https://www.logo.dev** (free tier available).
2. Copy your **secret key** (`sk_...`) from the dashboard — this is the Brand Search key, used server-side only.
3. Set `LOGO_DEV_TOKEN` (local + Vercel).

Without it, `/api/logo-suggest` returns `{ status: "not_configured" }` and the "Suggest my company logo" helper renders nothing — no errors. Personal email domains (gmail/outlook/etc) are skipped automatically. Provider is behind an interface (`src/lib/logo-provider.ts`) so it can be swapped later.

---

## Needed Later (payments)

See **`STRIPE_TWILIO_SETUP.md`** for the full dashboard walkthrough (products, prices, webhook events, test vs. live mode).

| Variable | Where to get it |
|---|---|
| `STRIPE_SECRET_KEY` | dashboard.stripe.com → Developers → API Keys → Secret key. Use a **test-mode** key (`sk_test_...`) until you're ready to accept real payments; switch to `sk_live_...` only when going live. |
| `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com → Developers → Webhooks → your endpoint → Signing secret (`whsec_...`). Test mode and live mode each have their own endpoint and their own secret — don't mix them. |
| `NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID` | Stripe → Product catalog → your Pro monthly price → copy Price ID (`price_...`). Must be $4.99/mo to match `/pricing`. |
| `NEXT_PUBLIC_STRIPE_ANNUAL_PRICE_ID` | Stripe → Product catalog → your Pro annual price → copy Price ID. Must be $54.00/yr to match `/pricing`. |
| `NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID` | Stripe → Product catalog → your Office (per-seat) monthly price → copy Price ID. Must be $3.99/mo per seat. |
| `NEXT_PUBLIC_STRIPE_ENTERPRISE_ANNUAL_PRICE_ID` | Stripe → Product catalog → your Office (per-seat) annual price → copy Price ID. Must be $43.09/yr per seat. |
| `STRIPE_PRICE_ID` | Optional legacy fallback for `NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID`. Leave unset if the monthly price ID above is set. |
| `STRIPE_RETENTION_COUPON_ID` | Optional. A Stripe Coupon ID applied on the account-cancellation "retain" offer. |

Test/live mode are **completely separate catalogs** in Stripe — a test Price ID will not work with a live secret key. When you're ready to go live, recreate the Products/Prices in live mode (same amounts) and swap every Stripe value above for its live-mode equivalent. `src/app/api/stripe/checkout/route.ts` fetches the real Stripe price at checkout time and rejects the request if its amount doesn't match `PLAN_PRICES` in `src/lib/plan.ts` — keep that file in sync if you ever change a displayed price.

---

## SMS (Twilio)

See **`STRIPE_TWILIO_SETUP.md` § Twilio** for what is already provisioned and the full dashboard walkthrough.

Sender, Messaging Service, and inbound webhook are **live**; three of the four
variables are already set in Vercel Production. Only `TWILIO_AUTH_TOKEN` is
outstanding — until it's set, `sendSms()` returns `not_configured` and nothing
sends. A2P 10DLC brand + campaign registration is still required before US
carriers will actually deliver.

| Variable | Where to get it | Status |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | console.twilio.com → Account Info → Account SID (`AC...`) | ✅ set |
| `TWILIO_AUTH_TOKEN` | console.twilio.com → Account Info → Auth Token | ❌ **not set** — the one switch that turns SMS on |
| `TWILIO_MESSAGING_SERVICE_SID` | console.twilio.com → Messaging → Services → your service SID (`MG...`). Preferred over a bare phone number — set this OR `TWILIO_PHONE_NUMBER` below. | ✅ set — the "SwiftCard" service |
| `TWILIO_PHONE_NUMBER` | console.twilio.com → Phone Numbers → your number (e.g. `+15550001234`). Only needed if you're not using a Messaging Service. | ✅ set (`+19179057335`) — kept as the fallback sender |
| `TWILIO_SKIP_VALIDATION` | Leave unset/`false` everywhere except local dev without a public tunnel. Bypasses the inbound-webhook signature check — never set to `true` in production. |

---

## What breaks without each key

| Missing key | What stops working |
|---|---|
| `RESEND_API_KEY` | All emails — welcome, receipts, marketing, promo codes |
| `RESEND_FROM_EMAIL` | Emails may be rejected or go to sandbox only |
| `ADMIN_SECRET` | Admin broadcast + promo code routes return 403 |
| `GEMINI_API_KEY` (or OPENAI/ANTHROPIC) | AI follow-up generation falls back to generic templates |
| `NEXT_PUBLIC_APP_URL` | Card links, email links, and OAuth redirects will point at the wrong domain |
| `OAUTH_SECRET` | Google "Connect" and HubSpot token save both fail (can't encrypt tokens) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Contacts integration |
| `STRIPE_SECRET_KEY` | Checkout and subscription management |
| `STRIPE_WEBHOOK_SECRET` | Plan upgrades, receipts, failed-payment emails, and cancellations won't process |
| `NEXT_PUBLIC_STRIPE_*_PRICE_ID` | Checkout rejects the request with "Unknown plan price" |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | SMS sending returns "not configured" (fails safely, no 500) |
| `TWILIO_MESSAGING_SERVICE_SID` / `TWILIO_PHONE_NUMBER` | Same — at least one of these two is also required for SMS to send |

## Product analytics (optional)

`NEXT_PUBLIC_POSTHOG_KEY` — PostHog **project** key. Publishable by design, which
is why it's `NEXT_PUBLIC_`. Without it the analytics layer is completely inert:
the SDK is never imported, no network, no cookies, and every `track()` call is a
no-op. Set it to start recording the conversion funnel (card created → published
→ plan selected → checkout completed). This was previously referenced by the code
but documented nowhere and set in no environment, so the funnel recorded nothing.

`NEXT_PUBLIC_POSTHOG_HOST` — optional, defaults to `https://us.i.posthog.com`.
Set to `https://eu.i.posthog.com` for an EU project.

## Search Console (optional)

`NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` — **already set in Vercel Production**
(2026-08-17) for the `https://swiftcard.me/` URL-prefix property. It's the
`content` value from Search Console's **HTML tag** method; the root layout
renders the `google-site-verification` meta tag and emits nothing while unset.
Leave it set permanently — Google re-checks the tag and un-verifies the property
if it disappears, which silently stops sitemap and indexing reports.

`public/google9d510ed9f03ed408.html` is the same verification as a static file
(Search Console's "HTML file" method), kept as a second, git-tracked proof of
ownership so deleting the env var alone can't un-verify the property. Both
methods point at the same property — don't delete either one.

## Referenced in code but previously undocumented

These are all read somewhere in `src/` but appeared in no env file or doc, so
they were invisible when provisioning a new environment. Every one is optional —
the feature behind it degrades quietly when unset.

| Key | What it turns on / what breaks without it |
|---|---|
| `ALERT_WEBHOOK_URL` | Production error alerts (`lib/report-error.ts`). Unset = errors are logged but nothing is pushed anywhere. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Shared rate-limit store (`lib/rate-limit.ts`). Unset = limits fall back to per-instance memory, so they reset on every cold start. |
| `STRIPE_RETENTION_COUPON_ID` | Coupon offered in the account-DELETION retention flow (`/api/account/retain`). |
| `STRIPE_RETENTION_DISCOUNT_COUPON_ID` | Separate coupon offered in the subscription CANCEL flow (`/api/stripe/subscription/discount`). Note: two different coupons — easy to confuse. |
| `APPLE_PUSH_KEY_ID` / `APPLE_PUSH_PRIVATE_KEY` / `APPLE_PUSH_TOPIC` / `APPLE_PUSH_SANDBOX` | Native iOS push. Unset = push is skipped; in-app bell notifications still work. |
| `APPLE_SIGN_IN_CLIENT_ID` / `APPLE_SIGN_IN_KEY_ID` / `APPLE_SIGN_IN_PRIVATE_KEY` | Sign in with Apple (also see `docs/ios-review/SHELL-RUNBOOK.md`). |
| `APP_STORE_ID` / `APP_STORE_COUNTRY` | App Store links in the native shell / marketing surfaces. |
