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
| `ADMIN_SECRET` | **RETIRED — read nowhere.** No file in `src/`, `scripts/` or `.github/` reads it. `/api/admin/promo-codes/send` and `/api/admin/broadcast` are gated by `requireAdmin()` (a signed-in session whose email is in `ADMIN_EMAILS`), not by a shared secret. Safe to delete from Vercel. |
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
| `ADMIN_SECRET` | Nothing — RETIRED, read nowhere (admin routes are gated by `ADMIN_EMAILS`) |
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

---

> **Set automatically — never set by hand:** `NODE_ENV`, `NEXT_RUNTIME`, `PORT`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_GIT_COMMIT_SHA`, `NEXT_PUBLIC_VERCEL_ENV` are provided by Vercel/Node at runtime.
>
> `NEXT_PUBLIC_*` values are baked into the browser bundle at build time: changing one in Vercel does nothing until the next deploy.

## Scheduled jobs (cron and GitHub-schedule secrets)

Vercel Hobby allows two daily crons (`vercel.json`: `/api/reminders`, `/api/wallet/sweep`). Everything hourly runs from GitHub Actions (`push-catchup.yml`, `trial-notice.yml`, `instagram-bot.yml`, `facebook-bot.yml`) and calls the app with a Bearer secret. Every route refuses an UNSET secret rather than accepting `Bearer undefined`.

| Key | What it does — and what breaks when it's missing |
|---|---|
| `CRON_SECRET` | Long random string. Vercel Cron sends it as `Authorization: Bearer …` automatically once it's set in Vercel. Guards `/api/reminders` (daily: follow-up sequences, the 30-day account purge, seat reductions, downgrades, expiry warnings, the trial-notice backstop, Apple offer-code retries) and `/api/wallet/sweep` (daily Wallet pass refresh). Also accepted by every GitHub-scheduled route, and is the fallback HMAC key for email-preference and contact-unsubscribe links when `OAUTH_SECRET` is unset. **Missing = both daily crons return 401 every day**: no follow-ups go out, deleted accounts are never purged, Wallet passes stop catching up. |
| `PUSH_CATCHUP_SECRET` | Long random string, set to the **same value in Vercel AND in GitHub → Settings → Secrets → Actions**. The hourly GitHub jobs send it to `/api/push/catchup` (8am "while you were asleep" push), `/api/push/recap` (Monday recap + daily team check), `/api/push/activation` (one-time getting-started push), `/api/account/purge-due` (hourly purge of `purgeNow` accounts), `/api/billing/trial-notice` (7-day pre-charge notice) and the Instagram/Facebook bot ticks. **Missing in GitHub** = each workflow logs "PUSH_CATCHUP_SECRET is not set" and sends nothing; **missing in Vercel** = those routes return 401 (unless `CRON_SECRET` matches). Trial customers then get only the daily backstop notice. |
| `TRIAL_NOTICE_SECRET` | Optional dedicated secret for `/api/billing/trial-notice`. The route also accepts `PUSH_CATCHUP_SECRET` and `CRON_SECRET`, and `trial-notice.yml` actually sends `PUSH_CATCHUP_SECRET`, so leaving this unset changes nothing. Only set it if you rewire that workflow to its own secret. |

## AI model overrides (optional)

Provider order is `OPENAI_API_KEY` → `GEMINI_API_KEY` → `ANTHROPIC_API_KEY` (`src/lib/ai.ts`). These only pick the model; unset = the default shown.

| Key | What it does — and what breaks when it's missing |
|---|---|
| `GEMINI_MODEL` | Gemini model for text and vision calls (follow-ups, help/sales chat, card scanner). Default `gemini-2.5-flash`. |
| `GEMINI_IMAGE_MODEL` | Gemini image model for the design-transfer image edit (`/api/design-transfer`). Default `gemini-2.5-flash-image`. Needs `GEMINI_API_KEY` regardless of the other providers. Without that key the image-edit feature reports unavailable. |
| `OPENAI_MODEL` | OpenAI model for text and vision when `OPENAI_API_KEY` is set. Default `gpt-4o-mini`. |
| `ANTHROPIC_MODEL` | Anthropic model when Anthropic is the provider in use. Default `claude-haiku-4-5-20251001`. |

## Push notifications (iOS, Android, web)

| Key | What it does — and what breaks when it's missing |
|---|---|
| `APPLE_TEAM_ID` | Your 10-character Apple Developer Team ID (developer.apple.com → Membership). **Shared by four features:** the APNs push JWT (with `APPLE_PUSH_KEY_ID`/`APPLE_PUSH_PRIVATE_KEY`), Apple Wallet passes, Sign in with Apple token revocation on account delete, and the `appID` in `/.well-known/apple-app-site-association`. Missing = iOS push returns `not_configured`, the Add to Wallet button is hidden, Apple revocation is skipped, and the AASA file serves `TEAMID_PLACEHOLDER` (a malformed value also falls back to it). |
| `FIREBASE_PROJECT_ID` | Android push (FCM). From Firebase console → Project settings → Service accounts → Generate new private key: the JSON's `project_id`. All three `FIREBASE_*` are required. **Missing any one = Android push silently off** (`fcmConfigured()` is false; `/api/health` reports it). |
| `FIREBASE_CLIENT_EMAIL` | Same service-account JSON: `client_email`. See above. |
| `FIREBASE_PRIVATE_KEY` | Same service-account JSON: `private_key` (PEM; literal `\n` and wrapping quotes are normalised). See above. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web-push public key (generate the pair with `npx web-push generate-vapid-keys`). Missing = the browser "Enable notifications" control reports push as unsupported and no web subscription can be made. |
| `VAPID_PRIVATE_KEY` | The private half of the same VAPID pair, server-only. Missing = web-push sends are skipped (`/api/health` shows `webPush: false`); in-app bell, iOS and Android push are unaffected. |

## Apple Wallet pass

All five of `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_PASS_CERT_PEM`, `APPLE_PASS_KEY_PEM`, `APPLE_WWDR_PEM` must be set (`hasWalletConfig()` in `src/lib/wallet-config.ts`). **Missing any one = the "Add to Apple Wallet" button is hidden** in the new-card wizard and the dashboard's share options.

| Key | What it does — and what breaks when it's missing |
|---|---|
| `APPLE_PASS_TYPE_ID` | The Pass Type ID (e.g. `pass.me.swiftcard.card`) from developer.apple.com → Identifiers → Pass Type IDs. Also the APNs topic for "your pass changed" pushes and checked by the Wallet web-service routes. Missing = Wallet off and pass-update pushes return `not_configured`. |
| `APPLE_PASS_CERT_PEM` | The Pass Type ID certificate as PEM text. Apple issues it for about a year; the builder logs a warning at 30 days and an error once expired. **An expired cert turns every Add to Wallet into a 500.** |
| `APPLE_PASS_KEY_PEM` | The certificate's private key as PEM text. Also the fallback HMAC key for pass authentication tokens when `WALLET_AUTH_SECRET` is unset. |
| `APPLE_PASS_KEY_PASSWORD` | Passphrase for `APPLE_PASS_KEY_PEM`, only if the key is encrypted. Unset = the key is read as unencrypted; with an encrypted key, pass signing fails. |
| `APPLE_WWDR_PEM` | Apple's WWDR intermediate certificate as PEM text (apple.com/certificateauthority). |
| `WALLET_AUTH_SECRET` | Long random string used to derive each pass's authenticationToken. Unset = falls back to `APPLE_PASS_KEY_PEM`, which works until you renew the signing cert: then **every installed pass stops updating until re-added**. Set this before the next renewal. |

## Google Wallet pass (Android)

All three must be set (`hasGoogleWalletConfig()` in `src/lib/google-wallet-config.ts`). **Missing any one = "Add to Google Wallet" is hidden everywhere** (the new-card prompt, Other ways to share on Android, the assistant's answer), and `/api/wallet/google` returns 501. Until Google approves the issuer for publishing, only the test accounts listed in the Wallet Console can save the pass. `/api/health` reports `googleWallet`, and the 15-minute uptime check alerts when the key stops working.

| Key | What it does — and what breaks when it's missing |
|---|---|
| `GOOGLE_WALLET_ISSUER_ID` | The Issuer ID from pay.google.com/business/console (Google Pay & Wallet Console → Google Wallet API). Every pass id starts with it. |
| `GOOGLE_WALLET_CLIENT_EMAIL` | The service account's `client_email` from its JSON key (Google Cloud → IAM → Service accounts, with the Google Wallet API enabled). That email must also be added as a user on the issuer in the Wallet Console, or every save returns 403. |
| `GOOGLE_WALLET_PRIVATE_KEY` | The same JSON key's `private_key` (PEM; literal `\n` and wrapping quotes are normalised, as for Firebase). |

## iPhone app: in-app purchase, offer codes and store links

| Key | What it does — and what breaks when it's missing |
|---|---|
| `NEXT_PUBLIC_RC_APPLE_API_KEY` | RevenueCat **public** Apple SDK key (RevenueCat → Project → API keys, `appl_…`). Configures StoreKit purchases in the iOS shell. Missing = the paywall sheet still opens but cannot load prices or buy; each attempt reports an `env` IAP failure. Ignored on Android and the web. |
| `REVENUECAT_SECRET_KEY` | RevenueCat **secret** key (`sk_…`, server-only). `/api/iap/sync` uses it to unlock Pro the moment a purchase finishes, and the webhook uses it to settle transfers/refunds. Missing = sync is a no-op (Pro arrives only when the webhook does, slower but correct) and transfer/refund checks return "unknown". |
| `REVENUECAT_WEBHOOK_TOKEN` | The literal Authorization value configured on RevenueCat's webhook (sent as `Bearer …` to `/api/iap/revenuecat`). Missing = the webhook returns 503 for everything: **Apple purchases, renewals, expiries and refunds never reach the plan**. |
| `ASC_KEY_ID` | App Store Connect API key ID (App Store Connect → Users and Access → Integrations → App Store Connect API). With `ASC_ISSUER_ID` + `ASC_PRIVATE_KEY`, mirrors every free-time promo code as an Apple offer code. Missing any of the three = no Apple offer codes are created, and a code typed in the iOS app is sent to swiftcard.me instead (check `apple_offer_error` on the code). |
| `ASC_ISSUER_ID` | Same App Store Connect API page: Issuer ID. See `ASC_KEY_ID`. |
| `ASC_PRIVATE_KEY` | The `.p8` private key text for that API key (literal `\n` allowed). See `ASC_KEY_ID`. |
| `ASC_APP_ID` | Numeric App Store Connect app id the offer codes are created on. Default: `NEXT_PUBLIC_APP_STORE_ID`, then the hardcoded `6798875872`. Leave unset unless the app id changes. |
| `NEXT_PUBLIC_APP_STORE_URL` | The live App Store listing URL (e.g. `https://apps.apple.com/app/id6798875872`). Missing = **every "Download on the App Store" button, the app popup and the footer badge are hidden**, and new accounts' guided tour does not wait for the popup. |
| `NEXT_PUBLIC_APP_STORE_ID` | Numeric App Store id (digits only). Feeds the Smart App Banner and the "Rate us" write-review links. Missing = parsed from `NEXT_PUBLIC_APP_STORE_URL`; if neither gives an id, the banner and Rate-us links are hidden. |
| `NEXT_PUBLIC_PLAY_STORE_URL` | The Google Play listing URL; only `https://play.google.com/store/apps/details?id=…` is accepted. Missing (or any other shape) = every Google Play badge renders nothing. |

## Sign-in and bot protection

| Key | What it does — and what breaks when it's missing |
|---|---|
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google Identity Services client ID for the "Sign in with Google" button (console.cloud.google.com → Credentials → OAuth client, Web; add `https://swiftcard.me` under Authorized JavaScript origins). Missing = the Google button shows "Google sign-in isn't configured. Use email, or try again later." |
| `NEXT_PUBLIC_APPLE_SIGNIN_ENABLED` | Kill switch for the "Sign in with Apple" button. Only the literal `1` shows it (on in Production since 2026-08-07). Set it to `0` and redeploy when the Apple client secret has expired (about every 6 months), because a dead sign-in button is an App Review rejection. Missing = the button is hidden. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (Cloudflare → Turnstile) for the email/password sign-up, sign-in and reset forms. Missing = no widget loads and forms send no token. **If Supabase's CAPTCHA switch (Auth → Attack Protection) is ON while this is unset, every email sign-up and password sign-in is refused.** Turn on the Supabase switch only after this key is live. |

## Monitoring, rate limits and visitor location

| Key | What it does — and what breaks when it's missing |
|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry project DSN. Turns on error and performance reporting for client, server and edge. Missing = Sentry is completely disabled (no errors recorded), and the deploy watchdog has no error rate to roll back on. |
| `NEXT_PUBLIC_SENTRY_RELEASE` | Release name attached to Sentry events. Default `VERCEL_GIT_COMMIT_SHA`, so leave it unset on Vercel. |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | Performance-trace sample rate, a number from 0 to 1. Default `0.1` in production and `1` elsewhere; anything out of range is ignored. |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL for the shared rate-limit store. Takes precedence over `KV_REST_API_URL` (either naming works). Missing both = rate limits fall back to per-instance memory and reset on every cold start. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token; pairs with the URL above (falls back to `KV_REST_API_TOKEN`). |
| `IPINFO_TOKEN` | ipinfo.io token for the second-opinion IP lookup behind visit city/region and "a visit from X's network". Missing = the free `ipwho.is` endpoint is used instead (lower quota, slightly different network naming). A failed lookup leaves Vercel's edge geo standing alone. |

## Admin agent tooling and marketing bots (admin only)

**Admin agent tooling only — the product works without it.** These power the owner-only platform connections (`/api/admin/connect/<provider>`) and the Pinterest pin route; the old agent system was removed 2026-10-19. No customer-facing screen reads any of them. Agent OAuth redirect URI: `https://swiftcard.me/api/admin/connect/<provider>/callback`.

| Key | What it does — and what breaks when it's missing |
|---|---|
| `AGENT_RELAY_SECRET` | Admin agent tooling only — the product works without it. Bearer secret the agent workflows use to send their digest/alert emails through `/api/agent-email` (recipient is always `agent_system.digest_email`). Minted by `scripts/agent-flow-setup.mjs`; must match the GitHub Actions secret of the same name. Missing = the route is a 404 and agents send no emails. |
| `INSTAGRAM_BOT_SECRET` | Admin agent tooling only — the product works without it. Optional dedicated Bearer secret (16+ chars) for the Pinterest pin route under `/api/agents/pinterest/pin` (also accepts `PUSH_CATCHUP_SECRET` and `CRON_SECRET`). |
| `META_APP_ID` | Admin agent tooling only — the product works without it. Meta (Facebook) app ID from developers.facebook.com, for posting to the SwiftCard Page + Instagram and for the Instagram/Facebook reply bots. Missing (with `META_APP_SECRET`) = the Facebook + Instagram Connect button is unavailable. |
| `META_APP_SECRET` | Admin agent tooling only — the product works without it. Same Meta app's secret. Also verifies `x-hub-signature-256` on `/api/meta/webhook`. Missing = no Meta connection, and every webhook POST is rejected 401 (the 10-minute bot pass still runs). |
| `META_PAGE_ID` | Admin agent tooling only — the product works without it. Picks which Facebook Page to connect when the account manages several. Unset = the first Page returned. |
| `META_SCOPES` | Admin agent tooling only — the product works without it. Overrides the whole Meta OAuth scope list. Unset = the built-in list (pages + Instagram publish, comments, messages, engagement). Set it only if the Meta app lacks one of those scopes, because an unknown scope fails the consent screen. |
| `X_CLIENT_ID` | Admin agent tooling only — the product works without it. X (Twitter) OAuth 2.0 client ID from developer.x.com, for posting as the SwiftCard X account. Missing (with the secret) = X Connect unavailable. |
| `X_CLIENT_SECRET` | Admin agent tooling only — the product works without it. Same X app's client secret. |
| `YOUTUBE_CLIENT_ID` | Admin agent tooling only — the product works without it. Google OAuth client for uploading agent videos to YouTube (an Internal-consent project so refresh tokens don't expire after 7 days). Unset = falls back to `GOOGLE_CLIENT_ID`. |
| `YOUTUBE_CLIENT_SECRET` | Admin agent tooling only — the product works without it. Same client's secret. Unset = falls back to `GOOGLE_CLIENT_SECRET`. |
| `LINKEDIN_AGENT_CLIENT_ID` | Admin agent tooling only — the product works without it. Client ID of the Page-attached "SwiftCard Agent Flow" LinkedIn app (Community Management API), separate from the profile-photo app. Unset = falls back to `LINKEDIN_CLIENT_ID` with member scopes. |
| `LINKEDIN_AGENT_CLIENT_SECRET` | Admin agent tooling only — the product works without it. Same app's secret. Unset = falls back to `LINKEDIN_CLIENT_SECRET`. |
| `LINKEDIN_AGENT_SCOPES` | Admin agent tooling only — the product works without it. Overrides LinkedIn OAuth scopes. Default `w_organization_social r_organization_admin` when `LINKEDIN_AGENT_CLIENT_ID` is set, else `openid profile w_member_social`. |
| `PINTEREST_APP_ID` | Admin agent tooling only — the product works without it. Pinterest app ID from developers.pinterest.com, for pinning card designs. Missing (with the secret) = Pinterest Connect unavailable. |
| `PINTEREST_APP_SECRET` | Admin agent tooling only — the product works without it. Same Pinterest app's secret. |

## Agents (Crew) — admin only

**Admin agent tooling only — the product works without it.** The agent system behind the Agents tab (`/admin/crew`, plan in `docs/plans/agent-system.md`). Every agent starts switched off, and one whose keys are missing shows "Needs: …" and cannot be switched on. Crew deliberately uses its **own** key names: `src/lib/ai.ts` picks the product's AI provider by which of `OPENAI_API_KEY` / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` exists, and that choice is shown in the App Store consent notice, so the agents must not share those names. Run `supabase/crew.sql` once before anything else.

| Key | What it does — and what breaks when it's missing |
|---|---|
| `CREW_ANTHROPIC_API_KEY` | Admin agent tooling only. Anthropic API key every agent's Claude calls use (Sonnet 5.5 workers, Opus 5.5 managers, optional Fable 5.1 head). Also add it as a GitHub Actions secret of the same name for the fix-PR workflow. Missing = every agent shows "Needs: CREW_ANTHROPIC_API_KEY". |
| `CREW_OPENAI_API_KEY` | Admin agent tooling only. OpenAI API key for the second opinion on drafts (ChatGPT via the Responses API, never a ChatGPT login). Missing = a second Claude "skeptic" pass is used instead and cards say "ChatGPT not connected". |
| `CREW_OPENAI_MODEL` | Admin agent tooling only. Which OpenAI model gives the second opinion (pick the current one at platform.openai.com/docs/models). Required with the key. |
| `CREW_OPENAI_PRICE` | Admin agent tooling only. Optional "input,output" $ per million tokens for that model, so the usage meter is exact. Unset = a conservative default that over-counts. |
| `CREW_TICK_SECRET` | Admin agent tooling only. Long random string. Same value in Vercel and as a GitHub Actions secret: `crew-tick.yml` (every 15 min) and the monitor ingest steps send it as a Bearer token. Missing = `/api/crew/tick` and `/api/crew/ingest` are 404 and no agent ever runs on schedule. |
| `CREW_DISABLED` | Admin agent tooling only. `1` stops every agent at once with no database needed (the hard kill switch). |
| `CREW_FAKE_LLM` | Development only. `1` swaps in deterministic fake models for local dry runs. Ignored in production. |
| `CREW_GITHUB_TOKEN` | Admin agent tooling only. Fine-grained GitHub token for this repo only (Actions, Contents, Pull requests: read/write). Lets an approved Watchdog fix open a pull request; it never merges. Missing = fixes stay as a written plan on the card. |
| `CREW_STRIPE_READ_KEY` | Admin agent tooling only. Stripe **restricted, read-only** key for the payments pair (failed charges, trials that didn't convert, plan drift). Missing = those two agents stay off. |
| `REDDIT_CLIENT_ID` | Admin agent tooling only. Reddit app client id (app-only OAuth, read only) for the Reddit replies, DM and lead agents. Missing = Reddit agents fall back to web search. |
| `REDDIT_CLIENT_SECRET` | Admin agent tooling only. Same Reddit app's secret. |
| `REDDIT_USER_AGENT` | Admin agent tooling only. Reddit requires a descriptive user agent, e.g. `web:me.swiftcard.crew:v1 (by /u/yourname)`. |
| `GOOGLE_SHEETS_SA_JSON` | Admin agent tooling only. A Google Cloud service-account key (the whole JSON) for the lead sheets. Share each sheet with the key's `client_email`. Missing = leads stay in the Agents tab (with CSV download) and nothing is written to Sheets. |
| `CREW_LEADS_SHEET_ID` | Admin agent tooling only. Id of the cold-lead sheet (from its URL). |
| `CREW_OFFICE_SHEET_ID` | Admin agent tooling only. Id of the Office-prospects call sheet. |
| `VERCEL_TOKEN` | Admin agent tooling only. Optional; lets the security agent read traffic data. Also used by the deploy watchdog workflow (as a GitHub secret). |
