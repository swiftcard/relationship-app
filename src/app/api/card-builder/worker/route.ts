import { NextRequest, NextResponse } from "next/server";
import { runWorker } from "@/lib/card-builder-jobs/jobs";
import { hasKey } from "@/lib/card-builder-jobs/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Pro's ceiling. The worker stops taking new work well before it.
export const maxDuration = 800;

// GET /api/card-builder/worker   (vercel.json cron, every 5 minutes)
//
// Card Builder's job queue: carries due prospects through research → build
// card → write opener → ready for review (lib/card-builder-jobs/jobs.ts).
// Runs overlap on purpose (a run lasts up to ~12 minutes, one starts every
// 5): each job is claimed by exactly one run. Locked with CRON_SECRET, which
// Vercel sends as a bearer token on every scheduled call.

const BUDGET_MS = 720_000;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasKey()) return NextResponse.json({ ok: false, error: "no Anthropic key on the server" }, { status: 500 });
  const started = Date.now();
  try {
    const result = await runWorker({ deadline: started + BUDGET_MS });
    return NextResponse.json({ ok: true, ms: Date.now() - started, ...result });
  } catch (e) {
    console.error("[card-builder worker]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
