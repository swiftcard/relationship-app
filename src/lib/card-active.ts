import { getAdminSupabase } from "@/lib/supabase-admin";
import { PLAN_LIMITS, isPaidPlan } from "@/lib/plan";
import { PLAN_STEP_REQUIRED_SINCE } from "@/lib/billing-state";

// ── Central "is this card allowed to be public?" kill-switch ────────────────
// EVERY public surface (card page, Swift Links, OG/share image, Apple Wallet
// pass, lead capture, vCard) must consult this so there is no bypass:
//
//   1. DELETED account  → every card, link, QR, signature link, and wallet
//      pass of that account is inactive.
//   2. DELETED card     → the row is gone; nothing resolves (handled by the
//      lookups themselves).
//   3. DOWNGRADED plan  → a Free account only serves FREE_CARD_LIMIT card(s):
//      the one it chose when Pro ended, else the oldest (pickFreeLiveCardIds).
//      Extra cards created on Pro go
//      inactive the moment the plan is no longer paid — links, QRs, NFC
//      tags, wallet passes and lead capture for them all stop working.
//      Their remaining Free-plan card's links keep working.
//   4. TAKEN OFFLINE    → an office admin pulled the card from /office/admin.
//      Everything the card serves goes dark, but nothing is deleted, so it can
//      be brought back online. Used when an employee leaves.
//   5. NO PLAN CHOSEN   → a NEW account's card is not live until its owner has
//      chosen a plan (owner, 2026-09-16: create the account → the card isn't
//      live yet → choose Pro, Office or Free → then it goes live). The owner
//      can still see it; nobody else can.

/** The owner fields rule 5 reads. */
export type PlanGateOwner = {
  plan?: string | null;
  customization?: unknown;
  created_at?: string | null;
  office_id?: string | null;
};

/**
 * Rule 5: is this owner's card still waiting on the plan step?
 *
 * The same test the dashboard uses to send someone to /welcome, so "not live"
 * and "go choose a plan" can never disagree:
 *   • a paid plan (Stripe, Apple, an admin grant) IS a choice;
 *   • "_planChosen" (lib/welcome-email PLAN_CHOSEN_KEY — written by Free,
 *     Stripe and Apple) is a choice;
 *   • an office member's plan is the team's, never theirs to choose;
 *   • accounts from before PLAN_STEP_REQUIRED_SINCE were never asked, and stay
 *     exactly as live as they were. A row without created_at is treated the
 *     same way — fail open, never take an existing card down.
 */
export function awaitingPlanChoice(owner: PlanGateOwner | null | undefined): boolean {
  if (!owner) return false;
  if (isPaidPlan(owner.plan)) return false;
  if (owner.office_id) return false;
  const c = (owner.customization as { _planChosen?: unknown; _proEndedChoicePending?: unknown; _trialEnded?: unknown } | null) ?? null;
  if (c?._planChosen) return false;
  // Someone who HAD Pro (a referral free month, an app trial) that has since
  // ended already went through a plan — their card must stay live on Free
  // (2026-09-16 website audit: a referred user's card went dark when the free
  // month expired, because they never saw the plan step).
  if (c?._proEndedChoicePending || c?._trialEnded) return false;
  return typeof owner.created_at === "string" && owner.created_at >= PLAN_STEP_REQUIRED_SINCE;
}

export function ownerIsDeleted(customization: unknown): boolean {
  return !!(customization as { _deleted?: boolean } | null)?._deleted;
}

// Whether an office admin has taken this card offline. A missing column
// (pre office-primary-card.sql) reads as undefined → the card stays live.
export function cardIsOffline(cardRow: unknown): boolean {
  return (cardRow as { is_offline?: boolean } | null)?.is_offline === true;
}

/**
 * Which cards a Free account serves, given its cards OLDEST FIRST and the card
 * it chose to keep live when Pro ended (profiles.free_live_card_id).
 *
 * The ONE statement of this rule. It used to be "the oldest FREE_CARD_LIMIT
 * cards", written out separately here, in the card PATCH route, on /share and
 * in the dashboard's card list — so letting someone pick which card survives
 * would have meant four edits that could drift. A choice that no longer points
 * at one of their cards (deleted, or never theirs) is ignored and the oldest
 * card rule applies, which is exactly today's behaviour for every account that
 * never chose.
 */
export function pickFreeLiveCardIds(orderedCardIds: string[], chosenCardId: string | null | undefined): string[] {
  const chosen = chosenCardId && orderedCardIds.includes(chosenCardId) ? chosenCardId : null;
  const order = chosen ? [chosen, ...orderedCardIds.filter((id) => id !== chosen)] : orderedCardIds;
  return order.slice(0, PLAN_LIMITS.FREE_CARD_LIMIT);
}

/** The live card ids for a Free account, read from the database. */
export async function freeLiveCardIds(userId: string): Promise<string[]> {
  const admin = getAdminSupabase();
  const [{ data: cards }, { data: profile, error }] = await Promise.all([
    admin.from("cards").select("id").eq("user_id", userId).order("created_at", { ascending: true }),
    admin.from("profiles").select("free_live_card_id").eq("id", userId).maybeSingle(),
  ]);
  // Before supabase/pro-trial-safeguards.sql the column does not exist and the
  // select errors — treat that as "never chose", i.e. the oldest-card rule.
  const chosen = error ? null : ((profile as { free_live_card_id?: string | null } | null)?.free_live_card_id ?? null);
  return pickFreeLiveCardIds((cards ?? []).map((c: { id: string }) => c.id), chosen);
}

// Whether this card falls within its owner's plan allowance. Cheap: only
// queries when the owner is NOT paid.
export async function cardWithinPlanLimit(
  cardId: string,
  userId: string,
  plan: string | null | undefined
): Promise<boolean> {
  if (isPaidPlan(plan)) return true;
  return (await freeLiveCardIds(userId)).includes(cardId);
}

// One-call resolver for API routes: is the card slug live right now?
// (Legacy profile-cards count as the account's primary card — always within
// the Free allowance.)
export async function isCardActive(username: string): Promise<boolean> {
  const admin = getAdminSupabase();
  // Only the three columns this reads. It runs on every card view, lead and
  // tracked tap, and used to pull the whole card (its design included) each
  // time. is_offline is named outright: the column is in the live schema
  // (checked 2026-11-15), and leaving it out would reopen an offline card.
  const { data: cardRow } = await admin
    .from("cards")
    .select("id, user_id, is_offline")
    .eq("username", username)
    .maybeSingle();

  if (cardRow) {
    if (cardIsOffline(cardRow)) return false;
    const { data: owner } = await admin
      .from("profiles")
      .select("plan, customization, created_at, office_id")
      .eq("id", cardRow.user_id)
      .maybeSingle();
    if (!owner || ownerIsDeleted(owner.customization)) return false;
    if (awaitingPlanChoice(owner)) return false;
    return cardWithinPlanLimit(cardRow.id, cardRow.user_id, owner.plan);
  }

  const { data: profileRow } = await admin
    .from("profiles")
    .select("name, customization")
    .eq("username", username)
    .maybeSingle();
  if (!profileRow || ownerIsDeleted(profileRow.customization)) return false;
  const cust = profileRow.customization as { _migrated?: boolean } | null;
  return !cust?._migrated && !!profileRow.name; // legacy un-migrated profile-card
}
