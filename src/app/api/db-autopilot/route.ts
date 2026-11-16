import { NextRequest, NextResponse } from "next/server";
import { runDbAutopilot } from "@/lib/db-autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/db-autopilot   (vercel.json cron, nightly 08:20 UTC)
//
// Rolls page views older than 90 days into daily rows, and tells the admins
// once a week if the database passes 400 MB of the free plan's 500 MB
// (lib/db-autopilot.ts).

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runDbAutopilot()) });
  } catch (e) {
    console.error("[db-autopilot]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
