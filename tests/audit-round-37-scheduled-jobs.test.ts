import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 37 (2026-10-19), N-21: the hourly jobs are watched ──────────
//
// The morning catch-up, the Monday recap, due deletions and the 7-day trial
// charge notice run on a schedule. A run that failed turned red in a list
// nobody reads, and a schedule that stopped said nothing. The 15-minute health
// check reads their history and opens the same incident as everything else:
// two failures in a row, or no success in 12h.
//
// 2026-10-21: the schedules moved from GitHub Actions to Supabase pg_cron
// (supabase/clock.sql) when the private repo's free Actions minutes ran out.
// pg_net calls are silent, so every call is logged in clock_calls and the
// health check reads clock_status().

const read = (p: string) => readFileSync(p, "utf8");

describe("N-21: the scheduled jobs are part of the health check", () => {
  const hc = read("scripts/health-check.mjs");
  const sql = read("supabase/clock.sql");

  it("watches every job the clock runs, by the names the clock logs", () => {
    for (const job of ["push-catchup:catchup", "push-catchup:recap", "push-catchup:activation", "push-catchup:purge-due", "trial-notice", "crew-tick"]) {
      expect(hc).toContain(`["${job}",`);
      expect(sql).toContain(`clock_call('${job}',`);
    }
  });

  it("alerts on two failures in a row or 12 hours without a success — not on one blip", () => {
    expect(hc).toContain("const SCHEDULED_STALE_MS = 12 * 60 * 60 * 1000;");
    expect(hc).toContain("r?.last_two_failed");
    expect(hc).toContain("age > SCHEDULED_STALE_MS");
    expect(hc).toContain("/rest/v1/rpc/clock_status");
  });

  it("the status is service-role only, and the uptime workflow passes the key through env", () => {
    expect(sql).toContain("revoke all on function clock_status() from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function clock_status() to service_role;");
    const wf = read(".github/workflows/uptime.yml");
    expect(wf).toContain("SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}");
  });

  it("secrets come from Vault, never from the SQL file", () => {
    expect(sql).toContain("from vault.decrypted_secrets where name = p_secret_name");
    expect(sql).not.toMatch(/Bearer [A-Za-z0-9_-]{16,}/);
  });
});
