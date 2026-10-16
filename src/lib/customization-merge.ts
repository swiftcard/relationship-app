import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { canonicalJson } from "@/lib/profile-customization";

// ── Writing only the keys you changed (audit B-03) ───────────────────────────
//
// profiles.customization is one JSONB column many writers share. Writing the
// whole object back from a copy erased whatever another writer set in
// between: a checkout fires checkout.session.completed,
// customer.subscription.updated and invoice.payment_succeeded within the same
// second, and the last one to finish decided which of _planSource,
// _planChosen, _everPaid and the trial mirror survived.
//
// Every server write now names only the keys it changed and hands them to the
// database function merge_customization (supabase/merge-customization.sql),
// which applies `(customization - remove) || set` in one statement under the
// row's lock. A key nobody here touched is never written.

export type CustomizationChanges = { set: Record<string, unknown>; remove: string[] };

/** What turning `before` into `after` changed: keys added or changed, and keys removed. */
export function customizationDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
): CustomizationChanges {
  const prev = before ?? {};
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) {
    if (v === undefined) continue;
    if (!(k in prev) || canonicalJson(prev[k]) !== canonicalJson(v)) set[k] = v;
  }
  const remove = Object.keys(prev).filter((k) => !(k in after) || after[k] === undefined);
  return { set, remove };
}

/**
 * Apply `set` and `remove` to this person's customization atomically.
 *
 * `requireSub`: only while profiles.stripe_subscription_id is still that
 * subscription (the webhook's guard against a stale retry). `requirePlan`:
 * only while profiles.plan is still that plan. Resolves to the
 * new customization, or null when nothing matched or the write failed (the
 * failure is logged; callers treat these writes as best-effort, as before).
 */
export async function mergeCustomization(
  userId: string,
  changes: CustomizationChanges,
  opts: { requireSub?: string | null; requirePlan?: string | null; admin?: SupabaseClient } = {},
): Promise<Record<string, unknown> | null> {
  if (!Object.keys(changes.set).length && !changes.remove.length) return {};
  const admin = opts.admin ?? getAdminSupabase();
  const { data, error } = await admin.rpc("merge_customization", {
    p_user: userId,
    p_set: changes.set,
    p_remove: changes.remove,
    p_require_sub: opts.requireSub ?? null,
    p_require_plan: opts.requirePlan ?? null,
  });
  if (error) {
    console.error("[customization] merge failed:", error.message ?? error);
    return null;
  }
  return (data as Record<string, unknown> | null) ?? null;
}

/** The common case: a copy was edited; write back only what differs from the original. */
export function writeCustomizationChanges(
  userId: string,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  opts: { requireSub?: string | null; requirePlan?: string | null; admin?: SupabaseClient } = {},
): Promise<Record<string, unknown> | null> {
  return mergeCustomization(userId, customizationDiff(before, after), opts);
}
