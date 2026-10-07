import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSeededView, SEEDED_VISITOR_PREFIX } from "@/lib/seeded-views";

// ── Views and locations must describe what actually happened ─────────────────
//
// Analytics that is merely PRESENT is worthless; analytics that is wrong is
// worse than none, because decisions get made on it. Card views and Swift Link
// views share one table and are told apart only by a "__links" suffix on the
// slug, so the ways this goes wrong are: counting one surface as the other,
// counting a card that is not yours, counting a bot or your own visit, counting
// one visitor twice, or counting demo data as real.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("card views and Swift Link views never mix", () => {
  const dash = read("src/app/dashboard/page.tsx");

  it("counts each surface with an EXACT slug match", () => {
    // A prefix/LIKE match on the card slug would sweep in "<slug>__links" and
    // report link traffic as card traffic — the counts would look plausible
    // and simply be wrong.
    expect(dash).toMatch(/\.eq\("username", analyticsUsername\)/);
    expect(dash).toMatch(/\.eq\("username", linkUsername\)/);
    expect(dash).not.toMatch(/\.like\("username"|\.ilike\("username"/);
  });

  it("derives the link key from the SAME card being shown", () => {
    // If these two ever come from different sources, the box shows one card's
    // card-views beside another card's link-views.
    expect(dash).toMatch(/const linkUsername = `\$\{analyticsUsername\}__links`/);
  });

  it("scopes analytics to a card the signed-in user actually owns", () => {
    // activeCard is resolved out of the user's own card list, so a crafted
    // ?card= cannot point analytics at somebody else's slug.
    expect(dash).toMatch(/allCards\.find\(\(c\) => c\.username === selectedCard\)/);
    expect(dash).toMatch(/const analyticsUsername = activeUsername/);
  });

  it("reads locations for both surfaces of that one card, and nothing else", () => {
    expect(dash).toMatch(/\.in\("username", \[analyticsUsername, linkUsername\]\)/);
  });
});

describe("a recorded view is a real visit", () => {
  // The recording itself lives in lib/record-view.ts (shared with /api/card-events).
  // The recording path since /api/views was retired (2026-09-18): the events
  // route, plus the shared recorder it calls.
  const route = read("src/app/api/card-events/route.ts") + "\n" + read("src/lib/record-view.ts");

  it("drops bot traffic", () => {
    // Checked against the REAL request header, never the client-supplied
    // device_info (the events route reads it into `ua` one line above).
    expect(route).toMatch(/const ua = req\.headers\.get\("user-agent"\)/);
    expect(route).toMatch(/if \(isLikelyBot\(ua\)\)/);
  });

  it("never counts the owner looking at their own card", () => {
    expect(route).toMatch(/isOwnerRequest\(/);
  });

  it("refuses views for a card that is not live", () => {
    expect(route).toMatch(/isCardActive\(baseSlug\)/);
  });

  it("rate-limits per IP and card", () => {
    expect(route).toMatch(/isRateLimited\(`card-events:\$\{ip\}:\$\{card_owner_username\}:\$\{event_type\}`/);
  });

  it("counts one visitor once per VISIT window, and survives the race", () => {
    // The dedup window is the shared visit constant (view-window.ts) — a
    // reload inside it is one visit, a genuine return past it is a REPEAT
    // VIEW and records again (this used to be 24h, which erased every
    // same-day return). The read-then-insert check narrows the window but is
    // not atomic; the unique-violation branch is what makes two simultaneous
    // tabs one view.
    expect(route).toMatch(/VIEW_VISIT_WINDOW_MS/);
    expect(route).not.toMatch(/24 \* 60 \* 60 \* 1000/);
    expect(route).toMatch(/insertErr\.code === "23505"/);
  });

  it("takes location from the edge headers, never from the client", () => {
    // A client-supplied location would let anyone write any city into someone
    // else's analytics. resolveGeo reads ONLY this request's own Vercel geo
    // headers plus a lookup of ITS OWN IP (see lib/request-geo.ts, which has
    // its own tests) — and it returns HOW MUCH of that answer is real, which the
    // row now stores, so a state-level guess stops being shown as a town.
    expect(route).toMatch(/resolveGeo\(req, ip\)/);
    expect(route).toMatch(/geo_accuracy: geo\.accuracy/);
    const geo = read("src/lib/request-geo.ts");
    expect(geo).toMatch(/x-vercel-ip-city/);
    expect(geo).toMatch(/x-vercel-ip-country/);
    // The second opinion is looked up by IP and nothing else — a confidence
    // level must never come from something the client said.
    expect(geo).not.toMatch(/body\?\.(geo|location|accuracy)/);
    // Only the ROUTE parses the body; the recorder receives already-validated fields.
    const routeOnly = read("src/app/api/views/[username]/route.ts");
    const body = routeOnly.slice(routeOnly.indexOf("const body ="), routeOnly.indexOf("recordView({"));
    expect(body, "location must not be read off the request body").not.toMatch(/location/);
  });

  it("does not store the visitor's IP with the view", () => {
    // The privacy policy says so; the IP is only a rate-limit key.
    expect(route).not.toMatch(/insert\(\{[^}]*\bip\b/s);
  });
});

describe("seeded demo views are not counted as real traffic", () => {
  it("recognises the seeder's visitor ids", () => {
    expect(isSeededView("demo-visitor-0")).toBe(true);
    expect(isSeededView("demo-visitor-8")).toBe(true);
    expect(isSeededView(`${SEEDED_VISITOR_PREFIX}-42`)).toBe(true);
  });

  it("leaves real visitors alone", () => {
    expect(isSeededView("8e61eeef-11e0-4c1a-9f77-1b2c3d4e5f60")).toBe(false);
    expect(isSeededView(null)).toBe(false);
    expect(isSeededView(undefined)).toBe(false);
    expect(isSeededView("")).toBe(false);
  });

  it("the site-wide admin totals exclude them — without dropping NULL-visitor rows", () => {
    // 24 of 81 rows were seeded — about 30% of the number we read to judge
    // whether the product is working. The filter must be the or() form: a bare
    // .not("visitor_id","like",...) is NULL — not true — for NULL visitor_id,
    // so it silently dropped every pre-visitor-id row from the total while the
    // 30-day loop kept them; the two numbers counted different populations.
    const admin = read("src/app/api/admin/analytics/route.ts");
    expect(admin).toMatch(/\.or\(`visitor_id\.is\.null,visitor_id\.not\.like\.\$\{SEEDED_VISITOR_PREFIX\}%`\)/);
    expect(admin).not.toMatch(/\.not\("visitor_id", "like"/);
    expect(admin).toMatch(/if \(isSeededView\(v\.visitor_id as string \| null\)\) return;/);
  });

  it("customer dashboards are untouched by that filter", () => {
    // Each customer's numbers are already scoped to their own slug, so the
    // seeded rows never reached them — and the App Review account must keep
    // seeing its demo data or the reviewer gets an empty dashboard.
    const dash = read("src/app/dashboard/page.tsx");
    expect(dash).not.toMatch(/SEEDED_VISITOR_PREFIX|isSeededView/);
  });
});
