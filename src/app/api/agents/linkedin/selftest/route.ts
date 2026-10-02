import { NextRequest, NextResponse } from "next/server";
import { botAuthorized } from "@/lib/instagram-bot-auth";
import { aiProviderName } from "@/lib/ai";
import { campaignLink } from "@/lib/campaign-links";
import { NOTE_MAX, draftProspect } from "@/lib/linkedin-desk";

// Does the LinkedIn desk's writer work in production? One made-up post goes
// through the real model with the real prompt, and the answer is held to the
// same rules the desk promises the owner: a personal note inside LinkedIn's
// limit with no link in it, and a message carrying the person's link once.
//
// Nothing is saved and nobody real is involved. Run by hand from
// .github/workflows/linkedin-desk-check.yml — never on a schedule, since every
// run is a model call.

export const runtime = "nodejs";
export const maxDuration = 60;

const CODE = "li_d_selftest";
const SAMPLE = `Jordan Ellis
Realtor at Keller Williams Realty Greater Nashville
2d

I'm happy to share that I'm starting a new position as Realtor at Keller Williams Realty! After eight years teaching middle school science I finally took the leap. First open house is next Saturday in East Nashville and I am equal parts excited and terrified.

Like Comment Repost Send`;

export async function GET(req: NextRequest) {
  if (!botAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { facts, drafts, ai } = await draftProspect({ pasted: SAMPLE, code: CODE, sender: "Aaron" });
  const link = campaignLink(CODE, facts.profession);
  const once = (s: string) => s.split(link).length === 2;
  const checks = {
    model_answered: ai,
    read_the_name: /jordan/i.test(facts.name ?? ""),
    two_versions_each: [drafts.comment, drafts.note, drafts.message, drafts.followup].every((v) => v.length === 2),
    note_within_limit: drafts.note.length > 0 && drafts.note.every((n) => n.length <= NOTE_MAX),
    note_and_comment_have_no_link: [...drafts.note, ...drafts.comment].every((s) => !/swiftcard\.me|https?:/i.test(s)),
    message_carries_the_link_once: drafts.message.length > 0 && [...drafts.message, ...drafts.followup].every(once),
    says_who_we_are: drafts.message.every((m) => /swiftcard/i.test(m)),
  };
  const ok = Object.values(checks).every(Boolean);
  return NextResponse.json({ ok, provider: aiProviderName(), checks, facts, drafts }, { status: ok ? 200 : 500 });
}
