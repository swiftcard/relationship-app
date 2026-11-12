import { telHref } from "./input";
import type { ProspectPreview } from "./types";

// ── Card Builder: the three messages ────────────────────────────────────────
// Written from the prospect's real details, for the founder to send BY HAND
// from their own phone number and inbox (owner, 2026-11-11). Nothing here
// sends anything: the Send screen opens Messages or Mail with the words
// filled in, and the person presses send.
//
//   ask    a first text with NO link: "I made you a card, want it?"
//   text   the text with the link
//   email  the email with the link
//
// Short and plain, and never generic: each one opens with the preview's hook.
// Pure, so the wording is tested
// (tests/prospect-preview-pipeline.test.ts).

export type MessageKind = "ask" | "text" | "email";
export type Messages = {
  ask: string;
  text: string;
  email: { subject: string; body: string };
  /**
   * Every message opens with this prospect's hook. False when the preview has
   * none: the words then could go to any office, and the Send screen says so.
   */
  specific: boolean;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** "Harbor Realty" → "Harbor Realty's"; "Harbor Homes" → "Harbor Homes'". */
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** "Marcus", "Marcus and Jo", "Marcus, Jo and Ana", "Marcus, Jo and 4 others". */
export function teamNames(names: string[]): string {
  const first = names.map(firstName).filter(Boolean);
  if (first.length <= 1) return first.join("");
  if (first.length <= 3) return `${first.slice(0, -1).join(", ")} and ${first[first.length - 1]}`;
  return `${first[0]}, ${first[1]} and ${first.length - 2} others`;
}

const upUntil = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/**
 * The hook as two sentences: the fact ("I saw …") and why it matters to
 * them. Null unless the preview has both, so nothing half-specific is said.
 * The Call screen's opener uses the same words (lib/prospect-preview/call.ts).
 */
export function hookLines(p: { detail: string | null; hook_why: string | null }): { saw: string; why: string } | null {
  const detail = (p.detail ?? "").trim(), why = (p.hook_why ?? "").trim();
  return detail && why ? { saw: sentence(`I saw ${detail}`), why: sentence(why) } : null;
}

type About = Pick<ProspectPreview, "owner_name" | "office_name" | "logo_url" | "team_members" | "expires_at"> & Partial<Pick<ProspectPreview, "detail" | "hook_why">>;

/**
 * Every message leads with one true thing about this office and why it
 * matters to them (owner's rule, 2026-11-12: "if a message could go to any
 * brokerage unchanged, rewrite it"). The card comes second: it is the proof.
 *
 * @param sender  the founder's first name; null when we don't know it (the
 *                messages then say "the founder of SwiftCard" and nothing false)
 */
export function buildMessages(p: About, opts: { link: string; sender: string | null }): Messages {
  const first = firstName(p.owner_name);
  const sender = opts.sender ? firstName(opts.sender) : null;
  const team = teamNames(p.team_members.map((m) => m.name));
  const look = p.logo_url ? `with ${possessive(p.office_name)} logo and colors on it` : `in ${possessive(p.office_name)} colors`;
  const until = upUntil(p.expires_at);
  const hook = hookLines({ detail: p.detail ?? null, hook_why: p.hook_why ?? null });
  const lead = hook ? [hook.saw, hook.why] : [];

  const ask = [
    `Hi ${first}, ${sender ? `it's ${sender}, the founder of SwiftCard` : "this is the founder of SwiftCard"}.`,
    ...lead,
    hook
      ? `I made a card for you${team ? ` and for ${team}` : ""}, ${look}, to show you.`
      : `I made a digital business card for you${team ? ` and for ${team}` : ""}, ${look}.`,
    "Want me to text you the link?",
  ].join(" ");

  const text = [
    `Hi ${first}, ${sender ? `${sender} from SwiftCard` : "the founder of SwiftCard here"}.${hook ? ` ${lead.join(" ")}` : ""} Here's the card I made for you${team ? " and the team" : ""}:`,
    opts.link,
    `It's up until ${until}. Tell me what you'd change.`,
  ].join("\n");

  const body = [
    `Hi ${first},`,
    "",
    `${sender ? `I'm ${sender}, the founder of SwiftCard` : "I'm the founder of SwiftCard"}.${hook ? ` ${lead.join(" ")}` : ""}`,
    "",
    `${hook ? "So I made" : "I made"} a digital business card for you${team ? `, and one each for ${team}` : ""}, ${look}.`,
    "",
    `Here it is: ${opts.link}`,
    "",
    `It's a preview and it stays up until ${until}. If you like it, the button on that page books a 15-minute call and I'll set up the whole ${team ? "team" : "office"}.`,
    "",
    ...(sender ? [sender] : []),
    "Founder, SwiftCard",
  ].join("\n");

  return { ask, text, email: { subject: `${first}, I made your ${p.office_name} card`, body }, specific: !!hook };
}

/**
 * Opens the Messages app on a phone or a Mac with the number and the words
 * filled in. "?&body=" is the one spelling both iOS and Android accept.
 */
export function smsHref(phone: string, body: string): string {
  return `sms:${telHref(phone).slice(4)}?&body=${encodeURIComponent(body)}`;
}

export function mailtoHref(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
