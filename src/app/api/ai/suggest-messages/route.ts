import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isRateLimited } from "@/lib/rate-limit";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOwnerUsernames } from "@/lib/owner-usernames";
import { isPaidPlan } from "@/lib/plan";
import { aiComplete, hasAiProvider } from "@/lib/ai";
import { aiConsentBlock } from "@/lib/ai-consent-server";
import { senderAbout } from "@/lib/sender-about";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Declining the AI notice has to actually stop the data leaving —
  // see lib/ai-consent-server.ts (App Review 5.1.1(i)/5.1.2(i)).
  const consentBlocked = await aiConsentBlock(user.id, req);
  if (consentBlocked) return consentBlocked;
  // Per-user throttle: authenticated but previously uncapped (cost/abuse guard).
  if (await isRateLimited(`ai-suggest:${user.id}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests — please wait a moment and try again." }, { status: 429 });
  }


  if (!hasAiProvider()) {
    return NextResponse.json({ messages: [], error: "no_ai", message: "AI isn't configured yet." });
  }

  const { leadId, meetContext, tone = "friendly", channel = "email" } = await req.json();
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
  const isText = channel === "sms";

  const adminSupabase = getAdminSupabase();
  const [{ data: profile }, { data: lead }, usernames] = await Promise.all([
    adminSupabase.from("profiles").select("name, title, company, plan, customization").eq("id", user.id).single(),
    adminSupabase.from("leads").select("name, phone, company, message, notes, tags, card_owner").eq("id", leadId).single(),
    getOwnerUsernames(user.id),
  ]);

  // Only the owner of the lead may generate messages for it.
  if (!lead || !usernames.includes(lead.card_owner)) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // AI follow-up drafts are Pro-only (owner, 2026-09-23) — there is no Free
  // allowance. Pro/Office unlimited.
  const paid = isPaidPlan(profile?.plan);
  if (!paid) {
    return NextResponse.json(
      {
        // Additive machine code for native; web keeps using message/error/upgrade.
        code: "AI_DRAFTS_PRO_ONLY",
        error: "upgrade",
        message: "AI follow-up drafts are a Pro feature. Upgrade to Pro to have AI write your follow-ups.",
        upgrade: "/upgrade",
        messages: [],
      },
      { status: 402 }
    );
  }

  const ownerName = profile?.name ?? "I";
  const title = profile?.title ?? "";
  const company = profile?.company ?? "";
  // The contact came in through one card — its Swift Links bio says what the
  // sender does for this audience (lib/sender-about).
  const { data: card } = await adminSupabase
    .from("cards")
    .select("customization")
    .eq("username", lead.card_owner)
    .maybeSingle();
  const about = senderAbout(
    card?.customization as { bio?: string; about?: string } | null,
    profile?.customization as { about?: string } | null,
  );
  const leadName = lead.name.split(" ")[0];

  const contextLines = [
    title && `${ownerName} works as a ${title}${company ? ` at ${company}` : ""}`,
    about && `What ${ownerName} does / offers (their bio): ${about}`,
    lead.company && `${leadName} works at ${lead.company}`,
    meetContext && `They met at: ${meetContext}`,
    lead.message && `${leadName} mentioned: "${lead.message}"`,
    lead.notes && `Notes about ${leadName}: ${lead.notes}`,
  ].filter(Boolean);

  const toneGuide =
    tone === "professional" ? "Professional and polished, but still warm. No slang."
    : tone === "direct" ? "Direct and action-oriented. Short. Clear ask or next step."
    : "Warm, conversational, like texting a new friend.";

  try {
    const prompt = `Write 3 short follow-up ${isText ? "TEXT MESSAGES (SMS)" : "EMAILS"} from ${ownerName} to ${leadName}, who they recently connected with.

${isText
  ? "Format: SMS. Each under 160 characters, plain text, no greeting line, no signature, no links unless essential."
  : "Format: short email body. 2-3 sentences each, no subject line and NO signature/sign-off (a signature is added automatically)."}

Context (use it to speak about the RIGHT things — naturally reference what ${ownerName} does/offers and the contact's situation):
${contextLines.length > 0 ? contextLines.join("\n") : "No additional context provided."}

Tone: ${toneGuide}

Requirements:
- ${isText ? "Each text 1-2 short sentences, under 160 characters" : "Each email max 2-3 sentences"}
- First person, natural — sounds like a real human wrote it, not a template
- Three different angles: (1) personal/casual check-in, (2) value or insight tied to what ${ownerName} does, (3) direct next step or question
- No emoji unless tone is friendly and it fits naturally
- Vary the openers — don't start with "Hi" or "Hey ${leadName}" on all three
- Do NOT mention "digital business card" or "networking"
${isText ? "" : `- Also write ONE short, specific email subject line (under 6 words, not salesy).`}

Return ONLY valid JSON: ${isText ? `{"messages":["m1","m2","m3"]}` : `{"subject":"...","messages":["m1","m2","m3"]}`}`;

    const textOut = (await aiComplete(prompt, { maxTokens: 600, json: true })) ?? "{}";
    const match = textOut.match(/\{[\s\S]*\}/);
    let parsed: { subject?: string; messages?: string[] } = {};
    try { parsed = JSON.parse(match?.[0] ?? "{}"); } catch { parsed = {}; }
    const out = Array.isArray(parsed.messages) ? parsed.messages.slice(0, 3) : [];
    const subject = isText ? null : (typeof parsed.subject === "string" ? parsed.subject.trim() : null);

    return NextResponse.json({
      messages: out,
      subject,
      // Kept in the response shape for older clients; paid is unlimited.
      aiDraftsRemaining: null,
    });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}
