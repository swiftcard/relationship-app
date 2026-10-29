import { KEY_COLUMN, TASK_STATUSES, c, linkCol, longCol, messageCol, type TabSpec } from "./spec";

// ── Every tab of the SwiftCard Leads workbook ───────────────────────────────
// The owner, 2026-10-29: "I just want you to give me the person's name, the
// message to either write to them or reply to them, a link directly to where
// they literally just paste the message and send it. I only want those three
// things." So every agent tab is exactly Name, Message, Link (plus the Key the
// sync finds a row by, hidden), one tab per agent, named after it. Send it,
// then delete the row: a deleted row counts as sent and never comes back.
//
// Paste a Post is the one other tab: Facebook groups, Alignable and Instagram
// can't be searched, so the owner pastes a post there and the right agent
// writes the reply. The Dashboard, queues, pipeline, stats, Controls and logs
// were removed the same day (owner's choice); Start, Stop and Pause all live
// in admin → Agents.

const TASK = [...TASK_STATUSES];

/** The three columns the owner asked for, and the hidden Key. */
export const SEND_COLUMNS: TabSpec["columns"] = [
  c("name", "Name", { width: 180 }),
  messageCol("Message"),
  linkCol("link", "Link", 200),
  KEY_COLUMN,
];

/** A tab of things to send: name, message, link. */
const send = (o: { id: string; name: string; agent: string; description: string; color: string }): TabSpec => ({
  id: o.id,
  name: o.name,
  group: "agent",
  layout: "rows",
  agents: [o.agent],
  description: `${o.description} Copy the message, tap the link, paste, send. Then delete the row: a deleted row counts as sent and never comes back.`,
  columns: SEND_COLUMNS,
  statuses: TASK,
  color: o.color,
});

// ── The one input tab ───────────────────────────────────────────────────────

export const PASTE: TabSpec = {
  id: "paste",
  name: "Paste a Post",
  group: "operating",
  layout: "input",
  agents: ["replies-facebook", "contact-alignable", "replies-instagram"],
  description: "For places the agents can't search on their own (Facebook groups, Alignable, Instagram): paste a post or a profile here with its link, and the right agent writes the message on its next run. Taken means an agent picked it up.",
  columns: [
    c("platform", "Platform", { width: 110, owner: true, note: "facebook, alignable, instagram, linkedin, threads, bluesky, quora, indiehackers, reddit, x, tiktok or web" }),
    c("url", "Link", { width: 220, owner: true }),
    c("kind", "What is it", { width: 100, owner: true, note: "post, profile or page" }),
    longCol("text", "The Text", 420, { owner: true }),
    c("taken", "Taken", { width: 130 }),
  ],
  statuses: [],
  color: "795548",
};

export const OPERATING_TABS: TabSpec[] = [PASTE];

// ── X ───────────────────────────────────────────────────────────────────────
export const X_REPLIES = send({ id: "x-replies", name: "X Replies", agent: "replies-x", description: "Posts on X where someone is talking about business cards, link in bio pages or following up with leads. The link opens their post; tap Reply.", color: "000000" });
export const X_DMS = send({ id: "x-dms", name: "X Outreach", agent: "contact-x", description: "People on X who'd use SwiftCard, each with a direct message about something they posted. The link opens their profile; tap the message button.", color: "000000" });

// ── Reddit ──────────────────────────────────────────────────────────────────
export const REDDIT_REPLY = send({ id: "reddit-reply", name: "Reddit Reply", agent: "replies-reddit", description: "Reddit threads where a real answer helps. The link opens the exact post or comment; tap Reply.", color: "ff4500" });
export const REDDIT_DMS = send({ id: "reddit-dms", name: "Reddit DMs", agent: "contact-reddit", description: "People on Reddit asking for a card or link page tool. The link opens Reddit's message screen already addressed to them, with the message filled in.", color: "ff4500" });

// ── Facebook ────────────────────────────────────────────────────────────────
export const FACEBOOK = send({ id: "facebook", name: "Facebook Groups", agent: "replies-facebook", description: "Replies to Facebook group posts you pasted into Paste a Post. The link opens the post; tap Comment.", color: "1877f2" });

// ── Instagram ───────────────────────────────────────────────────────────────
export const INSTAGRAM_DMS = send({ id: "instagram-dms", name: "Instagram DMs", agent: "contact-instagram", description: "Business owners on Instagram, each with a message about something they posted. The link opens your chat with them in the Instagram app.", color: "e1306c" });
export const INSTAGRAM_LINKEDIN_BIO = send({ id: "instagram-linkedin-bio", name: "Instagram LinkedIn Bio", agent: "contact-instagram-linkinbio", description: "Professionals whose Instagram bio links to their LinkedIn, each with a message built on their bio. The link opens your chat with them in the Instagram app.", color: "e1306c" });
export const INSTAGRAM_COMMENTS = send({ id: "instagram-comments", name: "Instagram Comments", agent: "replies-instagram", description: "Comments on business owners' Instagram posts. The link opens the post; tap the comment box.", color: "e1306c" });

// ── TikTok ──────────────────────────────────────────────────────────────────
export const TIKTOK_COMMENTS = send({ id: "tiktok-comments", name: "TikTok Comments", agent: "replies-tiktok", description: "Comments on TikTok videos about networking, business cards or link in bio pages. The link opens the video; tap the comment box.", color: "010101" });
export const TIKTOK_DMS = send({ id: "tiktok-dms", name: "TikTok Outreach", agent: "contact-tiktok", description: "Business owners on TikTok who'd use SwiftCard, each with a message about a video they made. The link opens their profile; tap Message (TikTok messages open in the app).", color: "010101" });

// ── LinkedIn ────────────────────────────────────────────────────────────────
export const LINKEDIN_COMMENTS = send({ id: "linkedin-comments", name: "LinkedIn Comments", agent: "replies-linkedin", description: "Comments on specific LinkedIn posts by business professionals. The link opens the post; tap Comment.", color: "0a66c2" });
export const LINKEDIN_CONNECTIONS = send({ id: "linkedin-connections", name: "LinkedIn Connections", agent: "contact-linkedin", description: "Professionals to connect with, each with a connection note under 200 characters. The link opens their profile; tap Connect, then Add a note.", color: "0a66c2" });

// ── Everywhere else people ask ──────────────────────────────────────────────
export const THREADS = send({ id: "threads", name: "Threads Replies", agent: "replies-threads", description: "Threads posts where a short, warm reply helps. The link opens the post; tap Reply.", color: "000000" });
export const BLUESKY = send({ id: "bluesky", name: "Bluesky Replies", agent: "replies-bluesky", description: "Bluesky posts where a reply helps. The link opens the post; tap Reply.", color: "1185fe" });
export const QUORA = send({ id: "quora", name: "Quora Answers", agent: "replies-quora", description: "Quora questions about business cards, link in bio tools and following up with leads. The link opens the question; tap Answer.", color: "b92b27" });
export const INDIE_HACKERS = send({ id: "indiehackers", name: "Indie Hackers", agent: "replies-indiehackers", description: "Indie Hackers threads about cards, link pages and personal branding. The link opens the thread; tap Reply.", color: "4f46e5" });
export const HACKER_NEWS = send({ id: "hackernews", name: "Hacker News", agent: "replies-hackernews", description: "Hacker News discussions about business cards, networking follow ups and link pages. The link opens the exact comment with its own reply box.", color: "ff6600" });
export const ALIGNABLE = send({ id: "alignable", name: "Alignable", agent: "contact-alignable", description: "Messages to Alignable profiles you pasted into Paste a Post. The link opens their profile; tap Message.", color: "d32f2f" });

// ── Email ───────────────────────────────────────────────────────────────────
export const WEB_LEADS = send({ id: "web-leads", name: "Web Leads", agent: "leads-web", description: "Businesses (real estate offices, insurance agencies, contractors and more, city by city) with the email their own website publishes. The link opens a new email to them with the message already in it.", color: "34a853" });
export const OFFICE_PROSPECTS = send({ id: "office-prospects", name: "Office Prospects", agent: "office-outreach", description: "Teams in New York with several agents or salespeople, for SwiftCard Office. The link opens a new email to the person with the message already in it (or their website when it shows no email).", color: "3f51b5" });

export const AGENT_TABS: TabSpec[] = [
  X_REPLIES,
  X_DMS,
  REDDIT_REPLY,
  REDDIT_DMS,
  FACEBOOK,
  INSTAGRAM_DMS,
  INSTAGRAM_LINKEDIN_BIO,
  INSTAGRAM_COMMENTS,
  TIKTOK_COMMENTS,
  TIKTOK_DMS,
  LINKEDIN_COMMENTS,
  LINKEDIN_CONNECTIONS,
  THREADS,
  BLUESKY,
  QUORA,
  INDIE_HACKERS,
  HACKER_NEWS,
  ALIGNABLE,
  WEB_LEADS,
  OFFICE_PROSPECTS,
];

export const ALL_TABS: TabSpec[] = [...AGENT_TABS, ...OPERATING_TABS];

/**
 * Tabs earlier versions of the workbook had and this one doesn't. The sync
 * deletes them from the workbook once (bootstrap.ts); only these names, so a
 * tab the owner added by hand is never touched. Their rows stay in the
 * database, and the daily snapshot kept dated copies.
 */
export const RETIRED_TAB_NAMES = [
  "Dashboard", "Today - Top 50", "Today - Action Queue", "All Leads", "Intent Leads", "Pipeline", "Meetings",
  "Source Stats", "Agent Performance", "Controls", "Activity Log", "Suppression List",
  "Partnerships", "Events", "SEO Opportunities", "GEO Opportunities", "Social Media", "Blog Writer", "Competitor Intel",
  "Reddit Leads", "Quora Leads", "Facebook Group Leads", "Alignable Leads",
];

export function tabById(id: string): TabSpec | undefined {
  return ALL_TABS.find((t) => t.id === id);
}

export function tabByName(name: string): TabSpec | undefined {
  return ALL_TABS.find((t) => t.name === name);
}

/** The agent's own tab (one per agent), or none (the Watchdog, its manager, the Sheet keepers). */
export function tabsForAgent(agentId: string): TabSpec[] {
  return AGENT_TABS.filter((t) => t.agents.includes(agentId) && t.layout === "rows");
}

/** The lead agent whose tab a lead belongs on. Only Web Leads finds leads now (2026-10-29). */
export const LEAD_TAB_BY_SOURCE: Record<string, TabSpec> = { web: WEB_LEADS };
