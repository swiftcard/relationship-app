import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// ── The guards that keep production honest must keep existing ────────────────
//
// The owner has had the same three things fixed more than once — a bug that
// came back, the site getting slow, analytics/notifications glitching — and
// asked for measures that are ALWAYS running. Those measures are files. A
// refactor that deletes a schedule, drops a check, or makes a QA script read
// only from .env.local again would switch a guard off in silence, and nobody
// would know until the next incident. This pins each one.

const read = (p: string) => readFileSync(p, "utf8");

describe("always-on production guards", () => {
  it("the 15-minute uptime probe still runs on a schedule and carries the speed budget", () => {
    const wf = read(".github/workflows/uptime.yml");
    expect(wf).toMatch(/schedule:\s*\n\s*(?:#[^\n]*\n\s*)*- cron: "\*\/15 \* \* \* \*"/);
    expect(wf).toContain("scripts/health-check.mjs");
    const hc = read("scripts/health-check.mjs");
    expect(hc).toContain("speed budget (median of 3, full response)");
    expect(hc).toContain("database answers quickly");
    // A budget that is quietly relaxed past 5s is a budget in name only.
    for (const m of hc.matchAll(/"\/[^"]*": (\d+)/g)) expect(Number(m[1])).toBeLessThanOrEqual(5000);
  });

  it("the nightly real-browser run is scheduled AND fires after every production deploy", () => {
    const wf = read(".github/workflows/nightly-qa.yml");
    expect(wf).toMatch(/- cron: "0 9 \* \* \*"/);
    expect(wf).toContain("deployment_status:");
    for (const s of ["qa-prod-probe.mjs", "health-check.mjs", "qa-flows.mjs", "qa-office-links-brand.mjs", "qa-office-shell.mjs", "qa-sweep.mjs", "qa-share-preview.mjs", "qa-nightly-summary.mjs"]) {
      expect(wf, s).toContain(`scripts/${s}`);
    }
    expect(wf).toContain("labels: 'nightly-qa'");
  });

  // Owner, 2026-10-06: a texted link unfurled without the logo, and nothing
  // noticed. The link-preview check must stay in the run AND in the verdict,
  // and must keep comparing pixels, not just fetching the image.
  it("the nightly run checks real link previews for a dropped name, logo or photo", () => {
    expect(read("scripts/qa-nightly-summary.mjs")).toContain('"nightly/share-preview/failures.json"');
    const p = read("scripts/qa-share-preview.mjs");
    expect(p).toContain("?embed=card");
    expect(p).toMatch(/sLive >= 10 && sOg < /);
    expect(p).toContain("unfurls as the generic SwiftCard picture");
  });

  it("the production probe pins the pipelines that were fixed more than once", () => {
    const p = read("scripts/qa-prod-probe.mjs");
    expect(p).toContain("exactly ONE card_views row");
    expect(p).toContain("exactly ONE notification for the visit");
    expect(p).toContain("visit_key");
    expect(p).toContain("crawler's view is refused");
    // It must clean up after itself — a probe that leaves rows behind pollutes real analytics.
    expect(p).toMatch(/finally \{[\s\S]*\/rest\/v1\/notifications[\s\S]*\/rest\/v1\/card_views[\s\S]*auth\/v1\/admin\/users/);
  });

  it("the production probe checks the contract that applies where it is RUNNING", () => {
    // From 2026-09-14 to 2026-09-16 this probe failed every night — "exactly ONE
    // notification for the visit (got 0)" — while production was healthy. Cloud
    // egress stopped being counted that day (by design, so view counts stay
    // honest) and GitHub Actions is a datacenter, so the probe's own traffic was
    // correctly refused. It was asserting a contract that cannot hold where it
    // runs.
    //
    // Both branches are pinned here because each protects something different:
    // the residential branch is the only end-to-end check that a real visit
    // still notifies, and the datacenter branch is a live regression test for
    // the hosting exclusion. Deleting either one buys a green CI run by no
    // longer looking.
    const p = read("scripts/qa-prod-probe.mjs");
    // Read from the endpoint's own flag. The first version of this read
    // analytics_ingest_log for a hosting decision, but a refused view never
    // reaches the log — so the probe saw no row, called itself residential, and
    // failed the full pipeline from CI anyway. Absence is not a signal.
    expect(p, "the probe no longer asks where it is running").toContain("v1Body.hosting === true");
    expect(p, "it is back to inferring its location from a missing log row").not.toMatch(/some\(\(r\) => r\.reason === "hosting"\)/);
    expect(p, "the datacenter branch is gone").toContain("a datacenter's view is refused");
    expect(p, "the datacenter branch no longer checks that nobody was notified").toContain("raises NO notification");
    expect(p, "the residential branch is gone").toContain("exactly ONE notification for the visit");

    // A bypass header would make CI green by exempting the probe from the very
    // gate that keeps view counts honest. That is not a fix, and the owner's
    // standing rule is that view counts cannot carry misinformation.
    expect(p, "the probe appears to exempt itself from the bot/hosting gate").not.toMatch(/x-(qa|probe|test|bypass)/i);
  });

  it("every QA script can take its secrets from the environment, so CI can run it", () => {
    for (const s of ["qa-flows", "qa-sweep", "qa-office-shell", "qa-office-links-brand", "qa-a11y", "qa-mac", "qa-prod-probe", "qa-share-preview"]) {
      const src = read(`scripts/${s}.mjs`);
      expect(src, s).toContain("process.env[k]");
      expect(src, s).not.toMatch(/const env = readFileSync\(`\$\{ROOT\}\/\.env\.local`/);
    }
  });

  it("the recurring-bug tripwires are still in the suite", () => {
    for (const t of ["one-notification-per-visit", "view-visit-window", "analytics-integrity", "analytics-accuracy", "trial-eligibility", "proxy-auth-hop"]) {
      expect(existsSync(`tests/${t}.test.ts`), t).toBe(true);
    }
  });
});
