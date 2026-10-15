import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeCardScope, type CardScope } from "@/lib/crm-scope";

// Server-side half of the scope vocabulary: parsing the choice a client sends
// at CONNECT time and pinning it to cards the caller actually owns. The pure
// rules stay in crm-scope.ts; this file exists because ownership needs the DB.

/**
 * Parse the `cards` value a connect/save flow sends before a connection
 * exists. "all" (or absence) means all cards; a comma-separated uuid list
 * means only those. Returns undefined for junk so the caller can refuse
 * loudly instead of storing a scope the user didn't pick.
 */
export function parseCardsParam(raw: string | null | undefined): CardScope | undefined {
  if (raw === null || raw === undefined || raw === "" || raw === "all") return null;
  const scope = sanitizeCardScope(raw.split(","));
  if (!scope || scope.length === 0) return undefined;
  return scope;
}

/**
 * True when every id in `scope` belongs to `userId`. A foreign id would never
 * match at send time (fail closed), but it would be a scope the owner can't
 * see or reason about in their own UI — reject it up front instead.
 */
export async function scopeIsOwned(admin: SupabaseClient, userId: string, scope: CardScope): Promise<boolean> {
  if (scope === null || scope.length === 0) return true;
  const { data: owned } = await admin.from("cards").select("id").eq("user_id", userId).in("id", scope);
  const ownedIds = new Set((owned ?? []).map((c) => c.id as string));
  return scope.every((id) => ownedIds.has(id));
}

/** The start of the line a scope emptied by card deletion leaves — matched to clear it once cards are chosen again. */
export const SCOPE_EMPTIED_MARK = "The cards you chose to send from were deleted";

const SCOPE_LABEL: Record<string, string> = {
  google: "Google Contacts",
  hubspot: "HubSpot",
  pipedrive: "Pipedrive",
  highlevel: "GoHighLevel",
  salesforce: "Salesforce",
};

/**
 * A deleted card leaves every "only these cards" choice it was part of.
 *
 * Its id used to stay behind in integrations.card_ids / zapier_card_ids. Harmless
 * while another chosen card remained — but delete the LAST chosen card and the
 * destination still read "Connected" while nothing could ever be in its scope,
 * so it silently stopped receiving anything. Now the id is removed, and a choice
 * left empty says so on that connection instead of failing quietly. Best-effort:
 * a card delete must never fail over this.
 */
export async function dropCardFromScopes(admin: SupabaseClient, userId: string, cardId: string): Promise<void> {
  const empty = `${SCOPE_EMPTIED_MARK} — pick which cards to send from again.`;
  try {
    const { data: rows } = await admin.from("integrations").select("provider, card_ids").eq("user_id", userId);
    for (const r of rows ?? []) {
      const ids = Array.isArray(r.card_ids) ? (r.card_ids as string[]) : null;
      if (!ids?.includes(cardId)) continue;
      const left = ids.filter((x) => x !== cardId);
      // Left empty: back to "all cards" would send cards the owner excluded,
      // so it stays scoped-to-nothing and the banner asks them to choose.
      const label = SCOPE_LABEL[r.provider as string] ?? "This integration";
      await admin
        .from("integrations")
        .update(left.length ? { card_ids: left } : { card_ids: left, sync_error: `${label}: ${empty}` })
        .eq("user_id", userId)
        .eq("provider", r.provider);
    }
    const { data: prof } = await admin.from("profiles").select("zapier_card_ids").eq("id", userId).maybeSingle();
    const zids = Array.isArray(prof?.zapier_card_ids) ? (prof!.zapier_card_ids as string[]) : null;
    if (zids?.includes(cardId)) {
      const left = zids.filter((x) => x !== cardId);
      await admin
        .from("profiles")
        .update(left.length ? { zapier_card_ids: left } : { zapier_card_ids: left, zapier_error: `Zapier: ${empty}` })
        .eq("id", userId);
    }
  } catch { /* best-effort */ }
}
