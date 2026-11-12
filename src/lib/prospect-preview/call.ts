import { possessive } from "./messages";
import { BUYER_ROLE_LABELS, type BuyerRole, type PreviewListRow } from "./types";

// ── Card Builder: what to say on the call ───────────────────────────────────
// The Call screen's brief, written from what we know about this prospect and
// what they did with their preview. Pure, so the wording is tested
// (tests/prospect-preview-call.test.ts). It states nothing we didn't record:
// no team size means no number is said, no detail means none is mentioned,
// and it never quotes a price.

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
  objections: { they: string; you: string }[];
};

type About = Pick<PreviewListRow, "owner_name" | "office_name" | "buyer_role" | "buyer_reason" | "team_size" | "detail" | "views" | "team_strip_scrolled" | "sent_at">;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

export function callBrief(p: About, opts: { sender: string | null }): CallBrief {
  const first = firstName(p.owner_name);
  const me = opts.sender ? `${firstName(opts.sender)}, the founder of SwiftCard` : "the founder of SwiftCard";
  const role = p.buyer_role ? BUYER_ROLE_LABELS[p.buyer_role as BuyerRole] ?? null : null;
  const whyBuyer = role || p.buyer_reason ? [role, p.buyer_reason ? sentence(p.buyer_reason) : null].filter(Boolean).join(": ") : null;
  const teamSize = p.team_size;
  const people = teamSize && teamSize > 1 ? `all ${teamSize} of you` : "your whole team";
  const noticed = p.detail ? ` I noticed ${sentence(p.detail)}` : "";

  const opener = p.views > 0
    ? `Hi ${first}, it's ${me}. I sent you the card I made for you and the team at ${p.office_name}.${noticed} ${p.team_strip_scrolled ? "Did the team's cards look right to you?" : "Did you get a chance to look at it?"}`
    : `Hi ${first}, it's ${me}. I ${p.sent_at ? "sent you" : "made"} a digital business card for you and the team at ${p.office_name}.${noticed} Do you have two minutes?`;

  return {
    whyBuyer,
    teamSize,
    opener,
    objections: [
      {
        they: "We already have business cards.",
        you: `Keep them. This is the one you text or tap. Everyone gets a card in ${possessive(p.office_name)} branding like the one I made you, and you can see when a client opens it.${p.views > 0 ? " That's how I knew to call: you opened yours." : ""}`,
      },
      {
        they: "I'm busy, just send me some information.",
        you: `The card I sent is the information: it's already built, with your name and your team on it. All that's left is a 15-minute setup call and I'll have ${people} live. Is tomorrow morning or afternoon better?`,
      },
    ],
  };
}
