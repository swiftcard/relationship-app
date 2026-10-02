import { randomBytes } from "node:crypto";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { aiComplete } from "@/lib/ai";
import { campaignLink, PROFESSION_TEMPLATE } from "@/lib/campaign-links";

// ── The LinkedIn desk ────────────────────────────────────────────────────────
// Owner order 2026-10-02: LinkedIn first, and "the main goal is to gain users".
//
// LinkedIn has no API for finding people or for messaging them, bans tools that
// do either through a member's session, and restricts the accounts that use
// them. So the desk does everything except the click on LinkedIn:
//   • the owner pastes a post or a profile he found;
//   • the desk writes the comment, the connection note, the message and the
//     follow-up, each in two versions, around the one specific thing that
//     person said;
//   • every person gets their own tracked link, so a signup is counted against
//     the exact conversation that produced it;
//   • the ledger says who is waiting on what, and who is due a follow-up.
//
// Nothing in this file talks to LinkedIn. It reads what the owner pasted and
// writes text for him to send.

export const LI_TRIGGERS = {
  new_job: "New job",
  new_license: "Newly licensed",
  team: "Team lead",
  event: "Going to an event",
  competitor: "Uses a competitor",
  warm: "Someone we know",
  other: "Other",
} as const;
export type LiTrigger = keyof typeof LI_TRIGGERS;

export const LI_STATUSES = ["new", "requested", "connected", "messaged", "replied", "signed_up", "closed"] as const;
export type LiStatus = (typeof LI_STATUSES)[number];

export type LiDrafts = { comment: string[]; note: string[]; message: string[]; followup: string[] };

export type LiSettings = {
  /** Whose LinkedIn profiles send. A Company Page cannot message anyone. */
  senders: string[];
  /** New people per sender per day. LinkedIn restricts accounts that send far more. */
  daily_target: number;
  /** Days of silence after the message before the follow-up is due. */
  followup_days: number;
};

export const LI_DEFAULTS: LiSettings = { senders: ["Aaron", "Menash"], daily_target: 10, followup_days: 3 };

export function mergeLiSettings(raw: unknown): LiSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const senders = Array.isArray(o.senders)
    ? [...new Set(o.senders.map((s) => String(s ?? "").trim().slice(0, 40)).filter(Boolean))].slice(0, 6)
    : [];
  const num = (v: unknown, d: number, lo: number, hi: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= lo ? Math.min(n, hi) : d;
  };
  return {
    senders: senders.length ? senders : LI_DEFAULTS.senders,
    // Capped at 20: past that LinkedIn starts restricting a free account.
    daily_target: num(o.daily_target, LI_DEFAULTS.daily_target, 1, 20),
    followup_days: num(o.followup_days, LI_DEFAULTS.followup_days, 1, 14),
  };
}

export async function loadLi(): Promise<{ settings: LiSettings; ready: boolean }> {
  const { data, error } = await getAdminSupabase().from("agent_system").select("linkedin").limit(1).single();
  // Before supabase/agent-linkedin.sql has run there is no column — say so, never throw.
  if (error) return { settings: LI_DEFAULTS, ready: false };
  return { settings: mergeLiSettings(data?.linkedin), ready: true };
}

/** li_d_<id>: this person's /go code, and the signup source it is recorded under. */
export function prospectCode(): string {
  return `li_d_${randomBytes(5).toString("hex").slice(0, 8)}`;
}

/** LinkedIn's limit on the note attached to a connection request (free account). */
export const NOTE_MAX = 200;

const LINK = /\b(?:https?:\/\/|www\.)\S+|\bswiftcard\.me\S*/gi;

/** Trim to a limit on a word boundary, never mid-word. */
export function clamp(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:—-]+$/, "");
}

const noLink = (s: string) => s.replace(LINK, "").replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();

export type ProspectFacts = {
  name: string | null; headline: string | null; company: string | null;
  trigger: LiTrigger; profession: string | null; hook: string | null;
};

const first = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] || "";

/**
 * The drafts when no model answered. Plain, true, and short — the owner can
 * still send them, they are just not built around what the person said.
 */
export function fallbackDrafts(p: ProspectFacts, link: string): LiDrafts {
  const hi = first(p.name) ? `Hi ${first(p.name)}, ` : "";
  const at = p.company ? ` at ${p.company}` : "";
  if (p.trigger === "warm") {
    return {
      comment: [],
      note: [],
      message: [
        `${hi}I'm working on SwiftCard, a digital business card. Would you make one and tell me where it's confusing? Takes about a minute and it's free: ${link}`,
        `${hi}favor to ask. I work on SwiftCard, a digital business card you share by QR code or Apple Wallet. Could you try making yours and tell me what you think? ${link}`,
      ],
      followup: [
        `No rush on this. If you get a minute, here's the link again: ${link}`,
        `Still glad to hear what you think whenever you try it: ${link}`,
      ],
    };
  }
  const opener: Record<LiTrigger, string> = {
    new_job: `Congrats on the new role${at}.`,
    new_license: "Congrats on getting licensed.",
    team: `Saw the new people joining${at}.`,
    event: "Good luck at the event.",
    competitor: "Saw your post about digital business cards.",
    warm: "",
    other: "Saw your post.",
  };
  const pitch: Record<LiTrigger, string> = {
    new_job: "a free digital business card with your new title on it",
    new_license: "a free digital business card with open-house sign-in built in",
    team: "one branded digital card per person, ready in minutes",
    event: "a QR code for the booth, so each visitor's details land on your phone",
    competitor: "a digital business card with a free plan and a price you can read",
    warm: "",
    other: "a free digital business card",
  };
  return {
    comment: [opener[p.trigger]],
    note: [clamp(`${hi}${hi ? opener[p.trigger].replace(/^./, (c) => c.toLowerCase()) : opener[p.trigger]} I work with SwiftCard: ${pitch[p.trigger]}. Glad to connect.`, NOTE_MAX)],
    message: [
      `Thanks for connecting${first(p.name) ? `, ${first(p.name)}` : ""}. I work with SwiftCard: ${pitch[p.trigger]}. It takes about a minute to make: ${link}`,
    ],
    followup: [`If it's useful, here's the link again: ${link}. I can walk you through it if you get stuck.`],
  };
}

// The only things a draft may say about the product. Kept short and true on
// purpose: nothing here names a price, a user count or a Pro-only feature.
const FACTS = `SwiftCard is a digital business card.
- You share it with a QR code, a link, an NFC card or Apple Wallet.
- The other person can leave their details, so you get theirs back (lead capture).
- You see when someone opens your card.
- Realtors put the QR code on the open-house table instead of a paper sign-in sheet.
- Teams get one branded card per person.
- It is free to start and takes about a minute to make.
Never state a price, a number of users, or any feature not listed here.`;

// marketing-agents/HUMAN_VOICE.md, compressed to what one LinkedIn message needs.
const VOICE = `Write like a sharp colleague texting: plain words, contractions, varied sentence length.
React to the ONE specific thing they said; never recap their post or restate their job title back at them.
If a sentence could be pasted to a different person unchanged, rewrite it.
Never write: "I hope this finds you well", "I came across", "reach out", "I'd love to", "feel free", "quick question", "game-changer", "seamless", "leverage", "elevate", "unlock".
No emoji. No exclamation marks. No bullet points. No em dashes. At most one question per message.`;

export function buildDraftPrompt(input: { pasted: string; name?: string | null; trigger?: LiTrigger | null; sender?: string | null }): string {
  const professions = Object.keys(PROFESSION_TEMPLATE).join(", ");
  return `You write LinkedIn outreach for SwiftCard. A real person will read each draft and send it by hand from their own LinkedIn profile${input.sender ? ` (${input.sender})` : ""}.

WHAT THE OWNER PASTED (a LinkedIn post or profile, copied from the page; it may include page clutter):
"""
${input.pasted.slice(0, 4000)}
"""
${input.name ? `The person's name: ${input.name}\n` : ""}${input.trigger ? `The owner says this is: ${LI_TRIGGERS[input.trigger]}\n` : ""}
PRODUCT FACTS
${FACTS}

VOICE
${VOICE}

Return ONE JSON object and nothing else:
{
  "name": "their full name, or empty if not in the text",
  "headline": "their role in a few words, or empty",
  "company": "their company or brokerage, or empty",
  "trigger": "new_job | new_license | team | event | competitor | warm | other",
  "profession": "one of: ${professions} — or empty if none fits",
  "hook": "the one specific detail from what they wrote that the drafts hang on",
  "comment": ["version A", "version B"],
  "note": ["version A", "version B"],
  "message": ["version A", "version B"],
  "followup": ["version A", "version B"]
}

RULES FOR EACH FIELD
- comment: under 35 words, posted under their post. A real reaction to what they said. No pitch, no link, no mention of SwiftCard.
- note: the note on a connection request. HARD LIMIT 190 characters. First name, the specific detail, and plainly "I work with SwiftCard" plus what it is in a few words. No link.
- message: sent after they accept. Under 70 words. The specific detail, why a digital card fits them right now, and {link} written exactly like that, once. Say plainly that you work with SwiftCard.
- followup: sent a few days later if they did not answer. Under 35 words. No guilt, no "just following up". One new useful point, then {link} once.
- trigger "warm" means the sender already knows this person: leave comment and note as empty arrays, and make message a casual ask to try SwiftCard and say what is confusing, with {link}.
- The two versions must take different angles, not reword each other.`;
}

function list(v: unknown): string[] {
  return (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 2);
}
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "") || null;

/**
 * Turn the model's reply into facts and drafts the owner can trust: limits are
 * enforced here, not hoped for. Returns null when the reply is not usable.
 */
export function parseDrafts(raw: string | null, link: (profession: string | null) => string, hints: { name?: string | null; trigger?: LiTrigger | null }): { facts: ProspectFacts; drafts: LiDrafts } | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }

  const trigger = hints.trigger ?? ((typeof o.trigger === "string" && o.trigger in LI_TRIGGERS ? o.trigger : "other") as LiTrigger);
  const profession = typeof o.profession === "string" && o.profession in PROFESSION_TEMPLATE ? o.profession : null;
  const url = link(profession);
  // The link goes in exactly once, wherever the model put {link}; a draft that
  // lost the placeholder gets the link on the end rather than no link at all.
  const withLink = (s: string) => {
    const clean = s.replace(LINK, "{link}");
    const once = clean.includes("{link}") ? clean.replace("{link}", "\u0000").replace(/\{link\}/g, "").replace("\u0000", url) : `${clean.replace(/[\s:]+$/, "")} ${url}`;
    return once.replace(/\s{2,}/g, " ").trim();
  };
  const plain = (s: string) => noLink(s.replace(/\{link\}/g, ""));

  const drafts: LiDrafts = {
    comment: trigger === "warm" ? [] : list(o.comment).map(plain),
    note: trigger === "warm" ? [] : list(o.note).map((s) => clamp(plain(s), NOTE_MAX)),
    message: list(o.message).map(withLink),
    followup: list(o.followup).map(withLink),
  };
  if (!drafts.message.length) return null;
  return {
    facts: { name: hints.name?.trim() || text(o.name, 120), headline: text(o.headline, 160), company: text(o.company, 120), trigger, profession, hook: text(o.hook, 300) },
    drafts,
  };
}

/** Read what was pasted and write the four drafts. Falls back to plain templates, never to nothing. */
export async function draftProspect(input: { pasted: string; code: string; name?: string | null; trigger?: LiTrigger | null; sender?: string | null }): Promise<{ facts: ProspectFacts; drafts: LiDrafts; ai: boolean }> {
  const link = (profession: string | null) => campaignLink(input.code, profession);
  const raw = await aiComplete(buildDraftPrompt(input), { maxTokens: 1200, json: true }).catch(() => null);
  const parsed = parseDrafts(raw, link, input);
  if (parsed) return { ...parsed, ai: true };
  const facts: ProspectFacts = { name: input.name?.trim() || null, headline: null, company: null, trigger: input.trigger ?? "other", profession: null, hook: null };
  return { facts, drafts: fallbackDrafts(facts, link(null)), ai: false };
}

export type ProspectClock = {
  status: LiStatus; trigger: string;
  messaged_at: string | null; followup_sent_at: string | null;
};

/** What the owner does next for this person, and whether it is due now. */
export function nextStep(p: ProspectClock, now: number, followupDays: number): { label: string; due: boolean } {
  switch (p.status) {
    case "new":
      return p.trigger === "warm" ? { label: "Send the message", due: true } : { label: "Comment, then send the connection request", due: true };
    case "requested":
      return { label: "Waiting for them to accept", due: false };
    case "connected":
      return { label: "They accepted — send the message", due: true };
    case "messaged": {
      if (p.followup_sent_at) return { label: "Followed up — waiting", due: false };
      const dueAt = (p.messaged_at ? new Date(p.messaged_at).getTime() : now) + followupDays * 86400e3;
      return dueAt <= now ? { label: "No reply — send the follow-up", due: true } : { label: `Waiting for a reply (follow-up in ${Math.max(1, Math.ceil((dueAt - now) / 86400e3))}d)`, due: false };
    }
    case "replied":
      return { label: "They replied — answer them", due: true };
    case "signed_up":
      return { label: "Signed up", due: false };
    default:
      return { label: "Closed", due: false };
  }
}

/** The timestamp each status stamps, so the ledger can say when. */
export const STATUS_STAMP: Record<LiStatus, string | null> = {
  new: null, requested: "requested_at", connected: "connected_at", messaged: "messaged_at",
  replied: "replied_at", signed_up: "signed_up_at", closed: "closed_at",
};

/** Midnight today in New York, as an ISO instant — "today" on the desk is the owner's day. */
export function startOfDayNY(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(now.getTime() - (((n("hour") % 24) * 60 + n("minute")) * 60 + n("second")) * 1000).toISOString();
}
