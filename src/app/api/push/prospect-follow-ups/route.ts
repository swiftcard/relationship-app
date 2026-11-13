import { NextRequest, NextResponse } from "next/server";
import { announceBatches, sendFollowUpDigest } from "@/lib/prospect-preview/digest";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/push/prospect-follow-ups
//
// Card Builder's morning push to staff: "3 follow-ups due today"
// (lib/prospect-preview/digest.ts). Called on the hour by the same clock as
// the other morning pushes (.github/workflows/push-catchup.yml), with the same
// secrets; the function decides whether it is morning in New York, whether
// anybody is due and whether today's has already gone, so a duplicate or late
// run sends nothing twice. The same call announces a finished /build batch
// ("22 drafts ready to approve"), once each. It never contacts a prospect.

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  // CLOCK_SECRET: the Supabase clock (pg_cron, Vault clock_secret).
  const accepted = [process.env.CLOCK_SECRET, process.env.PUSH_CATCHUP_SECRET, process.env.CRON_SECRET]
    .filter((s): s is string => Boolean(s))
    .map((s) => `Bearer ${s}`);
  // An unset secret must never authorize (`Bearer undefined`).
  return accepted.length > 0 && !!auth && accepted.includes(auth);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const batches = await announceBatches().catch(() => ({ announced: 0 }));
  return NextResponse.json({ ok: true, ...(await sendFollowUpDigest()), ...batches });
}
