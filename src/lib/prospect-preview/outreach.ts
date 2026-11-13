import { buildMessages, type Messages } from "./messages";
import { FILLER, isVerified } from "./quality";
import { LINK_SLOT, OUTREACH_KEYS, OUTREACH_LABELS, OUTREACH_MAX, OUTREACH_TEXTS, TEXT_LIMIT, type Outreach, type OutreachKey, type ProspectPreview, type Specific } from "./types";

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
// Nothing here sends anything. Every message still leaves from the founder's
// own phone or inbox, by hand.

const block = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "";

/** From the database's jsonb, a form or the command's JSON. Null when nothing was written. */
export function readOutreach(v: unknown): Outreach | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const out = { uses: {}, written_at: typeof r.written_at === "string" ? r.written_at : null } as Outreach;
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
  const raw: Record<string, unknown> = { uses: before?.uses ?? {}, written_at: now.toISOString() };
  for (const k of OUTREACH_KEYS) raw[k] = get(`o_${k}`);
  return readOutreach(raw);
}

export const fillLink = (s: string, link: string): string => s.split(LINK_SLOT).join(link);

const EMOJI = /\p{Extended_Pictographic}/u;
const FREE = /\bfree\b/i;
const HAS_URL = /https?:\/\/|\bwww\.|swiftcard\.me/i;

/**
 * What is wrong with a set of messages, as sentences; empty when it may be
 * saved. `complete` is the command's bar (every message written, each tied to
 * a verified specific); the edit screen saves a partial set, and whatever is
 * missing falls back to its template.
 */
export function checkOutreach(o: Outreach | null, ctx: { link: string; specifics: Specific[]; complete?: boolean }): string[] {
  const out: string[] = [];
  if (!o) return ctx.complete ? ["No messages were written."] : [];
  for (const k of OUTREACH_KEYS) {
    const label = OUTREACH_LABELS[k];
    const words = o[k];
    if (!words) {
      if (ctx.complete) out.push(`${label}: not written.`);
      continue;
    }
    if (EMOJI.test(words)) out.push(`${label}: no emojis.`);
    if (FREE.test(words)) out.push(`${label}: don't say "free".`);
    if (FILLER.test(words)) out.push(`${label}: that reads as a compliment or filler that could go to any office. Say the fact and why it matters.`);
    if (OUTREACH_TEXTS.includes(k)) {
      const length = fillLink(words, ctx.link).length;
      if (length > TEXT_LIMIT) out.push(`${label}: ${length} characters with the link in it. A text stays at ${TEXT_LIMIT} or under.`);
    }
  }
  if (o.first_text && (o.first_text.includes(LINK_SLOT) || HAS_URL.test(o.first_text))) out.push(`${OUTREACH_LABELS.first_text}: this one carries no link. It asks whether they want it.`);
  for (const k of ["link_text", "email_body"] as const) {
    if (o[k] && !o[k].includes(LINK_SLOT)) out.push(`${OUTREACH_LABELS[k]}: put ${LINK_SLOT} where the link goes.`);
  }
  for (const k of OUTREACH_KEYS) {
    if (o[k] && k !== "first_text" && HAS_URL.test(fillLink(o[k], ""))) out.push(`${OUTREACH_LABELS[k]}: write ${LINK_SLOT} instead of an address, so the link is always the right one.`);
  }

  if (ctx.complete) {
    const verified = ctx.specifics.map((s, i) => (isVerified(s) ? i : -1)).filter((i) => i >= 0);
    const needs = OUTREACH_KEYS.filter((k) => k !== "email_subject");
    const used = new Set<number>();
    for (const k of needs) {
      const i = o.uses[k];
      if (i === undefined) out.push(`${OUTREACH_LABELS[k]}: say which specific it is built on (uses.${k}).`);
      else if (!verified.includes(i)) out.push(`${OUTREACH_LABELS[k]}: it is built on specific ${i}, which isn't a verified one.`);
      else used.add(i);
    }
    const want = Math.min(verified.length, needs.length);
    if (verified.length && used.size < want) {
      const spare = verified.filter((i) => !used.has(i));
      out.push(`The messages lean on ${used.size} of the ${verified.length} verified specifics. Use a different one in each where possible: ${spare.map((i) => `${i} (${ctx.specifics[i].text.slice(0, 50)})`).join(", ")} ${spare.length === 1 ? "is" : "are"} unused.`);
    }
  }
  return out;
}

type About = Parameters<typeof buildMessages>[0] & Pick<ProspectPreview, "outreach">;

/**
 * The messages to show for one preview: what was written for this prospect,
 * with the link filled in, and the template for anything that wasn't.
 */
export function resolveOutreach(p: About, opts: { link: string; sender: string | null }): Messages {
  const t = buildMessages(p, opts);
  const o = p.outreach ?? null;
  if (!o) return t;
  const pick = (k: OutreachKey, fallback: string) => (o[k] ? fillLink(o[k], opts.link) : fallback);
  return {
    ask: pick("first_text", t.ask),
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
