# Email preference centre

Preference-first unsubscribe for SwiftCard marketing mail. **The rules below are
legal and deliverability requirements, not product preferences. Do not weaken
them.** `tests/email-preference-center.test.ts` enforces every one of them.

## The flow

A marketing email carries two exits, and it needs both:

1. **A visible footer link** — "Manage email preferences" → `/email/preferences?t=<token>`.
   The token is an HMAC-signed user id with a 90-day expiry (`src/lib/email-token.ts`).
   **No login.** Someone reading mail on a phone will not sign in to stop it;
   they will press the spam button, and that costs the whole sending domain.
2. **The `List-Unsubscribe` headers** — mailto + https, plus
   `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, which is what draws the
   unsubscribe control **inside Gmail and Apple Mail**. That control POSTs to
   `/api/email/one-click-unsubscribe`.

On the preference page everything happens **on that one page** — no navigation,
no modal, no interstitial:

- four category switches, pre-filled, each labelled with its frequency;
- **Save preferences**;
- **Pause everything for 30 days**;
- **Unsubscribe from all marketing emails** — a body-size, full-contrast link,
  above the fold on a 375px screen;
- clicking it expands an inline panel offering *Pause 30 days* before **No thanks, unsubscribe me**, which completes the
  opt-out on that click;
- afterwards the page becomes "You're unsubscribed." plus an **optional**
  one-tap reason survey that gates nothing.

## The hard rules

| Rule | Why | Where it lives |
|---|---|---|
| Full opt-out in exactly **two clicks** from the footer link | CAN-SPAM: the mechanism must be simple. Gmail treats friction as a reason people hit "report spam" instead | `PreferenceCenter.tsx` |
| **No login, no form field, no CAPTCHA, no countdown** | Same | `PreferenceCenter.tsx`, token auth |
| One-click endpoint **never redirects** | A provider follows a 3xx and scores the result; a redirect is how an opt-out is recorded as honoured while the mail keeps coming. It shipped that way here once already | `one-click-unsubscribe/route.ts` |
| One-click **answers in under 2s and takes effect immediately** | Providers time out and retry; a slow endpoint looks broken | one write, no fan-out |
| Opt-outs are effective **in the send path**, not at the next campaign build | CAN-SPAM's 10-day rule is a ceiling, not a target | `canSendMarketing()` |
| **Transactional mail is never affected** — auth, password reset, lead notifications, billing, receipts | A receipt is not marketing. Withholding one is a worse failure than sending it | those senders never call the gate; tested |
| Transactional mail carries **no** marketing footer and **no** `List-Unsubscribe` | Attaching them tells Gmail the message is bulk, which is how a receipt lands in Promotions | `layout()` takes the URLs only for marketing templates |
| The unsubscribe link is **not** small, low-contrast, or below the fold | Regulators and mailbox providers both read that as a dark pattern | pinned by test |

## The gate

Every marketing send calls it. There is no second path:

```ts
import { canSendMarketing } from "@/lib/marketing-consent";

if (!(await canSendMarketing(userId, "promotions"))) continue;   // one recipient
const allowed = await marketingAudience(ids, "product_updates"); // a campaign
```

Categories: `lead_tips`, `product_updates`, `digest`, `promotions`. Only
`product_updates` and `promotions` have a switch on the page: nothing sends a
lead-tips or digest email yet, so those rows (and the "Monthly digest only"
offer) were removed on 2026-10-06. The flags are still stored.

It returns false when **any** of these is true — full opt-out (either flag), a
`paused_until` in the future, or the category switch being off. It **fails
closed**: if the preferences row cannot be read, nothing is sent. Mailing
someone whose opt-out we could not confirm is far more expensive than a
marketing email nobody receives.

### Two flags, one truth

`marketing_opt_out` is the new authoritative switch. `marketing_emails` is the
legacy one that older senders still read. **Every write path sets both**, and
the gate treats either as a suppression. Do not "simplify" to one column until
nothing reads `marketing_emails` — an opt-out that lands in only one of them is
an opt-out we keep failing to honour.

## Data

`supabase/email-preference-center.sql` — run it in the SQL editor; it is
re-runnable. It **adds columns to the existing `email_preferences` table**
(which already carries `receipt_emails`, gating Stripe receipts, and
`unsubscribe_token`, which the older one-click URL resolves — neither is
touched), creates `unsubscribe_events`, backfills existing opt-outs into the new
flag, and enables RLS so a signed-in user reads and updates only their own row.
The token routes use the service-role client, which is what lets the page work
with no login.

`unsubscribe_events` exists because CAN-SPAM puts the burden of proof on us, and
because it is the only way to tell a footer opt-out from a Gmail one-click one.
It is append-only by policy: an audit trail you can delete is not proof.

## Analytics

`email_preferences_saved`, `email_paused_30d`,
`email_full_unsubscribe`, `email_unsubscribe_reason_given` — registered in
`src/lib/events.ts`. Opt-out events carry the source in `variant`
(`footer` | `one_click_header`).

## If you are about to change something here

Ask whether the change makes the exit **harder to find, slower, or conditional**.
If it does, it is the thing this system exists to prevent — and the cost is not
a lawsuit first, it is the spam complaints that take the sending domain down
with them, including the card-share emails the product exists to send.
