import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 8 (2026-10-16): numbers you can trust ───────────────────────
//
// A-03  Admin analytics counted rows of deleted cards: 84% of leads and a
//       third of card views belonged to cards that no longer exist.
// A-06  Every new card is seeded with a sample contact (tagged "demo", source
//       "qr_code"): 219 of 245 admin "leads" were that sample.
// A-09  Views and saves could be forged by a direct POST with a fresh
//       visitor_id each time — 8,640 a day per card from one machine.

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

function makeQuery(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let head = false;
  let range: [number, number] | null = null;
  const rows = () => (db[name] ??= []);
  const run = () => {
    let m = rows().filter((r) => filters.every((f) => f(r)));
    const count = m.length;
    if (range) m = m.slice(range[0], range[1] + 1);
    return { data: head ? null : m, count, error: null };
  };
  const chain: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return chain; },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
    gte: (k: string, v: string) => { filters.push((r) => String(r[k] ?? "") >= v); return chain; },
    or: () => chain, order: () => chain, limit: () => chain, contains: () => chain,
    in: (k: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[k])); return chain; },
    not: (k: string, op: string, v: string) => {
      if (op === "cs" && v === "{demo}") filters.push((r) => !(Array.isArray(r[k]) && (r[k] as unknown[]).includes("demo")));
      return chain;
    },
    range: (a: number, b: number) => { range = [a, b]; return chain; },
    maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (t: string) => makeQuery(t),
    // office_employee_view_stats for the 7/30-day windows: one card view, one Swift Links view.
    rpc: async () => ({ data: [{ views: 1, swiftlink_views: 1 }], error: null }),
  }),
}));

// Since 2026-10-28 the route reads accounts through lib/admin-data (customers
// only) and counts each card through the same database totals the customer's
// own pages use (office_employee_*_stats). Here: one customer with card "dana",
// and one of OUR accounts with card "ours" that must never reach a number.
const teamsAsked = vi.hoisted(() => [] as string[][]);
vi.mock("@/lib/admin-data/accounts", async (orig) => {
  const real = await orig<typeof import("@/lib/admin-data/accounts")>();
  const acct = (id: string, kind: "customer" | "internal", slug: string) => ({
    id, kind, email: `${id}@x.com`, name: id, profileName: null, username: id, plan: "pro", effectivePlan: "pro",
    planExpiresAt: null, createdAt: new Date().toISOString(), signupSource: null, referralCode: null, company: null, title: null,
    customization: {}, stripeSubscriptionId: null, stripeCustomerId: null, deleted: false,
    cards: [{ id: `card-${slug}`, username: slug, name: id, label: null, created_at: new Date().toISOString(), is_offline: false }],
    officeRole: null, billing: { source: "none", trialEndsAt: null, pastDue: false, cancelling: false, everPaid: false },
  });
  return { ...real, loadAccounts: async () => [acct("u1", "customer", "dana"), acct("us", "internal", "ours")] };
});
vi.mock("@/lib/office-analytics", async (orig) => {
  const real = await orig<typeof import("@/lib/office-analytics")>();
  return {
    ...real,
    getOfficeEmployeeMetricsForTeam: async (team: { userId: string; username: string; cardSlugs: { username: string }[] }[]) => {
      teamsAsked.push(team.flatMap((m) => m.cardSlugs.map((c) => c.username)));
      // The database's answer for "dana": one real contact (the sample is excluded in SQL).
      return team.map((m) => {
        const dana = m.cardSlugs.some((c) => c.username === "dana");
        return { userId: m.userId, name: "", username: m.username, isOwner: false, cardName: null, cardCount: 1, views: dana ? 1 : 0, swiftlinkViews: dana ? 1 : 0, scans: 0, uniqueVisitors: 0, leads: dana ? 1 : 0, contactsSaved: 0, lastActivityAt: null };
      });
    },
  };
});
vi.mock("@/lib/admin-data/billing", () => ({
  revenue: async () => ({ available: false, reason: "not in this test" }),
  listSubscriptions: async () => [],
  monthlyCents: () => 0,
}));
vi.mock("@/lib/admin", () => ({ requireAdmin: async () => ({ id: "admin" }), isAdminEmail: () => false }));
vi.mock("@/lib/account-email", () => ({ getAccountEmailMap: async () => new Map() }));
vi.mock("@/lib/warm-lead-metrics", () => ({ warmLeadMetrics: async () => ({}) }));

const now = new Date().toISOString();

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  db.profiles = [{ id: "u1", plan: "pro", created_at: now }];
  db.cards = [{ username: "dana" }];
  db.leads = [
    { card_owner: "dana", tags: [], source: "direct_link", created_at: now },
    { card_owner: "dana", tags: ["demo", "unread"], source: "qr_code", created_at: now }, // the sample
    { card_owner: "deleted-card", tags: [], source: "qr_code", created_at: now },          // orphan
  ];
  db.card_views = [
    { username: "dana", visitor_id: "v1", viewed_at: now },
    { username: "dana__links", visitor_id: "v2", viewed_at: now },
    { username: "deleted-card", visitor_id: "v3", viewed_at: now },
  ];
});

describe("A-03 / A-06: admin analytics count customers' live cards and real contacts only", () => {
  it("leads, views, the source split, top cards and activation: customers' cards only, never the sample or deleted cards", async () => {
    const { GET } = await import("@/app/api/admin/analytics/route");
    const d = await (await GET()).json();
    expect(d.leads.total).toBe(1);
    // The 30-day rows: the sample contact and the deleted card's contact are left out.
    expect(d.leads.bySource).toEqual([["direct_link", 1]]);
    expect(d.views.total).toBe(1);
    expect(d.views.linkTotal).toBe(1);
    expect(d.views.cardViews30 + d.views.linkViews30).toBe(2);
    expect(d.topCards).toEqual([{ username: "dana", count: 1, userId: "u1" }]);
    expect(d.engagement.activatedCards).toBe(1);
    // Our own account's card never reached a database total.
    expect(teamsAsked.flat()).toContain("dana");
    expect(teamsAsked.flat()).not.toContain("ours");
    expect(d.accounts.total).toBe(1);
    expect(d.internal.accounts).toBe(1);
  });
});

describe("A-09: forged views are bounded", () => {
  const route = readFileSync("src/app/api/card-events/route.ts", "utf8");

  it("a cookieless identity's views and saves have a daily ceiling per IP per card", () => {
    expect(route).toContain("const UNPROVEN_VIEWS_PER_DAY = 300;");
    expect(route).toContain("const identityUnproven = visitIdentity.setCookie;");
    expect(route).toMatch(/if \(identityUnproven && \(event_type === "viewed_card" \|\| event_type === "downloaded_vcard"\)\s*&& await isRateLimited\(`views-unproven-day:\$\{ip\}:\$\{card_owner_username\}`, UNPROVEN_VIEWS_PER_DAY, UNPROVEN_VIEWS_WINDOW_MS\)\) \{\s*return decided\("rate_limited"/);
  });

  it("…without bringing back the device-key dedupe that deleted the second iPhone in a room", () => {
    expect(route).not.toMatch(/identityMinted: identityUnproven/);
    expect(route.match(/identityMinted: visitIdentity\.minted,/g)?.length).toBe(2);
  });
});
