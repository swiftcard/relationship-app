import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ── NM-09: the morning never tells someone about themselves ─────────────────
//
// A live team push skips the person the news is about (alertTeam's
// skipPushFor, paired with meta.userId by both callers). The 8am catch-up
// rebuilt team pushes for every recipient and never read meta, so an
// admin-role joiner heard "X joined your team" about themselves.
describe("catch-up team rows skip their subject", () => {
  const route = read("src/app/api/push/catchup/route.ts");
  it("reads meta and filters each recipient's rows by it", () => {
    expect(route).toMatch(/\.select\("office_id, type, title, body, created_at, meta"\)/);
    expect(route).toContain("const theirs = rows.filter((t) => t.aboutUserId !== uid);");
  });
  it("every skipPushFor caller records who the news is about in meta.userId", () => {
    for (const f of ["src/app/api/join/route.ts", "src/lib/team-alerts.ts"]) {
      const src = read(f);
      for (const m of src.matchAll(/skipPushFor: \[([a-zA-Z.]+)\]/g)) {
        const call = src.slice(Math.max(0, m.index! - 900), m.index!);
        expect(call, `${f}: skipPushFor ${m[1]}`).toContain(`meta: { userId${m[1] === "userId" ? "" : `: ${m[1]}`} }`);
      }
    }
  });
});

// ── NM-14: the daily job never writes a whole settings object back ──────────
//
// The reminders run reads each profile once (and caches owners for the run),
// then used to write `{ ...cust, flag }` back, undoing any push switch or
// quiet-hours change saved in between. Its flags now go through the merge RPC.
describe("reminders job flags are merged, not overwritten", () => {
  const src = read("src/app/api/reminders/route.ts");
  it("no whole-customization update remains", () => {
    expect(src).not.toMatch(/\.update\(\{\s*customization:/);
  });
  it("each flag it manages is merged by key", () => {
    expect(src.match(/remove: \["_paymentFailedAt"\]/g)?.length).toBe(3);
    expect(src).toContain('remove: ["_seqPaused"]');
    expect(src).toContain("set: { _seqPaused: true }");
  });
});
