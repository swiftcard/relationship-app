import { NextRequest, NextResponse } from "next/server";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { reportError } from "@/lib/report-error";
import { DEMO_RULES, DEMO_TIME_ZONE } from "@/lib/demo/config";
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
    const { slots } = await listOpenSlots(new Date());
    return NextResponse.json(
      { slots: slots.map((d) => d.toISOString()), durationMin: DEMO_RULES.durationMin, businessTimeZone: DEMO_TIME_ZONE },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    await reportError("demo.slots", e);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
