import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── /api/site-view: what reaches the Website page (2026-10-28) ──────────────
// The owner: "website analytics is fake — make it accurate". The ingest half
// of that: one id per person, server racks refused, our own accounts known
// even signed out, the campaign a visit started on kept, and time on a page
// that can only grow.

const inserted = vi.hoisted(() => [] as Record<string, unknown>[]);
const updates = vi.hoisted(() => [] as { values: Record<string, unknown>; or: string | null }[]);
const state = vi.hoisted(() => ({
  hosting: false,
  user: null as { email: string } | null,
  claimants: [] as string[],
  emails: {} as Record<string, string>,
  cards: {} as Record<string, string[]>,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => ({
      // An account's card addresses (lib/admin-data accountKindOf).
      select: () => ({ eq: async (_k: string, userId: string) => ({ data: table === "cards" ? (state.cards[userId] ?? []).map((username) => ({ username })) : [], error: null }) }),
      insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null }; },
      update: (values: Record<string, unknown>) => {
        const u = { values, or: null as string | null };
        updates.push(u);
        const chain = { eq: () => chain, or: (f: string) => { u.or = f; return Promise.resolve({ error: null }); } };
        return chain;
      },
    }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: state.emails[id] ?? null } } }) } },
  }),
}));
vi.mock("@/lib/supabase-server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async () => false }));
vi.mock("@/lib/request-geo", () => ({ resolveGeo: async () => ({ isHosting: state.hosting }) }));
vi.mock("@/lib/self-traffic", () => ({ browserAccountIds: async () => state.claimants }));

const VID = "11111111-2222-4333-8444-555555555555";

function req(body: Record<string, unknown>, opts: { cookie?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest("https://swiftcard.me/api/site-view", {
    method: "POST",
    headers: {
      host: "swiftcard.me",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      "x-forwarded-for": "203.0.113.7",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...opts.headers,
    },
    body: JSON.stringify(body),
  });
}

const view = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), visitorId: VID, sessionId: "sess-1", path: "/", referrer: "https://www.google.com/search?q=x", device: "phone", ...over,
});

beforeEach(() => {
  inserted.length = 0;
  updates.length = 0;
  Object.assign(state, { hosting: false, user: null, claimants: [], emails: {}, cards: {} });
});

describe("a visitor's pageview", () => {
  it("is stored with the referrer host only, the device, and one durable id set as a cookie", async () => {
    const { POST } = await import("@/app/api/site-view/route");
    const res = await POST(req(view()));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ visitor_id: VID, path: "/", referrer: "google.com", device: "phone", is_internal: false, landing: false });
    // The same sc_vid cookie the card pages use, adopting the browser's id.
    expect(res.headers.get("set-cookie") ?? "").toContain(`sc_vid=${VID}`);
  });

  it("keeps the campaign tags of the page a visit started on, and only that page", async () => {
    const { POST } = await import("@/app/api/site-view/route");
    await POST(req(view({ landing: true, src: "badge", utm_source: "flyer", utm_campaign: "nyc" })));
    await POST(req(view({ landing: false, path: "/pricing", src: "badge" })));
    expect(inserted[0]).toMatchObject({ landing: true, src: "badge", utm_source: "flyer", utm_campaign: "nyc" });
    expect(inserted[1]).toMatchObject({ landing: false, src: null, utm_source: null });
  });

  it("an unknown device word is dropped, not stored", async () => {
    const { POST } = await import("@/app/api/site-view/route");
    await POST(req(view({ device: "toaster" })));
    expect(inserted[0].device).toBeNull();
  });
});

describe("what is not a visit", () => {
  it("traffic from a cloud server is refused", async () => {
    state.hosting = true;
    const { POST } = await import("@/app/api/site-view/route");
    expect(await (await POST(req(view()))).json()).toMatchObject({ skipped: "hosting" });
    expect(inserted).toHaveLength(0);
  });

  it("a prefetch is the browser guessing", async () => {
    const { POST } = await import("@/app/api/site-view/route");
    await POST(req(view(), { headers: { "sec-purpose": "prefetch;prerender" } }));
    expect(inserted).toHaveLength(0);
  });

  it("a signed-in customer in the card builder is using the app", async () => {
    state.user = { email: "dana@example.com" };
    const { POST } = await import("@/app/api/site-view/route");
    await POST(req(view({ path: "/cards/new" })));
    expect(inserted).toHaveLength(0);
    // …but the same customer reading the pricing page is a website visit.
    await POST(req(view({ path: "/pricing" })));
    expect(inserted[0]).toMatchObject({ path: "/pricing", is_internal: false });
  });
});

describe("the team's own visits are marked, never mixed in", () => {
  it("the Exclude-my-visits cookie or the QA flag", async () => {
    const { POST } = await import("@/app/api/site-view/route");
    await POST(req(view(), { cookie: "sc_internal=1" }));
    await POST(req(view({ internal: true })));
    expect(inserted.map((r) => r.is_internal)).toEqual([true, true]);
  });

  it("any of our accounts signed in, not only the admin's", async () => {
    state.user = { email: "qa-pro-1@swiftcard-test.invalid" };
    const { POST } = await import("@/app/api/site-view/route");
    await POST(req(view()));
    expect(inserted[0].is_internal).toBe(true);
  });

  it("signed OUT on a browser one of our accounts has signed in on", async () => {
    state.claimants = ["cust", "ours"];
    state.emails = { cust: "someone@example.com", ours: "hello@swiftcard.me" };
    const { POST } = await import("@/app/api/site-view/route");
    await POST(req(view()));
    expect(inserted[0].is_internal).toBe(true);
  });

  it("a founder's browser, by their card, whatever address they signed up with", async () => {
    state.claimants = ["founder"];
    state.emails = { founder: "someone@company.com" };
    state.cards = { founder: ["aaronlavi-malvecapital"] };
    const { POST } = await import("@/app/api/site-view/route");
    await POST(req(view()));
    expect(inserted[0].is_internal).toBe(true);
  });

  it("a browser only a customer has signed in on still counts", async () => {
    state.claimants = ["cust"];
    state.emails = { cust: "someone@example.com" };
    const { POST } = await import("@/app/api/site-view/route");
    await POST(req(view()));
    expect(inserted[0].is_internal).toBe(false);
  });
});

describe("time on a page only grows", () => {
  it("each beacon may raise the stored time, never lower it", async () => {
    const { POST } = await import("@/app/api/site-view/route");
    await POST(req({ event: "duration", id: VID, durationMs: 12_345 }));
    expect(updates[0].values).toEqual({ duration_ms: 12_345 });
    expect(updates[0].or).toBe("duration_ms.is.null,duration_ms.lt.12345");
  });

  it("capped at 30 minutes", async () => {
    const { POST } = await import("@/app/api/site-view/route");
    await POST(req({ event: "duration", id: VID, durationMs: 5 * 60 * 60 * 1000 }));
    expect(updates[0].values).toEqual({ duration_ms: 30 * 60 * 1000 });
  });
});
