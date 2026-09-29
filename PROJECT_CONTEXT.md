# Swisscard — Project Context

## What This App Is

**Swisscard** is a digital business card + lead CRM app.

- Users create a card → get a public URL at `/card/[username]`
- Anyone who views the card can tap **Save Contact** (downloads a .vcf) or fill out **Share My Info Back**
- Card owner sees all captured leads in a dashboard with analytics, pipeline, notes, and follow-up automation
- Cards share by link, QR code, or NFC — no app needed for the viewer

---

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16.2.9 — App Router, TypeScript |
| Styling | Tailwind CSS v4 with `@theme inline` |
| Database + Auth | Supabase (Postgres + RLS + Auth) |
| Hosting | Vercel |
| Email | Resend (installed) |
| SMS | Twilio (installed) |
| AI messages | Anthropic SDK — model `claude-haiku-4-5-20251001` |
| Payments | Stripe (partially wired) |

---

## CRITICAL PATTERN — Never Break This

```ts
// Every API route must follow this pattern:
const supabase = await createClient();            // auth ONLY
const { data: { user } } = await supabase.auth.getUser();
const admin = getAdminSupabase();                 // ALL DB reads and writes
```

Using `createClient()` for DB writes causes silent RLS failures. Always use `getAdminSupabase()` for any database operation beyond `getUser()`.

---

## Design System

**Public pages** (landing, card page, pricing):
- Background: `#FAF7F2` (cream)
- Card surfaces: `#EDE5D8`, border `#D4C8B8`
- Brand blue: `#1D4ED8`, hover `#1740C4`
- Text: `text-slate-900` primary, `text-slate-500` secondary
- Border: `#E4DDD4`

**Dashboard** (dark):
- Background: `#111827` / `bg-gray-950`
- Cards: `#1f2937` / `bg-gray-900`, border `border-gray-800`
- Text: `text-white`, `text-gray-400`

**NEVER** white or light text on cream backgrounds.

---

## Plan Tiers

| Feature | Free | Pro | Enterprise |
|---|---|---|---|
| Cards | 2 | Unlimited | Unlimited |
| Leads | 25 | Unlimited | Unlimited |
| Analytics | Basic | Full + location | Full |
| Branding | Swisscard watermark | Removed | Removed |
| Zapier | ✗ | ✓ | ✓ |
| CSV export | ✗ | ✓ | ✓ |

---

## Database Tables

### Core (original)
| Table | Key columns |
|---|---|
| `profiles` | `id`, `username`, `name`, `title`, `company`, `email`, `phone`, `website`, `instagram`, `twitter`, `tiktok`, `linkedin`, `photo_url`, `logo_url`, `template`, `plan`, `customization` (json), `zapier_webhook_url`, `flow_settings` (json) |
| `cards` | `id`, `user_id`, `username`, `name`, `title`, `company`, `phone`, `email`, `website`, `linkedin`, `instagram`, `twitter`, `tiktok`, `template` |
| `leads` | `id`, `card_owner` (username FK), `name`, `email`, `phone`, `message`, `notes`, `status`, `tags` (text[]), `source`, `visitor_id`, `created_at` |
| `card_views` | `id`, `username`, `location`, `viewed_at` |
| `card_events` | `id`, `card_owner_username`, `visitor_id`, `event_type`, `source`, `created_at` |
| `notifications` | `id`, `user_id`, `type`, `title`, `body`, `read`, `created_at` |
| `offices` / `office_members` | Enterprise team feature |
| `integrations` | Google + HubSpot connections |

### Email system (added — run `supabase/email-system.sql` once)
| Table | Purpose |
|---|---|
| `email_preferences` | Per-user marketing/receipt opt-in + `unsubscribe_token` |
| `promo_codes` | Admin-created discount codes with expiry, usage cap, plan target |
| `promo_code_redemptions` | Tracks who redeemed which code |
| `email_logs` | Audit trail — every sent email logged here |

---

## Per-Lead Flow State (uses tags — no migration needed)

Reserved values in `leads.tags text[]`:
- `"flow-paused"` — automation is off for this lead
- `"preset-1"` / `"preset-2"` / `"preset-3"` — active follow-up preset

Flow presets live in `profiles.flow_settings.presets` (JSONB):
```json
{
  "1": { "name": "Warm Touch", "days": [1, 7] },
  "2": { "name": "Standard",   "days": [1, 15, 30] },
  "3": { "name": "Long-term",  "days": [7, 30, 60] }
}
```

---

## App Pages

| Route | File | Notes |
|---|---|---|
| `/` | `src/app/page.tsx` | Landing page, cream theme, hand-crafted phone mockup hero |
| `/dashboard` | `src/app/dashboard/page.tsx` | 2-column dark dashboard |
| `/card/[username]` | `src/app/card/[username]/page.tsx` | Public card — works for profiles AND extra cards |
| `/profile` | `src/app/profile/page.tsx` | Edit PRIMARY card (profiles table) |
| `/templates` | `src/app/templates/page.tsx` | Choose template for primary card |
| `/cards/new` | `src/app/cards/new/page.tsx` | Create additional card |
| `/cards/[id]/edit` | `src/app/cards/[id]/edit/page.tsx` | Edit extra card — info + template tabs, live preview |
| `/contacts` | `src/app/contacts/page.tsx` | Full contacts list, search, activity timeline |
| `/settings/flows` | `src/app/settings/flows/page.tsx` | Flows + email preferences + integrations |
| `/unsubscribe` | `src/app/unsubscribe/page.tsx` | Email unsubscribe landing |
| `/pricing` | `src/app/pricing/page.tsx` | Pricing |
| `/onboarding` | `src/app/onboarding/page.tsx` | New user setup |
| `/login` | `src/app/login/page.tsx` | Auth |

---

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/cards` | POST / GET | Create card (admin client) / list user's cards |
| `/api/cards/[id]` | PATCH / GET | Update or fetch individual extra card |
| `/api/leads` | POST | New lead from public card form |
| `/api/leads/[id]` | PATCH / DELETE | Update lead fields / delete lead |
| `/api/leads/manual` | POST | Manually add a contact from the Contacts page |
| `/api/leads/export` | GET | CSV export |
| `/api/ai/suggest-messages` | POST | Generate 3 AI follow-up messages via Haiku |
| `/api/sms/send` | POST | Send Twilio SMS to a lead |
| `/api/reminders` | POST | Cron — send follow-up reminder emails |
| `/api/welcome` | POST | Send welcome email on signup |
| `/api/admin/broadcast` | POST | Marketing email blast (protected by ADMIN_SECRET) |
| `/api/admin/promo-codes` | POST / GET | Create / list promo codes |
| `/api/admin/promo-codes/send` | POST | Email promo code to a user segment |
| `/api/promo/redeem` | POST | User redeems a promo code |
| `/api/settings/email-preferences` | PATCH / GET | User updates email opt-ins |
| `/api/settings/flows` | PATCH | Save flow preset config |
| `/api/unsubscribe` | GET / POST | One-click unsubscribe handler |
| `/api/stripe/webhook` | POST | Stripe events — plan upgrade + automated receipts |
| `/api/profile` | PATCH | Update primary card / template |
| `/api/notifications` | GET / PATCH | Fetch + mark notifications read |
| `/api/card-events` | POST / GET | Track card views, saves, downloads |
| `/api/upload` | POST | Photo/logo upload to Supabase Storage |

---

## Key Components

| Component | Purpose |
|---|---|
| `LeadCard.tsx` | Collapsible contact row — flow toggle, preset picker, AI messages, SMS send, notes save, delete |
| `LeadPipeline.tsx` | Kanban drag-and-drop pipeline (dark theme) |
| `AddContactModal.tsx` | Manual contact entry modal |
| `FlowSettingsForm.tsx` | Configure flow presets + day/time toggles |
| `EmailPreferencesForm.tsx` | Marketing + receipt email toggles (in Settings) |
| `CardEditForm.tsx` | Edit extra cards — info tab + design tab + live preview |
| `LeadCaptureForm.tsx` | Public "Share your info" form — shows "Try 1 Month Free" promo on submit |
| `SaveContactButton.tsx` | Downloads .vcf + tracks events |
| `ProfileForm.tsx` | Edit primary card info + template |
| `ContactsClient.tsx` | Contacts page UI — search, alphabetical list, activity timeline |
| `NotificationBell.tsx` | Bell icon with unread badge |

---

## Lib Files

| File | Purpose |
|---|---|
| `src/lib/supabase-admin.ts` | `getAdminSupabase()` — service role, bypasses RLS |
| `src/lib/supabase-server.ts` | `createClient()` — user-scoped, for auth only |
| `src/lib/supabase.ts` | `getSupabase()` — anon client |
| `src/lib/email-templates.ts` | `welcomeEmail()`, `promoEmail()`, `receiptEmail()`, `marketingEmail()`, `unsubUrl()` |
| `src/lib/visitor.ts` | `getVisitorId()` — sessionStorage UUID for anonymous tracking |
| `src/lib/source-labels.ts` | `getSourceLabel()` — human-readable source labels |

---

## Card Templates (5 total)

All in `src/components/card-templates/`:
- `ClassicPro.tsx` — navy + white, corporate
- `ModernBold.tsx` — dark electric, big name
- `PhotoFirst.tsx` — full-height photo panel
- `LocalBusiness.tsx` — amber stripe, warm cream
- `LuxuryMinimal.tsx` — ivory + gold, editorial
- `shared.tsx` — shared icons and `formatPhone()`
- `types.tsx` — `CardData` type, `SAMPLE_DATA`, `MiniQR`

---

## Planned Features (not yet built)

- QR/barcode bigger and easier to scan, pinned bottom-right of cards
- Notifications when someone saves a card or shares info (partially built — `notifications` table exists)
- Phone required, email optional on lead capture form
- AI follow-up messages (API built, UI in LeadCard)
- Promo code input on pricing/checkout page (API built, no UI yet)
- Stripe + Twilio fully wired (waiting on keys)

---

## Working Session Rules

- Read this file at the start of every session
- Only open files needed for the current task — use `grep` to find things
- One focused task at a time
- After every change: list files touched + one-line test instruction
- Never use `createClient()` for DB writes
- Never add dependencies without checking `package.json`
