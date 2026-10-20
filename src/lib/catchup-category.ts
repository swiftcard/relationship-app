import type { PushCategory } from "@/lib/push-policy";
import { FORWARDED_OPEN_TITLE } from "@/lib/contact-return-notify";

// ── Which overnight bell rows the 8am catch-up may announce ─────────────────
//
// Only rows whose producer asked for a push could have been held by quiet
// hours. The row's `type` mostly says which, but a visit's row is upgraded in
// place as the visit goes on (lib/visit-notify.ts), so the type is the LAST
// thing that happened, not the thing that buzzed:
//
//   - contact_engaged is the returning contact's visit (which pushed) after
//     they tapped a link (which upgrades in silence). Still that visit.
//   - milestone_<N> is a view (which pushed, retitled with the milestone)
//     that crossed N. Leaving it out lost exactly the view the product most
//     wants to celebrate (audit NM-03). With a lead_id it was a returning
//     contact's visit.
//   - contact_returned is ALSO the forwarded-link note, which is bell only
//     (D3) and never had a push to hold (audit NM-01). Same type, own title.

const CATEGORY_FOR_TYPE: Record<string, PushCategory> = {
  card_viewed: "card_view",
  contact_saved: "contact_saved",
  contact_returned: "contact_return",
  contact_engaged: "contact_return",
  new_lead: "new_lead",
  lead_reply: "lead_reply",
  payment_failed: "billing_problem",
};

export type HeldRow = { type?: unknown; title?: unknown; lead_id?: unknown };

export function heldCategory(row: HeldRow): PushCategory | undefined {
  const type = String(row.type ?? "");
  if (type.startsWith("milestone_")) return row.lead_id ? "contact_return" : "card_view";
  if (type === "contact_returned" && row.title === FORWARDED_OPEN_TITLE) return undefined;
  return CATEGORY_FOR_TYPE[type];
}

/** Categories whose row names a contact the owner can mark closed. A closed
 *  contact never buzzes live (contactMayPush), so the morning must not either:
 *  that held for returns, not for the same contact downloading the card again
 *  (audit NM-02). */
export const CONTACT_RULE_CATEGORIES: readonly PushCategory[] = ["contact_return", "contact_saved"];
