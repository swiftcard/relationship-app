import { NextRequest, NextResponse } from "next/server";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

// Apple's device log sink: POST /v1/log {"logs": ["...", "..."]}
//
// iOS posts here when it hits trouble talking to the web service — a 401 it
// didn't expect, a malformed pass, a serial it can't reconcile. It is the only
// window into failures happening on someone else's phone, and without the
// endpoint those messages are simply discarded.
//
// Always 200: this is diagnostics, and an error here would have iOS retrying a
// log delivery instead of doing something useful.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Still always 200 (see above), but past 60 posts in 10 minutes from one
  // address nothing more is read or written.
  if (await isRateLimited(`wallet-log:${clientIp(req)}`, 60, 10 * 60 * 1000)) return NextResponse.json({});
  try {
    const body = (await req.json()) as { logs?: unknown };
    const logs = Array.isArray(body.logs) ? body.logs : [];
    // Bounded: this is an unauthenticated endpoint, so it must not be a way to
    // write unlimited text into our logs.
    for (const line of logs.slice(0, 20)) {
      console.warn(`[wallet][device] ${String(line).slice(0, 500)}`);
    }
  } catch {
    /* malformed body — nothing to log, and nothing worth failing over */
  }
  return NextResponse.json({});
}
