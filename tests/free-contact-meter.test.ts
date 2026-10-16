import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── A contact that was added is spent, even if it is deleted ─────────────────
//
// Owner, 2026-09-11: "when a contact is added it's recorded and if they delete
// it, that doesn't lower it (because they could just save it to their phone
// then delete it). Anytime, whether they put it in themselves or it comes from
// somewhere else, a contact is put in our app for that card, it counts as one
// even if they delete it."
//
// The meter therefore lives on the ACCOUNT (profiles.customization._usage), not
// on a count of rows, and nothing anywhere decrements it. These pin that, plus
// the two things that quietly break it: a delete path that "tidies up" the
// count, and a stale-snapshot write to the shared customization column that
// erases the meter altogether — which would hand out a whole free month.

type Row = Record<string, unknown>;

let stored: Row = {};
const writes: Row[] = [];
/** Simulates another writer landing between our read and our write. */
let clobberOnce: Row | null = null;

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => admin,
}));

const admin = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { customization: stored } }) }) }),
    // Shaped like the real client: update() returns a builder, and awaiting
    // .eq() is what performs the write.
    update: (patch: Row) => ({
      eq: async () => {
        writes.push(patch);
        stored = (patch.customization ?? {}) as Row;
        // Another writer lands between our write and our read-back.
        if (clobberOnce) { stored = clobberOnce; clobberOnce = null; }
        return { error: null };
      },
    }),
  }),
  // merge_customization (supabase/merge-customization.sql): only the keys
  // given are written, under the row's lock — so a concurrent writer can only
  // land BEFORE or AFTER, never erase what this call set. The read-back guard
  // in mutateCustomization still has to cope with "after".
  rpc: async (_fn: string, a: { p_set: Record<string, unknown>; p_remove: string[] }) => {
    writes.push({ customization: a.p_set });
    const next = { ...stored };
    for (const k of a.p_remove ?? []) delete next[k];
    stored = { ...next, ...a.p_set };
    if (clobberOnce) { stored = clobberOnce; clobberOnce = null; }
    return { data: stored, error: null };
  },
} as unknown as Parameters<typeof bumpUsage>[0];

import { bumpUsage, readUsage, currentPeriod } from "@/lib/usage";

beforeEach(() => {
  stored = {};
  writes.length = 0;
  clobberOnce = null;
});

describe("the free monthly contact meter", () => {
  it("counts up as contacts arrive", async () => {
    for (let i = 1; i <= 5; i++) {
      expect(await bumpUsage(admin, "u1", stored, "leads")).toBe(i);
    }
    expect(readUsage(stored).leads).toBe(5);
  });

  it("is not a row count, so nothing about deleting a contact can reach it", () => {
    // The only writer is bumpUsage, it only ever adds, and no delete path
    // imports it. If a future one does, this fails and the reviewer has to
    // justify the exception.
    const code = readFileSync(join(process.cwd(), "src/lib/usage.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/-\s*by\b|by\s*\*\s*-1|decrement/i);
    const del = readFileSync(join(process.cwd(), "src/app/api/leads/[id]/route.ts"), "utf8");
    expect(del).not.toMatch(/bumpUsage/);
  });

  it("counts a contact the owner typed in themselves and one a visitor sent", () => {
    // Both producers meter, and they meter the same key on the same account.
    for (const route of ["src/app/api/leads/manual/route.ts", "src/app/api/leads/route.ts"]) {
      const src = readFileSync(join(process.cwd(), route), "utf8");
      expect(src, route).toMatch(/bumpUsage\(/);
      expect(src, route).toMatch(/"leads"/);
    }
  });

  it("counts a contact that arrived OVER the cap, which is locked rather than refused", () => {
    // A visitor's details are never thrown away; the lead is stored and tagged.
    // It still spends a slot, so upgrading is what unlocks it — not waiting.
    const src = readFileSync(join(process.cwd(), "src/app/api/leads/route.ts"), "utf8");
    const block = src.slice(src.indexOf("let locked = false;"), src.indexOf("const leadRow"));
    expect(block).toMatch(/locked = usedThisMonth >= PLAN_LIMITS\.FREE_LEADS_PER_MONTH/);
    expect(block).toMatch(/await bumpUsage\(/);
    // The bump is NOT inside the `locked` branch — it happens either way.
    expect(block.indexOf("bumpUsage")).toBeGreaterThan(block.indexOf("locked ="));
  });

  it("survives another feature rewriting the shared customization column", async () => {
    await bumpUsage(admin, "u1", stored, "leads");          // 1
    // Now a migration/settings write lands with a stale snapshot that has no
    // _usage at all. Without the verified read-back the meter would be gone and
    // the account would have its whole month back.
    clobberOnce = { _photoMigrated: true };
    expect(await bumpUsage(admin, "u1", stored, "leads")).toBe(2);
    expect(readUsage(stored).leads).toBe(2);
    expect(stored._photoMigrated).toBe(true);               // the other key survives too
  });

  it("ignores the caller's stale snapshot and counts from what is in the database", async () => {
    const snapshotFromAgesAgo = { _usage: { period: currentPeriod(), leads: 0, drafts: 0 } };
    stored = { _usage: { period: currentPeriod(), leads: 4, drafts: 0 } };
    // Two captures landing together used to read the same "0" and both store 1.
    expect(await bumpUsage(admin, "u1", snapshotFromAgesAgo, "leads")).toBe(5);
  });

  it("never writes a number lower than one it has already seen", async () => {
    stored = { _usage: { period: currentPeriod(), leads: 4, drafts: 0 } };
    // Every attempt in a row loses to another writer that wipes the key. The
    // count still climbs from 4, because the floor travels with the retry.
    clobberOnce = {};
    expect(await bumpUsage(admin, "u1", stored, "leads")).toBe(5);
    expect(readUsage(stored).leads).toBe(5);
  });

  it("resets on the 1st, and only then", () => {
    const lastMonth = { _usage: { period: "2020-01", leads: 5, drafts: 3 } };
    expect(readUsage(lastMonth).leads).toBe(0);
    expect(readUsage({ _usage: { period: currentPeriod(), leads: 5, drafts: 0 } }).leads).toBe(5);
  });
});
