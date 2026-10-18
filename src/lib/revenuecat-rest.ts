import { IAP_ENTITLEMENT } from "./iap-shared";

/**
 * Does RevenueCat say this account holds an active Pro entitlement right now?
 *
 *   true  — yes, it does
 *   false — no, it does not
 *   null  — can't tell (no REVENUECAT_SECRET_KEY, RevenueCat down, bad reply)
 *
 * Asked by the webhook where an event alone doesn't settle it: the account a
 * subscription was TRANSFERRED away from (only take Pro off if it really has
 * none left), and a refund (RevenueCat reports it as a CANCELLATION, which is
 * normally "auto-renew switched off, access continues"). Callers decide what
 * `null` means for them; nothing here writes.
 */
export async function rcProActive(uid: string): Promise<boolean | null> {
  const secret = process.env.REVENUECAT_SECRET_KEY;
  if (!secret) return null;
  try {
    const r = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      // No answer is "unknown" (null), never a hung webhook (audit I-01).
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const ent = d?.subscriber?.entitlements?.[IAP_ENTITLEMENT];
    if (!ent) return false;
    return !ent.expires_date || new Date(ent.expires_date).getTime() > Date.now();
  } catch {
    return null;
  }
}
