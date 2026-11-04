import type { Candidate } from "../replies/engine";

// ── Instagram DMs: scoring a profile as a prospect, and keeping the DM honest ─
// What contact-instagram finds is Instagram PROFILES (every one of its drafts
// up to 2026-11-04 points at instagram.com/<handle>/, never a post). The shared
// scorer was written for posts asking for a card tool, so a profile could only
// ever be "maybe": 180 scored, 10 drafted, almost all at exactly 0.55, about
// $0.28 a draft. And the drafts filled the gap with guesses ("I'm guessing
// quote requests land in your DMs", "buyers who lose the card by lunch").
// This rubric scores the profile as a SwiftCard customer, from what the bio
// actually says, and the check below refuses a DM that claims what it can't.

export const PROFILE_SCORE_SYSTEM = `You help one of SwiftCard's two founders decide which Instagram business profiles are worth a short, personal DM. SwiftCard is a digital business card plus a link in bio page: one tap or a QR code saves your contact, and the people you meet can send theirs back. The best customers are client-facing professionals and local businesses who meet new people all the time: realtors, loan officers, insurance agents, financial advisors, sales reps, recruiters, contractors and home services, salons and other local service businesses. Never lawyers.
Each item is a PROFILE (the bio as a search engine shows it), not a post. Score each 0 to 1 as a prospect, using only what the text says:
- 0.75 and up: clearly a working client-facing professional or local business AND the bio shows a concrete reason a card or link page fits: a phone number or email typed into the bio, a Linktree or other link page, several services or markets, a team or brokerage, a service area, "DM to book" or similar.
- 0.5 to 0.7: clearly such a professional, but the bio shows nothing specific to build on.
- Under 0.4: brands or big companies, influencers or coaches selling courses, anyone who sells cards, link pages or marketing tools, students, personal accounts, bios with no business information, lawyers.
why: quote the exact words from the bio you are relying on, in double quotes, then say in a few words why they fit. angle: the one thing from the bio a message could open on. Never guess at a problem the bio doesn't show.
business_pro: true only for a working professional or business. asks_for_tools: always false for a profile.`;

const GUESSES = /\bi'?m guessing\b|\bi bet\b|\bi imagine\b|\bprobably\b|\bi'?d guess\b|\bmust (get|be|have|lose)\b|\bget(s)? lost\b|\bnever (do|call|follow)\b|\blose (the|your) cards?\b|\bby lunch\b/i;
const PERSONAL = /\b(husband|wife|girl dad|boy dad|dad of|mom of|my kids|your kids|kids|married|church|faith)\b/i;
const CUSTOMER = /\bi use swift ?card\b|\bi'?ve been using swift ?card\b/i;

/**
 * What a DM claims that the profile doesn't support. Empty means it's fine.
 * Numbers and quoted words must come from the bio; no guessing at their
 * problems, no personal life, never pretending to be a customer.
 */
export function unsupportedClaims(text: string, c: Pick<Candidate, "text" | "title">): string[] {
  const out: string[] = [];
  const source = `${c.title} ${c.text}`.toLowerCase();
  const plain = source.replace(/,/g, "");
  if (GUESSES.test(text)) out.push("guesses at a problem their profile doesn't show");
  const personal = PERSONAL.exec(text)?.[0];
  if (personal) out.push(`brings up their personal life ("${personal}")`);
  if (CUSTOMER.test(text)) out.push("pretends to be a SwiftCard customer");
  for (const n of text.replace(/https?:\/\/\S+|\bswiftcard\.me\S*/gi, "").match(/\d[\d,]*(\.\d+)?/g) ?? []) {
    if (!plain.includes(n.replace(/,/g, ""))) out.push(`says ${n}, which isn't in their profile`);
  }
  for (const m of text.matchAll(/["\u201c]([^"\u201d]{4,})["\u201d]/g)) {
    if (!source.includes(m[1].toLowerCase().trim())) out.push(`quotes "${m[1].slice(0, 40)}", which isn't in their profile`);
  }
  return out;
}
