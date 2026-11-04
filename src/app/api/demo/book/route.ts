import { createHash } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { isLikelyBot } from "@/lib/bot-detection";
import { reportError } from "@/lib/report-error";
import { DEMO_DURATION_MS, DEMO_MIN_FILL_MS } from "@/lib/demo/config";
import { parseBookingBody } from "@/lib/demo/input";
import { bookDemo } from "@/lib/demo/service";
import { bookingsLastDay, queueMessages, upcomingForEmail } from "@/lib/demo/store";
import { drainDue } from "@/lib/demo/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/demo/book — the popup's (and /demo's) "Confirm demo".
//
// Public, so it is guarded the way api/leads is: a honeypot field, a bot
// User-Agent check, a minimum time to fill the form, 5 bookings a day per IP,
// and 30 a day across the whole site (counted in the database, because the
// rate limiter only counts per server without Upstash). Then lib/demo/service
// books it; Postgres's demo_no_overlap rule is what makes a double booking
// impossible. The confirmation and the owner's email go out right after the
// response (after()), and the clock retries anything that fails.

const DAILY_SITE_CAP = 30;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = parseBookingBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, fields: parsed.fields }, { status: 400 });
  const input = parsed.value;
  const now = new Date();

  // The honeypot: a person never sees or fills it. Say yes and keep nothing.
  if (input.trap) {
    const end = new Date(input.start.getTime() + DEMO_DURATION_MS).toISOString();
    return NextResponse.json({ ok: true, booking: { id: input.id, start: input.start.toISOString(), end, meetUrl: null, email: input.details.email, calendarInvite: false } });
  }
  if (isLikelyBot(req.headers.get("user-agent"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (input.elapsedMs < DEMO_MIN_FILL_MS) return NextResponse.json({ error: "too_fast" }, { status: 400 });

  const ip = clientIp(req);
  if (await isRateLimited(`demo-book:${ip}`, 5, 24 * 60 * 60 * 1000)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  try {
    if ((await bookingsLastDay(now)) >= DAILY_SITE_CAP) {
      await reportError("demo.book.daily_cap", `${DAILY_SITE_CAP} demos booked in 24 hours`);
      return NextResponse.json({ error: "busy" }, { status: 429 });
    }

    // One upcoming demo per email. Send their confirmation again (it holds
    // the reschedule link) and say when it is.
    const already = await upcomingForEmail(input.details.email, now);
    if (already && already.id !== input.id) {
      await queueMessages([{ booking_id: already.id, kind: "confirmation", send_at: now }]);
      after(() => drainDue({ bookingId: already.id }).catch(() => {}));
      return NextResponse.json({ error: "already_booked", start: already.starts_at, timezone: already.timezone }, { status: 409 });
    }

    const d = input.details;
    const result = await bookDemo({
      id: input.id, name: d.name, email: d.email, phone: d.phone, company: d.company, teamSize: d.teamSize,
      role: d.role || null, crm: d.crm || null, notes: d.notes || null,
      start: input.start, timezone: input.timezone, smsOptIn: d.smsOptIn, source: input.source,
      ipHash: createHash("sha256").update(`demo:${ip}`).digest("hex").slice(0, 32),
    }, now);

    if (!result.ok) {
      const status = result.error === "slot_taken" ? 409 : result.error === "not_open" ? 400 : 500;
      return NextResponse.json({ error: result.error }, { status });
    }
    const b = result.booking;
    after(() => drainDue({ bookingId: b.id }).catch((e) => reportError("demo.book.drain", e)));
    return NextResponse.json({
      ok: true,
      booking: { id: b.id, start: b.starts_at, end: b.ends_at, meetUrl: b.meet_url, email: b.email, calendarInvite: b.calendar_status === "created" },
    });
  } catch (e) {
    await reportError("demo.book", e);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
