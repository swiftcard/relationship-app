import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// ── Our own QA traffic must never read as customers ─────────────────────────
//
// 2026-09-23 audit: 131 "external" sessions had published a card in 13 days
// against roughly 9 real signups. The nightly office-shell run opened its
// browser context without the internal marker, and the marketing-site sink
// (/api/site-view) honoured a different marker from the funnel sink
// (/api/events) — so the same run was "internal" on one admin page and "real"
// on the other. This pins the three things that closed it:
//
//   1. every script that opens a Playwright context passes it through
//      scripts/qa-internal.mjs;
//   2. that helper sets BOTH markers (localStorage flag + sc_internal cookie);
//   3. both ingest routes honour both markers.

const read = (p: string) => readFileSync(p, "utf8");

describe("every browser-driving script marks its traffic internal", () => {
  const scripts = readdirSync("scripts").filter((f) => f.endsWith(".mjs") && f !== "qa-internal.mjs");
  const driving = scripts.filter((f) => read(`scripts/${f}`).includes("newContext("));

  it("finds the scripts it is meant to guard", () => {
    // If this list ever empties, the check below would pass vacuously.
    expect(driving.length).toBeGreaterThanOrEqual(10);
    expect(driving).toContain("qa-office-shell.mjs");
    expect(driving).toContain("qa-flows.mjs");
  });

  for (const f of driving) {
    it(`${f} imports and calls markInternal`, () => {
      const src = read(`scripts/${f}`);
      expect(src).toContain('from "./qa-internal.mjs"');
      // At least as many markInternal calls as newContext calls: a second
      // context added later without the marker is exactly the regression.
      // One named exception: Card Builder's test opens a prospect's preview in
      // a browser that is NOT marked, because a marked browser's view is never
      // counted (lib/prospect-preview/real-view) and counting it is the test.
      // That browser opens /p/<slug> and nothing else, and /p feeds neither sink.
      const unmarked = f === "qa-card-builder.mjs" ? 1 : 0;
      if (unmarked) {
        expect(src).toContain("const prospectCtx = await browser.newContext(");
        const opens = src.match(/\bprospect\.goto\([^)]*\)/g) ?? [];
        expect(opens.length).toBeGreaterThan(0);
        for (const o of opens) expect(o, "the unmarked browser may only open a preview page").toContain("/p/${slug}`");
        expect(src).not.toMatch(/\bprospect\.(click|fill)\(|prospect\.locator\([^)]*\)\.click\(/);
      }
      const contexts = (src.match(/newContext\(/g) ?? []).length - unmarked;
      const marks = (src.match(/markInternal\(/g) ?? []).length;
      expect(marks, `${f}: ${contexts} contexts, ${marks} marked`).toBeGreaterThanOrEqual(contexts);
    });
  }
});

describe("the marker helper sets both markers", () => {
  const helper = read("scripts/qa-internal.mjs");
  it("writes the localStorage flag the funnel sink reads", () => {
    expect(helper).toContain('localStorage.setItem("sc_evt_internal", "1")');
    expect(read("src/lib/events.ts")).toContain('const INTERNAL_KEY = "sc_evt_internal"');
  });
  // Local hosts only: since 2026-11-15 no script may open the live site at
  // all (tests/qa-local-only.test.ts), so there is no production cookie to plant.
  it("plants the sc_internal cookie the website sink reads, for local hosts", () => {
    expect(helper).toContain('name: "sc_internal"');
    expect(helper).not.toContain("https://swiftcard.me");
    expect(helper).toContain("http://localhost");
    expect(helper).toContain("http://127.0.0.1");
  });
});

describe("both ingest routes honour both markers", () => {
  it("/api/site-view takes the cookie OR the browser flag", () => {
    const src = read("src/app/api/site-view/route.ts");
    expect(src).toContain('req.cookies.get(INTERNAL_COOKIE)?.value === "1" || body.internal === true');
    expect(read("src/components/SiteAnalytics.tsx")).toContain("internal: internalFlag()");
  });
  it("/api/events takes the browser flag OR the cookie", () => {
    const src = read("src/app/api/events/route.ts");
    expect(src).toContain("body.internal === true");
    expect(src).toContain('req.cookies.get("sc_internal")?.value === "1"');
  });
});

describe("the production probe measures the live endpoint", () => {
  it("never posts to the retired /api/views route", () => {
    const src = read("scripts/qa-prod-probe.mjs");
    expect(src).not.toMatch(/post\(`\/api\/views/);
    expect(src).toContain('post("/api/card-events", view)');
  });
});
