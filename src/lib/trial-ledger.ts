import { createHash } from "node:crypto";
import { getAdminSupabase } from "./supabase-admin";
import { normEmail } from "./referral-server";

// ── One Pro trial per PERSON, not per account ────────────────────────────────
//
// trial-eligibility.ts used to ask Stripe one question: has this CUSTOMER ever
// subscribed? A new email is a new customer, so a second account — or the same
// email after the 30-day account purge — got a second 14-day trial with the
// same card. This ledger remembers who has had one, keyed by one-way hashes so
// it holds no readable personal data, and lib/account-purge.ts never touches it
// (supabase/pro-trial-safeguards.sql).
//
//   card            the Stripe card fingerprint a trial started on
//   email_trial     the normalised account email a trial started on
//   email_retention the email that took the delete-flow free days
//   email_retention_discount / card_retention_discount
//                   the email / card that took the 50%-off retention offer —
//                   one per PERSON, not per account (owner, 2026-09-30)
//
// FAILS OPEN on a missing table or a read error: the ledger narrows who gets a
// free trial, and an outage in it must never stop someone paying or signing up.

export type LedgerKind =
  | "card"
  | "email_trial"
  | "email_retention"
  | "email_retention_discount"
  | "card_retention_discount";

const CARD_KINDS: readonly LedgerKind[] = ["card", "card_retention_discount"];

export function ledgerKey(kind: LedgerKind, raw: string): string {
  const value = CARD_KINDS.includes(kind) ? raw.trim() : normEmail(raw);
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

/** Has this card / email already been used for `kind`? Unknown → false. */
export async function ledgerHas(kind: LedgerKind, raw: string | null | undefined): Promise<boolean> {
  if (!raw || !raw.trim()) return false;
  try {
    const { data, error } = await getAdminSupabase()
      .from("trial_ledger")
      .select("kind")
      .eq("kind", kind)
      .eq("key_hash", ledgerKey(kind, raw))
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

/**
 * The history isProTrialEligible needs, read tolerantly: a separate select so
 * a database without supabase/pro-trial-safeguards.sql (no column) can never
 * break the caller's own profile query — it just reads as "no trial recorded".
 */
export async function trialHistoryFor(
  userId: string,
  accountEmail: string | null | undefined,
): Promise<{ proTrialStartedAt: string | null; accountEmail: string | null; referralGiftOffered: boolean }> {
  // The two reads are independent, so they run together: one database round
  // trip of wait instead of two, on every page that asks (dashboard, /upgrade,
  // /checkout). Each keeps its own fallback.
  const [referralGiftOffered, proTrialStartedAt] = await Promise.all([
    // A friend's free month on offer IS this account's free Pro period — the
    // 14-day trial is not offered or granted beside it (fails open to false).
    (async () => {
      try {
        const { referralGiftOffered: offered } = await import("./referral-server");
        return await offered(userId);
      } catch { return false; /* no record → no gift */ }
    })(),
    (async (): Promise<string | null> => {
      try {
        const { data, error } = await getAdminSupabase()
          .from("profiles")
          .select("pro_trial_started_at")
          .eq("id", userId)
          .maybeSingle();
        return error ? null : (data as { pro_trial_started_at?: string | null } | null)?.pro_trial_started_at ?? null;
      } catch { return null; /* pre-migration */ }
    })(),
  ]);
  return { proTrialStartedAt, accountEmail: accountEmail ?? null, referralGiftOffered };
}

/**
 * A Pro trial just started on this account (Stripe trialing checkout, or an
 * Apple intro offer). Stamps profiles.pro_trial_started_at — which nothing ever
 * clears — and the email ledger, so neither this account nor this email is
 * offered another. Best-effort and idempotent; never throws.
 */
export async function recordProTrialStarted(userId: string, accountEmail: string | null | undefined): Promise<void> {
  await ledgerAdd("email_trial", accountEmail);
  try {
    await getAdminSupabase()
      .from("profiles")
      .update({ pro_trial_started_at: new Date().toISOString() })
      .eq("id", userId)
      .is("pro_trial_started_at", null);
  } catch { /* pre-migration: the column does not exist yet */ }
}

/**
 * Record that this card / email has used `kind`. Returns true when THIS call
 * wrote the row (first use), false when it was already there or the write
 * could not be made. Idempotent: a replayed webhook simply gets false.
 */
export async function ledgerAdd(kind: LedgerKind, raw: string | null | undefined): Promise<boolean> {
  if (!raw || !raw.trim()) return false;
  try {
    const { data, error } = await getAdminSupabase()
      .from("trial_ledger")
      .upsert({ kind, key_hash: ledgerKey(kind, raw) }, { onConflict: "kind,key_hash", ignoreDuplicates: true })
      .select("kind");
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}
