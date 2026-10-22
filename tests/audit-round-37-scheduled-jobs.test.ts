import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 37 (2026-10-19), N-21: the hourly jobs are watched ──────────
//
// The morning catch-up, the Monday recap, due deletions and the 7-day trial
// charge notice all run on GitHub's best-effort scheduler. A run that failed
// turned red in a list nobody reads, and a schedule that stopped said nothing.
// The 15-minute health check now reads their run history and opens the same
// incident as everything else: two failures in a row, or no success in 12h.
// (Checked against the live history before shipping: both green, runs as far
// apart as ~5h on a normal day, so 12h does not cry wolf.)

const read = (p: string) => readFileSync(p, "utf8");

describe("N-21: the scheduled jobs are part of the health check", () => {
  const hc = read("scripts/health-check.mjs");

  it("watches both workflows, by the files that exist", () => {
    for (const f of ["push-catchup.yml", "trial-notice.yml"]) {
      expect(hc).toContain(`["${f}",`);
      expect(read(`.github/workflows/${f}`)).toMatch(/schedule:\n\s+- cron:/);
    }
  });

  it("alerts on two failures in a row or 12 hours without a success — not on one blip", () => {
    expect(hc).toContain("const SCHEDULED_STALE_MS = 12 * 60 * 60 * 1000;");
    expect(hc).toContain('runs[0]?.conclusion === "failure" && runs[1]?.conclusion === "failure"');
    expect(hc).toContain("age > SCHEDULED_STALE_MS");
  });

  it("the uptime workflow gives it a token that can read Actions", () => {
    const wf = read(".github/workflows/uptime.yml");
    expect(wf).toMatch(/permissions:[\s\S]*?\n  actions: read\n/);
    expect(wf).toContain("GITHUB_TOKEN: ${{ github.token }}");
  });
});
