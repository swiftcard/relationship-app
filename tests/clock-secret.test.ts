import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-11-04: the Supabase clock's hourly push-catchup and trial-notice jobs
// had failed every hour since they were scheduled, on "secret
// push_catchup_secret is missing from Vault". PUSH_CATCHUP_SECRET is
// write-only in Vercel, so its value could never be copied into Vault, and the
// work only ran when GitHub's best-effort schedule fired. The clock now has its
// own key, CLOCK_SECRET (Vercel) = clock_secret (Vault), accepted next to the
// GitHub one. This pins every link of that chain.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const CLOCK_ROUTES = [
  "src/app/api/push/catchup/route.ts",
  "src/app/api/push/recap/route.ts",
  "src/app/api/push/activation/route.ts",
  "src/app/api/account/purge-due/route.ts",
  "src/app/api/billing/trial-notice/route.ts",
];

describe("the database clock's own secret", () => {
  for (const route of CLOCK_ROUTES) {
    it(`${route} accepts CLOCK_SECRET and the GitHub secret, and an unset one never authorizes`, () => {
      const src = read(route);
      const list = src.match(/const accepted = \[([^\]]+)\]\s*\n\s*\.filter\(\(s\): s is string => Boolean\(s\)\)/);
      expect(list, "the accepted list must still drop unset secrets").not.toBeNull();
      expect(list![1]).toContain("process.env.CLOCK_SECRET");
      expect(list![1]).toContain("process.env.PUSH_CATCHUP_SECRET");
    });
  }

  it("the clock's jobs call exactly those routes with Vault clock_secret, never the secret that cannot exist", () => {
    const sql = read("supabase/clock-push-jobs.sql");
    const calls = [...sql.matchAll(/clock_call\('([^']+)', 'https:\/\/swiftcard\.me(\/api\/[^']+)', '([^']+)'/g)];
    expect(calls.map((c) => c[2]).sort()).toEqual([
      "/api/account/purge-due", "/api/billing/trial-notice", "/api/push/activation", "/api/push/catchup", "/api/push/recap",
    ]);
    for (const c of calls) expect(c[3]).toBe("clock_secret");
    expect(sql).not.toMatch(/'push_catchup_secret'\)/);
  });

  it("no secret value is ever written into the job file", () => {
    expect(read("supabase/clock-push-jobs.sql")).not.toMatch(/[0-9a-f]{32,}/i);
  });

  it("ENV_KEYS_NEEDED.md says where the value lives", () => {
    const doc = read("ENV_KEYS_NEEDED.md");
    const row = doc.slice(doc.indexOf("| `CLOCK_SECRET` |"));
    expect(row.slice(0, row.indexOf("\n"))).toContain("Supabase Vault as `clock_secret`");
  });
});
