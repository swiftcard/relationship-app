import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isCloudHostingOrg, isCloudRegionTown } from "@/lib/request-geo";

// ── Audit round 24 (2026-10-18): counting people, not networks or rows ──────
//
// A-08  A booth's Wi-Fi is one IP for hundreds of phones: 60 views per card
//       per 10 minutes and 6 buzzes an hour were shared between all of them.
// A-17  The admin funnel counted rows: every editor reload was a new "start"
//       (143 rows, 113 sessions); upgrade prompts 83 rows, 26 sessions.
// A-07  With no second-opinion lookup the edge's datacenter town was stored
//       as a person's ("Ashburn, US"), and one failure was cached 15 minutes.

const read = (p: string) => readFileSync(p, "utf8");

describe("A-08: a visitor with our cookie has their own budget", () => {
  const route = read("src/app/api/card-events/route.ts");

  it("views and taps are budgeted per visitor once proven, per IP (5x wider) until then", () => {
    expect(route).toContain("const budgetKey = identityUnproven ? `ip:${ip}` : `v:${visitIdentity.visitorId}`;");
    expect(route).toContain("const budget = (RATE_BUDGET[event_type] ?? 20) * (identityUnproven ? 5 : 1);");
  });

  it("the daily cookieless ceiling still bounds forging", () => {
    expect(route).toContain("const UNPROVEN_VIEWS_PER_DAY = 300;");
  });

  it("the buzz cap is per person once proven, still per IP for cookieless requests", () => {
    expect(route).toContain("const notifyWho = identityUnproven ? ip : `v:${visitIdentity.visitorId}`;");
    expect(route).toMatch(/isRateLimited\(`notify-ip:\$\{card_owner_username\}:\$\{notifyWho\}`, 6, 60 \* 60 \* 1000\)/);
  });
});

describe("A-17: the funnel counts sessions", () => {
  const route = read("src/app/api/admin/analytics/route.ts");

  it("each step counts a session once; a row with no key counts as its own", () => {
    expect(route).toContain('.select("name, props, is_internal, created_at, session_key")');
    expect(route).toContain("const who = `${name}|${r.session_key ?? `row:${i}`}`;");
    expect(route).toContain("if (!seen30.has(who)) { seen30.add(who); d30[name] = (d30[name] ?? 0) + 1; }");
  });

  it("the hint says what the event really is", () => {
    expect(read("src/app/admin/analytics/AnalyticsClient.tsx")).toContain('hint: "Opened the card editor (once per visit)"');
  });
});

describe("A-07: an unverified request is never named as a datacenter's town", () => {
  it("knows the cloud-region towns by town AND state", () => {
    expect(isCloudRegionTown("Ashburn", "VA")).toBe(true);
    expect(isCloudRegionTown("Quincy", "WA")).toBe(true);
    expect(isCloudRegionTown("Quincy", "MA")).toBe(false); // a real place full of people
    expect(isCloudRegionTown("Brooklyn", "NY")).toBe(false);
    expect(isCloudRegionTown(null, "VA")).toBe(false);
  });

  it("more hosting egress is recognised, the privacy relay still is not", () => {
    for (const org of ["Vercel Inc", "Fly.io", "OVHcloud", "ColoCrossing", "Psychz Networks", "Oracle Corporation"]) expect(isCloudHostingOrg(org), org).toBe(true);
    expect(isCloudHostingOrg("Cloudflare, Inc.")).toBe(false);
  });

  it("no second opinion in a cloud town gives the region, not the town; a failure is retried after a minute", () => {
    const geo = read("src/lib/request-geo.ts");
    expect(geo).toContain("const cloudTownUnverified = !second && isCloudRegionTown(edge.city, edge.regionCode);");
    expect(geo).toContain("{ townUnsupported: isRelay || cloudTownUnverified }");
    expect(geo).toContain("expires: Date.now() + (guess ? CACHE_TTL_MS : FAILED_LOOKUP_TTL_MS)");
    expect(geo).toContain("const FAILED_LOOKUP_TTL_MS = 60 * 1000;");
  });
});
