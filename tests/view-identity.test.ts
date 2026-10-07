import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// INFLATED VIEW COUNTS: THE OWNER, THE DUPLICATE, AND THE DATACENTER.
//
// Three defects, one table. Production evidence for each, 2026-09-14:
//
//   1. THE OWNER COUNTED AS A VISITOR. analytics_ingest_log contained ZERO
//      decisions with reason "self" over its entire life, while the owner's own
//      views of his own cards were recorded as anonymous strangers and pushed
//      to his own phone. The exclusion had exactly one signal — a Supabase
//      session on the request — and public card/Swift Links routes sit outside
//      src/proxy.ts's matcher, so a signed-in owner whose access token has
//      expired reads as signed-out there. Fixed by adding the httpOnly
//      sc_device cookie the proxy already plants as a second, durable signal.
//
//   2. ONE VISIT, FOUR VIEWS, FOUR "UNIQUE VISITORS". Card
//      menashharooni-swiftcard-2, created 15:54:28, had four card_views rows by
//      15:56:36 — four different visitor ids, one card, ninety seconds. The
//      dedupe keyed on a localStorage value the browser had not kept, so it
//      matched nothing, and the per-IP backstop sat in an `else` branch that a
//      request carrying ANY id could never reach. Fixed by the sc_vid cookie
//      plus a per-card device key (lib/visit-identity.ts).
//
//   3. A DATACENTER IS NOT A PERSON. Those same four views resolved to
//      "Quincy, WA" — an Azure region — with is_relay true and a push to the
//      owner for each. request-geo.ts had blended cloud hosting and consumer
//      privacy relays into one pattern and so could only downgrade both or drop
//      both; they are separate patterns now, and only hosting stops counting.
//
// What must NOT regress: a genuine return after the window is still a view, an
// anonymous visitor is still a visitor, and two people behind one office NAT
// are still two people.
// ─────────────────────────────────────────────────────────────────────────────

import {
  decideVisitIdentity,
  deviceKeyFor,
  isVisitorId,
  VISITOR_COOKIE,
} from "@/lib/visit-identity";
import { isCloudHostingOrg } from "@/lib/request-geo";
import { VIEW_VISIT_WINDOW_MS } from "@/lib/view-window";

// ── The in-memory database every recordView test runs against ────────────────

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { cards: [], profiles: [], user_devices: [], card_views: [] };

/** A cut-down PostgREST builder: enough of the chain for the queries this
 *  pipeline actually issues, and nothing more. */
function table(name: string) {
  const filters: { op: "eq" | "gte" | "lte"; col: string; val: unknown }[] = [];
  let order: { col: string; asc: boolean } | null = null;
  let limit = Infinity;
  let mode: "select" | "update" = "select";
  let patch: Row = {};

  const rows = () => {
    let out = (db[name] ?? []).filter((r) =>
      filters.every((f) => (f.op === "eq" ? r[f.col] === f.val : f.op === "gte" ? String(r[f.col]) >= String(f.val) : String(r[f.col]) <= String(f.val))),
    );
    if (order) {
      const { col, asc } = order;
      out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    return out.slice(0, limit);
  };

  const apply = () => {
    if (mode === "update") for (const r of rows()) Object.assign(r, patch);
    return { data: rows(), error: null };
  };

  const q = {
    select: () => q,
    eq: (col: string, val: unknown) => { filters.push({ op: "eq", col, val }); return q; },
    gte: (col: string, val: unknown) => { filters.push({ op: "gte", col, val }); return q; },
    lte: (col: string, val: unknown) => { filters.push({ op: "lte", col, val }); return q; },
    order: (col: string, opts?: { ascending?: boolean }) => {
      order = { col, asc: opts?.ascending !== false };
      return q;
    },
    limit: (n: number) => { limit = n; return q; },
    update: (p: Row) => { mode = "update"; patch = p; return q; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    insert: async (row: Row) => {
      // The visit-bucket unique indexes, in miniature: the app-layer check has
      // to be able to lose a race and be told so (23505).
      const bucket = (ts: unknown) => Math.floor(new Date(String(ts)).getTime() / VIEW_VISIT_WINDOW_MS);
      const clash = (db[name] ?? []).some(
        (r) =>
          r.username === row.username &&
          bucket(r.viewed_at) === bucket(row.viewed_at) &&
          ((row.visitor_id != null && r.visitor_id === row.visitor_id) ||
            (row.device_key != null && r.device_key === row.device_key)),
      );
      if (clash) return { error: { code: "23505", message: "duplicate key" } };
      (db[name] ??= []).push({ id: `row-${(db[name] ?? []).length + 1}`, ...row });
      return { error: null };
    },
    then: (res: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve(apply()).then(res),
  };
  return q;
}

vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({ from: table }) }));

// Who the request's Supabase session says it is. Null = signed out, which is
// the state the public card page is in far more often than anyone assumed.
let sessionUserId: string | null = null;
vi.mock("@/lib/supabase-server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUserId ? { id: sessionUserId } : null } }) },
  }),
}));

// The httpOnly device cookie src/proxy.ts plants on authenticated routes.
let deviceCookie: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sc_device" && deviceCookie ? { value: deviceCookie } : undefined) }),
}));

let geoOrg: string | null = null;
vi.mock("@/lib/request-geo", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/request-geo")>();
  return {
    ...real,
    resolveGeo: async () => ({
      label: "Great Neck, NY",
      accuracy: "city" as const,
      source: "edge+second" as const,
      org: geoOrg,
      isRelay: !!geoOrg,
      isHosting: real.isCloudHostingOrg(geoOrg),
    }),
  };
});

vi.mock("@/lib/card-active", () => ({ isCardActive: async () => true }));
vi.mock("@/lib/crm-events", () => ({ dispatchCrmEvent: async () => {} }));
vi.mock("@/lib/milestones", () => ({ checkViewMilestone: async () => null }));

const rateHits = new Map<string, number>();
vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: async (key: string, max: number) => {
    const n = (rateHits.get(key) ?? 0) + 1;
    rateHits.set(key, n);
    return n > max;
  },
}));

import { recordView } from "@/lib/record-view";

const OWNER = "owner-user-id";
const SLUG = "dana-lee-acme";

/** One tracking request. `at` lets a test move time without faking timers. */
async function view(opts: {
  visitorId?: string | null;
  ip?: string;
  ua?: string;
  source?: string | null;
  at?: number;
  fromCookie?: boolean;
  /** visit-identity's "minted": the browser handed up no id of its own.
   *  Defaults to true only when no visitor id is supplied. */
  minted?: boolean;
}) {
  const ip = opts.ip ?? "203.0.113.7";
  const ua = opts.ua ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) Safari/605.1.15";
  // Whole-clock, not just Date.now(): the row's viewed_at comes from
  // `new Date()`, and a test that moved only one of the two would be testing
  // nothing at all.
  if (opts.at != null) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(opts.at);
  }
  try {
    return await recordView({
      req: { headers: new Headers({ "user-agent": ua }) } as never,
      username: SLUG,
      visitorId: opts.visitorId === undefined ? "visitor-alpha" : opts.visitorId,
      deviceKey: deviceKeyFor({ ip, userAgent: ua, username: SLUG }),
      source: opts.source ?? "direct_link",
      ip,
      identityFromCookie: opts.fromCookie ?? false,
      identityMinted: opts.minted ?? opts.visitorId === null,
    });
  } finally {
    if (opts.at != null) vi.useRealTimers();
  }
}

const viewRows = () => db.card_views;

beforeEach(() => {
  for (const k of Object.keys(db)) db[k] = [];
  db.cards.push({ user_id: OWNER, username: SLUG });
  sessionUserId = null;
  deviceCookie = null;
  geoOrg = null;
  rateHits.clear();
});

// ── 1. The owner looking at their own card ───────────────────────────────────

describe("an owner viewing their own card", () => {
  it("is not a view, not a unique visitor, and not a notification", async () => {
    sessionUserId = OWNER;
    const { outcome } = await view({});
    expect(outcome).toBe("self");
    expect(viewRows()).toHaveLength(0);
  });

  it("is still not a view when the session has lapsed and only the device cookie is left", async () => {
    // The real production shape: the public card route is outside the proxy's
    // matcher, so nothing there refreshes the session and getUser() sees no one.
    sessionUserId = null;
    deviceCookie = "a".repeat(32);
    db.user_devices.push({ device_id: "a".repeat(32), user_id: OWNER, last_seen: "2026-09-14T10:00:00Z" });

    const { outcome } = await view({});
    expect(outcome).toBe("self");
    expect(viewRows()).toHaveLength(0);
  });

  // ONE BROWSER, TWO OF THE OWNER'S OWN ACCOUNTS. This replaces a test that
  // pinned "most recent claimant only" (owner report, 2026-09-18): production
  // showed both of his accounts claiming the same two devices, `last_seen`
  // moving only when THAT account loads a protected page, and his own view of
  // his own card recorded as a stranger and pushed to his phone because the
  // other account's row happened to be fresher.
  it("suppresses the owner when ANY recent claimant of the device is the owner", async () => {
    sessionUserId = null; // signed in as his OTHER account, which this card doesn't own
    deviceCookie = "b".repeat(32);
    const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const older = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    db.user_devices.push({ device_id: "b".repeat(32), user_id: OWNER, last_seen: older });
    db.user_devices.push({ device_id: "b".repeat(32), user_id: "his-other-account", last_seen: fresh });

    expect((await view({})).outcome).toBe("self");
  });

  it("a claim older than the window stops suppressing — a device handed on ages out", async () => {
    sessionUserId = null;
    deviceCookie = "d".repeat(32);
    const ancient = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    db.user_devices.push({ device_id: "d".repeat(32), user_id: OWNER, last_seen: ancient });
    db.user_devices.push({ device_id: "d".repeat(32), user_id: "someone-else", last_seen: new Date().toISOString() });

    expect((await view({})).outcome).toBe("recorded");
  });

  it("does not suppress a DIFFERENT signed-in person looking at the card", async () => {
    sessionUserId = "a-real-visitor-who-happens-to-have-an-account";
    expect((await view({})).outcome).toBe("recorded");
    expect(viewRows()).toHaveLength(1);
  });

  it("does not suppress a visitor who merely shares the owner's network", async () => {
    // Identity-based, never IP-based. The owner's device cookie is absent from
    // the visitor's browser even though the IP is the same.
    sessionUserId = null;
    deviceCookie = null;
    db.user_devices.push({ device_id: "c".repeat(32), user_id: OWNER, last_seen: "2026-09-14T10:00:00Z" });
    expect((await view({ ip: "198.51.100.4" })).outcome).toBe("recorded");
  });
});

// ── 2. One visit that fires the tracker more than once ───────────────────────

describe("one page visit that fires several tracking calls", () => {
  it("records exactly one view when the id is stable (remount, retry, back-nav)", async () => {
    const outcomes = [];
    for (let i = 0; i < 4; i++) outcomes.push((await view({ visitorId: "visitor-alpha" })).outcome);
    expect(outcomes).toEqual(["recorded", "deduped", "deduped", "deduped"]);
    expect(viewRows()).toHaveLength(1);
  });

  it("STILL records exactly one view when the browser can keep no id and one is minted every load", async () => {
    // The four-views-per-visit bug, reproduced: four loads, four server-minted
    // ids (no cookie, no localStorage), one browser, one card, one visit window.
    // Before the device key this was four rows and four "unique visitors".
    const outcomes = [];
    for (const id of ["fresh-1111", "fresh-2222", "fresh-3333", "fresh-4444"]) {
      outcomes.push((await view({ visitorId: id, minted: true })).outcome);
    }
    expect(outcomes).toEqual(["recorded", "deduped", "deduped", "deduped"]);
    expect(viewRows()).toHaveLength(1);
  });

  it("still records one view when the browser can supply no id at all", async () => {
    expect((await view({ visitorId: null })).outcome).toBe("recorded");
    expect((await view({ visitorId: null })).outcome).toBe("deduped");
    expect(viewRows()).toHaveLength(1);
  });

  // Warm-lead plan H7. Two people in one room, same Wi-Fi, same iOS build:
  // byte-identical device keys. With their cookies they are two proven
  // identities, and the database index must not merge them.
  it("two cookie-bearing visitors on one Wi-Fi with identical phones are two views", async () => {
    expect((await view({ visitorId: "cookie-person-a", fromCookie: true })).outcome).toBe("recorded");
    expect((await view({ visitorId: "cookie-person-b", fromCookie: true })).outcome).toBe("recorded");
    expect(viewRows()).toHaveLength(2);
    expect(viewRows().every((r) => r.device_key == null)).toBe(true);
  });

  // 2026-10-06. The first-time case: no cookie yet, but each phone hands up its
  // own localStorage id. Same Wi-Fi, same iOS build, same card, seconds apart —
  // the QR passed around a room. These are two people and must be two views.
  it("two FIRST-TIME visitors on one Wi-Fi with identical phones are two views", async () => {
    expect((await view({ visitorId: "first-time-a" })).outcome).toBe("recorded");
    expect((await view({ visitorId: "first-time-b" })).outcome).toBe("recorded");
    expect(viewRows()).toHaveLength(2);
    expect(viewRows().every((r) => r.device_key == null)).toBe(true);
  });

  it("a browser that could keep no id still carries the device key, so its minted reloads stay one visit", async () => {
    await view({ visitorId: "fresh-aaaa", minted: true });
    expect(viewRows()[0].device_key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("upgrades the source in place rather than adding a row, when the scan arrives second", async () => {
    await view({ visitorId: "visitor-alpha", source: "direct_link" });
    const { outcome } = await view({ visitorId: "visitor-alpha", source: "qr_scan" });
    expect(outcome).toBe("deduped");
    expect(viewRows()).toHaveLength(1);
    expect(viewRows()[0].source).toBe("qr_scan");
  });
});

// ── 3 & 4. The 30-minute visit window, both sides of it ──────────────────────

describe("the 30-minute visit window is unchanged", () => {
  const t0 = Date.UTC(2026, 8, 14, 12, 0, 0);

  it("a refresh inside the window is the same visit", async () => {
    expect((await view({ at: t0 })).outcome).toBe("recorded");
    expect((await view({ at: t0 + 60_000 })).outcome).toBe("deduped");
    expect((await view({ at: t0 + VIEW_VISIT_WINDOW_MS - 1_000 })).outcome).toBe("deduped");
    expect(viewRows()).toHaveLength(1);
  });

  it("a return AFTER the window is a genuine repeat view and records again", async () => {
    expect((await view({ at: t0 })).outcome).toBe("recorded");
    expect((await view({ at: t0 + VIEW_VISIT_WINDOW_MS + 1_000 })).outcome).toBe("recorded");
    expect(viewRows()).toHaveLength(2);
    // Same person both times — two views, one unique viewer, which is exactly
    // the split the dashboard computes from these rows.
    expect(new Set(viewRows().map((r) => r.visitor_id)).size).toBe(1);
  });

  it("the device backstop expires with the window too — it never freezes a card", async () => {
    expect((await view({ visitorId: "fresh-a", at: t0 })).outcome).toBe("recorded");
    expect(
      (await view({ visitorId: "fresh-b", at: t0 + VIEW_VISIT_WINDOW_MS + 1_000 })).outcome,
    ).toBe("recorded");
    expect(viewRows()).toHaveLength(2);
  });
});

// ── 5. Anonymous visitors, who must keep counting ────────────────────────────

describe("anonymous visitors", () => {
  it("two different people are two views and two unique visitors", async () => {
    await view({ visitorId: "anon-one", ip: "203.0.113.7", ua: "Safari/iPhone" });
    await view({ visitorId: "anon-two", ip: "198.51.100.9", ua: "Chrome/Android" });
    expect(viewRows()).toHaveLength(2);
    expect(new Set(viewRows().map((r) => r.visitor_id)).size).toBe(2);
  });

  it("two colleagues behind one office NAT are still two visitors", async () => {
    // Same IP, different browsers — the device key differs, so nothing merges.
    await view({ visitorId: "anon-one", ip: "203.0.113.7", ua: "Safari/iPhone" });
    await view({ visitorId: "anon-two", ip: "203.0.113.7", ua: "Chrome/Windows" });
    expect(viewRows()).toHaveLength(2);
  });

  it("a first-time visitor with no history is recorded, not suspected", async () => {
    expect((await view({ visitorId: "never-seen-before" })).outcome).toBe("recorded");
  });
});

// ── 6. Location and notifications derive from the same event ─────────────────

describe("location and notification consistency", () => {
  it("a recorded view stores the same geo answer it hands back to the notifier", async () => {
    const { outcome, location, geo } = await view({});
    expect(outcome).toBe("recorded");
    expect(location).toBe("Great Neck, NY");
    expect(geo?.accuracy).toBe("city");
    expect(viewRows()[0]).toMatchObject({ location: "Great Neck, NY", geo_accuracy: "city" });
  });

  it("every outcome that writes no row also reports no 'recorded' — no bell without a bar", async () => {
    // /api/card-events notifies only on "recorded"; this is the invariant that
    // keeps the bell and the traffic chart from disagreeing.
    sessionUserId = OWNER;
    expect((await view({})).outcome).toBe("self");
    sessionUserId = null;

    geoOrg = "Microsoft Corporation";
    expect((await view({ visitorId: "crawler-1" })).outcome).toBe("hosting");
    geoOrg = null;

    expect((await view({ visitorId: "real-person" })).outcome).toBe("recorded");
    expect((await view({ visitorId: "real-person" })).outcome).toBe("deduped");

    expect(viewRows()).toHaveLength(1);
  });

  it("a deduped attempt still reports the location, so a caller never invents one", async () => {
    await view({});
    const second = await view({});
    expect(second.outcome).toBe("deduped");
    expect(second.location).toBe("Great Neck, NY");
  });

  it("the database race backstop reads as a dedup, not an error", async () => {
    // Two instances both pass the app-layer check; the unique index decides.
    db.card_views.push({
      username: SLUG,
      visitor_id: "visitor-alpha",
      viewed_at: new Date().toISOString(),
      device_key: "unrelated",
    });
    // The row above is invisible to the window lookup only because the test
    // inserted it directly; the insert below still collides on the bucket.
    const { outcome } = await recordView({
      req: { headers: new Headers() } as never,
      username: SLUG,
      visitorId: "visitor-alpha",
      deviceKey: null,
      source: null,
      ip: "203.0.113.7",
    });
    expect(outcome).toBe("deduped");
  });
});

// ── 7. Cloud egress is not a person; a privacy relay is ──────────────────────

describe("datacenter traffic vs privacy-relay traffic", () => {
  it("does not count a view from cloud hosting", async () => {
    for (const org of ["Microsoft Corporation", "Amazon Technologies Inc.", "Google Cloud", "DigitalOcean, LLC", "Hetzner Online GmbH"]) {
      geoOrg = org;
      expect(isCloudHostingOrg(org)).toBe(true);
      expect((await view({ visitorId: `bot-${org}` })).outcome).toBe("hosting");
    }
    expect(viewRows()).toHaveLength(0);
  });

  it("still counts iCloud Private Relay and consumer VPNs — those are real people", async () => {
    for (const org of ["Cloudflare, Inc.", "Akamai Technologies", "Fastly", "Mullvad VPN AB"]) {
      expect(isCloudHostingOrg(org)).toBe(false);
    }
    geoOrg = "Cloudflare, Inc.";
    expect((await view({ visitorId: "relay-visitor" })).outcome).toBe("recorded");
  });

  it("an ordinary consumer ISP is untouched", async () => {
    for (const org of ["Verizon Fios", "Optimum Online", "Comcast Cable", "T-Mobile USA"]) {
      expect(isCloudHostingOrg(org)).toBe(false);
    }
  });
});

// ── 8. The identity itself ───────────────────────────────────────────────────

describe("the durable visit identity", () => {
  it("prefers the server's cookie over whatever the page script sends", () => {
    const d = decideVisitIdentity("cookie-abc123", "a-brand-new-localstorage-id");
    expect(d).toEqual({ visitorId: "cookie-abc123", setCookie: false, minted: false });
  });

  it("ADOPTS an existing localStorage id on first sight, so no visitor loses their history", () => {
    const d = decideVisitIdentity(null, "3da73ee9-ec6d-45f6-9c62-4faf3503ef1b");
    expect(d.visitorId).toBe("3da73ee9-ec6d-45f6-9c62-4faf3503ef1b");
    expect(d.setCookie).toBe(true);
    expect(d.minted).toBe(false);
  });

  it("mints one when the browser offers nothing, and says so", () => {
    const d = decideVisitIdentity(null, null);
    expect(isVisitorId(d.visitorId)).toBe(true);
    expect(d).toMatchObject({ setCookie: true, minted: true });
  });

  it("refuses a malformed or unbounded cookie rather than storing it", () => {
    for (const bad of ["", "short", "a".repeat(65), "has space", "semi;colon", "new\nline"]) {
      expect(isVisitorId(bad)).toBe(false);
    }
  });

  it("the device key is per-card, so it cannot follow one device between owners", () => {
    const a = deviceKeyFor({ ip: "203.0.113.7", userAgent: "UA", username: "dana-lee-acme" });
    const b = deviceKeyFor({ ip: "203.0.113.7", userAgent: "UA", username: "sam-ray-acme" });
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("the device key is stable for one browser and different for another", () => {
    const same = deviceKeyFor({ ip: "203.0.113.7", userAgent: "UA-1", username: SLUG });
    expect(deviceKeyFor({ ip: "203.0.113.7", userAgent: "UA-1", username: SLUG })).toBe(same);
    expect(deviceKeyFor({ ip: "203.0.113.7", userAgent: "UA-2", username: SLUG })).not.toBe(same);
    expect(deviceKeyFor({ ip: "198.51.100.9", userAgent: "UA-1", username: SLUG })).not.toBe(same);
  });

  it("is null without a usable IP — a null key must never match another null key", () => {
    expect(deviceKeyFor({ ip: null, userAgent: "UA", username: SLUG })).toBeNull();
    expect(deviceKeyFor({ ip: "unknown", userAgent: "UA", username: SLUG })).toBeNull();
  });

  it("never stores the raw IP", () => {
    const key = deviceKeyFor({ ip: "203.0.113.7", userAgent: "UA", username: SLUG })!;
    expect(key).not.toContain("203.0.113.7");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ── 9. Source invariants the behaviour above cannot see ──────────────────────

describe("the pipeline is wired the way the tests assume", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const recordSrc = read("src/lib/record-view.ts");
  const eventsSrc = read("src/app/api/card-events/route.ts");
  const viewsSrc = read("src/app/api/views/[username]/route.ts");
  const identitySrc = read("src/lib/visit-identity.ts");

  it("the ingest route that records resolves the identity server-side and sets the cookie", () => {
    expect(eventsSrc).toMatch(/resolveVisitIdentity\(req,/);
    expect(eventsSrc).toMatch(/attachVisitIdentity\(/);
    expect(eventsSrc).toMatch(/deviceKeyFor\(/);
  });

  // /api/views was retired 2026-09-18. It was public and unauthenticated, wrote
  // card_views + CRM events + milestones, and logged NOTHING — an audit blind
  // spot and a way to fabricate views at any public slug (the browser-side
  // human gate cannot apply to a direct POST). It must stay inert.
  it("the retired /api/views records nothing and logs that it was called", () => {
    expect(viewsSrc).not.toMatch(/recordView\(/);
    expect(viewsSrc).toMatch(/logIngest\(/);
    expect(viewsSrc).toMatch(/retired_endpoint/);
  });

  it("the card-events route keys its rows on the RESOLVED id, never the body's", () => {
    // The body's value is parsed into client_visitor_id and must be consumed by
    // exactly one thing: the identity resolution.
    const uses = eventsSrc.match(/client_visitor_id/g) ?? [];
    expect(uses).toHaveLength(2); // the parse, and resolveVisitIdentity
    expect(eventsSrc).toMatch(/const visitor_id = visitIdentity\.visitorId;/);
  });

  // A lead is the join key for "this contact came back". It must carry the id
  // their later views are keyed on — the cookie — not the localStorage value
  // the two used to drift on (warm-lead plan, H1).
  it("the lead route stores the RESOLVED id, never the body's, and hands the cookie back", () => {
    const leadsSrc = read("src/app/api/leads/route.ts");
    expect(leadsSrc).toMatch(/visitor_id: client_visitor_id/);
    const uses = leadsSrc.match(/client_visitor_id/g) ?? [];
    expect(uses).toHaveLength(3); // the parse, the type guard, resolveVisitIdentity
    expect(leadsSrc).toMatch(/resolveVisitIdentity\(req, typeof client_visitor_id === "string" \? client_visitor_id : null\)/);
    expect(leadsSrc).toMatch(/const visitor_id = visitIdentity\.visitorId;/);
    // Every success exit sets the cookie, including the deduped re-submit.
    expect(leadsSrc).toMatch(/attachVisitIdentity\(NextResponse\.json\(\{ success: true \}\), visitIdentity\)/);
    expect(leadsSrc).toMatch(/attachVisitIdentity\(NextResponse\.json\(\{ success: true, deduped: true \}\), visitIdentity\)/);
    // A minted id is unique per request, so it must not narrow the double-submit
    // dedupe. The same-person check (2026-10-06) is card + phone only — no
    // visitor id at all, so neither a minted id nor another device gets a
    // second contact through.
    const knownQuery = leadsSrc.slice(leadsSrc.indexOf("const { data: knownRows }"), leadsSrc.indexOf("const known = knownRows"));
    expect(knownQuery).toMatch(/\.eq\("phone", phone\)/);
    expect(knownQuery).not.toMatch(/visitor_id/);
  });

  it("a lead submitted by a browser whose storage was wiped still lands on the cookie's id", () => {
    // The drift case itself: cookie survived, localStorage minted a new id.
    expect(decideVisitIdentity("cookie-id-123", "fresh-local-456").visitorId).toBe("cookie-id-123");
  });

  it("the identity cookie is httpOnly and first-party, so page script cannot rotate it", () => {
    expect(identitySrc).toMatch(/httpOnly: true/);
    expect(identitySrc).toMatch(/sameSite: "lax"/);
    expect(identitySrc).toMatch(/VISITOR_COOKIE = "sc_vid"/);
    expect(VISITOR_COOKIE).toBe("sc_vid");
  });

  // The backstop still may not hide in an `else` (that was the four-views bug),
  // but it is now reached ONLY for a browser that could keep no identity at
  // all. The key is sha256(slug + ip + user-agent), and two iPhones on one
  // Wi-Fi share it byte for byte, which silently deleted the second person's
  // visit — at a QR code passed around a room (owner report, 2026-09-18).
  it("the device backstop is consulted only for an identity-less browser, never in an `else`", () => {
    expect(recordSrc).toMatch(/if \(!recent && deviceKey && identityMinted\) recent = await recentBy\("device_key", deviceKey\);/);
    expect(recordSrc).toMatch(/identityMinted = false/);
    expect(eventsSrc).toMatch(/identityMinted: visitIdentity\.minted/);
    expect(eventsSrc).toMatch(/identityFromCookie: !visitIdentity\.setCookie/);
    expect(recordSrc).toMatch(/device_key: identityMinted \? deviceKey : null/);
  });

  it("owner exclusion has two signals and neither of them is an IP", () => {
    const selfSrc = read("src/lib/self-traffic.ts");
    expect(selfSrc).toMatch(/auth\.getUser\(\)/);
    expect(selfSrc).toMatch(/DEVICE_COOKIE/);
    // Bounded by recency, and EVERY recent claimant counts: one browser can be
    // signed into two of the same person's accounts, and "most recent wins"
    // then named the wrong one (owner report, 2026-09-18).
    expect(selfSrc).toMatch(/DEVICE_CLAIM_MS/);
    expect(selfSrc).toMatch(/claimsOwner\(/);
    expect(selfSrc).not.toMatch(/\bclientIp\b/);
  });

  it("a view that is not recorded can never reach the notifier", () => {
    expect(eventsSrc).toMatch(/if \(outcome !== "recorded"\)/);
  });
});
