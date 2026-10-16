import { describe, it, expect, vi, beforeEach } from "vitest";

// ── A customization write lands ONCE, even though jsonb reorders keys ────────
//
// Reproduced on production 2026-09-23: a Free account showed "12/5 this month"
// after four contacts. mutateCustomization compared JSON.stringify of what it
// wrote with what came back, jsonb returned the keys in its own order, every
// write "failed" the check, and bumpUsage's retry added one more each time —
// three per contact, so the third contact of the month arrived locked.

let row: Record<string, unknown> = {};
let writes = 0;
// jsonb's key order: shorter keys first, then byte order — NOT insertion order.
const jsonbOrder = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(jsonbOrder);
  if (v && typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
    return Object.fromEntries(keys.map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]));
  }
  return v;
};
function table() {
  const q: Record<string, unknown> = {};
  const self = () => q;
  Object.assign(q, {
    select: self, eq: self,
    maybeSingle: async () => ({ data: { customization: jsonbOrder(row) }, error: null }),
    update: (u: { customization: Record<string, unknown> }) => {
      writes++; row = JSON.parse(JSON.stringify(u.customization));
      return { eq: async () => ({ error: null }) };
    },
  });
  return q;
}
// merge_customization (supabase/merge-customization.sql): only the keys given.
const rpc = async (_fn: string, a: { p_set: Record<string, unknown>; p_remove: string[] }) => {
  writes++;
  const next = { ...row };
  for (const k of a.p_remove ?? []) delete next[k];
  row = JSON.parse(JSON.stringify({ ...next, ...a.p_set }));
  return { data: row, error: null };
};
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({ from: table, rpc }) }));

const { bumpUsage, readUsage } = await import("@/lib/usage");
const { mutateCustomization, canonicalJson } = await import("@/lib/profile-customization");
const admin = { from: table, rpc } as never;

beforeEach(() => { row = {}; writes = 0; });

describe("the monthly counter counts each contact once", () => {
  it("four contacts read 4/5, not 12/5", async () => {
    for (let i = 0; i < 4; i++) await bumpUsage(admin, "u1", jsonbOrder(row) as Record<string, unknown>, "leads");
    expect(readUsage(jsonbOrder(row)).leads).toBe(4);
  });

  it("one write per change — the read-back accepts jsonb's key order", async () => {
    const r = await mutateCustomization("u1", "_usage", () => ({ period: "2026-09", leads: 1, drafts: 0 }), admin);
    expect(r.ok).toBe(true);
    expect(writes).toBe(1);
  });

  it("canonicalJson ignores key order, not values", () => {
    expect(canonicalJson({ period: "x", leads: 1 })).toBe(canonicalJson({ leads: 1, period: "x" }));
    expect(canonicalJson({ leads: 1 })).not.toBe(canonicalJson({ leads: 2 }));
    expect(canonicalJson(undefined)).toBe("null");
  });
});
