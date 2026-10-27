import { KEY_COLUMN, PIPELINE_STATUSES, TASK_STATUSES, c, dateCol, linkCol, longCol, messageCol, notes, status, type TabSpec } from "./spec";

// ── Every tab of the SwiftCard Leads workbook ───────────────────────────────
// Twelve operating tabs first (the spec's list, in its order), then exactly
// one tab per marketing or outreach agent, named after the agent (the admin
// page's Start / Stop list uses the same name), each with columns for that
// agent's job. A new agent gets a tab by adding a spec here with its id in
// `agents`; tests/crew-sheets pins one tab per agent and one agent per tab.

const TASK = [...TASK_STATUSES];
const PIPE = [...PIPELINE_STATUSES];
const priority = () => c("priority", "Priority", { width: 80, note: "High: act today. Medium: this week. Low: when you have time." });

// ── Operating tabs ──────────────────────────────────────────────────────────

export const DASHBOARD: TabSpec = {
  id: "dashboard",
  name: "Dashboard",
  group: "operating",
  layout: "free",
  agents: [],
  description: "Your daily overview: what the agents found, what waits for you, and whether anything is broken. Rebuilt every 15 minutes.",
  columns: [],
  statuses: [],
  color: "1a73e8",
};

export const LEAD_COLUMNS = [
  c("score", "Score", { kind: "number", width: 60, note: "0 to 100. Green 80+, yellow 60 to 79, grey below." }),
  c("name", "Name", { width: 150 }),
  c("business", "Business", { width: 180 }),
  c("industry", "Industry", { width: 140 }),
  c("city", "City", { width: 110 }),
  c("state", "State", { width: 60 }),
  c("email", "Email", { width: 200 }),
  c("email_status", "Email Status", { width: 100, note: "Verified: the address is on their own site and its domain accepts mail. Risky: one of those is missing. None: no email." }),
  c("phone", "Phone", { width: 120 }),
  linkCol("website", "Website", 120),
  c("source_platform", "Source Platform", { width: 110 }),
  linkCol("source_link", "Source Link", 110),
  longCol("why", "Why They Fit", 260),
  longCol("hook", "Personal Hook", 260),
  status({ options: PIPE, note: "Not Interested or Unsubscribed stops every agent from contacting them again." }),
  dateCol("date_found", "Date Found"),
  dateCol("last_contacted", "Last Contacted", true),
  c("next_step", "Next Step", { owner: true, width: 160 }),
  notes(),
  KEY_COLUMN,
];

export const TOP50: TabSpec = {
  id: "top50",
  name: "Today - Top 50",
  group: "operating",
  layout: "derived",
  agents: [],
  description: "The 50 best leads found today, highest score first. Same rows as All Leads; a Status you set here shows there too.",
  columns: LEAD_COLUMNS,
  statuses: PIPE,
  color: "34a853",
};

export const QUEUE: TabSpec = {
  id: "queue",
  name: "Today - Action Queue",
  group: "operating",
  layout: "derived",
  agents: [],
  description: "Start here each day. Every message or task waiting for you, from every agent, most important first. Copy the message, open the link, send it, set Status to Sent / Posted. The same row lives on its agent's tab; a Status set here or there is one and the same.",
  columns: [
    priority(),
    c("agent", "Agent", { width: 150 }),
    c("platform", "Platform", { width: 90 }),
    c("who", "Person / Opportunity", { width: 220 }),
    longCol("why", "Why It Matters", 260),
    messageCol("Message / Action"),
    linkCol("open", "Open Exact Destination", 170),
    status({ options: TASK }),
    dateCol("added", "Date Added"),
    c("origin", "Original Agent Tab / Row", { width: 200 }),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "ea4335",
};

export const ALL_LEADS: TabSpec = {
  id: "all-leads",
  name: "All Leads",
  group: "operating",
  layout: "derived",
  agents: [],
  description: "Every lead from every lead agent (Web Leads, Reddit Leads, Quora Leads, the paste agents), newest first, rebuilt every 15 minutes. A Status set here is the same Status as on the agent's own tab. No agent emails anyone from this list.",
  columns: LEAD_COLUMNS,
  statuses: PIPE,
  color: "34a853",
};

export const INTENT: TabSpec = {
  id: "intent",
  name: "Intent Leads",
  group: "operating",
  layout: "derived",
  agents: [],
  description: "People who publicly asked for exactly what SwiftCard does (a card app, a Linktree alternative, a way to follow up). Their post and a reply are on the agent's tab; this is the short list.",
  columns: [
    priority(),
    c("platform", "Platform", { width: 90 }),
    c("who", "Person", { width: 160 }),
    longCol("said", "What They Said", 320),
    longCol("why", "Why It's Intent", 220),
    messageCol("Suggested Response"),
    linkCol("open", "Open Post", 120),
    status({ options: TASK }),
    dateCol("date_found", "Date Found"),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "fbbc04",
};

export const PIPELINE: TabSpec = {
  id: "pipeline",
  name: "Pipeline",
  group: "operating",
  layout: "rows",
  agents: [],
  description: "Everyone a message was sent to, and how far they got. Move the Status as things happen; Meeting and Customer are yours to set.",
  columns: [
    c("who", "Person", { width: 170 }),
    c("platform", "Platform", { width: 90 }),
    c("company", "Company", { width: 160 }),
    status({ header: "Stage", options: PIPE, note: "Contacted → Replied → Meeting → Customer. Not Interested or Unsubscribed stops every agent." }),
    dateCol("first_contact", "First Contact"),
    dateCol("last_touch", "Last Touch"),
    longCol("last_message", "Last Message", 300),
    linkCol("open", "Open", 110),
    c("next_step", "Next Step", { owner: true, width: 160 }),
    notes(),
    KEY_COLUMN,
  ],
  statuses: PIPE,
  color: "9c27b0",
};

export const MEETINGS: TabSpec = {
  id: "meetings",
  name: "Meetings",
  group: "operating",
  layout: "input",
  agents: [],
  description: "Every booked meeting with its context. Booked meetings arrive here from the calendar once it is connected; you can also type one in.",
  columns: [
    c("name", "Prospect Name", { width: 160, owner: true }),
    c("company", "Company", { width: 150, owner: true }),
    c("industry", "Industry", { width: 120, owner: true }),
    c("when", "Date and Time", { width: 150, owner: true }),
    c("link", "Meeting Link", { width: 160, owner: true }),
    c("source", "Lead Source", { width: 110 }),
    c("score", "Lead Score", { width: 80 }),
    longCol("conversation", "Original Conversation", 280),
    longCol("reason", "Reason for Interest", 220),
    longCol("questions", "Important Questions", 220),
    longCol("prep", "Preparation Notes", 260, { owner: true }),
    status({ options: ["Scheduled", "Done", "No-show", "Rescheduled", "Cancelled"] }),
    KEY_COLUMN,
  ],
  statuses: ["Scheduled", "Done", "No-show", "Rescheduled", "Cancelled"],
  color: "00acc1",
};

export const SOURCE_STATS: TabSpec = {
  id: "source-stats",
  name: "Source Stats",
  group: "operating",
  layout: "derived",
  agents: [],
  description: "Where leads and replies come from, and what each source turned into. Rebuilt every 15 minutes.",
  columns: [
    c("source", "Source", { width: 140 }),
    c("leads_today", "Leads Today", { kind: "number", width: 90 }),
    c("leads_7d", "Leads 7 Days", { kind: "number", width: 90 }),
    c("leads_all", "Leads All Time", { kind: "number", width: 100 }),
    c("drafts_7d", "Drafts 7 Days", { kind: "number", width: 90 }),
    c("sent_7d", "Sent 7 Days", { kind: "number", width: 90 }),
    c("replied", "Replied", { kind: "number", width: 80 }),
    c("meetings", "Meetings", { kind: "number", width: 80 }),
    c("customers", "Customers", { kind: "number", width: 80 }),
    c("reply_rate", "Reply Rate", { width: 80 }),
  ],
  statuses: [],
  color: "607d8b",
};

export const PERFORMANCE: TabSpec = {
  id: "performance",
  name: "Agent Performance",
  group: "operating",
  layout: "derived",
  agents: [],
  description: "What each agent found, prepared and cost, and what it led to. Rebuilt every 15 minutes.",
  columns: [
    c("agent", "Agent", { width: 170 }),
    c("tab", "Tab", { width: 150 }),
    c("state", "State", { width: 110 }),
    c("leads", "Leads Found 7d", { kind: "number", width: 100 }),
    c("prepared", "Tasks Prepared 7d", { kind: "number", width: 110 }),
    c("sent", "Sent / Posted 7d", { kind: "number", width: 100 }),
    c("replies", "Replies", { kind: "number", width: 70 }),
    c("positive", "Positive Replies", { kind: "number", width: 100 }),
    c("meetings", "Meetings", { kind: "number", width: 80 }),
    c("customers", "New Customers", { kind: "number", width: 100 }),
    c("conversion", "Conversion", { width: 90 }),
    c("cost_7d", "Cost 7d ($)", { kind: "number", width: 90 }),
    c("cost_per_lead", "Cost per Lead ($)", { kind: "number", width: 110 }),
    c("failed", "Failed Runs 7d", { kind: "number", width: 100 }),
    c("last_ok", "Last Successful Run", { width: 150 }),
  ],
  statuses: [],
  color: "607d8b",
};

export const CONTROLS: TabSpec = {
  id: "controls",
  name: "Controls",
  group: "operating",
  layout: "input",
  agents: [],
  description: "The switches. Change only the Value column; everything else is written by the backend. A change takes effect within seconds (or 15 minutes if the Sheet's script isn't installed). The backend checks every value; a bad one is put back.",
  columns: [
    c("setting", "Setting", { width: 240 }),
    c("value", "Value", { width: 140, owner: true }),
    longCol("what", "What It Does", 420),
    c("allowed", "Allowed Values", { width: 200 }),
    c("changed", "Last Changed", { width: 150 }),
    c("ckey", "Key", { kind: "key", width: 150 }),
  ],
  statuses: [],
  color: "ff6d00",
};

export const ACTIVITY: TabSpec = {
  id: "activity",
  name: "Activity Log",
  group: "operating",
  layout: "derived",
  agents: [],
  description: "The last 500 things that happened: every status change, everything sent or posted (real or simulated), every failure. The full history stays in the database.",
  columns: [
    c("at", "When", { width: 150 }),
    c("agent", "Agent", { width: 150 }),
    c("platform", "Platform", { width: 90 }),
    c("action", "Action", { width: 110 }),
    c("target", "Recipient / Target", { width: 220 }),
    longCol("message", "Exact Message", 320),
    c("result", "Result", { width: 90 }),
    c("error", "Error", { width: 200 }),
    c("row", "Related Row", { width: 100 }),
    c("by", "Approved By", { width: 160 }),
  ],
  statuses: [],
  color: "9e9e9e",
};

export const SUPPRESSION: TabSpec = {
  id: "suppression",
  name: "Suppression List",
  group: "operating",
  layout: "input",
  agents: [],
  description: "Nobody on this list is ever contacted again, by any agent. Add a row yourself (an email, an @domain, or platform:handle like instagram:@name) and it is picked up within 15 minutes. Rows the system added can't be removed from here.",
  columns: [
    c("value", "Email, @domain or platform:handle", { width: 260, owner: true }),
    c("channel", "Channel", { width: 100 }),
    c("reason", "Reason", { width: 220, owner: true }),
    c("source", "Added By", { width: 110 }),
    c("added", "Added", { width: 130 }),
  ],
  statuses: [],
  color: "b71c1c",
};

export const PASTE: TabSpec = {
  id: "paste",
  name: "Paste a Post",
  group: "operating",
  layout: "input",
  agents: ["replies-facebook", "contact-alignable", "replies-instagram", "leads-facebook", "leads-alignable"],
  description: "For places the agents can't read on their own (Facebook groups, Alignable, Instagram, LinkedIn): paste a post or a profile here, with the person's name or handle, and the right agent drafts from it on its next run. Taken means an agent picked it up.",
  columns: [
    c("platform", "Platform", { width: 110, owner: true, note: "facebook, alignable, instagram, linkedin, threads, bluesky, quora, indiehackers, reddit or web" }),
    c("url", "Link (optional)", { width: 220, owner: true }),
    c("kind", "What is it", { width: 100, owner: true, note: "post, profile or page" }),
    longCol("text", "The Text", 420, { owner: true }),
    c("taken", "Taken", { width: 130 }),
  ],
  statuses: [],
  color: "795548",
};

export const OPERATING_TABS: TabSpec[] = [DASHBOARD, TOP50, QUEUE, ALL_LEADS, INTENT, PIPELINE, MEETINGS, SOURCE_STATS, PERFORMANCE, CONTROLS, ACTIVITY, SUPPRESSION, PASTE];

// ── Agent tabs: one per agent, named after it ───────────────────────────────

const social = (o: { id: string; name: string; agent: string; description: string; who: string; postHeader?: string; messageHeader?: string; openHeader: string; color: string; extra?: TabSpec["columns"] }): TabSpec => ({
  id: o.id,
  name: o.name,
  group: "agent",
  layout: "rows",
  agents: [o.agent],
  description: o.description,
  columns: [
    priority(),
    c("who", o.who, { width: 150 }),
    c("community", "Where", { width: 120 }),
    longCol("post", o.postHeader ?? "Original Post", 320),
    longCol("asking", "What They're Asking", 200),
    longCol("why", "Why It's Relevant", 220),
    messageCol(o.messageHeader ?? "Suggested Reply"),
    linkCol("open", o.openHeader, 170),
    ...(o.extra ?? []),
    status({ options: TASK }),
    dateCol("date_found", "Date Found"),
    dateCol("date_posted", "Date Posted", true),
    c("engagement", "Upvotes / Engagement", { width: 110, owner: true }),
    notes(),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: o.color,
});

const leadTab = (o: { id: string; name: string; agent: string; description: string; color: string }): TabSpec => ({ id: o.id, name: o.name, group: "agent", layout: "rows", agents: [o.agent], description: o.description, columns: LEAD_COLUMNS, statuses: PIPE, color: o.color });

export const INSTAGRAM_LINKEDIN_BIO: TabSpec = {
  id: "instagram-linkedin-bio",
  name: "Instagram LinkedIn Bio",
  group: "agent",
  layout: "rows",
  agents: ["contact-instagram-linkinbio"],
  description: "Professionals whose Instagram bio links to their LinkedIn, each with a short message built on their bio. Copy the message, tap Open Instagram (it opens the chat with them in the Instagram app on your phone), paste, send, set Status to Sent / Posted. On a computer, use the profile link and tap Message.",
  columns: [
    priority(),
    c("name", "Name", { width: 150 }),
    c("occupation", "Occupation", { width: 130 }),
    c("company", "Company", { width: 150 }),
    c("username", "Instagram Username", { width: 140 }),
    linkCol("profile", "Instagram Profile", 130),
    linkCol("linkedin", "LinkedIn Profile", 130),
    c("location", "Location", { width: 120 }),
    longCol("why", "Reason They're a Fit", 240),
    longCol("detail", "Personalization Detail", 240),
    messageCol("Message to Send"),
    linkCol("open", "Open Instagram", 170),
    status({ options: TASK }),
    dateCol("date_found", "Date Found"),
    dateCol("date_contacted", "Date Contacted", true),
    notes(),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "e1306c",
};

export const INSTAGRAM_DMS: TabSpec = {
  id: "instagram-dms",
  name: "Instagram DMs",
  group: "agent",
  layout: "rows",
  agents: ["contact-instagram"],
  description: "Business professionals on Instagram, each with a message about a post they made. Copy, tap Open Instagram (opens the chat with them in the Instagram app), paste, send, set Status to Sent / Posted. Their Post opens the post the message talks about.",
  columns: [
    priority(),
    c("name", "Name", { width: 150 }),
    c("username", "Instagram Username", { width: 140 }),
    linkCol("profile", "Instagram Profile", 130),
    linkCol("their_post", "Their Post", 110),
    longCol("post", "What They Posted", 280),
    longCol("why", "Reason They're a Fit", 240),
    messageCol("Message to Send"),
    linkCol("open", "Open Instagram", 170),
    status({ options: TASK }),
    dateCol("date_found", "Date Found"),
    dateCol("date_contacted", "Date Contacted", true),
    notes(),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "e1306c",
};

export const INSTAGRAM_COMMENTS: TabSpec = social({
  id: "instagram-comments",
  name: "Instagram Comments",
  agent: "replies-instagram",
  description: "Useful comments on business professionals' Instagram posts you pasted into Paste a Post (most never mention SwiftCard). Copy the comment, tap Open Post, paste, post, set Status to Sent / Posted.",
  who: "Account",
  postHeader: "Their Post",
  messageHeader: "Comment to Post",
  openHeader: "Open Post",
  color: "e1306c",
});

export const REDDIT_REPLY: TabSpec = {
  id: "reddit-reply",
  name: "Reddit Reply",
  group: "agent",
  layout: "rows",
  agents: ["replies-reddit"],
  description: "Reddit threads where a real answer helps. Read the reply, tap Open Exact Reply Location (it opens the thread, or the exact comment, you answer), press Reply, paste, post, then set Status to Sent / Posted. At most a third of replies mention SwiftCard, and those say you built it.",
  columns: [
    priority(),
    c("subreddit", "Subreddit", { width: 120 }),
    c("thread", "Thread Title", { width: 240 }),
    c("who", "Reddit Username", { width: 130 }),
    longCol("post", "Original Post or Comment", 320),
    longCol("asking", "What They're Asking", 200),
    longCol("why", "Why It's Relevant", 220),
    messageCol("Suggested Reply"),
    linkCol("open", "Open Exact Reply Location", 190),
    status({ options: TASK }),
    dateCol("date_found", "Date Found"),
    dateCol("date_posted", "Date Posted", true),
    c("engagement", "Upvotes / Engagement", { width: 110, owner: true }),
    notes(),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "ff4500",
};

export const REDDIT_DMS: TabSpec = social({
  id: "reddit-dms",
  name: "Reddit DMs",
  agent: "contact-reddit",
  description: "People on Reddit asking for a card or link page tool, each with a short private message. Tap Open Message (Reddit's message screen, addressed to them), paste, send, set Status to Sent / Posted. Nobody is messaged twice, on any platform.",
  who: "Reddit Username",
  messageHeader: "Message to Send",
  openHeader: "Open Message",
  color: "ff4500",
  extra: [linkCol("open_post", "Their Post", 110)],
});

export const LINKEDIN_COMMENTS: TabSpec = {
  id: "linkedin-comments",
  name: "LinkedIn Comments",
  group: "agent",
  layout: "rows",
  agents: ["replies-linkedin"],
  description: "Comments on specific LinkedIn posts by business professionals. Copy, tap Open Post (the exact post), paste the comment, post, set Status to Sent / Posted. LinkedIn's API doesn't let an app comment for you.",
  columns: [
    priority(),
    c("name", "Name", { width: 150 }),
    c("occupation", "Occupation", { width: 140 }),
    longCol("topic", "Post Topic", 260),
    longCol("detail", "Personalization Detail", 240),
    messageCol("Comment to Post"),
    linkCol("open", "Open Post", 150),
    status({ options: TASK }),
    dateCol("date_found", "Date Found"),
    dateCol("date_posted", "Date Posted", true),
    notes(),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "0a66c2",
};

export const LINKEDIN_CONNECTIONS: TabSpec = {
  id: "linkedin-connections",
  name: "LinkedIn Connections",
  group: "agent",
  layout: "rows",
  agents: ["contact-linkedin"],
  description: "Business professionals to connect with, each with a connection note (under 200 characters) and a message for after they accept. Tap Open Profile, press Connect, Add a note, paste the note, send, set Status to Sent / Posted.",
  columns: [
    priority(),
    c("name", "Name", { width: 150 }),
    c("occupation", "Headline", { width: 180 }),
    c("location", "Location", { width: 120 }),
    longCol("detail", "Personalization Detail", 240),
    messageCol("Connection Note + Follow Up"),
    linkCol("open", "Open Profile", 150),
    status({ options: TASK }),
    dateCol("date_found", "Date Found"),
    dateCol("date_posted", "Date Sent", true),
    notes(),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "0a66c2",
};

export const QUORA: TabSpec = {
  id: "quora",
  name: "Quora Answers",
  group: "agent",
  layout: "rows",
  agents: ["replies-quora"],
  description: "Quora questions about business cards, networking and link pages, with a real answer first. Tap Open Question, press Answer, paste, post, set Status to Sent / Posted.",
  columns: [
    priority(),
    longCol("question", "Question", 280),
    c("topic", "Topic", { width: 140 }),
    longCol("why", "Relevance", 220),
    messageCol("Suggested Answer"),
    linkCol("open", "Open Question", 150),
    status({ options: TASK }),
    dateCol("date_found", "Date Found"),
    dateCol("date_posted", "Date Posted", true),
    notes(),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "b92b27",
};

export const BLUESKY: TabSpec = {
  id: "bluesky",
  name: "Bluesky Replies",
  group: "agent",
  layout: "rows",
  agents: ["replies-bluesky"],
  description: "Bluesky posts worth a reply (under 300 characters, at most a third mention SwiftCard). Tap Open Post, reply, paste, set Status to Sent / Posted. Bluesky's open API can post an approved reply for you: once the Bluesky connection is set and Dry run is off in Controls, setting Status to Approved posts it.",
  columns: [
    priority(),
    c("who", "Profile", { width: 160 }),
    longCol("post", "Relevant Post", 320),
    longCol("why", "Why It's Relevant", 220),
    messageCol("Suggested Response"),
    linkCol("open", "Open Post", 150),
    c("method", "Posting Method", { width: 170, note: "Copy & open: you post it. Approval posts it: set Status to Approved and the backend replies from the SwiftCard account." }),
    status({ options: TASK }),
    dateCol("date_found", "Date Found"),
    dateCol("date_posted", "Date Posted", true),
    notes(),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "1185fe",
};

export const THREADS: TabSpec = social({ id: "threads", name: "Threads Replies", agent: "replies-threads", description: "Threads posts where a short, warm reply helps. Tap Open Post (the exact post), reply, paste, set Status to Sent / Posted. Threads' API can't post a reply to someone else's post for us.", who: "Account", openHeader: "Open Post", color: "000000" });
export const FACEBOOK: TabSpec = social({ id: "facebook", name: "Facebook Groups", agent: "replies-facebook", description: "Replies to Facebook group posts you pasted into Paste a Post (apps can't read groups). Tap Open Post, reply, paste, set Status to Sent / Posted. Group replies never pitch.", who: "Poster", openHeader: "Open Post", color: "1877f2" });
export const INDIE_HACKERS: TabSpec = social({ id: "indiehackers", name: "Indie Hackers", agent: "replies-indiehackers", description: "Indie Hackers threads about cards, link pages and personal branding, founder to founder. Tap Open Thread, reply, paste, set Status to Sent / Posted.", who: "Member", openHeader: "Open Thread", color: "4f46e5" });
export const ALIGNABLE: TabSpec = social({ id: "alignable", name: "Alignable", agent: "contact-alignable", description: "Neighborly hellos to Alignable profiles you pasted into Paste a Post (Alignable has no API). Tap Open Profile, message, paste, set Status to Sent / Posted. No pitch, ever.", who: "Business", postHeader: "Their Profile", messageHeader: "Message to Send", openHeader: "Open Profile", color: "d32f2f" });
export const HACKER_NEWS: TabSpec = social({ id: "hackernews", name: "Hacker News", agent: "replies-hackernews", description: "Hacker News stories and comments about business cards, networking follow ups and link pages. Tap Open Comment (the exact comment, with its own reply box), paste, post, set Status to Sent / Posted. HN dislikes promotion: most replies never mention SwiftCard.", who: "Member", postHeader: "Original Discussion", openHeader: "Open Comment", color: "ff6600" });

export const X_REPLIES: TabSpec = {
  id: "x-replies",
  name: "X Replies",
  group: "agent",
  layout: "placeholder",
  agents: [],
  description: "Replies to posts on X. Off: X charges for every post read and written (about $0.005 to read and $0.015 to write; no free tier for new apps). A cost estimate sits in Controls under Paid services; approve it there and the agent can be built on the existing X connection.",
  columns: [c("username", "Username", { width: 140 }), longCol("post", "Original Post", 300), c("topic", "Relevant Topic", { width: 160 }), messageCol("Suggested Reply"), linkCol("open", "Exact Post Link", 150), priority(), status({ options: TASK }), dateCol("date_posted", "Date Posted", true), c("engagement", "Engagement", { width: 100, owner: true }), KEY_COLUMN],
  statuses: TASK,
  color: "000000",
  placeholder: "Needs X API billing (pay per use). Approve the cost in Controls → Paid services first.",
};

export const WEB_LEADS = leadTab({ id: "web-leads", name: "Web Leads", agent: "leads-web", description: "Businesses (real estate offices, insurance agencies, contractors and more, city by city) with the email their own website publishes. Source Link opens the page the email is on. Nothing is emailed by the agents.", color: "34a853" });
export const REDDIT_LEADS = leadTab({ id: "reddit-leads", name: "Reddit Leads", agent: "leads-reddit", description: "Business owners on Reddit who posted a business email publicly. Source Link opens the post. Needs the Reddit app keys.", color: "34a853" });
export const QUORA_LEADS = leadTab({ id: "quora-leads", name: "Quora Leads", agent: "leads-quora", description: "Professionals on Quora who list a public business email. Source Link opens where it was found.", color: "34a853" });
export const FACEBOOK_LEADS = leadTab({ id: "facebook-leads", name: "Facebook Group Leads", agent: "leads-facebook", description: "Business emails found in Facebook group posts and pages you pasted into Paste a Post. No AI, no messages.", color: "34a853" });
export const ALIGNABLE_LEADS = leadTab({ id: "alignable-leads", name: "Alignable Leads", agent: "leads-alignable", description: "Business emails found in Alignable profiles you pasted into Paste a Post. No AI, no messages.", color: "34a853" });

export const OFFICE_PROSPECTS: TabSpec = {
  id: "office-prospects",
  name: "Office Prospects",
  group: "agent",
  layout: "rows",
  agents: ["office-outreach"],
  description: "New York teams and offices for the Office Plan: owners, brokers and sales heads with the phone and email their own site shows, a talking point for the call, and sometimes a personal email draft. Call or email, then set Status to Contacted.",
  columns: [
    c("company", "Company", { width: 200 }),
    c("type", "Business Type", { width: 150 }),
    c("name", "Contact Name", { width: 150 }),
    c("title", "Title", { width: 130 }),
    c("phone", "Phone", { width: 120 }),
    c("email", "Email", { width: 200 }),
    longCol("talking_point", "Talking Point", 260),
    messageCol("Email Draft"),
    linkCol("open", "Open Website", 120),
    status({ options: PIPE }),
    dateCol("date_found", "Date Found"),
    dateCol("last_contacted", "Last Contacted", true),
    notes(),
    KEY_COLUMN,
  ],
  statuses: PIPE,
  color: "3f51b5",
};

export const PARTNERSHIPS: TabSpec = {
  id: "partnerships",
  name: "Partnerships",
  group: "agent",
  layout: "rows",
  agents: ["partnerships"],
  description: "Organizations that already reach the people we sell to (associations, chambers, coworking spaces, license schools, networking groups), each with a concrete idea and a first email. Tap Contact Link (their contact or membership page), send the message, set Status to Sent / Posted.",
  columns: [
    c("org", "Organization", { width: 200 }),
    c("industry", "Industry", { width: 130 }),
    c("contact", "Contact Name", { width: 140 }),
    longCol("opportunity", "Partnership Opportunity", 240),
    longCol("why", "Why They're a Fit", 240),
    longCol("proposal", "Proposed Collaboration", 240),
    messageCol("Message to Send"),
    linkCol("open", "Contact Link", 130),
    status({ options: TASK }),
    dateCol("follow_up", "Follow-Up Date", true),
    notes(),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "009688",
};

export const EVENTS: TabSpec = {
  id: "events",
  name: "Events",
  group: "agent",
  layout: "rows",
  agents: ["events"],
  description: "Upcoming networking and industry events where our buyers will be, with what to do there. Tap Event Link, decide, set Status (Completed when you went, Skipped if not).",
  columns: [
    c("name", "Event Name", { width: 220 }),
    c("location", "Location", { width: 150 }),
    c("date", "Date", { width: 110 }),
    c("audience", "Audience", { width: 160 }),
    c("cost", "Attendance / Cost", { width: 130 }),
    longCol("why", "Why It's Relevant", 240),
    c("organizer", "Organizer", { width: 150 }),
    linkCol("open", "Event Link", 120),
    longCol("action", "Suggested Marketing Action", 260),
    status({ options: TASK }),
    notes(),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "8bc34a",
};

export const SEO: TabSpec = {
  id: "seo",
  name: "SEO Opportunities",
  group: "agent",
  layout: "rows",
  agents: ["marketing-seo"],
  description: "Exact pages with a search problem and the fix. Set Status to Approved and an AI engineer opens the change as a pull request for you to review; nothing changes on the site until you merge it. Current Ranking fills in once Google Search Console is connected.",
  columns: [
    priority(),
    c("keyword", "Target Keyword", { width: 170 }),
    c("intent", "Search Intent", { width: 120 }),
    c("page", "Target Page", { width: 200 }),
    c("ranking", "Current Ranking", { width: 100 }),
    c("competitor", "Competitor", { width: 120 }),
    longCol("problem", "Problem or Opportunity", 280),
    longCol("fix", "Exact Recommended Fix", 320),
    longCol("meta", "Suggested Title / Meta Description", 260),
    longCol("evidence", "Supporting Evidence", 220),
    linkCol("open", "Open Page", 110),
    status({ options: TASK }),
    dateCol("date_checked", "Date Checked"),
    notes(),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "0f9d58",
};

export const GEO: TabSpec = {
  id: "geo",
  name: "GEO Opportunities",
  group: "agent",
  layout: "rows",
  agents: ["marketing-geo"],
  description: "What AI search tools say when asked the questions our buyers ask, and whether SwiftCard came up. AI answers change from day to day; these are observations, not guarantees. Improvements are proposed as site changes you approve.",
  columns: [
    c("platform", "AI Platform", { width: 120 }),
    longCol("question", "Search Question", 260),
    c("mentioned", "SwiftCard Mentioned", { width: 100 }),
    c("competitors", "Competitors Mentioned", { width: 200 }),
    linkCol("citation", "Citation / Source", 150),
    longCol("problem", "Visibility Problem", 220),
    longCol("fix", "Recommended Improvement", 260),
    c("page", "Page to Improve", { width: 160 }),
    status({ options: TASK }),
    dateCol("date_tested", "Date Tested"),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "673ab7",
};

const contentColumns = (bodyHeader: string): TabSpec["columns"] => [
  priority(),
  c("platform", "Platform", { width: 110 }),
  c("type", "Content Type", { width: 110 }),
  c("topic", "Topic", { width: 200 }),
  longCol("hook", "Hook", 220),
  longCol("caption", "Caption", 320, { editable: true }),
  longCol("script", bodyHeader, 320),
  linkCol("asset", "Asset Link", 120),
  c("hashtags", "Hashtags", { width: 140 }),
  c("cta", "Call to Action", { width: 160 }),
  dateCol("scheduled", "Scheduled Date", true),
  status({ header: "Approval Status", options: TASK }),
  c("publishing", "Publishing Status", { width: 120 }),
  c("published_link", "Published Link", { width: 160, owner: true }),
  c("views", "Views", { width: 70, owner: true }),
  c("engagement", "Engagement", { width: 90, owner: true }),
  c("signups", "Signups Generated", { width: 100 }),
  notes(),
  KEY_COLUMN,
];

export const SOCIAL: TabSpec = {
  id: "social",
  name: "Social Media",
  group: "agent",
  layout: "rows",
  agents: ["marketing-social"],
  description: "One post a day for LinkedIn, Instagram, Threads, TikTok, Pinterest, YouTube, Reddit and Alignable. First row of an idea: type 1, 2 or 3 in Notes to pick an option and set Approval Status to Approved. Then the finished row: download the pictures from Asset Link, post with the caption, set it to Sent / Posted.",
  columns: contentColumns("Script / Slides"),
  statuses: TASK,
  color: "e91e63",
};

export const BLOG: TabSpec = {
  id: "blog",
  name: "Blog Writer",
  group: "agent",
  layout: "rows",
  agents: ["marketing-blog"],
  description: "One SEO blog post a week, aimed at a real search (like \"HiHello alternative\"). Read it, then set Approval Status to Approved and it goes live on swiftcard.me/blog (while Dry run is off).",
  columns: contentColumns("Post"),
  statuses: TASK,
  color: "e91e63",
};

export const COMPETITOR_INTEL: TabSpec = {
  id: "competitor-intel",
  name: "Competitor Intel",
  group: "agent",
  layout: "rows",
  agents: ["competitor-watch"],
  description: "What HiHello, Blinq, Popl, Link.me, Linktree and Hoobe changed, from their own sites, checked Wednesdays and Sundays. A price change proposes an update to our compare pages (Status Approved opens it as a pull request).",
  columns: [
    c("competitor", "Competitor", { width: 120 }),
    longCol("change", "New Feature or Change", 300),
    linkCol("source", "Source", 110),
    dateCol("date", "Date"),
    longCol("why", "Why It Matters", 240),
    longCol("opportunity", "Opportunity for SwiftCard", 240),
    longCol("action", "Recommended Action", 240),
    status({ options: TASK }),
    notes(),
    KEY_COLUMN,
  ],
  statuses: TASK,
  color: "ff9800",
};

/** In the order they appear in the workbook (and on the admin page's Start / Stop list). */
export const AGENT_TABS: TabSpec[] = [
  INSTAGRAM_LINKEDIN_BIO,
  INSTAGRAM_DMS,
  INSTAGRAM_COMMENTS,
  REDDIT_REPLY,
  REDDIT_DMS,
  LINKEDIN_COMMENTS,
  LINKEDIN_CONNECTIONS,
  QUORA,
  THREADS,
  BLUESKY,
  FACEBOOK,
  INDIE_HACKERS,
  ALIGNABLE,
  HACKER_NEWS,
  OFFICE_PROSPECTS,
  PARTNERSHIPS,
  EVENTS,
  WEB_LEADS,
  REDDIT_LEADS,
  QUORA_LEADS,
  FACEBOOK_LEADS,
  ALIGNABLE_LEADS,
  SOCIAL,
  BLOG,
  SEO,
  GEO,
  COMPETITOR_INTEL,
  X_REPLIES,
];

export const ALL_TABS: TabSpec[] = [...OPERATING_TABS, ...AGENT_TABS];

export function tabById(id: string): TabSpec | undefined {
  return ALL_TABS.find((t) => t.id === id);
}

export function tabByName(name: string): TabSpec | undefined {
  return ALL_TABS.find((t) => t.name === name);
}

/** The agent's own tab (one per agent), or none (the Watchdog, managers, the Sheet keepers). */
export function tabsForAgent(agentId: string): TabSpec[] {
  return AGENT_TABS.filter((t) => t.agents.includes(agentId) && t.layout === "rows");
}

/** The lead agent whose tab a lead belongs on, by where it was found. */
export const LEAD_TAB_BY_SOURCE: Record<string, TabSpec> = { web: WEB_LEADS, reddit: REDDIT_LEADS, quora: QUORA_LEADS, facebook: FACEBOOK_LEADS, alignable: ALIGNABLE_LEADS };
