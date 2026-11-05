import { afterEach, describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { edgeGeo as edgeGeoOf, formatLocation as formatOf } from "@/lib/request-geo";
// The edge-only label, as resolveGeo composes it (the old requestLocation
// wrapper had no caller left and was removed 2026-10-23).
const requestLocation = (req: Parameters<typeof edgeGeoOf>[0]) => formatOf(edgeGeoOf(req));

// ─────────────────────────────────────────────────────────────────────────────
// LOCATION IS THIS REQUEST'S OWN EDGE GEO, HONESTLY DEGRADED.
//
// Audit scenario (14): VPN/proxy/missing data must fail honestly — null, a
// bare city, or a bare country code; never a placeholder, and NEVER a throw.
// An unguarded decodeURIComponent on x-vercel-ip-city once turned one
// malformed header into a 500 that lost the lead being captured.
// ─────────────────────────────────────────────────────────────────────────────

function reqWith(headers: Record<string, string>): NextRequest {
  return { headers: { get: (k: string) => headers[k] ?? null } } as unknown as NextRequest;
}

describe("requestLocation", () => {
  it("city + country → 'City, CC', with percent-encoding decoded", () => {
    expect(requestLocation(reqWith({ "x-vercel-ip-city": "Austin", "x-vercel-ip-country": "US" }))).toBe("Austin, US");
    expect(requestLocation(reqWith({ "x-vercel-ip-city": "S%C3%A3o%20Paulo", "x-vercel-ip-country": "BR" }))).toBe("São Paulo, BR");
  });

  it("keeps a city even when the country header is missing — it used to be discarded", () => {
    expect(requestLocation(reqWith({ "x-vercel-ip-city": "Austin" }))).toBe("Austin");
  });

  it("keeps a bare country when that's all there is", () => {
    expect(requestLocation(reqWith({ "x-vercel-ip-country": "US" }))).toBe("US");
  });

  it("no headers → null, never a placeholder", () => {
    expect(requestLocation(reqWith({}))).toBeNull();
  });

  it("a malformed percent-sequence degrades to absent instead of throwing", () => {
    expect(requestLocation(reqWith({ "x-vercel-ip-city": "%E0%A4%A", "x-vercel-ip-country": "IN" }))).toBe("IN");
    expect(requestLocation(reqWith({ "x-vercel-ip-city": "%ZZ" }))).toBeNull();
  });

  it("rejects a country that isn't a bare ISO code (spoofed/garbled header)", () => {
    expect(requestLocation(reqWith({ "x-vercel-ip-country": "us" }))).toBeNull();
    expect(requestLocation(reqWith({ "x-vercel-ip-city": "Austin", "x-vercel-ip-country": "USA!" }))).toBe("Austin");
  });

  it("caps a forged oversized city", () => {
    const loc = requestLocation(reqWith({ "x-vercel-ip-city": "A".repeat(500), "x-vercel-ip-country": "US" }));
    expect(loc!.length).toBeLessThanOrEqual(84);
  });

  it("whitespace-only city is absent, not an empty label", () => {
    expect(requestLocation(reqWith({ "x-vercel-ip-city": "%20%20" }))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TWO DATABASES, ONE HONEST ANSWER.
//
// 2026-09-03: a Long Island viewer was reported from "Bolton Landing" (Lake
// George, four hours away). The same IP came back as Trumansburg from three
// other databases — every source was confidently wrong in a different
// direction. A single provider cannot know it is wrong; two that disagree can,
// and then the only honest label is the level they still agree on.
// ─────────────────────────────────────────────────────────────────────────────

import { edgeGeo, formatLocation, locationAliases, reconcileDetailed, resolveGeo, type GeoGuess } from "@/lib/request-geo";
// The label of each decision — what resolveGeo stores (the reconcile and
// resolveLocation wrappers were test-only and removed 2026-10-23).
const reconcile = (edge: GeoGuess, second: GeoGuess | null) => reconcileDetailed(edge, second).label;
const resolveLocation = async (req: Parameters<typeof resolveGeo>[0], ip: string) => (await resolveGeo(req, ip)).label;

const g = (p: Partial<GeoGuess>): GeoGuess => ({ city: null, regionCode: null, regionName: null, country: null, org: null, ...p });
const NY_EDGE = g({ city: "Bolton Landing", regionCode: "NY", regionName: "New York", country: "US" });

describe("formatLocation / edgeGeo", () => {
  it("US/CA cities carry their state code — 'Bolton Landing, NY', not 'Bolton Landing, US'", () => {
    expect(formatLocation(NY_EDGE)).toBe("Bolton Landing, NY");
    expect(formatLocation(g({ city: "Toronto", regionCode: "ON", country: "CA" }))).toBe("Toronto, ON");
    expect(formatLocation(g({ city: "Paris", regionCode: "IDF", country: "FR" }))).toBe("Paris, FR");
    // No region header → the old shape, never a dangling comma.
    expect(formatLocation(g({ city: "Austin", country: "US" }))).toBe("Austin, US");
  });

  it("reads the edge region header and rejects a garbled one", () => {
    expect(requestLocation(reqWith({ "x-vercel-ip-city": "Austin", "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "TX" }))).toBe("Austin, TX");
    expect(edgeGeo(reqWith({ "x-vercel-ip-country-region": "TX" })).regionName).toBe("Texas");
    expect(edgeGeo(reqWith({ "x-vercel-ip-country-region": "texas!" })).regionCode).toBeNull();
  });
});

describe("reconcile", () => {
  it("second source unavailable → the edge answer alone, exactly as before", () => {
    expect(reconcile(NY_EDGE, null)).toBe("Bolton Landing, NY");
    expect(reconcile(g({}), null)).toBeNull();
  });

  it("both name the same town → the town (accents and case don't split them)", () => {
    expect(reconcile(NY_EDGE, g({ city: "bolton landing", regionName: "New York", country: "US" }))).toBe("Bolton Landing, NY");
    expect(reconcile(g({ city: "São Paulo", country: "BR" }), g({ city: "Sao Paulo", country: "BR" }))).toBe("São Paulo, BR");
  });

  it("two towns in one state → the state, never a coin-toss town (the Bolton Landing case)", () => {
    expect(reconcile(NY_EDGE, g({ city: "Trumansburg", regionCode: "NY", regionName: "New York", country: "US" }))).toBe("New York, US");
  });

  it("two towns in two states → just the country", () => {
    expect(reconcile(NY_EDGE, g({ city: "Newark", regionCode: "NJ", regionName: "New Jersey", country: "US" }))).toBe("US");
    // A region NAME that contradicts the edge code counts as a clash too.
    expect(reconcile(NY_EDGE, g({ city: "Newark", regionName: "New Jersey", country: "US" }))).toBe("US");
  });

  it("two countries → the edge country", () => {
    expect(reconcile(g({ city: "Windsor", regionCode: "ON", country: "CA" }), g({ city: "Detroit", regionCode: "MI", country: "US" }))).toBe("CA");
  });

  it("a cellular carrier IP is a regional gateway → the state, even when the towns agree", () => {
    expect(reconcile(NY_EDGE, g({ city: "Bolton Landing", regionName: "New York", country: "US", org: "AS22394 Cellco Partnership DBA Verizon Wireless" }))).toBe("New York, US");
    expect(reconcile(NY_EDGE, g({ city: "Bolton Landing", regionName: "New York", country: "US", org: "AS21928 T-Mobile USA, Inc." }))).toBe("New York, US");
    // A cable ISP is not a carrier.
    expect(reconcile(NY_EDGE, g({ city: "Bolton Landing", regionName: "New York", country: "US", org: "AS11351 Charter Communications Inc" }))).toBe("Bolton Landing, NY");
  });

  it("only one source has a town → that town; no contradiction, no downgrade", () => {
    expect(reconcile(NY_EDGE, g({ country: "US" }))).toBe("Bolton Landing, NY");
    expect(reconcile(g({ country: "US", regionCode: "NY" }), g({ city: "Trumansburg", regionName: "New York", country: "US" }))).toBe("Trumansburg, NY");
  });

  // Both sources describe the SAME IP, so a state either of them knows is a
  // state the answer knows. Reading it only off the edge wrote "Great Neck, US"
  // for a request whose edge headers carried no region — the pre-2026-09-03
  // shape, which then sits in the Locations tab as a second row for one town.
  it("takes the state from whichever source has it", () => {
    const noRegionEdge = g({ city: "Great Neck", country: "US" });
    // Both name the town; only the second knows the state.
    expect(reconcile(noRegionEdge, g({ city: "Great Neck", regionCode: "NY", regionName: "New York", country: "US" })))
      .toBe("Great Neck, NY");
    // The second source has no town of its own, but still knows the state.
    expect(reconcile(noRegionEdge, g({ regionCode: "NY", regionName: "New York", country: "US" })))
      .toBe("Great Neck, NY");
    // ipinfo never sends a code, only a name — that has to work too, or the
    // paid provider is strictly worse than the free one it replaces.
    expect(reconcile(noRegionEdge, g({ city: "Great Neck", regionName: "New York", country: "US" })))
      .toBe("Great Neck, NY");
    // Nothing is invented: an unknown region name stays a country tail.
    expect(reconcile(noRegionEdge, g({ city: "Great Neck", regionName: "Nordrhein-Westfalen", country: "US" })))
      .toBe("Great Neck, US");
    // Outside the US the tail is the country, state table or not.
    expect(reconcile(g({ city: "Lyon", country: "FR" }), g({ city: "Lyon", regionName: "Auvergne", country: "FR" })))
      .toBe("Lyon, FR");
  });

  it("never invents: nothing anywhere → null", () => {
    expect(reconcile(g({}), g({}))).toBeNull();
  });
});

describe("resolveLocation", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("parses the keyless ipwho.is shape, and a timeout falls back to the edge", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ success: true, city: "Trumansburg", region: "New York", region_code: "NY", country_code: "US", connection: { org: "Charter", isp: "Spectrum" } }));
    }) as typeof fetch;
    const req = reqWith({ "x-vercel-ip-city": "Bolton%20Landing", "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "NY" });
    expect(await resolveLocation(req, "203.0.113.7")).toBe("New York, US");
    // Same IP again inside the TTL → cached, no second network call.
    expect(await resolveLocation(req, "203.0.113.7")).toBe("New York, US");
    expect(calls).toBe(1);

    globalThis.fetch = (async () => { throw new DOMException("timeout", "TimeoutError"); }) as typeof fetch;
    expect(await resolveLocation(req, "203.0.113.8")).toBe("Bolton Landing, NY");
  });

  it("never looks up a private or missing IP", async () => {
    globalThis.fetch = (async () => { throw new Error("must not be called"); }) as typeof fetch;
    const req = reqWith({ "x-vercel-ip-city": "Austin", "x-vercel-ip-country": "US" });
    expect(await resolveLocation(req, "10.0.0.5")).toBe("Austin, US");
    expect(await resolveLocation(req, "unknown")).toBe("Austin, US");
  });

  it("the second-opinion URL carries the IP and nothing about the visitor", async () => {
    let url = "";
    globalThis.fetch = (async (u: RequestInfo | URL) => { url = String(u); return new Response(JSON.stringify({ success: false })); }) as typeof fetch;
    await resolveLocation(reqWith({}), "203.0.113.9");
    expect(url).toMatch(/^https:\/\/ipwho\.is\/203\.0\.113\.9$/);
  });
});

describe("locationAliases (the Locations tab must not split one town in two)", () => {
  const fold = (labels: string[]) => {
    const alias = locationAliases(labels);
    const out: Record<string, number> = {};
    for (const l of labels) { const k = alias.get(l) ?? l; out[k] = (out[k] ?? 0) + 1; }
    return out;
  };

  it("folds the old country-tailed rows into the state-tailed ones", () => {
    // 65 rows of "Great Neck, US" predate the state; every new one says NY.
    expect(fold(["Great Neck, US", "Great Neck, US", "Great Neck, NY"])).toEqual({ "Great Neck, NY": 3 });
    expect(fold(["Toronto, CA", "Toronto, ON"])).toEqual({ "Toronto, ON": 2 });
  });

  it("NEVER folds a state-level label into the city of the same name", () => {
    // "New York, US" is "somewhere in New York State" — the two databases
    // disagreed on the town. Counting it as New York City would invent the
    // precision this whole change exists to remove.
    expect(fold(["New York, US", "New York, NY"])).toEqual({ "New York, US": 1, "New York, NY": 1 });
  });

  it("leaves everything else exactly as it is", () => {
    expect(locationAliases(["Roslyn, US"]).size).toBe(0);        // no specific twin yet
    expect(locationAliases(["Paris, FR", "Paris, US"]).size).toBe(0); // FR is a country, not a state
    expect(fold(["Austin, TX", "US", "Tel Aviv, IL", "Bogotá, CO"])).toEqual({ "Austin, TX": 1, US: 1, "Tel Aviv, IL": 1, "Bogotá, CO": 1 });
  });
});
