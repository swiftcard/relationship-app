import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import { demoHealth, demoTickAuthorized, runDemoTick } from "@/lib/demo/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The demo clock. pg_cron POSTs here every 5 minutes (supabase/demo-bookings.sql,
// Vault secret demo_tick_secret = Vercel DEMO_TICK_SECRET). GitHub's hourly
// catch-up workflow GETs it as a backup, and GET ?status=1 is the uptime
// check's read-only health probe.
//
// Without the secret this answers 404, as if it did not exist.

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

async function tick() {
  try {
    return NextResponse.json({ ok: true, ...(await runDemoTick()) });
  } catch (e) {
    await reportError("demo.tick", e);
    return NextResponse.json({ ok: false, error: "tick_failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!demoTickAuthorized(req.headers.get("authorization"))) return notFound();
  return tick();
}

export async function GET(req: NextRequest) {
  if (!demoTickAuthorized(req.headers.get("authorization"))) return notFound();
  if (req.nextUrl.searchParams.get("status") === "1") {
    try {
      return NextResponse.json({ ok: true, ...(await demoHealth()) });
    } catch {
      return NextResponse.json({ ok: false, error: "status_failed" }, { status: 500 });
    }
  }
  return tick();
}
