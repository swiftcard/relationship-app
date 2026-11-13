import { buildMessages, type Messages } from "./messages";
import { FILLER, isVerified } from "./quality";
import { LINK_SLOT, LINKEDIN_NOTE_LIMIT, OUTREACH_KEYS, OUTREACH_LABELS, OUTREACH_LINKEDIN, OUTREACH_MAX, OUTREACH_TEXTS, TEXT_LIMIT, type Outreach, type OutreachKey, type ProspectPreview, type Specific } from "./types";

// ── Card Builder: the outreach written for ONE prospect ─────────────────────
// Owner, 2026-11-13: "written per prospect, not templates". When a card is
// built, the /build-card command writes the first text, the text with the
// link, the email, the call opener, a voicemail script and two follow-up
// nudges for that office, and saves them on the preview. The Send and Call
// screens, the Approve queue and "Follow up today" show these, and fall back
// to the templates (messages.ts) only where none was written.
//
// The words are written by the command, never by a paid API call inside the
// app; this file only stores, checks and shows them. Pure, so the rules are
// tested (tests/prospect-preview-outreach.test.ts):
//
//   • a text is 160 characters at most, with the real link in it
//   • no emojis, and never the word "free"
//   • the first text carries no link; the second text and the email do
//   • each message is built on a verified specific, and they don't all lean
//     on the same one when the preview has others
//
// Round 2 (owner, 2026-11-13), also checked here:
//
//   • two versions of the first text, built on different specifics, for the
//     owner to pick between in Approve
//   • a LinkedIn connection note (200 characters, no link, no pitch) and a
//     message for after they accept, when their public profile was found
//   • tone: never quote back something that reads as having been watched (a
//     follower count; any specific marked `quiet`, such as a former name or
//     an old address), never use a number that was flagged as possibly stale,
//     and never claim SwiftCard tells you WHO opened a card: it tells you
//     when, and names only people who already shared their details
//   • when there is a warm path, the first text leads with it
//
// Nothing here sends anything. Every message still leaves from the founder's
// own phone or inbox, by hand.

const block = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "";

/** From the database's jsonb, a form or the command's JSON. Null when nothing was written. */
export function readOutreach(v: unknown): Outreach | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const out = { uses: {}, written_at: typeof r.written_at === "string" ? r.written_at : null, first_pick: r.first_pick === "a" || r.first_pick === "b" ? r.first_pick : null } as Outreach;
  let any = false;
  for (const k of OUTREACH_KEYS) {
    out[k] = block(r[k], OUTREACH_MAX[k]);
    if (out[k]) any = true;
  }
  if (!any) return null;
  const uses = (r.uses && typeof r.uses === "object" ? r.uses : {}) as Record<string, unknown>;
  for (const k of OUTREACH_KEYS) {
    const n = uses[k];
    if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 20) out.uses[k] = n;
  }
  return out;
}

/** The edit screen's fields: o_<message>. What each message is built on is kept from before. */
export function parseOutreachForm(get: (key: string) => unknown, before: Outreach | null, now: Date = new Date()): Outreach | null {
  const raw: Record<string, unknown> = { uses: before?.uses ?? {}, first_pick: before?.first_pick ?? null, written_at: now.toISOString() };
  for (const k of OUTREACH_KEYS) raw[k] = get(`o_${k}`);
  return readOutreach(raw);
}

export const fillLink = (s: string, link: string): string => s.split(LINK_SLOT).join(link);

const EMOJI = /\p{Extended_Pictographic}/u;
const FREE = /\bfree\b/i;
const HAS_URL = /https?:\/\/|\bwww\.|swiftcard\.me/i;
/** "12.4K people follow you": true, public, and it reads as being watched. */
const FOLLOWERS = /\b\d[\d.,]*\s?[km]?\s+(followers|subscribers)\b|\b\d[\d.,]*\s?[km]?\s+people follow/i;
/**
 * SwiftCard tells a card's owner WHEN it is opened (and where, on what). It
 * names the person only when they already shared their details with that
 * owner (lib/card-event-notify.ts: everyone else is "Someone"). So "see who
 * opens it" promises something the product doesn't do.
 */
const WHO_OPENS = /\b(see|seeing|know|knowing|tells? you|shows? you|find out|learn)\s+(exactly\s+)?who(?:'s| is| has)?\s+(open|view|look|click|scan|tap)/i;
/** A connection note is a hello, not a pitch. */
const PITCH = /\bswiftcard\b|\bdemo\b|\bpric(e|es|ing)\b|\bcard i (made|built)\b|\bsign up\b|\boffer\b/i;
const STREET = /\b\d+[A-Za-z]?\s+(?:[A-Z0-9][\w.'-]*\s+){0,3}(?:St|Street|Ave|Avenue|Pl|Place|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Plaza|Plz|Sq|Square|Ter|Terrace|Pkwy|Parkway|Hwy|Broadway)\b\.?/g;
const DAY_OF_MONTH = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\b/g;
const NO_LINK: readonly OutreachKey[] = ["first_text", "first_text_b", "linkedin_note"];

/**
 * Numbers that were flagged as possibly stale when the card was researched:
 * the team size when its source is marked uncertain, and any number inside a
 * specific marked uncertain. A message must not lean on one.
 */
export function staleNumbers(p: Pick<ProspectPreview, "team_size" | "sources" | "specifics">): string[] {
  const out = new Set<string>();
  if (p.team_size && p.sources.team_size?.uncertain) out.add(String(p.team_size));
  for (const sp of p.specifics) if (sp.uncertain) for (const n of sp.text.match(/\d+/g) ?? []) if (n.length > 1 || Number(n) > 1) out.add(n);
  return [...out];
}

/**
 * What is wrong with a set of messages, as sentences; empty when it may be
 * saved. `complete` is the command's bar (every message written, each tied to
 * a verified specific); the edit screen saves a partial set, and whatever is
 * missing falls back to its template.
 */
export function checkOutreach(o: Outreach | null, ctx: {
  link: string; specifics: Specific[]; complete?: boolean;
  /** Their public LinkedIn profile was found, so the two LinkedIn messages are expected. */
  linkedin?: boolean;
  /** The person or place of the warm path, which the first text must name. */
  warmName?: string | null;
  /** staleNumbers(preview). */
  stale?: string[];
}): string[] {
  const out: string[] = [];
  if (!o) return ctx.complete ? ["No messages were written."] : [];
  for (const k of OUTREACH_KEYS) {
    const label = OUTREACH_LABELS[k];
    const words = o[k];
    if (!words) {
      if (ctx.complete && (ctx.linkedin || !OUTREACH_LINKEDIN.includes(k))) out.push(`${label}: not written.`);
      continue;
    }
    if (FOLLOWERS.test(words)) out.push(`${label}: don't quote a follower count back to them. It reads as watching them.`);
    if (WHO_OPENS.test(words)) out.push(`${label}: SwiftCard tells you when a card is opened, not who opened it. Say "you see when it's opened".`);
    // A house number or a day of the month is not the count that went stale:
    // "14 Garden Pl" and "Nov 14" are taken out before looking for "14 agents".
    const counts = words.replace(STREET, " ").replace(DAY_OF_MONTH, " ");
    for (const n of ctx.stale ?? []) {
      if (new RegExp(`(^|[^\\d.,$#])${n}(?![\\d]|[.,]\\d)`).test(counts)) out.push(`${label}: it uses ${n}, a number that was flagged as possibly out of date. Leave the number out, or confirm it first.`);
    }
    if (EMOJI.test(words)) out.push(`${label}: no emojis.`);
    if (FREE.test(words)) out.push(`${label}: don't say "free".`);
    if (FILLER.test(words)) out.push(`${label}: that reads as a compliment or filler that could go to any office. Say the fact and why it matters.`);
    if (OUTREACH_TEXTS.includes(k)) {
      const length = fillLink(words, ctx.link).length;
      if (length > TEXT_LIMIT) out.push(`${label}: ${length} characters with the link in it. A text stays at ${TEXT_LIMIT} or under.`);
    }
  }
  for (const k of NO_LINK) {
    if (o[k] && (o[k].includes(LINK_SLOT) || HAS_URL.test(o[k]))) out.push(`${OUTREACH_LABELS[k]}: this one carries no link.${k === "linkedin_note" ? "" : " It asks whether they want it."}`);
  }
  if (o.linkedin_note) {
    if (o.linkedin_note.length > LINKEDIN_NOTE_LIMIT) out.push(`${OUTREACH_LABELS.linkedin_note}: ${o.linkedin_note.length} characters. A connection note stays at ${LINKEDIN_NOTE_LIMIT} or under.`);
    if (PITCH.test(o.linkedin_note)) out.push(`${OUTREACH_LABELS.linkedin_note}: no pitch. Say why you'd like to connect, and leave SwiftCard and the card out of it.`);
  }
  if (ctx.warmName && o.first_text) {
    const first = ctx.warmName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (first && !o.first_text.toLowerCase().includes(first)) out.push(`${OUTREACH_LABELS.first_text}: there is a warm path (${ctx.warmName}). Lead with it.`);
  }
  for (const k of ["link_text", "email_body"] as const) {
    if (o[k] && !o[k].includes(LINK_SLOT)) out.push(`${OUTREACH_LABELS[k]}: put ${LINK_SLOT} where the link goes.`);
  }
  for (const k of OUTREACH_KEYS) {
    if (o[k] && !NO_LINK.includes(k) && HAS_URL.test(fillLink(o[k], ""))) out.push(`${OUTREACH_LABELS[k]}: write ${LINK_SLOT} instead of an address, so the link is always the right one.`);
  }

  if (ctx.complete) {
    const verified = ctx.specifics.map((s, i) => (isVerified(s) ? i : -1)).filter((i) => i >= 0);
    // The LinkedIn note is a hello: it needn't be built on anything.
    const needs = OUTREACH_KEYS.filter((k) => k !== "email_subject" && k !== "linkedin_note" && (ctx.linkedin || k !== "linkedin_dm"));
    const used = new Set<number>();
    for (const k of needs) {
      const i = o.uses[k];
      if (i === undefined) out.push(`${OUTREACH_LABELS[k]}: say which specific it is built on (uses.${k}).`);
      else if (!verified.includes(i)) out.push(`${OUTREACH_LABELS[k]}: it is built on specific ${i}, which isn't a verified one.`);
      else if (ctx.specifics[i].quiet) out.push(`${OUTREACH_LABELS[k]}: it is built on specific ${i}, which is marked "don't quote". Use another.`);
      else used.add(i);
    }
    const quotable = verified.filter((i) => !ctx.specifics[i].quiet);
    if (quotable.length > 1 && o.uses.first_text !== undefined && o.uses.first_text === o.uses.first_text_b) {
      out.push("The two first texts are built on the same specific. Give the second a different angle.");
    }
    const want = Math.min(quotable.length, needs.length);
    if (quotable.length && used.size < want) {
      const spare = quotable.filter((i) => !used.has(i));
      out.push(`The messages lean on ${used.size} of the ${quotable.length} verified specifics. Use a different one in each where possible: ${spare.map((i) => `${i} (${ctx.specifics[i].text.slice(0, 50)})`).join(", ")} ${spare.length === 1 ? "is" : "are"} unused.`);
    }
  }
  return out;
}

type About = Parameters<typeof buildMessages>[0] & Pick<ProspectPreview, "outreach"> & Partial<Pick<ProspectPreview, "linkedin_url">>;

/**
 * The messages to show for one preview: what was written for this prospect,
 * with the link filled in, and the template for anything that wasn't.
 */
export function resolveOutreach(p: About, opts: { link: string; sender: string | null }): Messages {
  const t = buildMessages(p, opts);
  const o = p.outreach ?? null;
  if (!o) return t;
  const pick = (k: OutreachKey, fallback: string) => (o[k] ? fillLink(o[k], opts.link) : fallback);
  const a = pick("first_text", t.ask);
  const versions = o.first_text && o.first_text_b ? { a, b: o.first_text_b, picked: o.first_pick === "b" ? "b" as const : "a" as const } : null;
  return {
    ask: versions?.picked === "b" ? versions.b : a,
    versions,
    linkedin: p.linkedin_url && (o.linkedin_note || o.linkedin_dm) ? { note: o.linkedin_note, dm: fillLink(o.linkedin_dm, opts.link) } : null,
    text: pick("link_text", t.text),
    email: { subject: pick("email_subject", t.email.subject), body: pick("email_body", t.email.body) },
    voicemail: pick("voicemail", t.voicemail),
    nudge_no_view: pick("nudge_no_view", t.nudge_no_view),
    nudge_viewed: pick("nudge_viewed", t.nudge_viewed),
    written: true,
    // Written for this office: it says something true about them even when the hook fields are empty.
    specific: true,
  };
}

/** The opener written for this prospect, when there is one. */
export const writtenOpener = (p: Pick<ProspectPreview, "outreach">): string | null => p.outreach?.call_opener || null;

/** What the owner changed, message by message: what future drafts learn their voice from. */
export function outreachEdits(before: Outreach | null, after: Outreach | null): { message: OutreachKey; before: string; after: string }[] {
  if (!before || !after) return [];
  return OUTREACH_KEYS.filter((k) => before[k] && after[k] && before[k] !== after[k]).map((k) => ({ message: k, before: before[k], after: after[k] }));
}
