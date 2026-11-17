import { NextRequest, NextResponse } from "next/server";
import { releaseDue } from "@/lib/card-builder-jobs/release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/card-builder/release   (vercel.json cron, every 5 minutes)
//
// Approved openers whose 9 AM (their time) has come go to the Mac's queue, a
// few at a time (lib/card-builder-jobs/release.ts). Sends nothing itself.

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await releaseDue()) });
  } catch (e) {
    console.error("[card-builder release]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
