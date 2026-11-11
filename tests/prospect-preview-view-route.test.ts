import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Card Builder: the view beacon's route, end to end ───────────────────────
//
// POST /api/p/view with the database, the push and the admin session replaced
// by fakes, so what is under test is the route's own wiring: who gets a view
// row, who rings the admins' phones, and that a stranger learns nothing from
// the answer. The rules themselves are in prospect-preview-real-view.test.ts.

const state = vi.hoisted(() => ({
  preview: null as Record<string, unknown> | null,
  admin: false,
  hosting: false,
  limited: false,
  views: [] as { id: string; previewId: string; deviceId: string; deviceType: string; deviceLabel: string | null; first: boolean; alerted: boolean; strip: boolean }[],
  alerts: [] as { viewId: string; previewId: string }[],
}));

vi.mock("@/lib/admin", () => ({ requireAdmin: async () => (state.admin ? { id: "admin-1", email: "owner@swiftcard.me" } : null) }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async () => state.limited }));
vi.mock("@/lib/request-geo", () => ({ resolveGeo: async () => ({ isHosting: state.hosting }) }));
vi.mock("@/lib/prospect-preview/alert", () => ({
  alertAdminsOfView: async (v: { viewId: string; preview: { id: string } }) => { state.alerts.push({ viewId: v.viewId, previewId: v.preview.id }); },
}));
// The store, in memory, with the same contract as the real one: one row per
// device per visit, and "first from this device" true exactly once.
vi.mock("@/lib/prospect-preview/store", () => ({
  getPreviewBySlug: async (slug: string) => (state.preview && state.preview.slug === slug ? state.preview : null),
  recordView: async (v: { previewId: string; deviceId: string; deviceType: string; deviceLabel: string | null }) => {
    const same = state.views.filter((r) => r.previewId === v.previewId && r.deviceId === v.deviceId);
    if (same.length) return { viewId: same[0].id, firstFromDevice: false, repeat: true };
    const row = { id: `view-${state.views.length + 1}`, ...v, first: true, alerted: false, strip: false };
    state.views.push(row);
    return { viewId: row.id, firstFromDevice: true, repeat: false };
  },
  markTeamStripScrolled: async (previewId: string, deviceId: string) => {
    const row = state.views.find((r) => r.previewId === previewId && r.deviceId === deviceId);
    if (row) row.strip = true;
  },
  alertsInLastDay: async (previewId: string) => state.views.filter((r) => r.previewId === previewId && r.alerted).length,
  markAlerted: async (viewId: string) => { const row = state.views.find((r) => r.id === viewId); if (row) row.alerted = true; },
}));

import { POST } from "@/app/api/p/view/route";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const SLUG = "harbor-realty-group-k3x9qa";

function beacon(opts: { ua?: string | null; device?: string; cookie?: string; event?: string; slug?: string; headers?: Record<string, string>; touch?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-real-ip": "203.0.113.9", ...(opts.headers ?? {}) };
  if (opts.ua !== null) headers["user-agent"] = opts.ua ?? IPHONE;
  const cookies = [opts.device ? `sc_vid=${opts.device}` : "", opts.cookie ?? ""].filter(Boolean).join("; ");
  if (cookies) headers.cookie = cookies;
  return new NextRequest("https://swiftcard.me/api/p/view", {
    method: "POST",
    headers,
    body: JSON.stringify({ slug: opts.slug ?? SLUG, event: opts.event ?? "view", visitor_id: "", touch: opts.touch ?? false }),
  });
}

beforeEach(() => {
  state.preview = { id: "preview-1", slug: SLUG, status: "live", expires_at: new Date(Date.now() + 86_400_000).toISOString(), owner_name: "Dana Whitfield", office_name: "Harbor Realty Group", phone: "(212) 555-0199" };
  state.admin = false;
  state.hosting = false;
  state.limited = false;
  state.views = [];
  state.alerts = [];
});

describe("a real view", () => {
  it("is stored with the device it came from, and rings the admins", async () => {
    const res = await POST(beacon({ device: "device-aaaaaaaa" }));
    expect(await res.json()).toEqual({ ok: true });
    expect(state.views).toHaveLength(1);
    expect(state.views[0]).toMatchObject({ previewId: "preview-1", deviceId: "device-aaaaaaaa", deviceType: "phone", alerted: true });
    expect(state.views[0].deviceLabel).toMatch(/^iPhone/);
    expect(state.alerts).toEqual([{ viewId: "view-1", previewId: "preview-1" }]);
  });

  it("the same device again is the same visit: no second row, no second alert", async () => {
    await POST(beacon({ device: "device-aaaaaaaa" }));
    await POST(beacon({ device: "device-aaaaaaaa" }));
    expect(state.views).toHaveLength(1);
    expect(state.alerts).toHaveLength(1);
  });

  it("a view from a NEW device is stored and rings again", async () => {
    await POST(beacon({ device: "device-aaaaaaaa" }));
    await POST(beacon({ device: "device-bbbbbbbb", ua: MAC }));
    expect(state.views.map((v) => [v.deviceId, v.deviceType])).toEqual([["device-aaaaaaaa", "phone"], ["device-bbbbbbbb", "desktop"]]);
    expect(state.alerts).toHaveLength(2);
  });

  it("past five new devices in a day, views are still stored but stop ringing", async () => {
    for (let i = 0; i < 7; i++) await POST(beacon({ device: `device-0000000${i}` }));
    expect(state.views).toHaveLength(7);
    expect(state.alerts).toHaveLength(5);
  });

  it("a browser with no device cookie is given one, so its next visit is recognised", async () => {
    const res = await POST(beacon());
    expect(res.headers.get("set-cookie")).toMatch(/^sc_vid=[A-Za-z0-9_.:-]{8,64};/);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(state.views).toHaveLength(1);
  });

  it("an iPad in desktop mode (a Mac with a touch screen) is stored as a tablet", async () => {
    await POST(beacon({ device: "device-aaaaaaaa", ua: MAC, touch: true }));
    expect(state.views[0].deviceType).toBe("tablet");
  });
});

describe("the team strip", () => {
  it("marks the visit's row, and is not a view of its own", async () => {
    await POST(beacon({ device: "device-aaaaaaaa" }));
    await POST(beacon({ device: "device-aaaaaaaa", event: "team_strip" }));
    expect(state.views).toHaveLength(1);
    expect(state.views[0].strip).toBe(true);
    expect(state.alerts).toHaveLength(1);
  });

  it("on its own (no view yet) it records nothing", async () => {
    await POST(beacon({ device: "device-aaaaaaaa", event: "team_strip" }));
    expect(state.views).toHaveLength(0);
    expect(state.alerts).toHaveLength(0);
  });
});

describe("what never counts, and never rings", () => {
  const nothing = async (req: NextRequest) => {
    const res = await POST(req);
    // The same answer as a real view: a stranger can't tell which it was.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.views).toHaveLength(0);
    expect(state.alerts).toHaveLength(0);
    return res;
  };

  it("a link-preview fetcher that somehow ran the page's script", async () => {
    await nothing(beacon({ ua: "WhatsApp/2.23.20.0 A" }));
    await nothing(beacon({ ua: "facebookexternalhit/1.1 Facebot Twitterbot/1.0" }));
    await nothing(beacon({ ua: "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/141.0.0.0 Safari/537.36" }));
  });

  it("a request with no User-Agent", async () => {
    await nothing(beacon({ ua: null }));
  });

  it("a device carrying the admin cookie", async () => {
    await nothing(beacon({ cookie: "sc_internal=1", device: "device-aaaaaaaa" }));
  });

  it("a browser signed in as an admin", async () => {
    state.admin = true;
    await nothing(beacon({ device: "device-aaaaaaaa" }));
  });

  it("a datacenter", async () => {
    state.hosting = true;
    await nothing(beacon({ device: "device-aaaaaaaa" }));
  });

  it("a speculative load", async () => {
    await nothing(beacon({ headers: { "sec-purpose": "prefetch;prerender" } }));
  });

  it("an expired, paused or unknown preview", async () => {
    state.preview = { ...state.preview!, expires_at: new Date(Date.now() - 1000).toISOString() };
    await nothing(beacon({ device: "device-aaaaaaaa" }));
    state.preview = { ...state.preview!, expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "paused" };
    await nothing(beacon({ device: "device-aaaaaaaa" }));
    await nothing(beacon({ device: "device-aaaaaaaa", slug: "someone-elses-preview-zzzzzz" }));
    await nothing(beacon({ device: "device-aaaaaaaa", slug: "../../etc/passwd" }));
  });

  it("anything past the rate limit", async () => {
    state.limited = true;
    await nothing(beacon({ device: "device-aaaaaaaa" }));
  });

  it("a refused request is not handed a device cookie", async () => {
    const res = await nothing(beacon({ ua: "curl/8.4.0" }));
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
