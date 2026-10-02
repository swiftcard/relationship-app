import type Stripe from "stripe";
import { planFromPriceId } from "@/lib/subscription";
import { isApplePaid } from "@/lib/iap-entitlement";
import { ledgerHas } from "@/lib/trial-ledger";
import { trialExtensionFor, type TrialExtension } from "@/lib/trial-extension";

// The person-side half of "stretch the trial to a full month" (lib/trial-
// extension owns the subscription-side half). One function, asked by every
// door — the delete flow, Billing's cancel flow, and the route that applies it
// — so the offer is shown exactly where applying it will work.

export type TrialExtensionOffer = TrialExtension & {
  /** What the first charge will be, for the web price line (never shown in the app). */
  chargeCents: number | null;
  chargeInterval: "month" | "year";
};

/**
 * Has this ACCOUNT already had its retention free time — the Free plan's
 * delete-flow gift, or a stretched trial? Either one is the free month.
 */
export function retentionTimeTakenOnAccount(cust: Record<string, unknown>): boolean {
  const rec = cust._retention as { grantedAt?: unknown; trialExtendedAt?: unknown } | undefined;
  return typeof rec?.grantedAt === "string" || typeof rec?.trialExtendedAt === "string";
}

/**
 * The stretch this account could take right now, or null. An individual Pro
 * on Stripe only: Office is a seat-billed team plan, and an Apple trial is
 * Apple's. Fails closed on the account checks; the email ledger fails open
 * (lib/trial-ledger), and the account record plus the Stripe metadata stamp
 * still stand behind it.
 */
export async function trialExtensionOfferFor(opts: {
  plan: string | null | undefined;
  cust: Record<string, unknown>;
  sub: Stripe.Subscription;
  email: string | null | undefined;
  nowMs?: number;
}): Promise<TrialExtensionOffer | null> {
  if (opts.plan !== "pro") return null;
  if (isApplePaid(opts.cust)) return null;
  if (retentionTimeTakenOnAccount(opts.cust)) return null;
  const item = opts.sub.items?.data?.[0];
  const mapped = planFromPriceId(item?.price?.id);
  if (!mapped || mapped.plan !== "pro") return null;
  const ext = trialExtensionFor(opts.sub, opts.nowMs);
  if (!ext) return null;
  if (await ledgerHas("email_retention", opts.email)) return null;
  const unit = item?.price?.unit_amount ?? null;
  return {
    ...ext,
    chargeCents: unit != null ? unit * (item?.quantity ?? 1) : null,
    chargeInterval: mapped.interval === "annual" ? "year" : "month",
  };
}
