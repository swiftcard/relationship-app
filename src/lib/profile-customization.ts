import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/supabase-admin";

// ── Writing one key of profiles.customization without losing it ──────────────
//
// `customization` is a single JSONB column that several unrelated features
// share: the push switches and quiet-hours timezone (_push), the monthly free
// meters (_usage), the AI consent flag, the one-time migration marks. PostgREST
// has no partial JSONB update, so every writer does read-modify-write on the
// WHOLE object — and a writer holding a stale snapshot silently deletes
// whatever landed after it read.
//
// Measured, not theoretical (2026-09-11): on the first dashboard load of a new
// account the server runs two one-time migrations that each rewrite the column
// from the page's snapshot, while the browser reports its timezone. The PATCH
// returned 200, the client recorded "already reported", and _push was gone.
//
// The same race can erase `_usage`, and that one has a price: the free monthly
// contact meter resetting to zero is a month of free contacts, and the whole
// point of keeping the count on the ACCOUNT is that it cannot be reset by
// anything the owner does.
//
// So every write to a customization key goes through here, and here READS BACK
// what it wrote. A lost write is retried against the fresh object instead of
// being reported as a success.

const MAX_ATTEMPTS = 3;

/**
 * JSON with object keys SORTED, so two equal values compare equal.
 *
 * The read-back compared JSON.stringify of what was written with what came
 * back — but a jsonb column does not keep key order (it stores shorter keys
 * first), so {"period","leads","drafts"} came back as {"leads","drafts",
 * "period"} and EVERY write of an object looked lost. It was retried, and for
 * the monthly counter each retry added one more: every contact a Free account
 * captured counted three times — 12/5 after four contacts, locking them from
 * the third (2026-09-23 notification review, reproduced on production).
 */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(norm(value ?? null));
}

export type CustomizationWrite =
  | { ok: true; customization: Record<string, unknown> }
  | { ok: false };

/**
 * Apply `mutate` to ONE key of this person's customization and make sure it
 * sticks.
 *
 * `mutate` receives a fresh copy of the key's current value on EVERY attempt
 * and returns the value to store — so it must be idempotent in the sense that
 * re-running it against newer data is still correct. A mutation that changes
 * nothing short-circuits without writing at all: the common case is a no-op,
 * and rewriting a shared column to store what it already holds is a pointless
 * write and a pointless chance to clobber.
 */
export async function mutateCustomization<T>(
  userId: string,
  key: string,
  mutate: (current: T | undefined, customization: Record<string, unknown>) => T,
  admin: SupabaseClient = getAdminSupabase(),
): Promise<CustomizationWrite> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data } = await admin
      .from("profiles").select("customization").eq("id", userId).maybeSingle();
    const customization = (data?.customization ?? {}) as Record<string, unknown>;

    const before = canonicalJson(customization[key]);
    const next = mutate(customization[key] as T | undefined, customization);
    const wanted = canonicalJson(next);
    if (wanted === before) return { ok: true, customization };

    // THIS key only, in one statement (supabase/merge-customization.sql).
    // Writing the whole object back from our copy erased every other key
    // another writer had set since we read it (audit B-03). The read-back
    // below still guards this key against a concurrent writer of the same key.
    const { error } = await admin.rpc("merge_customization", {
      p_user: userId,
      p_set: next === undefined ? {} : { [key]: next },
      p_remove: next === undefined ? [key] : [],
    });
    if (error) return { ok: false };

    const { data: after } = await admin
      .from("profiles").select("customization").eq("id", userId).maybeSingle();
    const stored = (after?.customization ?? {}) as Record<string, unknown>;
    if (canonicalJson(stored[key]) === wanted) {
      return { ok: true, customization: stored };
    }
    // Someone else rewrote the column underneath us. Go round again against
    // what is actually there now — which, for a counter, is what keeps it
    // monotonic rather than merely probable.
  }

  return { ok: false };
}
