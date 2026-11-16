import { getAdminSupabase } from "@/lib/supabase-admin";
import { openerText, revealsOpen } from "@/lib/prospect-preview/opener";
import { fillLink } from "@/lib/prospect-preview/outreach";
import { isVerified } from "@/lib/prospect-preview/quality";
import { listPreviews } from "@/lib/prospect-preview/store";
import { LINK_SLOT, TEXT_LIMIT, type PreviewListRow } from "@/lib/prospect-preview/types";
import { commandText, jsonIn, NO_USAGE, say, turn, type Conversation } from "./llm";

// ── The 48-hour follow-up (owner, 2026-11-16) ───────────────────────────────
// "If a prospect hasn't opened their card 48 hours after it went, write one
// follow-up text into the review queue. Never auto-send it."
//
// Hourly (/api/card-builder/follow-ups). For each live preview that was sent
// 48 hours to 14 days ago, has no real view and has had no nudge, it writes
// ONE follow-up text and keeps it on the preview (followup_text). That text is
// then the "no view" nudge the owner sees under Call and follow up, where
// they send it by hand, or not. Nothing here sends anything, and a preview
// gets one written follow-up, ever.

export const FOLLOWUP_AFTER_MS = 48 * 3_600_000;
const FOLLOWUP_UNTIL_MS = 14 * 86_400_000;
const PER_RUN = 8;
const EMOJI = /\p{Extended_Pictographic}/u;

export function dueForFollowUp(r: PreviewListRow, now: number): boolean {
  if (r.status !== "live" || !r.sent_at || r.views > 0 || r.nudge_no_view_at || r.followup_at) return false;
  const age = now - Date.parse(r.sent_at);
  return age >= FOLLOWUP_AFTER_MS && age <= FOLLOWUP_UNTIL_MS && Date.parse(r.expires_at) > now;
}

/** What is wrong with a follow-up text; empty when it may be shown. */
export function checkFollowUp(text: string, link: string): string[] {
  const out: string[] = [];
  if (!text.includes(LINK_SLOT)) out.push(`Put ${LINK_SLOT} where the link goes.`);
  const length = fillLink(text, link).length;
  if (length > TEXT_LIMIT) out.push(`${length} characters with the link in. A text stays at ${TEXT_LIMIT} or under.`);
  if (EMOJI.test(text)) out.push("No emojis.");
  if (/\bfree\b/i.test(text)) out.push('Never the word "free".');
  if (/!/.test(text)) out.push("No exclamation marks.");
  if (revealsOpen(text) || /\b(opened|didn'?t open|haven'?t opened|not opened|seen it|tracking)\b/i.test(text)) out.push("Never let on that you can tell whether they opened it.");
  if (/https?:\/\//i.test(fillLink(text, ""))) out.push(`Write ${LINK_SLOT}, not an address.`);
  return out;
}

export type FollowUpResult = { due: number; written: number; failed: number };

export async function writeFollowUps(now: number = Date.now()): Promise<FollowUpResult> {
  const list = await listPreviews();
  if (!list.ready) throw new Error("previews couldn't be read");
  const due = list.rows.filter((r) => dueForFollowUp(r, now));
  let written = 0, failed = 0;
  for (const p of due.slice(0, PER_RUN)) {
    try {
      const text = await writeOne(p);
      // Only if nobody nudged them meanwhile: one follow-up, ever.
      const { data } = await getAdminSupabase().from("prospect_previews").update({ followup_text: text, followup_at: new Date().toISOString() })
        .eq("id", p.id).is("followup_at", null).is("nudge_no_view_at", null).select("id");
      if (data?.length) written++;
    } catch (e) {
      failed++;
      console.error("[card-builder follow-ups]", p.id, e instanceof Error ? e.message : e);
    }
  }
  return { due: due.length, written, failed };
}

async function writeOne(p: PreviewListRow): Promise<string> {
  const link = `${process.env.NEXT_PUBLIC_APP_URL && !/localhost/.test(process.env.NEXT_PUBLIC_APP_URL) ? process.env.NEXT_PUBLIC_APP_URL : "https://swiftcard.me"}/p/${p.slug}`;
  const facts = {
    owner_name: p.owner_name, office_name: p.office_name, sent_at: p.sent_at,
    what_was_sent: openerText(p.openers ?? null) ?? p.outreach?.link_text ?? null,
    specifics: p.specifics.filter((s) => isVerified(s) && !s.quiet).map((s) => s.text),
    nudge_already_written: p.outreach?.nudge_no_view ?? null,
  };
  const convo: Conversation = { messages: [], usage: { ...NO_USAGE } };
  say(convo, [
    `SERVER MODE: unattended, nobody to ask. Today is ${new Date().toISOString().slice(0, 10)}.`,
    "Two days ago the owner texted this prospect the card they made for them, and it hasn't been opened. Write ONE short follow-up text the owner can send by hand: the build-card rules for `nudge_no_view` and its voice rules apply.",
    `- ${TEXT_LIMIT} characters at most once ${LINK_SLOT} becomes ${link} (${link.length} characters). Write ${LINK_SLOT} where the link goes.`,
    "- Name one real thing from their facts (a different one from the first text if there is one). No pressure, no guilt, no \"just checking in\", no \"bumping this\".",
    "- NEVER let on that you know it wasn't opened. Say it as a person would who simply hasn't heard back.",
    "- No emojis, no exclamation marks, never \"free\".",
    "",
    "Their facts:", JSON.stringify(facts),
    "",
    'Answer with ONE ```json block: { "text": "…" }',
  ].join("\n"));
  const signal = AbortSignal.timeout(120_000);
  let reply = await turn(convo, { system: commandText("build-card"), web: false, effort: "medium", signal, maxTokens: 8000 });
  for (let round = 0; ; round++) {
    const text = String(jsonIn(reply)?.text ?? "").trim();
    const problems = text ? checkFollowUp(text, link) : ["No text came back."];
    if (!problems.length) return text;
    if (round >= 2) throw new Error(problems.join(" "));
    say(convo, `Not saved. ${problems.join(" ")} Answer again with the JSON.`);
    reply = await turn(convo, { system: commandText("build-card"), web: false, effort: "medium", signal, maxTokens: 8000 });
  }
}
