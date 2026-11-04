import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── The owner's Demos page actions, and the visitor's manage link ───────────
// Cancel (two steps on the page), Mark no-show and Resend confirmation for the
// owner; I'll be there, Pick a new time and Cancel for the person who booked.

type Row = Record<string, unknown>;
const st = vi.hoisted(() => ({ admin: true, booking: null as Row | null, canceled: [] as Row[], moved: [] as Row[], queued: [] as Row[], updates: [] as Row[] }));

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/admin", () => ({ requireAdmin: async () => (st.admin ? { id: "a", email: "owner@example.com" } : null) }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async () => false }));
vi.mock("@/lib/report-error", () => ({ reportError: async () => {} }));
vi.mock("@/lib/demo/outbox", () => ({ drainDue: async () => ({}) }));
vi.mock("@/lib/demo/store", () => ({
  getBooking: async (id: string) => (st.booking && st.booking.id === id ? st.booking : null),
  getBookingByTokenHash: async (h: string) => (st.booking && st.booking.manage_token_hash === h ? st.booking : null),
  queueMessages: async (rows: Row[]) => { st.queued.push(...rows); },
  updateBooking: async (id: string, patch: Row) => { st.updates.push({ id, ...patch }); return { ok: true }; },
}));
vi.mock("@/lib/demo/service", () => ({
  cancelDemo: async (b: Row, by: string, reason: string | null) => { st.canceled.push({ id: b.id, by, reason }); return { ...b, status: "canceled" }; },
  rescheduleDemo: async (b: Row, start: Date) => {
    if (start.getUTCMinutes() % 30) return { ok: false, error: "not_open" };
    st.moved.push({ id: b.id, start: start.toISOString() });
    return { ok: true, booking: { ...b, starts_at: start.toISOString() } };
  },
  reconfirmDemo: async (b: Row) => ({ ...b, reconfirmed_at: "2026-11-10T15:00:00.000Z" }),
}));

const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a".repeat(43);
const future = new Date(Date.now() + 3 * 86_400_000).toISOString();

beforeEach(async () => {
  const { hashManageToken } = await import("@/lib/demo/token");
  st.admin = true;
  st.booking = { id: ID, status: "confirmed", starts_at: future, ends_at: future, name: "Alex Morgan", company: "Morgan Realty", timezone: "America/New_York", meet_url: "https://meet.google.com/abc-defg-hij", reconfirmed_at: null, manage_token_hash: hashManageToken(TOKEN) };
  st.canceled.length = 0; st.moved.length = 0; st.queued.length = 0; st.updates.length = 0;
});

const form = (fields: Record<string, string>, origin = "https://swiftcard.me") => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new NextRequest(`https://swiftcard.me/api/admin/demos/${ID}`, { method: "POST", headers: { origin }, body: fd });
};
const ctx = { params: Promise.resolve({ id: ID }) };

describe("the Demos page's actions, server side", () => {
  it("Cancel: admin only, same site only, then back to the page with a message", async () => {
    const { POST } = await import("@/app/api/admin/demos/[id]/route");
    st.admin = false;
    expect((await POST(form({ action: "cancel" }), ctx)).status).toBe(403);
    st.admin = true;
    expect((await POST(form({ action: "cancel" }, "https://evil.example"), ctx)).status).toBe(403);
    expect(st.canceled).toEqual([]);
    const res = await POST(form({ action: "cancel", reason: "Owner is out sick", back: "/admin/demos" }), ctx);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://swiftcard.me/admin/demos?done=canceled");
    expect(st.canceled).toEqual([{ id: ID, by: "admin", reason: "Owner is out sick" }]);
  });

  it("Resend confirmation queues it again; Mark no-show only after the start", async () => {
    const { POST } = await import("@/app/api/admin/demos/[id]/route");
    const r1 = await POST(form({ action: "resend", back: "/admin/demos" }), ctx);
    expect(r1.headers.get("location")).toBe("https://swiftcard.me/admin/demos?done=resent");
    expect(st.queued.map((q) => q.kind)).toEqual(["confirmation"]);
    const early = await POST(form({ action: "no_show", back: "/admin/demos?tab=past" }), ctx);
    expect(early.headers.get("location")).toBe("https://swiftcard.me/admin/demos?tab=past&done=failed");
    st.booking!.starts_at = new Date(Date.now() - 3600_000).toISOString();
    const ok = await POST(form({ action: "no_show", back: "/admin/demos?tab=past" }), ctx);
    expect(ok.headers.get("location")).toBe("https://swiftcard.me/admin/demos?tab=past&done=no_show");
    expect(st.updates).toEqual([{ id: ID, status: "no_show" }]);
  });

  it("never redirects anywhere but the Demos page", async () => {
    const { POST } = await import("@/app/api/admin/demos/[id]/route");
    const res = await POST(form({ action: "resend", back: "https://evil.example/x" }), ctx);
    expect(res.headers.get("location")).toBe("https://swiftcard.me/admin/demos?done=resent");
  });
});

const manage = (b: Row) => new NextRequest("https://swiftcard.me/api/demo/manage", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "203.0.113.9" }, body: JSON.stringify(b) });

describe("the manage link (swiftcard.me/demo/manage#<token>)", () => {
  it("a wrong or malformed token is a 404 and shows nothing", async () => {
    const { POST } = await import("@/app/api/demo/manage/route");
    expect((await POST(manage({ token: "b".repeat(43), action: "view" }))).status).toBe(404);
    expect((await POST(manage({ token: "short", action: "view" }))).status).toBe(404);
  });

  it("view tells them their demo without their email or phone", async () => {
    const { POST } = await import("@/app/api/demo/manage/route");
    const j = await (await POST(manage({ token: TOKEN, action: "view" }))).json();
    expect(j.booking).toMatchObject({ status: "confirmed", firstName: "Alex", company: "Morgan Realty", meetUrl: "https://meet.google.com/abc-defg-hij", reconfirmed: false, past: false });
    expect(JSON.stringify(j)).not.toMatch(/manage_token|"email"|"phone"/);
  });

  it("I'll be there, Pick a new time, Cancel", async () => {
    const { POST } = await import("@/app/api/demo/manage/route");
    expect((await (await POST(manage({ token: TOKEN, action: "confirm" }))).json()).booking.reconfirmed).toBe(true);
    const off = await POST(manage({ token: TOKEN, action: "reschedule", start: "2026-11-20T15:15:00.000Z" }));
    expect(off.status).toBe(400);
    const moved = await POST(manage({ token: TOKEN, action: "reschedule", start: "2026-11-20T15:00:00.000Z" }));
    expect(moved.status).toBe(200);
    expect(st.moved).toEqual([{ id: ID, start: "2026-11-20T15:00:00.000Z" }]);
    const c = await POST(manage({ token: TOKEN, action: "cancel", reason: "Found another time" }));
    expect((await c.json()).booking.status).toBe("canceled");
    expect(st.canceled).toEqual([{ id: ID, by: "prospect", reason: "Found another time" }]);
  });
});

describe("the demo clock's door", () => {
  it("is a 404 without the secret, and compares it in constant time", async () => {
    vi.stubEnv("DEMO_TICK_SECRET", "s3cret-value-for-tests");
    vi.stubEnv("PUSH_CATCHUP_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    const { demoTickAuthorized } = await import("@/lib/demo/tick");
    expect(demoTickAuthorized(null)).toBe(false);
    expect(demoTickAuthorized("Bearer wrong")).toBe(false);
    expect(demoTickAuthorized("Bearer undefined")).toBe(false);
    expect(demoTickAuthorized("Bearer s3cret-value-for-tests")).toBe(true);
    vi.stubEnv("DEMO_TICK_SECRET", "");
    expect(demoTickAuthorized("Bearer ")).toBe(false);
    vi.unstubAllEnvs();
  });
});
