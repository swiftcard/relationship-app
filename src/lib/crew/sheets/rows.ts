import { createHash } from "node:crypto";
import { agentName } from "../agent-status";
import { AGENTS } from "../registry";
import type { Approval, Lead, SheetEntityKind, SheetRow } from "../types";
import { link, type CellValue } from "../google/sheets";
import { normalizeHandle } from "../ledger";
import { approvalKey, customKey, leadKey, personKey } from "./keys";
import type { TabSpec } from "./spec";
import { statusForApproval } from "./status";
import { emailComposeLink, exactPostLink, exactProfileLink, handleFromPost, instagramDmLink, instagramHandle, redditMessageLink } from "../exact-links";
import { LEAD_TAB_BY_SOURCE, OFFICE_PROSPECTS, WEB_LEADS, tabsForAgent } from "./tabs";

// ── A record → a row: Name, Message, Link ───────────────────────────────────
// The owner, 2026-10-29: "the person's name, the message to either write to
// them or reply to them, a link directly to where they literally just paste
// the message and send it." So every row is those three cells (and its Key),
// and the Link is the place the message goes: the exact post or comment for a
// reply, the chat itself for an Instagram DM, Reddit's message screen with the
// message filled in, a new email with the message in it. A draft with no such
// place never becomes a row. Only open items are rows: once something was
// sent, skipped or expired it leaves the Sheet. A lead with no message yet is
// still a row, marked as needing one. Nothing here reads the network.

export type Cells = Record<string, CellValue>;

export type BuiltRow = {
  tab: TabSpec;
  key: string;
  kind: SheetEntityKind;
  entityId: string;
  cells: Cells;
  /** The Status word kept in the database for this row (not shown in the Sheet). */
  initialStatus: string;
  rank: number;
  agent: string;
  createdAt: string;
};

export type RowSources = {
  approvals: Approval[];
  leads: (Lead & { id: string; created_at: string })[];
  /** Existing Sheet rows by key: what was placed, and what the owner already finished. */
  known: Map<string, SheetRow>;
};

export { approvalKey, customKey, leadKey, personKey };

/** Status words for a draft that still waits to be sent. */
export const OPEN_TASK_WORDS = new Set(["New", "Ready", "Needs Review", "Approved"]);
/** A lead nobody has written to yet. */
const OPEN_LEAD_WORDS = new Set(["New", "Queued"]);

const str = (v: unknown) => (v == null ? "" : String(v));
const handle = (platform: string, raw: unknown) => (raw ? normalizeHandle(platform as Parameters<typeof normalizeHandle>[0], String(raw)).replace(/^(@|u\/|in\/)/, "") : "");

export function profileUrl(platform: string, h: string): string | null {
  if (!h) return null;
  switch (platform) {
    case "instagram":
      return `https://www.instagram.com/${h}/`;
    case "threads":
      return `https://www.threads.com/@${h}`;
    case "reddit":
      return `https://www.reddit.com/user/${h}/`;
    case "linkedin":
      return `https://www.linkedin.com/in/${h}/`;
    case "bluesky":
      return `https://bsky.app/profile/${h}`;
    case "tiktok":
      return `https://www.tiktok.com/@${h}`;
    case "x":
      return `https://x.com/${h}`;
    case "email":
      return `mailto:${h}`;
    default:
      return null;
  }
}

/** What a pasted item's link cell says when it was pasted without a link. */
export const NO_LINK = "(pasted without a link)";

/** The LinkedIn profile mentioned in a bio or post, if any. */
export function linkedinIn(text: string): string | null {
  const m = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_%.-]+\/?/i.exec(text) ?? /linkedin\.com\/in\/([A-Za-z0-9_%.-]+)/i.exec(text);
  if (!m) return null;
  return m[0].startsWith("http") ? m[0] : `https://www.linkedin.com/in/${m[1]}/`;
}

export function agentLabel(id: string): string {
  const def = AGENTS.find((d) => d.id === id);
  return def ? agentName(def) : id;
}

/** The person, the way the owner recognises them: their name, else their handle as the platform writes it. */
export function personName(a: Approval): string {
  const m = a.meta ?? {};
  const named = str(m.name) || str(m.contact_name);
  const p = a.platform ?? "";
  const author = str(m.author) || (p === "x" || p === "tiktok" ? handleFromPost(p, a.target_url) ?? "" : "") || (p === "instagram" ? instagramHandle(a.target_url) ?? "" : "");
  const h = author ? handle(p, author) : "";
  const tag = !h ? "" : p === "reddit" ? `u/${h}` : ["instagram", "threads", "bluesky", "x", "tiktok"].includes(p) ? `@${h}` : author;
  const company = str(m.company);
  if (named) return [named, tag && tag !== named ? tag : "", company && !named.includes(company) ? company : ""].filter(Boolean).join(", ");
  if (tag) return tag;
  if (company) return company;
  // A question with no asker (Quora): the question is who it's for.
  return (str(m.post_title) || a.title.replace(/^[^:]+:\s*/, "")).slice(0, 120);
}

/**
 * Where the message goes, as a link: null when there is no such place (the
 * draft then never becomes a row), or NO_LINK for something the owner pasted
 * without one.
 */
export function sendLink(a: Approval): { url: string | null; label: string } | typeof NO_LINK | null {
  const m = a.meta ?? {};
  const p = (a.platform ?? "web") as Parameters<typeof exactPostLink>[0];
  const pasted = !a.target_url || a.target_url.startsWith("paste:");
  const post = pasted ? null : exactPostLink(p, a.target_url);
  const author = str(m.author);

  // Email: a new message to them with the draft already in it.
  const email = str(m.email);
  if (p === "email" || (a.kind === "dm" && email)) {
    const mail = emailComposeLink(email, a.body);
    if (mail) return { url: mail, label: `Email ${email}` };
    const site = str(m.source_url) || (a.target_url?.startsWith("http") ? a.target_url : "");
    return site ? { url: site, label: "Open their website" } : null;
  }

  if (a.kind === "dm" || a.kind === "connect_note") {
    switch (p) {
      case "instagram": {
        const u = instagramHandle(author) ?? instagramHandle(a.target_url);
        return u ? { url: instagramDmLink(u), label: `Message @${u} on Instagram` } : null;
      }
      case "reddit": {
        const u = handle("reddit", author);
        return u ? { url: redditMessageLink(u, a.body), label: `Message u/${u}` } : null;
      }
      case "x":
      case "tiktok": {
        const u = handle(p, author) || handleFromPost(p, a.target_url);
        return u ? { url: profileUrl(p, u), label: `Open @${u}` } : null;
      }
      case "linkedin": {
        const prof = exactProfileLink("linkedin", str(m.linkedin) || a.target_url) ?? (pasted ? linkedinIn(`${str(m.excerpt)} ${str(m.post_title)}`) : null);
        return prof ? { url: prof, label: "Open their LinkedIn" } : pasted ? NO_LINK : null;
      }
      case "alignable": {
        const prof = exactProfileLink("alignable", a.target_url);
        return prof ? { url: prof, label: "Open their profile" } : pasted ? NO_LINK : null;
      }
      default: {
        const prof = exactProfileLink(p, a.target_url) ?? post;
        return prof ? { url: prof, label: "Open" } : pasted ? NO_LINK : null;
      }
    }
  }

  // A reply or a comment goes under the exact post or comment.
  if (post) return { url: post, label: p === "hackernews" ? "Open the comment" : p === "quora" ? "Open the question" : "Open the post" };
  if (!pasted) return null;
  // Pasted without a link: their profile if we know them, else say so.
  const prof = profileUrl(p, handle(p, author));
  return prof ? { url: prof, label: "Open their profile" } : NO_LINK;
}

/** The row for one draft, on its agent's tab. None for kinds that have no tab, or with nowhere to send. */
export function approvalRows(a: Approval, s: RowSources): BuiltRow[] {
  const tabs = tabsForAgent(a.agent_id);
  if (!tabs.length) return [];
  const tab = tabs[0];
  const key = approvalKey(a.id);
  const known = s.known.get(key);
  const word = statusForApproval(a, known);
  if (!OPEN_TASK_WORDS.has(word)) return [];
  const where = sendLink(a);
  if (!where) return [];
  const cells: Cells = {
    name: personName(a),
    message: a.body,
    link: where === NO_LINK ? NO_LINK : link(where.url, where.label) || NO_LINK,
  };
  const age = Math.max(0, (Date.now() - new Date(a.created_at).getTime()) / 86400_000);
  return [{ tab, key, kind: "approval", entityId: a.id, cells, initialStatus: word, rank: Math.min(9, age), agent: agentLabel(a.agent_id), createdAt: a.created_at }];
}

/**
 * What the Message cell says for a lead nobody has written to yet and no
 * agent wrote a message for (every lead saved before 2026-10-28 has none).
 * The lead is still listed, so it can't silently drop off the Sheet.
 */
export const NEEDS_MESSAGE = "Needs a message: none was written yet, and nothing has been sent.";

/** Email statuses (leads/quality.ts EMAIL_STATUS) whose domain can't take mail: the row links to the website instead. */
const UNDELIVERABLE = new Set(["No MX Record", "No Mail Server"]);

/** Why a lead isn't on the Sheet: privacy rules, already finished, or nowhere to reach them. */
export type LeadUnlisted = "region_restricted" | "finished" | "no_link";

/** 2125550100 → 212 555 0100, exactly the digits the site showed; anything else as saved. */
export function phoneText(phone: string | null | undefined): string {
  const d = str(phone).replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `${ten.slice(0, 3)} ${ten.slice(3, 6)} ${ten.slice(6)}` : str(phone).trim();
}

/**
 * One lead's row, or the reason it has none. Every lead nobody has finished is
 * listed: with its message, or marked as needing one (NEEDS_MESSAGE). Web
 * Leads link to a new email with the message in it; Office Prospects are call
 * rows, with the phone in the Name cell and a plain email or the website as
 * the link (their message is what to say on the call, not an email body).
 * Only what was saved is shown: nothing here invents a name or a number.
 */
export function leadListing(l: Lead & { id: string; created_at: string }, s: RowSources): { row: BuiltRow } | { reason: LeadUnlisted } {
  // Europe, the UK, Switzerland, Canada and Brazil stay out of the Sheet (and every export), as before.
  if (l.region_restricted) return { reason: "region_restricted" };
  const key = leadKey(l.id);
  const known = s.known.get(key);
  if (known && !OPEN_LEAD_WORDS.has(known.status)) return { reason: "finished" };
  const office = l.list === "office";
  const written = str(l.message).trim();
  const site = l.source_url.startsWith("http") ? l.source_url : null;
  const email = l.email && !UNDELIVERABLE.has(str(l.email_status)) ? str(l.email) : "";
  const mail = email ? emailComposeLink(email, office || !written ? "" : written) : null;
  const cellLink = (mail ? link(mail, `Email ${email}`) : "") || link(site, "Open their website");
  if (!cellLink) return { reason: "no_link" };
  const tab = office ? OFFICE_PROSPECTS : LEAD_TAB_BY_SOURCE[l.source_platform] ?? WEB_LEADS;
  const who = [str(l.name), str(l.title), str(l.company)].filter(Boolean).join(", ") || (site ? new URL(site).hostname.replace(/^www\./, "") : str(l.email));
  const phone = office ? phoneText(l.phone) : "";
  const name = phone ? `${who} · ${phone}` : who;
  return { row: { tab, key, kind: "lead", entityId: l.id, cells: { name, message: written || NEEDS_MESSAGE, link: cellLink }, initialStatus: known?.status ?? "New", rank: 20, agent: tab.name, createdAt: l.created_at } };
}

/** A lead's row on its tab (Web Leads or Office Prospects), or none with the reason in leadCoverage. */
export function leadRows(l: Lead & { id: string; created_at: string }, s: RowSources): BuiltRow[] {
  const r = leadListing(l, s);
  return "row" in r ? [r.row] : [];
}

export type LeadCoverage = {
  listed: number;
  ready: number;
  needsMessage: number;
  unlisted: Record<LeadUnlisted, number>;
  /** Each lead not listed for a reason other than being finished: its id (no contact details) and why. */
  missing: { id: string; reason: LeadUnlisted }[];
};

/** Where every saved lead stands on the Sheet, in counts, so a lead never drops off without a reason on record. */
export function leadCoverage(s: RowSources): LeadCoverage {
  const out: LeadCoverage = { listed: 0, ready: 0, needsMessage: 0, unlisted: { region_restricted: 0, finished: 0, no_link: 0 }, missing: [] };
  for (const l of s.leads) {
    const r = leadListing(l, s);
    if ("reason" in r) {
      out.unlisted[r.reason]++;
      if (r.reason !== "finished") out.missing.push({ id: l.id, reason: r.reason });
      continue;
    }
    out.listed++;
    if (r.row.cells.message === NEEDS_MESSAGE) out.needsMessage++;
    else out.ready++;
  }
  return out;
}

/** Every row-based tab's rows, from the records. */
export function buildRows(s: RowSources): BuiltRow[] {
  const out: BuiltRow[] = [];
  for (const a of s.approvals) out.push(...approvalRows(a, s));
  for (const l of s.leads) out.push(...leadRows(l, s));
  // One row per key: the first builder wins.
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}

/** A stable hash of the agent-owned cells, so an unchanged row costs no write. */
export function agentHash(tab: TabSpec, cells: Cells): string {
  const parts = tab.columns.filter((col) => !col.owner && col.kind !== "key" && col.kind !== "status").map((col) => `${col.key}=${str(cells[col.key])}`);
  return createHash("sha1").update(parts.join("\u0001")).digest("hex").slice(0, 16);
}
