import { isVerified } from "./quality";
import type { ProspectPreview, Specific } from "./types";

// ── Card Builder: the opening text (owner, 2026-11-16) ──────────────────────
// ONE text, sent from the owner's own number over iMessage, with the link to
// the card already made for them. Its only job is one tap on the link: "the
// card is a gift I already made for them, with their face and their name on
// it. People always want to see themselves."
//
// /build-card writes FIVE openers per prospect, each on a different hook,
// and scores each 1 to 10 on specificity, sounding human and curiosity. A
// separate judge then ranks them as the recipient would (opener-judge.ts): its
// first choice that passes every rule is the default and its next the
// alternate. The owner can edit the default on the review screen. Every candidate and every edit passes the
// rules below, which are the owner's, word for word where they could be:
//
//   • starts "Hey <First name>, Menash here." (or "Hi <First>, it's Menash.")
//   • ONE real, specific detail that proves we looked: a listing by street, the
//     team and its size, a review count, a niche or neighborhood, a recent
//     closing or news item. Never a generic compliment.
//   • says a card was made for them. No pitch, no features, no price, and
//     never anything about tracking.
//   • 2–3 short sentences after the greeting, about 150–220 characters; the
//     link alone on the last line (added here, so it can never be mistyped)
//   • no emojis, no hype, none of the banned phrases
//   • never invents a fact: every number and every name in it must already be
//     in the prospect's verified facts
//   • the swap test: it names something only true of THIS prospect
//
// Pure, so every rule is tested (tests/card-builder-opener.test.ts). Nothing
// here sends anything.

export const OPENER_SENDER = "Menash";

export const OPENER_HOOKS = ["listing", "team", "reviews", "niche", "recent", "warm"] as const;
export type OpenerHook = (typeof OPENER_HOOKS)[number];
export const OPENER_HOOK_LABELS: Record<OpenerHook, string> = {
  listing: "A listing, by street",
  team: "Their team and its size",
  reviews: "Their review count",
  niche: "Their niche or neighborhood",
  recent: "A recent closing or news",
  warm: "Someone you both know",
};
export const isOpenerHook = (v: unknown): v is OpenerHook => (OPENER_HOOKS as readonly unknown[]).includes(v);

export type OpenerScores = { specificity: number; human: number; curiosity: number };
export type OpenerCandidate = {
  hook: OpenerHook;
  /** The words, WITHOUT the link: the link is added on its own line when it is sent. */
  text: string;
  /** Which of `specifics` (its position) it is built on. Null only for `team` (built on the team size) and `warm`. */
  uses: number | null;
  scores: OpenerScores;
  /**
   * The independent judge's view (opener-judge.ts): its rank, 1 = the one it
   * would tap, and its one-line reason. The writer's scores stay for display.
   */
  judge?: { rank: number; reason: string } | null;
};
export type Openers = {
  candidates: OpenerCandidate[];
  /** The default and the runner-up, as positions in `candidates`: the judge's top two that pass every rule (the writer's best totals when no judge ran). */
  pick: number;
  alt: number | null;
  /** Who chose the default: the separate judge pass, or (it couldn't run) the writer's own scores. */
  picked_by?: "judge" | "writer";
  /** The owner's own rewording of the default, when they changed it. */
  edited: string | null;
  written_at: string | null;
};

export const OPENER_MIN_CHARS = 130;
export const OPENER_MAX_CHARS = 230;
/** "Write 5 openers per prospect, each using a different hook." Fewer only when the facts don't allow five without inventing one. */
export const OPENER_TARGET = 5;
export const OPENER_MIN_CANDIDATES = 3;
/** Below an average of 7 on the three scores, none of them is good enough: rewrite. */
export const OPENER_MIN_BEST_TOTAL = 21;

const total = (s: OpenerScores) => s.specificity + s.human + s.curiosity;
export const scoreTotal = (c: Pick<OpenerCandidate, "scores">) => total(c.scores);

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").split("\n").map((l) => l.trim()).join(" ").trim().slice(0, max) : "");
const score = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10 ? v : null);

/** Best first; equal totals go to the more specific one. */
function ranked(c: OpenerCandidate[]): number[] {
  return c.map((_, i) => i).sort((a, b) => total(c[b].scores) - total(c[a].scores) || c[b].scores.specificity - c[a].scores.specificity || a - b);
}

/** From the database's jsonb or the command's JSON. Null when there are no usable candidates. */
export function readOpeners(v: unknown): Openers | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const candidates: OpenerCandidate[] = [];
  for (const raw of Array.isArray(r.candidates) ? r.candidates : []) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const s = (c.scores ?? {}) as Record<string, unknown>;
    const scores = { specificity: score(s.specificity), human: score(s.human), curiosity: score(s.curiosity) };
    const text = clean(c.text, 400);
    if (!isOpenerHook(c.hook) || !text || scores.specificity === null || scores.human === null || scores.curiosity === null) continue;
    const uses = typeof c.uses === "number" && Number.isInteger(c.uses) && c.uses >= 0 && c.uses < 20 ? c.uses : null;
    const j = (c.judge ?? null) as Record<string, unknown> | null;
    const judge = j && typeof j.rank === "number" && Number.isInteger(j.rank) && j.rank >= 1 && j.rank <= 8 ? { rank: j.rank, reason: clean(j.reason, 200) } : null;
    candidates.push({ hook: c.hook, text, uses, scores: scores as OpenerScores, ...(judge ? { judge } : {}) });
    if (candidates.length >= 8) break;
  }
  if (!candidates.length) return null;
  const order = ranked(candidates);
  const pick = typeof r.pick === "number" && candidates[r.pick] ? r.pick : order[0];
  const alt = typeof r.alt === "number" && candidates[r.alt] && r.alt !== pick ? r.alt : order.find((i) => i !== pick) ?? null;
  const edited = clean(r.edited, 400) || null;
  const picked_by = r.picked_by === "judge" || r.picked_by === "writer" ? r.picked_by : undefined;
  return { candidates, pick, alt, edited, written_at: typeof r.written_at === "string" ? r.written_at : null, ...(picked_by ? { picked_by } : {}) };
}

/** What a new set looks like ranked by the writer's own scores (before the judge, or when it couldn't run): the best is the default, the runner-up the alternate. */
export function rankOpeners(candidates: OpenerCandidate[], now: Date = new Date()): Openers {
  const order = ranked(candidates);
  return { candidates, pick: order[0], alt: order[1] ?? null, edited: null, written_at: now.toISOString() };
}

/** The words that go out: the owner's edit, or the default. Null when nothing was written. */
export function openerText(o: Openers | null | undefined): string | null {
  if (!o) return null;
  return o.edited || o.candidates[o.pick]?.text || null;
}
export const openerHook = (o: Openers | null | undefined): OpenerHook | null => (o ? o.candidates[o.pick]?.hook ?? null : null);

// ── Whose words went out (owner, 2026-11-17) ────────────────────────────────
// A sent opener is credited to its hook only when the model's words went. When
// the owner's own edit went (saved on Approve, or reworded at the last moment
// on the Send screen), the sent event's variant is "edit:<hook>", and the open
// rates count it under "Your edit", never under the hook.

export const EDIT_VARIANT = "edit";
/** The variant a sent opener is recorded with: its hook, or "edit:<hook>" when the owner's words went out. */
export function openerSentVariant(o: Openers | null | undefined, reworded = false): string | null {
  const hook = openerHook(o);
  if (!hook) return null;
  return o?.edited || reworded ? `${EDIT_VARIANT}:${hook}` : hook;
}
/** What the open rates count a sent opener under: its hook, or "edit" for the owner's words. */
export const openerStatKey = (variant: string | null | undefined): string => (!variant ? "unknown" : variant === EDIT_VARIANT || variant.startsWith(`${EDIT_VARIANT}:`) ? EDIT_VARIANT : variant);
export const openerStatLabel = (key: string): string => (key === EDIT_VARIANT ? "Your edit" : isOpenerHook(key) ? OPENER_HOOK_LABELS[key] : key);

/** The text as it is sent: the words, then the link alone on the last line. */
export const openerMessage = (text: string, link: string): string => `${text.trim()}\n${link}`;

// ── The rules ───────────────────────────────────────────────────────────────

const EMOJI = /\p{Extended_Pictographic}/u;
const URL_RE = /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:me|com|net|org|io|co)\b|\{link\}/i;
/** The owner's list, and the same family. */
const BANNED: [RegExp, string][] = [
  [/\breach(ing|ed)? out\b/i, "reaching out"],
  [/\bhope (this|you|it) (finds|is|are)\b/i, "hope this finds you well"],
  [/\bquick question\b/i, "quick question"],
  [/\bplatform\b/i, "platform"],
  [/\bsolutions?\b/i, "solution"],
  [/\bboost/i, "boost"],
  [/\belevat/i, "elevate"],
  [/#\s?1\b|\bnumber one\b|\bno\. ?1\b/i, "#1"],
  [/\b(touch(ing)? base|circle back|just checking in|following up)\b/i, "filler"],
  [/\b(game[- ]?changer|revolutionary|cutting[- ]edge|next[- ]level|amazing|incredible|awesome|exclusive|act now|limited time|guarantee)/i, "hype"],
  [/\b(free|price|pricing|cost|discount|trial|\$\d|subscription|sign up|signup|demo|book a call)\b/i, "a price or a pitch"],
  // "leads" the noun (a sales pitch), not the verb ("a card that leads with them").
  [/\b(nfc|qr|crm|integrat\w*|features?|analytics|dashboard|app|lead (capture|gen\w*)|(more|new|capture|collect|get) leads)\b/i, "a feature"],
  [/\bswift ?card\b/i, "the company name (it's a text from Menash, not from a company)"],
  [/\b(track\w*|notif\w*|alerts?|see when|who opens|opens? it|opened|views?|viewed|watching)\b/i, "tracking"],
];
/**
 * Praise that could go to anybody. Lower case only, so a place called Great
 * Neck is a place and not a compliment; a sentence that OPENS with praise
 * ("Great listings.") is caught by the second pattern.
 */
const COMPLIMENT = /\b(great|impressive|beautiful|fantastic|wonderful|stunning|love(d)?|big fan|really like)\b|(?:^|[.?]\s+)(Great|Impressive|Beautiful|Fantastic|Wonderful|Stunning|Love|Loved|Really like)\s+[a-z]/;
const GREETING = (first: string) => new RegExp(`^(?:Hey|Hi) ${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, (?:${OPENER_SENDER} here|it'?s ${OPENER_SENDER})\\.`, "");
const MADE_CARD = /\b(made|put together|built|set up|did|designed|mocked up)\b[^.?]{0,40}\bcards?\b|\bcards?\b[^.?]{0,30}\b(made|put together|built) (you|for)/i;
/** Words a sentence may open with that aren't facts. */
const COMMON_CAPS = new Set(["I", "I'm", "I've", "I'd", "It's", "It", "Its", "Saw", "Figured", "Thought", "Made", "Put", "Since", "With", "And", "So", "Your", "You", "Here", "Hey", "Hi", "If", "Want", "Took", "Noticed", "Happy", "Just", "No", "All", "The", "A", "An", "Both", "Got", "Yours", "Let", "Hope", "Each", "Everyone", "One", "Also", OPENER_SENDER]);

export type OpenerContext = {
  owner_name: string;
  /** Every true thing it may draw on: verified, quotable specifics, the office, the owner, the team, the address… */
  facts: string[];
  /** Numbers flagged as possibly out of date (outreach.ts staleNumbers): never said. */
  stale?: string[];
};

/** The prospect's verified, quotable facts as one list of sentences, for the "never invents a fact" check. */
export function openerFacts(p: Pick<ProspectPreview, "owner_name" | "office_name" | "owner_title" | "address" | "specialty" | "team_members" | "team_size" | "specifics" | "sources"> & Partial<Pick<ProspectPreview, "warm_path">>): string[] {
  const out = [p.owner_name, p.office_name, p.owner_title ?? "", p.address ?? "", p.specialty ?? "", ...p.team_members.map((m) => `${m.name} ${m.title}`)];
  if (p.team_size && !p.sources.team_size?.uncertain) out.push(`${p.team_size} agents on the team`);
  for (const s of p.specifics) if (isVerified(s) && !s.quiet) out.push(s.text);
  if (p.warm_path?.name) out.push(p.warm_path.name);
  return out.filter(Boolean);
}

/** The words after the greeting, split into sentences. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.?:])\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * What is wrong with one opener, as sentences; empty when it may go out.
 * Used for every candidate /build-card writes AND for the owner's own edit.
 */
export function checkOpenerText(text: string, ctx: OpenerContext): string[] {
  const out: string[] = [];
  const t = text.trim();
  if (!t) return ["It's empty."];
  const first = firstName(ctx.owner_name);
  if (!GREETING(first).test(t)) out.push(`Start with "Hey ${first}, ${OPENER_SENDER} here." They don't have your number.`);
  if (URL_RE.test(t)) out.push("Leave the link out: it goes alone on the last line by itself.");
  if (t.includes("\n")) out.push("One paragraph: the only line break is before the link.");
  if (t.length < OPENER_MIN_CHARS || t.length > OPENER_MAX_CHARS) out.push(`${t.length} characters. Keep it about 150 to 220 (${OPENER_MIN_CHARS}–${OPENER_MAX_CHARS} at the outside).`);
  const body = sentences(t).slice(1);
  if (body.length < 2 || body.length > 3) out.push(`${body.length} sentence${body.length === 1 ? "" : "s"} after the greeting. Two or three short ones.`);
  if (EMOJI.test(t)) out.push("No emojis.");
  if (/!/.test(t)) out.push("No exclamation marks. A person texting a professional contact doesn't shout.");
  for (const [re, what] of BANNED) if (re.test(t)) out.push(`It says ${what}. ${what === "tracking" ? "Never mention tracking." : "Take it out."}`);
  if (COMPLIMENT.test(t)) out.push("That's a compliment that could go to anybody. Say the fact instead.");
  if (!MADE_CARD.test(t)) out.push("Say you made them a card.");

  // Never invents a fact: every number and every name has to be in their facts.
  const facts = ctx.facts.join(" \n ").toLowerCase();
  const factNumbers = new Set(facts.match(/\d+/g) ?? []);
  for (const n of new Set(t.match(/\d+/g) ?? [])) {
    if ((ctx.stale ?? []).includes(n)) out.push(`It uses ${n}, a number flagged as possibly out of date. Leave it out.`);
    else if (!factNumbers.has(n)) out.push(`It says ${n}, which isn't in their verified facts. Never invent a fact.`);
  }
  const unknown = new Set<string>();
  for (const s of sentences(t)) {
    const words = s.replace(/^[^A-Za-z]+/, "").split(/\s+/);
    words.forEach((w, i) => {
      const word = w.replace(/^[^A-Za-z]+|[^A-Za-z'’]+$/g, "").replace(/['’]s$/, "");
      if (!word || !/^[A-Z]/.test(word) || word === first || COMMON_CAPS.has(word)) return;
      // The first word of a sentence is capitalised anyway; it only counts when it isn't a plain word.
      if (i === 0 && !facts.includes(word.toLowerCase())) return;
      if (!facts.includes(word.toLowerCase())) unknown.add(word);
    });
  }
  if (unknown.size) out.push(`It names ${[...unknown].join(", ")}, which ${unknown.size === 1 ? "isn't" : "aren't"} in their verified facts. Never invent a fact.`);
  return out;
}

/** The distinctive bits of a fact: its numbers and its capitalised names. */
function marks(text: string): string[] {
  const nums = text.match(/\d+/g) ?? [];
  const names = (text.match(/\b[A-Z][a-zA-Z'’-]{2,}\b/g) ?? []).filter((w) => !COMMON_CAPS.has(w));
  return [...nums, ...names.map((n) => n.toLowerCase())];
}

/**
 * The swap test, in code: an opener has to carry something only true of
 * this prospect, beyond their first name. Built on a specific, it repeats a
 * number or a name from that specific; built on the team, it says the team's
 * size or the office's name; built on a warm path, it names that person.
 */
export function passesSwapTest(c: Pick<OpenerCandidate, "hook" | "text" | "uses">, p: { specifics: Specific[]; team_size: number | null; office_name: string; warm_name?: string | null }): boolean {
  const lower = c.text.toLowerCase();
  if (c.hook === "warm") return !!p.warm_name && lower.includes(firstName(p.warm_name).toLowerCase());
  if (c.uses !== null && p.specifics[c.uses]) {
    const m = marks(p.specifics[c.uses].text);
    if (m.some((x) => (/^\d+$/.test(x) ? new RegExp(`(^|\\D)${x}(\\D|$)`).test(c.text) : lower.includes(x)))) return true;
  }
  if (c.hook === "team") return (!!p.team_size && new RegExp(`(^|\\D)${p.team_size}(\\D|$)`).test(c.text)) || lower.includes(p.office_name.toLowerCase());
  return false;
}

type Checked = Pick<ProspectPreview, "owner_name" | "office_name" | "owner_title" | "address" | "specialty" | "team_members" | "team_size" | "specifics" | "sources"> & Partial<Pick<ProspectPreview, "warm_path">>;

/**
 * A whole set from /build-card, as sentences; empty when it may be saved.
 * Five candidates on five different hooks where the facts allow (three at
 * the least), each tied to a verified specific, each passing every rule, and
 * the best of them good enough to send.
 */
export function checkOpeners(o: Openers | null, p: Checked, stale: string[] = []): string[] {
  if (!o) return ["No openers were written."];
  const out: string[] = [];
  if (o.candidates.length < OPENER_MIN_CANDIDATES) out.push(`${o.candidates.length} openers. Write ${OPENER_TARGET}, each on a different hook (${OPENER_MIN_CANDIDATES} at the least, only when the facts can't carry more).`);
  if (o.candidates.length > OPENER_TARGET) out.push(`${o.candidates.length} openers. Keep the best ${OPENER_TARGET}.`);
  const hooks = o.candidates.map((c) => c.hook);
  if (new Set(hooks).size !== hooks.length) out.push("Two openers use the same hook. Each one takes a different angle.");
  const ctx: OpenerContext = { owner_name: p.owner_name, facts: openerFacts(p), stale };
  o.candidates.forEach((c, i) => {
    const label = `Opener ${i + 1} (${c.hook})`;
    for (const problem of checkOpenerText(c.text, ctx)) out.push(`${label}: ${problem}`);
    const sp = c.uses === null ? null : p.specifics[c.uses] ?? null;
    if (c.hook === "warm" && !p.warm_path?.name) out.push(`${label}: there is no warm path on this prospect.`);
    if (c.hook !== "team" && c.hook !== "warm") {
      if (!sp) out.push(`${label}: say which specific it is built on (uses).`);
      else if (!isVerified(sp)) out.push(`${label}: it is built on specific ${c.uses}, which isn't verified.`);
      else if (sp.quiet) out.push(`${label}: it is built on specific ${c.uses}, which is marked "don't quote".`);
    }
    if (c.hook === "team" && !(p.team_size && !p.sources.team_size?.uncertain) && !(sp && isVerified(sp))) out.push(`${label}: the team's size isn't confirmed. Build it on a verified specific, or use another hook.`);
    if (!passesSwapTest(c, { specifics: p.specifics, team_size: p.sources.team_size?.uncertain ? null : p.team_size, office_name: p.office_name, warm_name: p.warm_path?.name ?? null })) {
      out.push(`${label}: it fails the swap test. It would still make sense sent to someone else: name the street, the number or the place.`);
    }
  });
  // The writer's own best total (the judge may have picked another as the default).
  const best = o.candidates.length ? Math.max(...o.candidates.map((c) => total(c.scores))) : null;
  if (best !== null && best < OPENER_MIN_BEST_TOTAL) out.push(`The best opener scores ${best} of 30. Below ${OPENER_MIN_BEST_TOTAL} none is good enough: rewrite them.`);
  return out;
}

// ── The call ────────────────────────────────────────────────────────────────

/** Anything that would tell them we saw them open it. */
const REVEALS_OPEN = /\b(saw|see|noticed|notice) (that )?you\b[^.?]{0,30}\b(open|look|check|view|click|tap)|\b(you )?(just )?(opened|viewed|clicked|tapped)\b|\b(looking at|checking out|checked out) (it|the card|your card|the link)\b|\bopen(ed)? (it|the card|your card|the link)\b|\bright now\b|\bjust now\b/i;
export const revealsOpen = (text: string) => REVEALS_OPEN.test(text);

/**
 * The first thing to say when they pick up. The one written for them at
 * build time when it gives nothing away; otherwise one made from the opener's
 * own fact. Never "I saw you opened it".
 */
export function callFirstLine(p: Pick<ProspectPreview, "owner_name"> & Partial<Pick<ProspectPreview, "outreach">>, about: string | null): string {
  const written = (p.outreach?.call_opener ?? "").trim();
  if (written && !revealsOpen(written)) return written;
  const first = firstName(p.owner_name);
  return `Hi ${first}, it's ${OPENER_SENDER}. I texted you about the card I made you${about ? ` with ${about}` : ""}. Did it come through okay on your end?`;
}

/** Three things to bring up: the fact the opener used first, then the other verified ones. */
export function talkingPoints(p: Pick<ProspectPreview, "specifics" | "team_size" | "sources" | "current_tool" | "hook_why"> & Partial<Pick<ProspectPreview, "warm_path">>, usedSpecific: number | null): string[] {
  const out: string[] = [];
  const quotable = p.specifics.map((s, i) => ({ s, i })).filter(({ s }) => isVerified(s) && !s.quiet);
  quotable.sort((a, b) => (a.i === usedSpecific ? -1 : b.i === usedSpecific ? 1 : 0));
  for (const { s } of quotable) out.push(s.text);
  if (p.warm_path?.text) out.push(p.warm_path.text);
  if (p.team_size && !p.sources.team_size?.uncertain) out.push(`${p.team_size} on the team: a card for each of them, all matching.`);
  if (p.hook_why) out.push(p.hook_why);
  return [...new Set(out)].slice(0, 3);
}

/**
 * The text that lands on the owner's own phone the moment a prospect really
 * opens their card: who, the number to tap, what they were sent, three things
 * to say and a first line that gives nothing away.
 */
export function openAlertText(p: Pick<ProspectPreview, "owner_name" | "office_name" | "phone" | "specifics" | "team_size" | "sources" | "current_tool" | "hook_why"> & Partial<Pick<ProspectPreview, "warm_path" | "outreach" | "openers">>, opts: { sentText: string | null }): string {
  const o = p.openers ?? null;
  const used = o ? o.candidates[o.pick]?.uses ?? null : null;
  const points = talkingPoints(p, used);
  const about = used !== null && p.specifics[used] ? shortFact(p.specifics[used].text) : null;
  const digits = p.phone.replace(/[^\d+]/g, "");
  return [
    `${p.owner_name} (${p.office_name}) is looking at the card now.`,
    `Call: ${digits}`,
    opts.sentText ? `They got: "${opts.sentText.split("\n")[0]}"` : null,
    points.length ? `Talk about:\n${points.map((t, i) => `${i + 1}. ${t}`).join("\n")}` : null,
    `Open with: "${callFirstLine(p, about)}"`,
  ].filter(Boolean).join("\n");
}

/** "Listed 14 Garden Pl, a 4-bedroom brownstone, at $3.4M" → "the 14 Garden Pl listing"-ish: the first clause, lower-cased. */
function shortFact(text: string): string {
  const head = text.split(/[,;(]/)[0].trim().replace(/\.$/, "");
  return head.length > 60 ? `${head.slice(0, 57)}…` : head.charAt(0).toLowerCase() + head.slice(1);
}

// ── The link preview ────────────────────────────────────────────────────────

/** og:title: "Dana's card, made for you". */
export const ogTitle = (ownerName: string): string => `${firstName(ownerName)}'s card, made for you`;
