import { NextRequest, NextResponse } from "next/server";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { reportError } from "@/lib/report-error";
import { DEMO_RULES, DEMO_TIME_ZONE, PREVIEW_CALL_MIN, demoLength } from "@/lib/demo/config";
import { prefillFor, previewForRef } from "@/lib/prospect-preview/booking";
import { listOpenSlots } from "@/lib/demo/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/demo/slots → every open demo start for the next 30 days, as UTC
// ISO strings. The popup groups them by day in the visitor's own time zone.
// Open = on the grid, in the hours, not already booked, not busy on the
// owner's Google Calendar (lib/demo/slots).

export async function GET(req: NextRequest) {
  if (await isRateLimited(`demo-slots:${clientIp(req)}`, 60, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    // ?ref=<preview slug>: a setup call from a Card Builder preview, 15 minutes,
    // with the form filled in from that preview. ?len=15: the same grid, for
    // moving a call that is already 15 minutes (the manage page).
    const preview = await previewForRef(req.nextUrl.searchParams.get("ref"));
    const durationMin = preview ? PREVIEW_CALL_MIN : req.nextUrl.searchParams.has("len") ? demoLength(req.nextUrl.searchParams.get("len")) : DEMO_RULES.durationMin;
    const { slots } = await listOpenSlots(new Date(), durationMin);
    return NextResponse.json(
      { slots: slots.map((d) => d.toISOString()), durationMin, businessTimeZone: DEMO_TIME_ZONE, ...(preview ? { prefill: prefillFor(preview) } : {}) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    await reportError("demo.slots", e);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
