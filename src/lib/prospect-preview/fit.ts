// ── Card Builder: is this office worth a card? ──────────────────────────────
// /find-offices scores every office on the SAME six stated criteria and shows
// the breakdown, so a "78" can be argued with (owner, 2026-11-12). Two of the
// six are worked out here from the facts (size, direct contact) rather than
// taken on the researcher's word; one (active) needs a dated piece of
// evidence. Pure, so the rules are tested (tests/prospect-preview-fit.test.ts).

export const FIT_CRITERIA = [
  { key: "size", label: "5 to 50 people", weight: 20 },
  { key: "independent", label: "Independent, or a team whose leader can buy without corporate approval", weight: 20 },
  { key: "direct_contact", label: "Decision-maker named, with a direct mobile or email", weight: 20 },
  { key: "active", label: "Active in the last 60 days (listings, closings, posts)", weight: 15 },
  { key: "in_person", label: "Agents meet clients in person (open houses, local networking)", weight: 15 },
  { key: "growing", label: "Growing or recruiting", weight: 10 },
] as const;
export type FitKey = (typeof FIT_CRITERIA)[number]["key"];

/** What the researcher found for a criterion. `met: null` = looked and couldn't tell. */
export type FitEvidence = { met: boolean | null; note?: string; source?: string; date?: string };

export type FitInput = {
  name?: string | null;
  team_size?: number | null;
  phone?: string | null;
  /** "mobile" | "direct" | "office line" */
  phone_kind?: string | null;
  email?: string | null;
  /** A franchise or corporate branch where head office picks the tools. */
  corporate_decides?: boolean | null;
  evidence?: Partial<Record<FitKey, FitEvidence>>;
};

export type FitLine = { key: FitKey; label: string; weight: number; met: boolean | null; points: number; note: string };
export type Fit = { score: number; lines: FitLine[]; disqualified: string[]; summary: string };

export const ACTIVE_WINDOW_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;

/** An address anyone at the office might read: not the decision-maker's own. */
export const isGeneralEmail = (email: string | null | undefined): boolean =>
  /^(info|hello|hi|contact|contactus|office|admin|sales|team|support|inquir(y|ies)|enquir(y|ies)|mail|frontdesk|reception|leasing|rentals|marketing|careers|jobs)@/i.test((email ?? "").trim());

export function hasDirectContact(o: Pick<FitInput, "phone" | "phone_kind" | "email">): boolean {
  const directPhone = !!(o.phone ?? "").trim() && /^(mobile|cell|direct)$/i.test((o.phone_kind ?? "").trim());
  const ownEmail = !!(o.email ?? "").trim() && !isGeneralEmail(o.email);
  return directPhone || ownEmail;
}

/**
 * Reasons this office is not a lead at all, as sentences. Empty = it may be
 * scored. A competitor's card in use is NOT here: it changes the pitch only.
 */
export function disqualifiers(o: FitInput): string[] {
  const out: string[] = [];
  if (o.corporate_decides === true) out.push("A franchise or corporate branch where head office decides what the agents use.");
  if (typeof o.team_size === "number" && o.team_size < 5) out.push(`Under 5 people (${o.team_size}).`);
  if (!(o.name ?? "").trim()) out.push("No named leader.");
  else if (!hasDirectContact(o)) out.push("Only a general office line and a general address: no direct mobile or email for the decision-maker.");
  return out;
}

export function scoreFit(o: FitInput, now: number = Date.now()): Fit {
  const ev = o.evidence ?? {};
  const size = typeof o.team_size === "number" ? o.team_size : null;
  const answer = (key: FitKey): { met: boolean | null; note: string } => {
    const e = ev[key];
    const note = (e?.note ?? "").trim();
    switch (key) {
      case "size":
        return size === null ? { met: null, note: "Size not shown on their pages" } : { met: size >= 5 && size <= 50, note: `${size} people${note ? `: ${note}` : ""}` };
      case "independent":
        return o.corporate_decides === true ? { met: false, note: note || "Corporate decides" } : { met: e?.met ?? null, note };
      case "direct_contact": {
        const named = !!(o.name ?? "").trim();
        const direct = hasDirectContact(o);
        return { met: named && direct, note: !named ? "No named leader" : direct ? note || "Their own line or address" : "Office line and general address only" };
      }
      case "active": {
        // "Active" is a claim about a date, so it needs one, and a page to check it on.
        if (!e || e.met === null || e.met === undefined) return { met: null, note };
        if (e.met === false) return { met: false, note };
        const at = Date.parse(e.date ?? "");
        if (Number.isNaN(at) || !(e.source ?? "").trim()) return { met: null, note: `${note ? `${note} ` : ""}(needs a date and a source to count)` };
        const days = Math.floor((now - at) / DAY);
        // An open house next weekend is activity too.
        return days <= ACTIVE_WINDOW_DAYS ? { met: true, note: `${note} (${e.date})`.trim() } : { met: false, note: `${note} (${e.date}, ${days} days ago)`.trim() };
      }
      default:
        return { met: e?.met ?? null, note };
    }
  };

  const lines: FitLine[] = FIT_CRITERIA.map((c) => {
    const a = answer(c.key);
    return { key: c.key, label: c.label, weight: c.weight, met: a.met, points: a.met === true ? c.weight : 0, note: a.note };
  });
  const score = lines.reduce((n, l) => n + l.points, 0);
  const mark = (m: boolean | null) => (m === true ? "yes" : m === false ? "no" : "unknown");
  const short: Record<FitKey, string> = { size: "5-50 people", independent: "independent", direct_contact: "direct contact", active: "active in 60 days", in_person: "meets clients in person", growing: "growing" };
  return {
    score,
    lines,
    disqualified: disqualifiers(o),
    summary: `Fit ${score}/100: ${lines.map((l) => `${short[l.key]} ${mark(l.met)} (${l.points}/${l.weight})`).join(", ")}.`,
  };
}
