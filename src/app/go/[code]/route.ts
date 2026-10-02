import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isLikelyBot } from "@/lib/bot-detection";
import { isCampaignSource } from "@/lib/referral";
import { campaignDestination } from "@/lib/campaign-links";

// swiftcard.me/go/<code> → the card builder, counted.
//
// The link that goes in the Instagram bio, in every message the Instagram bot
// sends, and in ads. Each real tap is logged as campaign_link_clicked
// { code }, then the visitor lands on /cards/new?src=<code>, where src/proxy.ts
// writes the signup-source cookie — so clicks and signups share one name and
// the admin can follow a post from tap to account.
//
// Temporary redirect, not 308: a permanent one is cached and stops being
// counted (same reasoning as /review). An unknown code still reaches the
// builder — a mistyped link must never dead-end someone who wanted a card.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = (raw ?? "").toLowerCase();
  const res = NextResponse.redirect(new URL(campaignDestination(code, req.nextUrl.searchParams.get("for")), req.url), 307);

  // A prefetch, a link preview and a message scanner are not people.
  if (!isCampaignSource(code)) return res;
  if (req.headers.get("next-router-prefetch") === "1" || isLikelyBot(req.headers.get("user-agent"))) return res;

  try {
    await getAdminSupabase().from("product_events").insert({
      name: "campaign_link_clicked",
      props: { code },
      path: "/go",
      is_internal: process.env.VERCEL_ENV !== "production",
    });
  } catch {
    // Counting the tap must never stand between a person and their card.
  }
  return res;
}
