import { NextRequest, NextResponse } from "next/server";
import { botAuthorized } from "@/lib/instagram-bot-auth";
import { runFacebookTick } from "@/lib/facebook-bot";

// One pass of the Facebook bot: new comments on the SwiftCard Page's posts,
// new Messenger messages, and what to do about each (lib/facebook-bot.ts).
// Called every 10 minutes by .github/workflows/facebook-bot.yml. Idempotent —
// every comment is recorded once — so a late, duplicate or overlapping run
// sends nothing twice.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!botAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runFacebookTick());
  } catch (e) {
    return NextResponse.json({ ok: false, reason: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
