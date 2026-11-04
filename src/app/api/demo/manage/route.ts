import { after, NextRequest, NextResponse } from "next/server";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { reportError } from "@/lib/report-error";
import { cleanText } from "@/lib/demo/input";
import { hashManageToken, isManageTokenShape } from "@/lib/demo/token";
import { getBookingByTokenHash, type DemoBooking } from "@/lib/demo/store";
import { cancelDemo, reconfirmDemo, rescheduleDemo } from "@/lib/demo/service";
import { drainDue } from "@/lib/demo/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/demo/manage { token, action: view | confirm | cancel | reschedule }
//
// Behind swiftcard.me/demo/manage#<token>. POST only, with the token in the
// body: it never sits in a URL a server logs, and opening the page changes
// nothing (mail scanners open every link). The token is the credential, so
// there is nothing to do for someone without it but get a 404.

function view(b: DemoBooking, now: Date) {
  return {
    status: b.status,
    start: b.starts_at,
    end: b.ends_at,
    timezone: b.timezone,
    firstName: b.name.trim().split(/\s+/)[0] || b.name,
    company: b.company,
    meetUrl: b.status === "confirmed" ? b.meet_url : null,
    reconfirmed: !!b.reconfirmed_at,
    past: new Date(b.starts_at).getTime() <= now.getTime(),
  };
}

export async function POST(req: NextRequest) {
  if (await isRateLimited(`demo-manage:${clientIp(req)}`, 40, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isManageTokenShape(body.token)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const now = new Date();
  try {
    const b = await getBookingByTokenHash(hashManageToken(body.token));
    if (!b) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const action = String(body.action ?? "view");

    if (action === "view") return NextResponse.json({ ok: true, booking: view(b, now) });

    if (action === "confirm") {
      const next = await reconfirmDemo(b, now);
      return NextResponse.json({ ok: true, booking: view(next, now) });
    }

    if (action === "cancel") {
      if (b.status !== "confirmed") return NextResponse.json({ ok: true, booking: view(b, now) });
      if (new Date(b.starts_at).getTime() <= now.getTime()) return NextResponse.json({ error: "past" }, { status: 409 });
      const reason = cleanText(body.reason, 500) || null;
      const next = await cancelDemo(b, "prospect", reason, now);
      after(() => drainDue({ bookingId: b.id }).catch(() => {}));
      return NextResponse.json({ ok: true, booking: view(next, now) });
    }

    if (action === "reschedule") {
      const start = new Date(typeof body.start === "string" ? body.start : "");
      if (!Number.isFinite(start.getTime())) return NextResponse.json({ error: "not_open" }, { status: 400 });
      const r = await rescheduleDemo(b, start, now);
      if (!r.ok) {
        const status = r.error === "slot_taken" ? 409 : r.error === "save_failed" ? 500 : 400;
        return NextResponse.json({ error: r.error }, { status });
      }
      after(() => drainDue({ bookingId: b.id }).catch(() => {}));
      return NextResponse.json({ ok: true, booking: view(r.booking, now) });
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (e) {
    await reportError("demo.manage", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
