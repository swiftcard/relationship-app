import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { openDemoSlots } from "@/lib/demo/slots";

// ── POST /api/demo/book ─────────────────────────────────────────────────────
// Owner, 2026-11-03: "if two people do it on Wednesday and one person does it
// at 3:00, then it'll know that 3:00 is already taken." The store below keeps
// Postgres's demo_no_overlap rule (an overlapping CONFIRMED insert fails with
// 23P01), so two people pressing Confirm for the same time at once really race.

type Row = Record<string, unknown>;
const st = vi.hoisted(() => ({
  bookings: [] as Row[],
  messages: [] as Row[],
  rateLimited: false,
  busy: [] as { start: number; end: number }[],
  calendar: "ok" as "ok" | "fail" | "not_connected",
  events: [] as Row[],
  notified: [] as Row[],
  afterFns: [] as (() => unknown)[],
}));

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { st.afterFns.push(fn); } }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async () => st.rateLimited }));
vi.mock("@/lib/report-error", () => ({ reportError: async () => {} }));
vi.mock("@/lib/admin-notify", () => ({ notifyAdmin: async (n: Row) => { st.notified.push(n); } }));
vi.mock("@/lib/token-crypto", () => ({ encryptToken: (s: string) => `enc:${s}`, decryptToken: (s: string) => s.replace(/^enc:/, "") }));
vi.mock("@/lib/demo/outbox", () => ({ drainDue: async () => ({ sent: 0, skipped: 0, retry: 0 }) }));
vi.mock("@/lib/demo/google-calendar", () => ({
  freeBusy: async () => (st.calendar === "ok" ? { ok: true, busy: st.busy } : { ok: false, reason: st.calendar === "fail" ? "unavailable" : "not_connected" }),
  forgetFreeBusy: () => {},
  createDemoEvent: async (i: Row) => {
    if (st.calendar === "fail") return { ok: false, reason: "unavailable", detail: "503" };
    if (st.calendar === "not_connected") return { ok: false, reason: "not_connected" };
    st.events.push(i);
    return { ok: true, eventId: `scdemo${String(i.bookingId).replace(/-/g, "")}`, meetUrl: "https://meet.google.com/abc-defg-hij", htmlLink: null };
  },
  deleteDemoEvent: async () => true, moveDemoEvent: async () => true, getDemoEvent: async () => ({ ok: false, reason: "unavailable" }),
}));
vi.mock("@/lib/demo/store", async (orig) => {
  const real = await orig<typeof import("@/lib/demo/store")>();
  const overlaps = (a: Row, b: Row) => String(a.starts_at) < String(b.ends_at) && String(b.starts_at) < String(a.ends_at);
  return {
    ...real,
    getBooking: async (id: string) => st.bookings.find((b) => b.id === id) ?? null,
    upcomingForEmail: async (email: string, now: Date) =>
      st.bookings.find((b) => b.status === "confirmed" && b.email === email.toLowerCase() && String(b.starts_at) > now.toISOString()) ?? null,
    bookedBusy: async () => st.bookings.filter((b) => b.status === "confirmed").map((b) => ({ start: Date.parse(String(b.starts_at)), end: Date.parse(String(b.ends_at)) })),
    bookingsLastDay: async () => st.bookings.length,
    insertBooking: async (row: Row) => {
      // Yield first, so two requests in flight both pass the read before either writes.
      await new Promise((r) => setTimeout(r, 5));
      if (st.bookings.some((b) => b.id === row.id)) return { ok: false, code: "23505", message: "duplicate key" };
      if (st.bookings.some((b) => b.status === "confirmed" && overlaps(b, row))) return { ok: false, code: "23P01", message: "conflicting key value violates exclusion constraint \"demo_no_overlap\"" };
      st.bookings.push({ ...row });
      return { ok: true };
    },
    updateBooking: async (id: string, patch: Row) => { Object.assign(st.bookings.find((b) => b.id === id) ?? {}, patch); return { ok: true }; },
    queueMessages: async (rows: Row[]) => { for (const r of rows) st.messages.push({ ...r }); },
    skipPending: async () => {},
  };
});

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const nextSlot = (i = 0) => openDemoSlots(new Date())[i].toISOString();
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const body = (o: Row = {}): Row => ({
  id: uuid(), name: "Alex Morgan", email: "Alex@Example.com", phone: "(212) 555-0142", company: "Morgan Realty", teamSize: "6–15",
  role: "", crm: "HubSpot", notes: "", smsOptIn: true, start: nextSlot(), timezone: "America/New_York", website: "", elapsedMs: 30_000, source: "pricing", ...o,
});
const post = (b: Row, ua = UA) => new NextRequest("https://swiftcard.me/api/demo/book", { method: "POST", headers: { "content-type": "application/json", "user-agent": ua, "x-real-ip": "203.0.113.9" }, body: JSON.stringify(b) });

beforeEach(() => {
  st.bookings.length = 0; st.messages.length = 0; st.events.length = 0; st.notified.length = 0; st.afterFns.length = 0;
  st.rateLimited = false; st.busy = []; st.calendar = "ok";
});

describe("booking a demo", () => {
  it("books it: Google event with Meet, email lower-cased, confirmation + owner email + reminders queued, the bell rings", async () => {
    const { POST } = await import("@/app/api/demo/book/route");
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.booking).toMatchObject({ meetUrl: "https://meet.google.com/abc-defg-hij", email: "alex@example.com", calendarInvite: true });
    expect(st.bookings).toHaveLength(1);
    expect(st.bookings[0]).toMatchObject({ email: "alex@example.com", status: "confirmed", calendar_status: "created", crm: "HubSpot", sms_opt_in: true });
    expect(String(st.bookings[0].manage_token_enc)).toMatch(/^enc:[A-Za-z0-9_-]{43}$/);
    expect(st.events[0]).toMatchObject({ attendee: { email: "alex@example.com", name: "Alex Morgan" } });
    expect(String(st.events[0].summary)).toBe("SwiftCard demo: Alex Morgan (Morgan Realty)");
    expect(String(st.events[0].description)).toContain("https://swiftcard.me/demo/manage#");
    const kinds = st.messages.map((m) => m.kind);
    expect(kinds.slice(0, 2)).toEqual(["confirmation", "owner_new"]);
    expect(st.notified[0]).toMatchObject({ kind: "demos", href: "/admin/demos" });
    expect(st.afterFns.length).toBe(1); // the confirmation goes right after the response
  });

  it("two people, the same time, at once: one gets it, the other is told it was just taken", async () => {
    const { POST } = await import("@/app/api/demo/book/route");
    const start = nextSlot(2);
    const [a, b] = await Promise.all([
      POST(post(body({ start, email: "one@example.com" }))),
      POST(post(body({ start, email: "two@example.com" }))),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect((await loser.json()).error).toBe("slot_taken");
    expect(st.bookings).toHaveLength(1);
  });

  it("a time the owner's calendar has busy is taken; a time off the grid is refused", async () => {
    const { POST } = await import("@/app/api/demo/book/route");
    const start = nextSlot(1);
    st.busy = [{ start: Date.parse(start) - 10 * 60_000, end: Date.parse(start) + 10 * 60_000 }];
    const r1 = await POST(post(body({ start })));
    expect(r1.status).toBe(409);
    expect((await r1.json()).error).toBe("slot_taken");
    const off = new Date(Date.parse(nextSlot(3)) + 15 * 60_000).toISOString();
    const r2 = await POST(post(body({ start: off })));
    expect(r2.status).toBe(400);
    expect((await r2.json()).error).toBe("not_open");
    expect(st.bookings).toHaveLength(0);
  });

  it("pressing Confirm twice is one booking", async () => {
    const { POST } = await import("@/app/api/demo/book/route");
    const b = body();
    expect((await POST(post(b))).status).toBe(200);
    expect((await POST(post(b))).status).toBe(200);
    expect(st.bookings).toHaveLength(1);
    expect(st.events).toHaveLength(1);
  });

  it("one upcoming demo per email: booking again resends the confirmation and says when", async () => {
    const { POST } = await import("@/app/api/demo/book/route");
    await POST(post(body({ start: nextSlot(0) })));
    const again = await POST(post(body({ start: nextSlot(5), email: "ALEX@example.com" })));
    expect(again.status).toBe(409);
    const j = await again.json();
    expect(j.error).toBe("already_booked");
    expect(j.start).toBe(st.bookings[0].starts_at);
    expect(st.messages.filter((m) => m.kind === "confirmation")).toHaveLength(2);
    expect(st.bookings).toHaveLength(1);
  });

  it("Google down: the booking still stands, the calendar is retried later", async () => {
    const { POST } = await import("@/app/api/demo/book/route");
    st.calendar = "fail";
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    expect((await res.json()).booking).toMatchObject({ meetUrl: null, calendarInvite: false });
    expect(st.bookings[0]).toMatchObject({ calendar_status: "failed", calendar_attempts: 1 });
  });

  it("guards: honeypot, bots, too fast, rate limit, bad fields", async () => {
    const { POST } = await import("@/app/api/demo/book/route");
    const trap = await POST(post(body({ website: "http://spam.example" })));
    expect(trap.status).toBe(200); // looks like it worked; nothing kept
    expect(st.bookings).toHaveLength(0);
    expect((await POST(post(body(), "curl/8.4.0"))).status).toBe(403);
    expect((await POST(post(body({ elapsedMs: 900 })))).status).toBe(400);
    st.rateLimited = true;
    expect((await POST(post(body()))).status).toBe(429);
    st.rateLimited = false;
    const bad = await POST(post(body({ name: " ", email: "nope", phone: "12", company: "", teamSize: "9000" })));
    expect(bad.status).toBe(400);
    expect(Object.keys((await bad.json()).fields).sort()).toEqual(["company", "email", "name", "phone", "teamSize"]);
    expect(st.bookings).toHaveLength(0);
  });

  it("a text reminder is queued only for a textable number that left the box ticked", async () => {
    const { POST } = await import("@/app/api/demo/book/route");
    const far = openDemoSlots(new Date()).filter((d) => d.getTime() - Date.now() > 3 * 86_400_000)[0].toISOString();
    await POST(post(body({ start: far, email: "a@example.com" })));
    await POST(post(body({ start: openDemoSlots(new Date()).filter((d) => d.getTime() - Date.now() > 3 * 86_400_000)[1].toISOString(), email: "b@example.com", smsOptIn: false })));
    const sms = st.messages.filter((m) => m.kind === "sms_day_of");
    expect(sms).toHaveLength(1);
    expect(sms[0].booking_id).toBe(st.bookings[0].id);
  });
});
