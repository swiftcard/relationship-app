import { createHash } from "node:crypto";
import { agentName } from "../agent-status";
import { AGENTS } from "../registry";
import { nyDay } from "../schedule";
import type { TouchedPerson } from "../store";
import type { Approval, Finding, Lead, SheetEntityKind, SheetRow } from "../types";
import { link, type CellValue } from "../google/sheets";
import { normalizeHandle } from "../ledger";
import { approvalKey, customKey, leadKey, personKey } from "./keys";
import type { TabSpec } from "./spec";
import { priorityOf, stageForPerson, statusForApproval } from "./status";
import { exactPostLink, exactProfileLink, instagramDmLink, instagramHandle, redditMessageLink } from "../exact-links";
import { BLOG, BLUESKY, COMPETITOR_INTEL, EVENTS, GEO, INSTAGRAM_DMS, INSTAGRAM_LINKEDIN_BIO, LEAD_TAB_BY_SOURCE, LINKEDIN_COMMENTS, LINKEDIN_CONNECTIONS, OFFICE_PROSPECTS, PARTNERSHIPS, PIPELINE, QUORA, REDDIT_DMS, REDDIT_REPLY, SEO, SOCIAL, WEB_LEADS, tabsForAgent } from "./tabs";

// ── A record → a row ────────────────────────────────────────────────────────
// Every row carries a Key (a short, stable id) and the cells of its tab's
// agent-owned columns. The sync writes those; the owner's columns are left
// alone (status.ts decides the Status word). Nothing here reads the network.

export type Cells = Record<string, CellValue>;

export type BuiltRow = {
  tab: TabSpec;
  key: string;
  kind: SheetEntityKind;
  entityId: string;
  cells: Cells;
  /** The Status word when the row is first written. */
  initialStatus: string;
  /** For the Action Queue: 0 = top. */
  rank: number;
  /** For the queue: the agent, in plain words. */
  agent: string;
  createdAt: string;
};

export type RowSources = {
  approvals: Approval[];
  leads: (Lead & { id: string; created_at: string })[];
  findings: Finding[];
  people: TouchedPerson[];
  facts: { competitor: string; fact: string; value: string; source_url: string; seen_at: string }[];
  geoHistory: { day: string; q: string; mentioned: boolean }[];
  /** Existing Sheet rows by key, so sticky owner statuses are respected. */
  known: Map<string, SheetRow>;
  blueskyLive: boolean;
};

export { approvalKey, customKey, leadKey, personKey };

const day = (iso: string | null | undefined) => (iso ? nyDay(new Date(iso)) : "");
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

/** Office Prospects: an email to the contact when their site shows one, else their website. */
function officeOpen(email: string, site: string | null): string {
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return link(`mailto:${email}`, `Email ${email}`);
  return link(site, "Open website");
}

/** The LinkedIn profile mentioned in a bio or post, if any. */
export function linkedinIn(text: string): string | null {
  const m = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_%.-]+\/?/i.exec(text) ?? /linkedin\.com\/in\/([A-Za-z0-9_%.-]+)/i.exec(text);
  if (!m) return null;
  return m[0].startsWith("http") ? m[0] : `https://www.linkedin.com/in/${m[1]}/`;
}

function rank(a: Approval): number {
  const p = { High: 0, Medium: 10, Low: 20 }[priorityOf(a)];
  const age = Math.max(0, (Date.now() - new Date(a.created_at).getTime()) / 86400_000);
  return p + Math.min(9, age);
}

function base(tab: TabSpec, a: Approval, cells: Cells, known: Map<string, SheetRow>): BuiltRow {
  const key = approvalKey(a.id);
  return { tab, key, kind: "approval", entityId: a.id, cells, initialStatus: statusForApproval(a, known.get(key)), rank: rank(a), agent: agentLabel(a.agent_id), createdAt: a.created_at };
}

export function agentLabel(id: string): string {
  const def = AGENTS.find((d) => d.id === id);
  return def ? agentName(def) : id;
}

const platformWord = (p: string | null) => ({ reddit: "Reddit", instagram: "Instagram", threads: "Threads", bluesky: "Bluesky", facebook: "Facebook", quora: "Quora", indiehackers: "Indie Hackers", linkedin: "LinkedIn", alignable: "Alignable", email: "Email", site: "Website", web: "Web", x: "X", hackernews: "Hacker News", tiktok: "TikTok", pinterest: "Pinterest", youtube: "YouTube" })[p ?? ""] ?? (p ?? "");

/** The row for one draft, on its agent's tab. Null for kinds that have no tab. */
export function approvalRows(a: Approval, s: RowSources): BuiltRow[] {
  const m = a.meta ?? {};
  const author = str(m.author);
  const tabs = tabsForAgent(a.agent_id);
  if (!tabs.length) return [];
  const tab = tabs[0];
  const excerpt = str(m.excerpt);
  const common: Cells = { priority: priorityOf(a), why: str(m.why), asking: str(m.angle), message: a.body, date_found: day(a.created_at) };
  // Exact links only. A social draft whose link isn't the exact post, comment
  // or person (one made before the rule, from a search result) never becomes
  // a row; one pasted without a link says so in its link cell.
  const social = ["reply", "comment", "dm", "connect_note"].includes(a.kind) && a.platform !== "email" && a.platform !== "web";
  const pasted = !a.target_url || a.target_url.startsWith("paste:");
  const p = (a.platform ?? "web") as Parameters<typeof exactPostLink>[0];
  const exact = pasted ? null : (exactPostLink(p, a.target_url) ?? exactProfileLink(p, a.target_url));
  if (social && !pasted && !exact) return [];
  /** The link cell: the exact place, or, for something pasted without a link, a plain note saying so. */
  const go = (label: string, url: string | null = exact) => link(url, label) || (pasted ? NO_LINK : "");

  switch (tab.id) {
    case REDDIT_REPLY.id:
      return [base(tab, a, { ...common, subreddit: m.community ? `r/${m.community}` : "", thread: str(m.post_title) || a.title.replace(/^Reddit[^:]*:\s*/, ""), who: author ? `u/${author}` : "", post: "(Reddit asks us not to keep post text; open the thread)", open: go("Open thread / comment") }, s.known)];
    case REDDIT_DMS.id: {
      const u = handle("reddit", author);
      return [base(tab, a, { ...common, who: u ? `u/${u}` : "", community: m.community ? `r/${m.community}` : "", post: "(Reddit asks us not to keep post text; open their post)", open: link(u ? redditMessageLink(u) : null, `Message u/${u}`), open_post: go("Their post") }, s.known)];
    }
    case INSTAGRAM_LINKEDIN_BIO.id: {
      const u = instagramHandle(author) ?? instagramHandle(a.target_url);
      return [
        base(tab, a, {
          priority: priorityOf(a),
          name: str(m.name) || (u ? `@${u}` : ""),
          occupation: str(m.occupation),
          company: str(m.company),
          username: u ? `@${u}` : "",
          profile: link(profileUrl("instagram", u ?? ""), "Profile"),
          linkedin: link(exactProfileLink("linkedin", str(m.linkedin)) ?? linkedinIn(`${excerpt} ${str(m.post_title)}`), "LinkedIn"),
          location: str(m.location),
          why: str(m.why),
          detail: str(m.angle) || excerpt.slice(0, 200),
          message: a.body,
          open: link(u ? instagramDmLink(u) : null, "Open DM (Instagram app)"),
          date_found: day(a.created_at),
        }, s.known),
      ];
    }
    case INSTAGRAM_DMS.id: {
      const u = instagramHandle(author);
      return [base(tab, a, { priority: priorityOf(a), name: str(m.name) || (u ? `@${u}` : ""), username: u ? `@${u}` : "", profile: link(profileUrl("instagram", u ?? ""), "Profile"), their_post: link(exactPostLink("instagram", a.target_url), "Their post"), post: excerpt || str(m.post_title), why: str(m.why), message: a.body, open: link(u ? instagramDmLink(u) : null, "Open DM (Instagram app)"), date_found: day(a.created_at) }, s.known)];
    }
    case LINKEDIN_COMMENTS.id:
      return [base(tab, a, { priority: priorityOf(a), name: author, occupation: str(m.occupation), topic: str(m.post_title) || excerpt.slice(0, 200), detail: str(m.angle), message: a.body, open: go("Open post"), date_found: day(a.created_at) }, s.known)];
    case LINKEDIN_CONNECTIONS.id:
      return [base(tab, a, { priority: priorityOf(a), name: str(m.name) || author, occupation: str(m.occupation), location: str(m.location), detail: str(m.angle) || excerpt.slice(0, 200), message: a.body, open: go("Open profile"), date_found: day(a.created_at) }, s.known)];
    case QUORA.id:
      return [base(tab, a, { priority: priorityOf(a), question: str(m.post_title) || a.title.replace(/^Quora[^:]*:\s*/, ""), topic: str(m.angle), why: str(m.why), message: a.body, open: go("Open question"), date_found: day(a.created_at) }, s.known)];
    case BLUESKY.id:
      return [base(tab, a, { priority: priorityOf(a), who: author ? `@${author}` : "", post: excerpt || str(m.post_title), why: str(m.why), message: a.body, open: go("Open post"), method: s.blueskyLive ? "Approval posts it (set Status to Approved)" : "Copy & open (Approval posts it once Bluesky is connected and Dry run is off)", date_found: day(a.created_at) }, s.known)];
    case SEO.id: {
      const f = s.findings.find((x) => x.id === m.finding_id);
      const d = (f?.detail ?? {}) as { url?: string; problems?: string[] };
      const url = d.url ?? "";
      return [base(tab, a, { priority: priorityOf(a), keyword: "", intent: "", page: url.replace(/^https?:\/\/swiftcard\.me/, "") || "/", ranking: "", competitor: "", problem: (d.problems ?? []).join("; ") || a.title.replace(/^Fix:\s*/, ""), fix: triageNotes(a.body), meta: "", evidence: a.summary, open: link(url, "Open page"), date_checked: day(a.created_at) }, s.known)];
    }
    case GEO.id:
      return [base(tab, a, { platform: "Site change", question: "", mentioned: "", competitors: "", citation: "", problem: a.title.replace(/^Fix:\s*/, ""), fix: triageNotes(a.body), page: str(((s.findings.find((x) => x.id === m.finding_id)?.detail ?? {}) as { url?: string }).url) || "/", date_tested: day(a.created_at) }, s.known)];
    case BLOG.id:
      return [base(tab, a, { priority: "Medium", platform: "Blog", type: "Article", topic: a.title.replace(/^Blog:\s*/, ""), hook: str(m.description), caption: str(m.description), script: a.body, asset: "", hashtags: "", cta: "Approved = goes live at swiftcard.me/blog", publishing: a.status === "done" ? "Published" : "Not published", signups: "" }, s.known)];
    case SOCIAL.id: {
      const step = Number(m.step ?? 1);
      const images = (m.images as { key: string; url: string }[] | undefined) ?? [];
      return [base(tab, a, { priority: "Medium", platform: "LinkedIn, Instagram, Threads, TikTok, Pinterest, YouTube, Reddit, Alignable", type: step === 1 ? "Pick 1 of 3 options" : "Image / slideshow + captions", topic: a.title.replace(/^Social:\s*/, ""), hook: step === 1 ? "Type 1, 2 or 3 in Notes, then set Approval Status to Approved" : "Download the pictures, post with the caption, set it to Sent / Posted", caption: step === 2 ? a.body : "", script: step === 1 ? a.body : "", asset: link(images[0]?.url, images.length ? `${images.length} pictures` : ""), hashtags: "", cta: "", publishing: a.status === "done" ? "Posted by you" : "Not posted", signups: "" }, s.known)];
    }
    case PARTNERSHIPS.id:
      if (a.kind !== "dm") return [];
      return [base(tab, a, { org: str(m.org) || a.title.replace(/^Partner:\s*/, ""), industry: str(m.industry), contact: str(m.contact_name), opportunity: str(m.opportunity), why: str(m.why), proposal: str(m.proposal), message: a.body, open: link(a.target_url, "Contact page") }, s.known)];
    case EVENTS.id:
      return [base(tab, a, { name: str(m.event_name) || a.title.replace(/^Event:\s*/, ""), location: str(m.location), date: str(m.date), audience: str(m.audience), cost: str(m.cost), why: str(m.why) || a.summary, organizer: str(m.organizer), open: link(a.target_url, "Event page"), action: a.body }, s.known)];
    case COMPETITOR_INTEL.id:
      return [base(tab, a, { competitor: "Several", change: a.title.replace(/^Fix:\s*/, ""), source: "", date: day(a.created_at), why: a.summary, opportunity: "", action: a.body }, s.known)];
    case OFFICE_PROSPECTS.id: {
      if (a.kind !== "dm") return [];
      const name = str(m.name) || /Office email to ([^(]+)/.exec(a.title)?.[1]?.trim() || "";
      return [base(tab, a, { company: str(m.company), type: str(m.business_type), name, title: str(m.title), phone: str(m.phone), email: str(m.email), talking_point: str(m.talking_point), message: a.body, open: officeOpen(str(m.email), str(m.source_url)) }, s.known)];
    }
    default: {
      // The shared social layout (Threads, Facebook, Indie Hackers, Alignable, Instagram comments, Hacker News).
      const who = author ? (p === "instagram" || p === "threads" || p === "bluesky" ? `@${handle(p, author)}` : author) : "";
      // A pasted post with no link opens the author's profile when there is one; otherwise the cell says it was pasted.
      const where = exact ?? (pasted ? profileUrl(p, handle(p, author)) : null);
      return [base(tab, a, { ...common, who, community: str(m.community), post: excerpt || str(m.post_title), open: go(p === "hackernews" ? "Open comment" : a.kind === "dm" ? "Open profile" : "Open post", where) }, s.known)];
    }
  }
}

function triageNotes(body: string): string {
  const i = body.indexOf("Triage notes:");
  return (i >= 0 ? body.slice(i + "Triage notes:".length) : body).trim().slice(0, 2000);
}

export function leadRows(l: Lead & { id: string; created_at: string }, s: RowSources): BuiltRow[] {
  // Europe, the UK, Switzerland, Canada and Brazil stay out of the Sheet (and every export), as before.
  if (l.region_restricted) return [];
  const key = leadKey(l.id);
  const known = s.known.get(key);
  const site = l.source_url.startsWith("http") ? l.source_url : null;
  let host = "";
  try {
    host = site ? new URL(site).hostname.replace(/^www\./, "") : "";
  } catch {
    /* pasted source */
  }
  if (l.list === "office") {
    return [{ tab: OFFICE_PROSPECTS, key, kind: "lead", entityId: l.id, cells: { company: str(l.company), type: str(l.business_type), name: str(l.name), title: str(l.title), phone: str(l.phone), email: str(l.email), talking_point: [str(l.notes), l.hook ? `Detail to mention: ${l.hook}` : ""].filter(Boolean).join("\n\n"), message: str(l.message), open: officeOpen(str(l.email), site), date_found: day(l.created_at) }, initialStatus: known?.status ?? "New", rank: 30, agent: agentLabel("office-outreach"), createdAt: l.created_at }];
  }
  return [{
    tab: LEAD_TAB_BY_SOURCE[l.source_platform] ?? WEB_LEADS,
    key,
    kind: "lead",
    entityId: l.id,
    cells: {
      // Leads saved before scoring keep blank cells, so their rows are never rewritten.
      score: l.score ?? "",
      name: [str(l.name), str(l.title)].filter(Boolean).join(", "),
      business: str(l.company),
      industry: str(l.business_type),
      city: str(l.city),
      state: str(l.region),
      email: str(l.email),
      email_status: l.email_status || (l.email ? "Risky" : "None"),
      phone: str(l.phone),
      website: link(site && l.source_platform === "web" ? `https://${host}` : null, host),
      source_platform: platformWord(l.source_platform),
      source_link: link(site, "Source"),
      why: str(l.why),
      // Web Leads has no message column: the opening line rides with the hook.
      hook: [str(l.hook), l.message ? `Opener: ${l.message}` : ""].filter(Boolean).join("\n\n"),
      date_found: day(l.created_at),
    },
    initialStatus: known?.status ?? "New",
    rank: 40,
    agent: (LEAD_TAB_BY_SOURCE[l.source_platform] ?? WEB_LEADS).name,
    createdAt: l.created_at,
  }];
}

export function personRows(p: TouchedPerson, s: RowSources): BuiltRow[] {
  const key = personKey(p.id);
  const known = s.known.get(key);
  const real = p.touches.filter((t) => t.kind !== "lead_listed" && t.kind !== "dm_drafted");
  if (!real.length) return [];
  const first = real[0];
  const last = real[real.length - 1];
  const ident = p.identities[0];
  const h = ident ? ident.handle_norm.replace(/^(@|u\/|in\/)/, "") : "";
  const lastApproval = s.approvals.find((a) => a.id === last.approval_id) ?? s.approvals.find((a) => a.person_id === p.id && a.status === "done");
  return [{
    tab: PIPELINE,
    key,
    kind: "custom",
    entityId: p.id,
    cells: {
      who: p.display_name || (ident ? ident.handle_norm : "someone"),
      platform: platformWord(ident?.platform ?? last.platform),
      company: str(lastApproval?.meta?.company),
      first_contact: day(first.at),
      last_touch: day(last.at),
      last_message: lastApproval?.body ?? "",
      open: link(lastApproval?.target_url?.startsWith("http") ? lastApproval.target_url : profileUrl(ident?.platform ?? "", h), "Open"),
    },
    initialStatus: stageForPerson(real, known),
    rank: 50,
    agent: "Pipeline",
    createdAt: first.at,
  }];
}

export function factRows(s: RowSources): BuiltRow[] {
  const NAME: Record<string, string> = { hihello: "HiHello", blinq: "Blinq", popl: "Popl", linkme: "Link.me", linktree: "Linktree", hoobe: "Hoobe" };
  return s.facts.map((f) => {
    const key = customKey("C", `${f.competitor}:${f.fact}`);
    return { tab: COMPETITOR_INTEL, key, kind: "custom" as const, entityId: `${f.competitor}:${f.fact}`, cells: { competitor: NAME[f.competitor] ?? f.competitor, change: `${f.fact.replace(/_/g, " ")}: ${f.value}`, source: link(f.source_url, "Source"), date: day(f.seen_at), why: "", opportunity: "", action: "" }, initialStatus: s.known.get(key)?.status ?? "New", rank: 60, agent: agentLabel("competitor-watch"), createdAt: f.seen_at };
  });
}

export function geoRows(s: RowSources): BuiltRow[] {
  return s.geoHistory.map((h) => {
    const key = customKey("G", `${h.day}:${h.q}`);
    return { tab: GEO, key, kind: "custom" as const, entityId: `${h.day}:${h.q}`, cells: { platform: "Claude with web search", question: h.q, mentioned: h.mentioned ? "Yes" : "No", competitors: "", citation: "", problem: h.mentioned ? "" : "SwiftCard was not named in the answer", fix: h.mentioned ? "" : "See the site changes proposed below (llms.txt, structured data, FAQ answers)", page: "", date_tested: h.day }, initialStatus: s.known.get(key)?.status ?? (h.mentioned ? "Completed" : "New"), rank: 70, agent: agentLabel("marketing-geo"), createdAt: `${h.day}T12:00:00Z` };
  });
}

/** Every row-based tab's rows, from the records. */
export function buildRows(s: RowSources): BuiltRow[] {
  const out: BuiltRow[] = [];
  for (const a of s.approvals) out.push(...approvalRows(a, s));
  for (const l of s.leads) out.push(...leadRows(l, s));
  for (const p of s.people) out.push(...personRows(p, s));
  out.push(...factRows(s), ...geoRows(s));
  // One row per key: the first builder wins.
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}

/** A stable hash of the agent-owned cells, so an unchanged row costs no write. */
export function agentHash(tab: TabSpec, cells: Cells): string {
  const parts = tab.columns.filter((col) => !col.owner && col.kind !== "key" && col.kind !== "status").map((col) => `${col.key}=${str(cells[col.key])}`);
  return createHash("sha1").update(parts.join("\u0001")).digest("hex").slice(0, 16);
}
