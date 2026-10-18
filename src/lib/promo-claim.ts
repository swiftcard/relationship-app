import type { SupabaseClient } from "@supabase/supabase-js";

// ── Take one use of a promo code, atomically ─────────────────────────────────
//
// uses_count used to be read, checked against max_uses, and written back as
// read+1. Twenty accounts redeeming a 5-use grant code at the same moment all
// passed the check and all wrote "1": a leaked limited code (free Pro, or an
// Office with seats, no card) could be used far past its limit (security
// audit 2026-09-24).
//
// Compare-and-set instead: the UPDATE only lands while uses_count still holds
// the value we read AND is under the cap. A lost race re-reads and tries again.
// Returns false once the code is used up — the caller must then undo the
// redemption it recorded.
export async function claimPromoUse(admin: SupabaseClient, promoId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: row } = await admin
      .from("promo_codes")
      .select("uses_count, max_uses")
      .eq("id", promoId)
      .maybeSingle();
    if (!row) return false;
    const used = Number(row.uses_count ?? 0);
    const max = row.max_uses == null ? null : Number(row.max_uses);
    if (max != null && used >= max) return false;
    // uses_count is nullable (default 0); a NULL row is matched as such.
    const q = admin.from("promo_codes").update({ uses_count: used + 1 }).eq("id", promoId);
    const { data: won } = await (row.uses_count == null ? q.is("uses_count", null) : q.eq("uses_count", used)).select("id");
    if (won && won.length > 0) return true;
  }
  return false;
}

/** Give one use back, by the same compare-and-set. Never below zero. */
export async function releasePromoUse(admin: SupabaseClient, promoId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: row } = await admin.from("promo_codes").select("uses_count").eq("id", promoId).maybeSingle();
    if (!row) return false;
    const used = Number(row.uses_count ?? 0);
    if (used <= 0) return false;
    const { data: won } = await admin.from("promo_codes").update({ uses_count: used - 1 }).eq("id", promoId).eq("uses_count", used).select("id");
    if (won && won.length > 0) return true;
  }
  return false;
}

/** A Stripe Checkout page lives at most 24 hours; past this, nobody can still pay on it. */
export const ABANDONED_CLAIM_MS = 25 * 60 * 60 * 1000;

// ── Give back the uses of checkouts nobody finished (audit B-18) ────────────
//
// A money-off or free-days code is claimed — counted against max_uses — when
// checkout opens a payment page for it, and marked spent (consumed_at) by the
// webhook when that purchase completes. Nothing ever gave back a claim whose
// page was abandoned, so a capped code ran out on people who never bought.
// Run daily: a claim unspent for longer than any payment page can live is
// released and its use returned. Grant codes are left alone: they are spent
// the moment they are applied and never carry consumed_at. Returns how many.
export async function releaseAbandonedPromoClaims(admin: SupabaseClient, nowMs: number = Date.now()): Promise<number> {
  const cutoff = new Date(nowMs - ABANDONED_CLAIM_MS).toISOString();
  const { data: stale, error } = await admin
    .from("promo_code_redemptions")
    .select("id, code_id")
    .is("consumed_at", null)
    .lt("redeemed_at", cutoff)
    .limit(500);
  if (error || !stale?.length) return 0;
  const codeIds = [...new Set(stale.map((r) => r.code_id as string))];
  const { data: codes } = await admin.from("promo_codes").select("id, discount_type").in("id", codeIds);
  const releasable = new Set((codes ?? []).filter((c) => c.discount_type !== "grant").map((c) => c.id as string));
  let released = 0;
  for (const r of stale) {
    if (!releasable.has(r.code_id as string)) continue;
    // Conditional on still being unspent, so a purchase completing at this
    // very moment keeps its claim.
    const { data: gone } = await admin
      .from("promo_code_redemptions")
      .delete()
      .eq("id", r.id as string)
      .is("consumed_at", null)
      .select("id");
    if (!gone?.length) continue;
    await releasePromoUse(admin, r.code_id as string);
    released += 1;
  }
  return released;
}
