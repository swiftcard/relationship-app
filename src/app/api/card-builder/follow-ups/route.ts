import { NextRequest, NextResponse } from "next/server";
import { writeFollowUps } from "@/lib/card-builder-jobs/followups";
import { hasKey } from "@/lib/card-builder-jobs/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

// GET /api/card-builder/follow-ups   (vercel.json cron, hourly)
//
// Sent 48 hours ago and never opened: write ONE follow-up text for the owner
// to review and send by hand (lib/card-builder-jobs/followups.ts). Never sends.

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasKey()) return NextResponse.json({ ok: false, error: "no Anthropic key on the server" }, { status: 500 });
  try {
    return NextResponse.json({ ok: true, ...(await writeFollowUps()) });
  } catch (e) {
    console.error("[card-builder follow-ups]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
