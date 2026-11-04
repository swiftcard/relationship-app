import { describe, it, expect, vi, beforeEach } from "vitest";

// ── The demo clock sends each message once, on time, and only while it still
// makes sense (owner, 2026-11-03: reminders halfway, the night before and the
// day of, "and this whole thing has to be automated"). A tiny in-memory
// database stands in for Supabase so the real claim → send → stamp code runs.

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, failUpdateOnce: false }));

function matches(row: Row, f: [string, string, unknown][]): boolean {
  return f.every(([op, col, v]) => {
    const x = row[col];
    switch (op) {
      case "eq": return x === v;
      case "neq": return x !== v;
      case "is": return v === null ? x == null : x === v;
      case "lte": return String(x) <= String(v);
      case "lt": return String(x) < String(v);
      case "gt": return String(x) > String(v);
      case "gte": return String(x) >= String(v);
      case "in": return (v as unknown[]).includes(x);
      case "or": {
        // only "claimed_at.is.null,claimed_at.lt.<iso>"
        const [, iso] = String(v).split(",claimed_at.lt.");
        return row.claimed_at == null || String(row.claimed_at) < iso;
      }
      default: return true;
    }
  });
}

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from(table: string) {
      const rows = (db.tables[table] ??= []);
      const filters: [string, string, unknown][] = [];
      let mode: "select" | "update" | "insert" = "select";
      let patch: Row = {};
      let returning = false;
      let limitN = Infinity;
      const run = () => {
        if (mode === "update") {
          const hit = rows.filter((r) => matches(r, filters));
          for (const r of hit) Object.assign(r, patch);
          return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
        }
        const hit = rows.filter((r) => matches(r, filters)).slice(0, limitN);
        return { data: hit.map((r) => ({ ...r })), error: null, count: hit.length };
      };
      const q: Record<string, unknown> = {
        select: () => { if (mode === "update") returning = true; return q; },
        update: (p: Row) => { mode = "update"; patch = p; return q; },
        insert: (p: Row) => { rows.push({ id: rows.length + 1, ...p }); return Promise.resolve({ error: null }); },
        eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return q; },
        neq: (c: string, v: unknown) => { filters.push(["neq", c, v]); return q; },
        is: (c: string, v: unknown) => { filters.push(["is", c, v]); return q; },
        lte: (c: string, v: unknown) => { filters.push(["lte", c, v]); return q; },
        lt: (c: string, v: unknown) => { filters.push(["lt", c, v]); return q; },
        gt: (c: string, v: unknown) => { filters.push(["gt", c, v]); return q; },
        gte: (c: string, v: unknown) => { filters.push(["gte", c, v]); return q; },
        in: (c: string, v: unknown) => { filters.push(["in", c, v]); return q; },
        or: (v: string) => { filters.push(["or", "", v]); return q; },
        not: () => q,
        order: () => q,
        limit: (n: number) => { limitN = n; return q; },
        maybeSingle: async () => { const r = run(); return { data: (r.data as Row[])[0] ?? null, error: null }; },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      };
      return q;
    },
  }),
}));

const sent = vi.hoisted(() => ({ emails: [] as Row[], texts: [] as Row[], emailStatus: "sent" as string, optedOut: false }));
vi.mock("@/lib/messaging", () => ({
  sendRawEmail: async (o: Row) => { sent.emails.push(o); return sent.emailStatus; },
  sendSms: async (to: string, body: string) => { sent.texts.push({ to, body }); return { status: "sent", sid: "SM1" }; },
  isOptedOut: async () => sent.optedOut,
  toGsm7: (s: string) => s,
}));
vi.mock("@/lib/report-error", () => ({ reportError: async () => {} }));
vi.mock("@/lib/admin-notify", () => ({ notifyAdmin: async () => {} }));
vi.mock("@/lib/token-crypto", () => ({ encryptToken: (s: string) => `enc:${s}`, decryptToken: (s: string) => s.replace(/^enc:/, "") }));
// The calendar is checked before a reminder: here it always agrees.
const cal = vi.hoisted(() => ({ next: null as null | ((b: Row) => Row) }));
vi.mock("@/lib/demo/service", () => ({ reconcileWithCalendar: async (b: Row) => (cal.next ? cal.next(b) : b) }));

const NOW = new Date("2026-11-10T15:00:00Z");
const booking = (o: Row = {}): Row => ({
  id: "11111111-1111-4111-8111-111111111111", status: "confirmed",
  starts_at: "2026-11-11T20:00:00.000Z", ends_at: "2026-11-11T20:30:00.000Z",
  name: "Alex Morgan", email: "alex@example.com", phone: "(212) 555-0142", company: "Morgan Realty", team_size: "6–15",
  role: null, crm: null, notes: null, timezone: "America/New_York", sms_opt_in: true, source: "pricing",
  manage_token_hash: "h", manage_token_enc: `enc:${"a".repeat(43)}`, google_event_id: "scdemo1", meet_url: "https://meet.google.com/abc-defg-hij",
  calendar_html_link: null, calendar_status: "created", calendar_attempts: 1, calendar_error: null, calendar_checked_at: null,
  attendee_response: null, reconfirmed_at: null, canceled_at: null, canceled_by: null, cancel_reason: null, ip_hash: null,
  created_at: "2026-11-09T15:00:00.000Z", updated_at: "2026-11-09T15:00:00.000Z", ...o,
});
const message = (o: Row): Row => ({ booking_id: booking().id, channel: "email", send_at: "2026-11-10T14:00:00.000Z", claimed_at: null, sent_at: null, attempts: 0, last_error: null, provider_id: null, skipped_reason: null, ...o });

beforeEach(() => {
  db.tables = { demo_bookings: [booking()], demo_messages: [] };
  sent.emails.length = 0;
  sent.texts.length = 0;
  sent.emailStatus = "sent";
  sent.optedOut = false;
  cal.next = null;
});

const msgs = () => db.tables.demo_messages;

describe("the demo outbox", () => {
  it("sends what is due, once, and stamps it; a second run sends nothing", async () => {
    const { drainDue } = await import("@/lib/demo/outbox");
    msgs().push(message({ id: 1, kind: "night_before" }), message({ id: 2, kind: "day_of", send_at: "2026-11-11T13:00:00.000Z" }));
    const r1 = await drainDue({ now: NOW });
    expect(r1.sent).toBe(1);
    expect(sent.emails).toHaveLength(1);
    expect(sent.emails[0]).toMatchObject({ to: "alex@example.com", sender: "support", fromName: "SwiftCard Demos", personal: false });
    expect(String(sent.emails[0].subject)).toMatch(/^Tomorrow: your SwiftCard demo at 3:00 PM EST$/);
    expect(String(sent.emails[0].idempotencyKey)).toBe(`demo/${booking().id}/night_before/1`);
    expect(msgs()[0].sent_at).toBeTruthy();
    expect(msgs()[1].sent_at).toBeNull(); // not due yet
    const r2 = await drainDue({ now: NOW });
    expect(r2.sent).toBe(0);
    expect(sent.emails).toHaveLength(1);
  });

  it("a row someone else already claimed is not sent twice", async () => {
    const { drainDue } = await import("@/lib/demo/outbox");
    msgs().push(message({ id: 1, kind: "halfway", claimed_at: new Date(NOW.getTime() - 60_000).toISOString(), attempts: 1 }));
    expect((await drainDue({ now: NOW })).sent).toBe(0);
    expect(sent.emails).toHaveLength(0);
    // …unless that run died: a claim older than 10 minutes is taken again.
    msgs()[0].claimed_at = new Date(NOW.getTime() - 11 * 60_000).toISOString();
    expect((await drainDue({ now: NOW })).sent).toBe(1);
  });

  it("never reminds about a canceled demo, or after it has started", async () => {
    const { drainDue } = await import("@/lib/demo/outbox");
    db.tables.demo_bookings[0].status = "canceled";
    msgs().push(message({ id: 1, kind: "day_of" }));
    await drainDue({ now: NOW });
    expect(msgs()[0].skipped_reason).toBe("canceled");
    db.tables.demo_bookings[0] = booking({ starts_at: "2026-11-10T14:30:00.000Z", ends_at: "2026-11-10T15:00:00.000Z" });
    msgs().push(message({ id: 2, kind: "halfway" }));
    await drainDue({ now: NOW });
    expect(msgs()[1].skipped_reason).toBe("too_late");
    expect(sent.emails).toHaveLength(0);
  });

  it("skips a reminder when the owner deleted or moved the event in Google Calendar", async () => {
    const { drainDue } = await import("@/lib/demo/outbox");
    cal.next = (b) => ({ ...b, status: "canceled" });
    msgs().push(message({ id: 1, kind: "night_before" }));
    await drainDue({ now: NOW });
    expect(msgs()[0].skipped_reason).toBe("canceled");
    cal.next = (b) => ({ ...b, starts_at: "2026-11-12T20:00:00.000Z" });
    msgs().push(message({ id: 2, kind: "halfway" }));
    await drainDue({ now: NOW });
    expect(msgs()[1].skipped_reason).toBe("moved_in_calendar");
    expect(sent.emails).toHaveLength(0);
  });

  it("the owner's copy goes to the inbox with Reply-To the prospect", async () => {
    const { drainDue } = await import("@/lib/demo/outbox");
    msgs().push(message({ id: 1, kind: "owner_new" }));
    await drainDue({ now: NOW });
    expect(sent.emails[0]).toMatchObject({ to: "hello@swiftcard.me", replyTo: "alex@example.com", personal: true });
    expect(String(sent.emails[0].subject)).toContain("New demo: Alex Morgan, Morgan Realty (6–15)");
    expect(String(sent.emails[0].html)).toContain("https://meet.google.com/abc-defg-hij");
  });

  it("a failed send is retried later, then given up after 5 tries", async () => {
    const { drainDue } = await import("@/lib/demo/outbox");
    sent.emailStatus = "failed";
    msgs().push(message({ id: 1, kind: "confirmation" }));
    await drainDue({ now: NOW });
    expect(msgs()[0]).toMatchObject({ sent_at: null, skipped_reason: null, claimed_at: null, attempts: 1 });
    expect(String(msgs()[0].send_at) > NOW.toISOString()).toBe(true);
    for (let i = 0; i < 6; i++) await drainDue({ now: new Date(NOW.getTime() + (i + 1) * 4 * 3600_000) });
    expect(msgs()[0].skipped_reason).toBe("gave_up");
    expect(msgs()[0].attempts).toBe(5);
  });

  it("the morning text: only when ticked, textable, and between 8 AM and 9 PM their time", async () => {
    const { drainDue } = await import("@/lib/demo/outbox");
    msgs().push(message({ id: 1, kind: "sms_day_of", channel: "sms" }));
    await drainDue({ now: NOW }); // 10:00 AM New York
    expect(sent.texts).toHaveLength(1);
    expect(sent.texts[0].body).toMatch(/^SwiftCard: your demo is today at 3:00 PM EST\.\nJoin: https:\/\/meet\.google\.com\/abc-defg-hij\nChange it: https:\/\/swiftcard\.me\/demo\/manage#a{43}$/);
    db.tables.demo_bookings[0].sms_opt_in = false;
    msgs().push(message({ id: 2, kind: "sms_day_of", channel: "sms" }));
    await drainDue({ now: NOW });
    expect(msgs()[1].skipped_reason).toBe("not_textable");
    db.tables.demo_bookings[0].sms_opt_in = true;
    msgs().push(message({ id: 3, kind: "sms_day_of", channel: "sms", send_at: "2026-11-10T11:00:00.000Z" }));
    await drainDue({ now: new Date("2026-11-10T11:30:00Z") }); // 6:30 AM New York
    expect(msgs()[2].skipped_reason).toBe("quiet_hours");
    expect(sent.texts).toHaveLength(1);
  });

  it("someone who unsubscribed gets no reminder emails", async () => {
    const { drainDue } = await import("@/lib/demo/outbox");
    sent.optedOut = true;
    msgs().push(message({ id: 1, kind: "halfway" }));
    await drainDue({ now: NOW });
    expect(msgs()[0].skipped_reason).toBe("opted_out");
    expect(sent.emails).toHaveLength(0);
  });
});

describe("the demo emails", () => {
  it("escape what the visitor typed, and carry the change and cancel links", async () => {
    const { buildDemoEmail } = await import("@/lib/demo/emails");
    const b = booking({ name: "<script>x</script> Lee", company: "A&B \"Realty\"", notes: "<b>hi</b>" }) as never;
    for (const kind of ["confirmation", "halfway", "night_before", "day_of", "rescheduled", "owner_new", "owner_canceled"] as const) {
      const m = buildDemoEmail(kind, b)!;
      expect(m.html, kind).not.toContain("<script>");
      expect(m.html, kind).not.toContain("<b>hi</b>");
    }
    const conf = buildDemoEmail("confirmation", booking() as never)!;
    expect(conf.subject).toBe("Confirmed: your SwiftCard demo on Wed, Nov 11 at 3:00 PM EST");
    expect(conf.html).toContain("Join with Google Meet");
    expect(conf.html).toContain("https://swiftcard.me/demo/manage?a=reschedule#");
    expect(conf.html).toContain("https://swiftcard.me/demo/manage?a=cancel#");
    expect(conf.html).toContain("A calendar invitation from hello@swiftcard.me");
    expect(conf.personal).toBe(true);
    const half = buildDemoEmail("halfway", booking() as never)!;
    expect(half.html).toContain("https://swiftcard.me/demo/manage?a=confirm#");
    expect(half.html).toContain("Yes, I'll be there");
    expect(half.personal).toBe(false);
  });

  it("without a Meet link yet, the confirmation says it follows", async () => {
    const { buildDemoEmail } = await import("@/lib/demo/emails");
    const m = buildDemoEmail("confirmation", booking({ meet_url: null, calendar_status: "pending" }) as never)!;
    expect(m.html).toContain("Your Google Meet link is on its way in a separate email.");
    expect(m.html).not.toContain("A calendar invitation from");
  });

  it("someone in Los Angeles sees their own time, with New York time alongside", async () => {
    const { buildDemoEmail } = await import("@/lib/demo/emails");
    const m = buildDemoEmail("confirmation", booking({ timezone: "America/Los_Angeles" }) as never)!;
    expect(m.subject).toBe("Confirmed: your SwiftCard demo on Wed, Nov 11 at 12:00 PM PST");
    expect(m.html).toContain("3:00 PM New York time");
  });
});
