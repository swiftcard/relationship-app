import { hookLines, possessive } from "./messages";
import { BUYER_ROLE_LABELS, COMPETITOR_TOOLS, CURRENT_TOOL_LABELS, HOOK_ANGLE_LABELS, type BuyerRole, type PreviewListRow } from "./types";

// ── Card Builder: what to say on the call ───────────────────────────────────
// The Call screen's brief, written from what we know about this prospect and
// what they did with their preview. Pure, so the wording is tested
// (tests/prospect-preview-call.test.ts). It states nothing we didn't record:
// no team size means no number is said, no detail means none is mentioned,
// and it never quotes a price.
//
// It also only promises what the Office plan does today (checked against the
// code, 2026-11-13): a card's owner is told WHEN it is opened, and by whom only
// when that person already shared their details (lib/card-event-notify.ts);
// and when an agent leaves, the contacts they had collected stay on the
// office's list (lib/office-departure.ts). It does not say "see who opens it".

export const CALL_OUTCOMES = ["no_answer", "voicemail", "reached", "meeting_booked", "won", "lost"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  no_answer: "No answer", voicemail: "Left a voicemail", reached: "Talked, no decision yet", meeting_booked: "Meeting booked", won: "Won", lost: "Lost",
};
export const isCallOutcome = (v: unknown): v is CallOutcome => (CALL_OUTCOMES as readonly unknown[]).includes(v);

/**
 * What logging an outcome changes. "Called" means we REACHED them: a ring-out
 * or a voicemail leaves them on the follow-up list as viewed-but-not-reached.
 */
export function outcomeEffect(o: CallOutcome): { called: boolean | null; stage: "meeting_booked" | "won" | "lost" | null | undefined } {
  if (o === "no_answer" || o === "voicemail") return { called: null, stage: undefined };
  if (o === "reached") return { called: true, stage: null };
  return { called: true, stage: o };
}

export type CallBrief = {
  /** Why this person can say yes for the whole office; null when nobody recorded it. */
  whyBuyer: string | null;
  /** People on the team, when it was researched; null when it wasn't (the cards on the preview are a sample, not a headcount). */
  teamSize: number | null;
  opener: string;
  /** The opener was written for this prospect when the card was built (not the template). */
  written: boolean;
  /** The opener leads with this prospect's hook. False = it could be said to anyone: fix the hook first. */
  specific: boolean;
  /** What the hook leads to ("Keeping contacts when an agent leaves"); null without one. */
  angle: string | null;
  /** What they share contact details with today; null when nobody recorded it. */
  currentTool: string | null;
  objections: { they: string; you: string }[];
};

type About = Pick<PreviewListRow, "owner_name" | "office_name" | "buyer_role" | "buyer_reason" | "team_size" | "detail" | "views" | "team_strip_scrolled" | "sent_at">
  & Partial<Pick<PreviewListRow, "hook_why" | "hook_angle" | "current_tool" | "outreach">>;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

export function callBrief(p: About, opts: { sender: string | null }): CallBrief {
  const first = firstName(p.owner_name);
  const me = opts.sender ? `${firstName(opts.sender)}, the founder of SwiftCard` : "the founder of SwiftCard";
  const role = p.buyer_role ? BUYER_ROLE_LABELS[p.buyer_role as BuyerRole] ?? null : null;
  const whyBuyer = role || p.buyer_reason ? [role, p.buyer_reason ? sentence(p.buyer_reason) : null].filter(Boolean).join(": ") : null;
  const teamSize = p.team_size;
  const people = teamSize && teamSize > 1 ? `all ${teamSize} of you` : "your whole team";
  const hook = hookLines({ detail: p.detail, hook_why: p.hook_why ?? null });
  // The fact first, then why it matters to them, then the card as the proof.
  const noticed = hook ? ` ${hook.saw} ${hook.why}` : p.detail ? ` I noticed ${sentence(p.detail)}` : "";
  const tool = p.current_tool ?? null;
  const toolName = tool ? CURRENT_TOOL_LABELS[tool] : null;

  // Written for this prospect at build time (lib/prospect-preview/outreach.ts): it wins over the template.
  const written = (p.outreach?.call_opener ?? "").trim();
  const opener = written ? written : p.views > 0
    ? `Hi ${first}, it's ${me}.${noticed} ${hook ? "That's why I sent you" : "I sent you"} the card I made for you and the team at ${p.office_name}. ${p.team_strip_scrolled ? "Did the team's cards look right to you?" : "Did you get a chance to look at it?"}`
    : `Hi ${first}, it's ${me}.${noticed} ${hook ? "So I" : "I"} ${p.sent_at ? "sent you" : "made"} a digital business card for you and the team at ${p.office_name}. Do you have two minutes?`;

  // What they use today decides the first objection: a competitor in use isn't
  // a reason to skip them, it is a different conversation.
  const already = tool && COMPETITOR_TOOLS.includes(tool)
    ? {
        they: tool === "other_digital" ? "We already use a digital card." : `We already use ${toolName}.`,
        you: `Good, so your agents already share that way and there's nothing new to learn. What I built is the office's side of it: every card in ${possessive(p.office_name)} branding on one account, each agent is told the moment a client opens their card, and the contacts an agent has collected stay on your office list when they leave. Put the card I made you next to the one you have and tell me which you'd rather hand a client.`,
      }
    : tool === "link_in_bio"
      ? {
          they: "We already have a link in our bio.",
          you: `Keep it. A link in a bio is for people who already follow you. A card is what you hand the person standing in front of you, and one tap saves you in their phone. Everyone gets one in ${possessive(p.office_name)} branding like the one I made you, and each of you is told when a client opens yours.${p.views > 0 ? " That's how I knew to call: you opened yours." : ""}`,
        }
      : {
          they: "We already have business cards.",
          you: `Keep them. This is the one you text or tap. Everyone gets a card in ${possessive(p.office_name)} branding like the one I made you, and each of you is told when a client opens yours.${p.views > 0 ? " That's how I knew to call: you opened yours." : ""}`,
        };

  return {
    whyBuyer,
    teamSize,
    opener,
    written: !!written,
    specific: !!hook || !!written,
    angle: hook && p.hook_angle ? HOOK_ANGLE_LABELS[p.hook_angle] : null,
    currentTool: toolName,
    objections: [
      already,
      {
        they: "I'm busy, just send me some information.",
        you: `The card I sent is the information: it's already built, with your name and your team on it. All that's left is a 15-minute setup call and I'll have ${people} live. Is tomorrow morning or afternoon better?`,
      },
    ],
  };
}
