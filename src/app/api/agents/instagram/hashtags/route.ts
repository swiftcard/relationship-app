import { NextRequest, NextResponse } from "next/server";
import { botAuthorized } from "@/lib/instagram-bot-auth";
import { readHashtagPosts } from "@/lib/instagram-bot";

// Fresh public posts under the hashtags new professionals use (#newrealtor,
// #justlicensed, …), for the Radar (marketing-agents/lib/radar.mjs). READ
// ONLY: the Radar files them as signals, an agent drafts a comment, and the
// owner posts it by hand — Instagram does not let an app comment on someone
// else's post, and nothing here tries to.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!botAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await readHashtagPosts());
  } catch (e) {
    return NextResponse.json({ posts: [], error: String((e as Error)?.message ?? e).slice(0, 200) });
  }
}
