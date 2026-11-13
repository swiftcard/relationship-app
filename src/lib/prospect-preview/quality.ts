import { HOOK_ANGLE_LABELS, MIN_SPECIFICS, type ProspectPreview, type Specific } from "./types";

// ── Card Builder: is this preview about THEM, or about anybody? ─────────────
// The owner's bar (2026-11-12): a preview may only go out when it carries at
// least three verified specifics, a decision-maker checked against a second
// source, and a hook built on one of those specifics and tied to something
// SwiftCard actually does. Anything less is "too generic": it stays a draft
// until it is fixed or the owner overrides it by hand on the edit screen.
//
// Pure, so every rule is tested (tests/prospect-preview-quality.test.ts).

export type QualityCheck = {
  key: string;
  label: string;
  ok: boolean;
  /** A failed required check makes the preview "too generic". */
  required: boolean;
  points: number;
  earned: number;
  /** What to do about it, when it isn't met. */
  fix: string | null;
};

export type Quality = {
  /** 0 to 100. */
  score: number;
  checks: QualityCheck[];
  tooGeneric: boolean;
  /** The required checks that failed, as things to fix. */
  blockers: string[];
  /** May it be published? Not too generic, or the owner overrode it. */
  mayPublish: boolean;
};

/**
 * A specific counts once it has its words, its source and its date, and nobody
 * marked it uncertain. One the owner supplied themselves (`owner`, pasted
 * notes) is confirmed by them and needs no page or date (owner, 2026-11-13).
 */
export const isVerified = (s: Specific | null | undefined): boolean => !!s && !!s.text && !s.uncertain && (s.owner === true || (!!s.source_url && !!s.dated));

const host = (url: string | undefined): string => {
  try { return new URL(url ?? "").hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};

/**
 * The decision-maker's name and role are verified when two pages on two
 * DIFFERENT sites say so (their own site plus a licence lookup, a brokerage
 * profile, Zillow…), and neither is marked uncertain. Two pages of one site
 * are one source saying it twice.
 */
export function buyerVerified(p: Pick<ProspectPreview, "sources" | "buyer_role">): boolean {
  const a = p.sources.buyer_role, b = p.sources.buyer_second;
  // The owner told us who runs the office: that is their own knowledge, not research to double-check.
  if (p.buyer_role && a?.owner && !a.uncertain) return true;
  if (!p.buyer_role || !a?.url || !b?.url || a.uncertain || b.uncertain) return false;
  return !!host(a.url) && !!host(b.url) && host(a.url) !== host(b.url);
}

// ── The hook ────────────────────────────────────────────────────────────────

const STOP = new Set(["about", "their", "there", "these", "those", "which", "while", "where", "every", "other", "first", "being", "since", "under", "after", "before", "agents", "agent", "office", "listing", "listed", "house", "homes", "realty", "estate", "brokerage", "broker", "team", "your", "with", "from", "that", "this", "have", "they", "site", "website", "page", "street", "avenue"]);
/** The words and numbers that make a sentence about one thing and not another. */
function distinctive(text: string): { numbers: Set<string>; words: Set<string> } {
  const numbers = new Set(text.match(/\d+/g) ?? []);
  const words = new Set((text.toLowerCase().match(/[a-z][a-z'’-]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
  return { numbers, words };
}

/** Praise that could be pasted to any office. */
export const FILLER = /\b(great|amazing|awesome|impressive|beautiful|incredible|love(?:d)?|fantastic|wonderful|stunning|big fan)\b[^.!?]{0,40}\b(website|site|work|team|listings?|brand|company|office|agency|business|presence|reputation)\b|\bhope (this|you)\b|\bjust (checking|reaching|wanted)\b|\btouch(ing)? base\b|\bcame across\b/i;
/** A service area on its own is a location, not a hook. */
const AREA_ONLY = /^(you|your (team|office|agents))\s+(cover|covers|serve|serves|work in|works in|specialize in|specializes in|are (based|located) in|operate in)\b/i;

/**
 * Why a hook is generic, as sentences; empty when it holds up. A hook is a
 * fact (`detail`, built on one verified specific), an angle (which SwiftCard
 * feature it leads to) and a reason it matters to them (`hook_why`).
 */
export function hookProblems(p: Pick<ProspectPreview, "detail" | "hook_specific" | "hook_angle" | "hook_why" | "specifics">): string[] {
  const out: string[] = [];
  const detail = (p.detail ?? "").trim();
  if (!detail) return ["There is no hook yet. Write the one fact you would open with."];
  const specific = p.hook_specific === null ? null : p.specifics[p.hook_specific] ?? null;
  if (!specific) out.push("The hook isn't tied to one of the specifics. Pick which one it is built on.");
  else if (!isVerified(specific)) out.push("The specific the hook is built on isn't verified: it needs its source and date, and can't be marked uncertain.");
  else {
    const a = distinctive(detail), b = distinctive(specific.text);
    const sharedNumber = [...a.numbers].some((n) => b.numbers.has(n));
    const sharedWords = [...a.words].filter((w) => b.words.has(w)).length;
    if (!sharedNumber && sharedWords < 2) out.push("The hook doesn't mention the specific it is tied to. Name the address, the number or the event.");
  }
  if (AREA_ONLY.test(detail)) out.push("Where they work is a location, not a hook. Open with something that happened or something you counted.");
  if (FILLER.test(detail) || FILLER.test(p.hook_why ?? "")) out.push("That reads as a compliment or filler that could go to any office. Say the fact and why it matters.");
  if (!p.hook_angle) out.push(`Pick what the hook leads to: ${Object.values(HOOK_ANGLE_LABELS).join(", ").toLowerCase()}.`);
  if (!(p.hook_why ?? "").trim()) out.push("Say why that fact matters to them, in one sentence.");
  return out;
}

// ── The checklist ───────────────────────────────────────────────────────────

type Assessed = Pick<ProspectPreview,
  "specifics" | "sources" | "buyer_role" | "detail" | "hook_specific" | "hook_angle" | "hook_why" | "headshot_url" | "logo_url" | "specialty" |
  "website" | "social_links" | "license" | "current_tool" | "team_members" | "owner_title" | "quality_override">;

export function assessQuality(p: Assessed): Quality {
  const verified = p.specifics.filter(isVerified).length;
  const unfinished = p.specifics.length - verified;
  const hook = hookProblems(p);
  const sourced = (k: keyof ProspectPreview["sources"]) => (!!p.sources[k]?.url || p.sources[k]?.owner === true) && !p.sources[k]?.uncertain;

  const check = (key: string, label: string, ok: boolean, points: number, fix: string, required = false, earned = ok ? points : 0): QualityCheck =>
    ({ key, label, ok, required, points, earned, fix: ok ? null : fix });

  const checks: QualityCheck[] = [
    check("specifics", `${MIN_SPECIFICS} verified specifics beyond name, logo and location`, verified >= MIN_SPECIFICS, 30,
      `${verified} of ${MIN_SPECIFICS} so far${unfinished ? ` (${unfinished} more ${unfinished === 1 ? "is" : "are"} missing a source or a date, or marked uncertain)` : ""}. Add a current listing with its address, a recent sale, an award, an open house, a recruiting post, or how many agents list their own cell.`,
      true, Math.min(verified, MIN_SPECIFICS) * 10),
    check("buyer", "Decision-maker's name and role checked against a second source", buyerVerified(p), 20,
      "Name the page that says they run the office, and a second page on a different site that agrees (a license lookup, their brokerage profile, Zillow). Neither can be marked uncertain.", true),
    check("hook", "A hook built on one specific and tied to what SwiftCard does", hook.length === 0, 20, hook.join(" "), true),
    check("title", "Their title, as they write it, with its source", !!p.owner_title && sourced("owner_title"), 4, "Copy their title exactly from their own page and name that page under Sources."),
    check("headshot", "Their real headshot", !!p.headshot_url, 5, "Add the picture from their own site or brokerage profile. None published is fine: leave it empty."),
    check("logo", "Their logo", !!p.logo_url, 4, "Add the address of their logo file."),
    check("tagline", "Their real tagline", !!p.specialty && sourced("specialty"), 4, "Copy the line they use about themselves, and name the page it is on under Sources."),
    check("links", "Their real links", !!p.website && Object.keys(p.social_links).length > 0, 4, "Add their website and at least one social profile."),
    check("colors", "Colors read from their logo or site", sourced("colors"), 3, "Use “Read colors from the saved logo”, or name the page the colors came from."),
    check("team", "Team titles are real ones", p.team_members.length > 0 && sourced("team_members"), 3,
      p.team_members.length ? "Name the page the team's names and titles came from. A title the site doesn't give is left off, never invented." : "Add the team, with the page their names came from."),
    check("tool", "What they use today to share contact details", !!p.current_tool && !p.sources.current_tool?.uncertain, 3,
      p.current_tool ? "It is recorded but marked uncertain. Look at their social profiles for a link-in-bio or a competitor's card, then clear the flag." : "Record what you saw: paper cards, a link in bio, or a competitor. It changes the pitch."),
  ];

  const blockers = checks.filter((c) => c.required && !c.ok).map((c) => `${c.label}: ${c.fix}`);
  const tooGeneric = blockers.length > 0;
  return {
    score: checks.reduce((n, c) => n + c.earned, 0),
    checks,
    tooGeneric,
    blockers,
    mayPublish: !tooGeneric || p.quality_override,
  };
}
