// ── LIVE DATA for the agents whose work starts from our own numbers ─────────
//
// Ana (analyst), Ollie (onboarding), Uma (upsell), Cass (churn), Pat (proof),
// Lena (launch) and Axel (aso) each get a block of REAL figures in their
// prompt. The rule that shapes every block: counts and segments, never a
// private person's name, email, phone or address — except Pat's candidate
// list, which is deliberately the public face of a card (first name, company,
// public card URL) because his whole job is to look at what they built.
//
// Every function returns "" on any error. A missing number must never stop a
// run; the brief tells the agent to say "no data" rather than invent one.
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sb } from "./agentkit.mjs";
import { sbRows, sbCount, isoAgo, DAY } from "./probe.mjs";

const execFileP = promisify(execFile);
const APP_ID = "6798875872";
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
const num = (n) => (n === null || n === undefined ? "no data" : String(n));

/** Shared: the week's funnel, this week vs last. */
async function funnel() {
  const w = (from, to) => `created_at=gte.${isoAgo(from * DAY)}&created_at=lt.${isoAgo(to * DAY)}`;
  const v = (from, to) => `viewed_at=gte.${isoAgo(from * DAY)}&viewed_at=lt.${isoAgo(to * DAY)}`;
  const [signups, signupsPrev, cards, cardsPrev, views, viewsPrev, leads, leadsPrev] = await Promise.all([
    sbCount("profiles", w(7, 0)), sbCount("profiles", w(14, 7)),
    sbCount("cards", w(7, 0)), sbCount("cards", w(14, 7)),
    sbCount("card_views", v(7, 0)), sbCount("card_views", v(14, 7)),
    sbCount("leads", w(7, 0)), sbCount("leads", w(14, 7)),
  ]);
  const ev = (await sbRows("stripe_events", `select=type,created_at&created_at=gte.${isoAgo(14 * DAY)}&limit=1000`)) ?? [];
  const week = (t, from, to) => ev.filter((e) => new RegExp(t).test(e.type) && new Date(e.created_at) >= new Date(isoAgo(from * DAY)) && new Date(e.created_at) < new Date(isoAgo(to * DAY))).length;
  const viewedRows = (await sbRows("card_views", `select=username&viewed_at=gte.${isoAgo(7 * DAY)}&limit=5000`)) ?? [];
  const newCards = (await sbRows("cards", `select=username&created_at=gte.${isoAgo(7 * DAY)}&limit=1000`)) ?? [];
  const viewed = new Set(viewedRows.map((r) => r.username));
  const newWithView = newCards.filter((c) => viewed.has(c.username)).length;
  return {
    signups, signupsPrev, cards, cardsPrev, views, viewsPrev, leads, leadsPrev, newWithView,
    proNew: week("checkout\\.session\\.completed", 7, 0), proNewPrev: week("checkout\\.session\\.completed", 14, 7),
    cancels: week("subscription\\.deleted", 7, 0), cancelsPrev: week("subscription\\.deleted", 14, 7),
    failed: week("payment_failed", 7, 0), failedPrev: week("payment_failed", 14, 7),
  };
}

async function appStore() {
  try {
    const r = await fetch(`https://itunes.apple.com/lookup?id=${APP_ID}&country=us`);
    const a = (await r.json())?.results?.[0];
    if (!a) return null;
    return { name: a.trackName, version: a.version, rating: a.averageUserRating, ratings: a.userRatingCount, notes: a.releaseNotes, description: a.description, subtitle: a.subtitle ?? null };
  } catch { return null; }
}

async function recentReviews(maxStars = 5, days = 30, limit = 10) {
  try {
    const r = await fetch(`https://itunes.apple.com/us/rss/customerreviews/id=${APP_ID}/sortBy=mostRecent/json`);
    const e = (await r.json())?.feed?.entry;
    const list = Array.isArray(e) ? e : e ? [e] : [];
    return list
      .map((x) => ({ stars: Number(x?.["im:rating"]?.label ?? 0), title: x?.title?.label ?? "", body: String(x?.content?.label ?? "").slice(0, 300), when: String(x?.updated?.label ?? "").slice(0, 10) }))
      .filter((x) => x.stars <= maxStars && Date.now() - new Date(x.when).getTime() <= days * DAY)
      .slice(0, limit);
  } catch { return []; }
}

/** Options offered vs picked per agent, last 14 days — the team's scorecard. */
export async function pickRates() {
  const rows = (await sbRows("agent_queue_items", `select=agent_id,item_type,status,payload&created_at=gte.${isoAgo(14 * DAY)}&limit=2000`)) ?? [];
  const by = new Map();
  for (const r of rows) {
    const picked = !!r.payload?.chosen;
    if (r.item_type !== "choice" && !picked) continue;
    const s = by.get(r.agent_id) ?? { offered: 0, picked: 0, waiting: 0 };
    s.offered++;
    if (picked) s.picked++;
    else if (r.status === "pending") s.waiting++;
    by.set(r.agent_id, s);
  }
  return [...by.entries()].map(([agent_id, s]) => ({ agent_id, ...s, rate: s.offered - s.waiting ? Math.round((s.picked / (s.offered - s.waiting)) * 100) : null }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
}

export function pickRateLines(rates) {
  if (!rates.length) return "(no options offered in the last 14 days)";
  return rates.map((r) => `- ${r.agent_id}: ${r.picked} picked of ${r.offered} offered${r.waiting ? ` (${r.waiting} still waiting)` : ""}${r.rate === null ? "" : ` → ${r.rate}% pick rate`}`).join("\n");
}

// ── Per-agent blocks ─────────────────────────────────────────────────────────

async function analystBlock() {
  const f = await funnel();
  const a = await appStore();
  const rates = await pickRates();
  const d = (x, y) => `${num(x)} (prior week ${num(y)})`;
  return `\n---\nLIVE DATA (last 7 days vs the 7 before; raw counts — say "too small to call" when they are):
- Signups: ${d(f.signups, f.signupsPrev)}
- Cards created: ${d(f.cards, f.cardsPrev)} → activation (cards ÷ signups) ${pct(f.cards ?? 0, f.signups ?? 0)} (prior ${pct(f.cardsPrev ?? 0, f.signupsPrev ?? 0)})
- New cards that got their first view within the week: ${f.newWithView} of ${f.cards ?? 0}
- Card views: ${d(f.views, f.viewsPrev)}
- Leads captured: ${d(f.leads, f.leadsPrev)}
- Pro checkouts: ${d(f.proNew, f.proNewPrev)} · Cancellations: ${d(f.cancels, f.cancelsPrev)} · Failed payments: ${d(f.failed, f.failedPrev)}
- App Store: ${a ? `${a.rating?.toFixed?.(2) ?? a.rating}★ from ${a.ratings} ratings, version ${a.version}` : "no data"}
PICK RATE per agent, last 14 days (options offered vs the owner picked one):
${pickRateLines(rates)}`;
}

async function onboardingBlock() {
  const profiles = (await sbRows("profiles", `select=id,created_at&created_at=gte.${isoAgo(8 * DAY)}&limit=2000`)) ?? [];
  const cards = (await sbRows("cards", `select=user_id,username,created_at,customization,website,linkedin,instagram,twitter,tiktok&limit=3000`)) ?? [];
  const owners = new Set(cards.map((c) => c.user_id));
  const noCard = (from, to) => profiles.filter((p) => { const t = new Date(p.created_at).getTime(); return t <= Date.now() - from * DAY && t > Date.now() - to * DAY && !owners.has(p.id); }).length;
  const hasLink = (c) => (Array.isArray(c.customization?.links) && c.customization.links.length) || c.website || c.linkedin || c.instagram || c.twitter || c.tiktok;
  const noPhoto = cards.filter((c) => !c.customization?.photoUrl).length;
  const noLinks = cards.filter((c) => !hasLink(c)).length;
  const viewed = new Set(((await sbRows("card_views", `select=username&limit=10000`)) ?? []).map((r) => r.username));
  const weekOld = cards.filter((c) => new Date(c.created_at).getTime() <= Date.now() - 7 * DAY);
  const zeroViews7 = weekOld.filter((c) => !viewed.has(c.username)).length;
  const neverViewed = cards.filter((c) => !viewed.has(c.username)).length;
  return `\n---\nLIVE DATA (segment sizes only — no names, no emails, no card URLs):
- Signed up ~1 day ago, still no card: ${noCard(1, 2)}
- Signed up ~3 days ago, still no card: ${noCard(3, 4)}
- Signed up ~7 days ago, still no card: ${noCard(7, 8)}
- Cards with no photo: ${noPhoto} of ${cards.length}
- Cards with no links at all: ${noLinks} of ${cards.length}
- Cards that have never been viewed by anyone (never shared, in effect): ${neverViewed} of ${cards.length}
- Cards 7+ days old with zero views: ${zeroViews7} of ${weekOld.length}
- Signups in the last 7 days: ${profiles.filter((p) => new Date(p.created_at).getTime() > Date.now() - 7 * DAY).length}`;
}

async function upsellBlock() {
  const free = (await sbRows("profiles", `select=id&plan=neq.pro&limit=5000`)) ?? [];
  const freeIds = new Set(free.map((p) => p.id));
  const cards = (await sbRows("cards", `select=user_id,username,title,company&limit=5000`)) ?? [];
  const byUser = new Map();
  for (const c of cards) { if (!freeIds.has(c.user_id)) continue; const l = byUser.get(c.user_id) ?? []; l.push(c); byUser.set(c.user_id, l); }
  const views = (await sbRows("card_views", `select=username,location&viewed_at=gte.${isoAgo(7 * DAY)}&limit=10000`)) ?? [];
  const leads = (await sbRows("leads", `select=card_owner&created_at=gte.${isoAgo(7 * DAY)}&limit=5000`)) ?? [];
  const viewsBy = new Map(), leadsBy = new Map(), townBy = new Map();
  for (const v of views) { viewsBy.set(v.username, (viewsBy.get(v.username) ?? 0) + 1); if (v.location && !townBy.has(v.username)) townBy.set(v.username, String(v.location).split(",")[0]); }
  for (const l of leads) leadsBy.set(l.card_owner, (leadsBy.get(l.card_owner) ?? 0) + 1);
  const ex = [];
  let hotViews = 0, hotLeads = 0, multi = 0;
  for (const [, list] of byUser) {
    const v = list.reduce((s, c) => s + (viewsBy.get(c.username) ?? 0), 0);
    const l = list.reduce((s, c) => s + (leadsBy.get(c.username) ?? 0), 0);
    if (v >= 25) hotViews++;
    if (l >= 3) hotLeads++;
    if (list.length >= 2) multi++;
    if ((v >= 25 || l >= 3) && ex.length < 6) {
      const c = list[0];
      ex.push(`a ${(c.title || "professional").toLowerCase()}${townBy.get(c.username) ? ` in ${townBy.get(c.username)}` : ""}: ${v} views, ${l} leads this week`);
    }
  }
  return `\n---\nLIVE DATA (free accounts only, last 7 days; segments and anonymized examples — no names):
- Free users on the Free plan: ${byUser.size} with a card (${free.length} accounts)
- Free users with ≥ 25 card views this week: ${hotViews}
- Free users with ≥ 3 leads captured this week: ${hotLeads}
- Free users who made a second card: ${multi}
- Examples: ${ex.length ? ex.join("; ") : "none crossed a threshold this week"}`;
}

async function churnBlock() {
  const ev = (await sbRows("stripe_events", `select=type,created_at&created_at=gte.${isoAgo(30 * DAY)}&limit=1000`)) ?? [];
  const n = (re, days) => ev.filter((e) => re.test(e.type) && new Date(e.created_at).getTime() >= Date.now() - days * DAY).length;
  const downgrades = await sbCount("profiles", `plan=neq.pro&stripe_subscription_id=not.is.null`);
  const reviews = await recentReviews(2, 30, 6);
  // Cancel reasons captured by the retention flow, if the table exists.
  const reasons = (await sbRows("retention_events", `select=reason,outcome,created_at&created_at=gte.${isoAgo(30 * DAY)}&limit=200`)) ?? [];
  const tally = {};
  for (const r of reasons) tally[r.reason ?? "unknown"] = (tally[r.reason ?? "unknown"] ?? 0) + 1;
  return `\n---\nLIVE DATA (raw counts; a failed payment is NOT a cancellation):
- Cancellations (subscription deleted): last 7 days ${n(/subscription\.deleted/, 7)}, last 30 days ${n(/subscription\.deleted/, 30)}
- Failed payments: last 7 days ${n(/payment_failed/, 7)}, last 30 days ${n(/payment_failed/, 30)}
- Accounts with a Stripe subscription id but no longer Pro (downgraded/lapsed): ${num(downgrades)}
- Cancel reasons captured in the flow, last 30 days: ${Object.keys(tally).length ? Object.entries(tally).map(([k, v]) => `${k} ×${v}`).join(", ") : "none captured"}
- 1–2★ App Store reviews, last 30 days: ${reviews.length ? reviews.map((r) => `${r.stars}★ "${r.title}" — ${r.body.slice(0, 160)}`).join(" | ") : "none"}`;
}

async function proofBlock() {
  const pros = (await sbRows("profiles", `select=id,plan,created_at&limit=5000`)) ?? [];
  const info = new Map(pros.map((p) => [p.id, p]));
  const cards = (await sbRows("cards", `select=user_id,username,name,title,company,created_at,is_offline&is_offline=eq.false&limit=5000`)) ?? [];
  const views = (await sbRows("card_views", `select=username&viewed_at=gte.${isoAgo(30 * DAY)}&limit=20000`)) ?? [];
  const leads = (await sbRows("leads", `select=card_owner&created_at=gte.${isoAgo(30 * DAY)}&limit=5000`)) ?? [];
  const vb = new Map(), lb = new Map();
  for (const v of views) vb.set(v.username, (vb.get(v.username) ?? 0) + 1);
  for (const l of leads) lb.set(l.card_owner, (lb.get(l.card_owner) ?? 0) + 1);
  const cands = cards
    .filter((c) => c.username && !/apple-review|swiftcard|test|demo/i.test(c.username))
    .map((c) => { const p = info.get(c.user_id); const days = p ? Math.floor((Date.now() - new Date(p.created_at).getTime()) / DAY) : 0; return { c, p, days, v: vb.get(c.username) ?? 0, l: lb.get(c.username) ?? 0 }; })
    .filter((x) => x.p && (x.p.plan === "pro" || x.days >= 30) && (x.v >= 10 || x.l >= 2))
    .sort((a, b) => (b.v + b.l * 10) - (a.v + a.l * 10))
    .slice(0, 8);
  return `\n---\nLIVE DATA — candidates who are provably getting value (30-day numbers):
${cands.length ? cands.map((x) => `- ${String(x.c.name ?? "").split(/\s+/)[0] || "(no name)"} · ${x.c.company || "no company"} · ${x.c.title || "no title"} · https://swiftcard.me/${x.c.username} · ${x.v} views, ${x.l} leads · ${x.p.plan === "pro" ? "Pro" : "Free"} · ${x.days} days on SwiftCard`).join("\n") : "- none yet: nobody is both established (Pro or 30+ days) and active (10+ views or 2+ leads in 30 days). Return [] rather than ask a cold account."}`;
}

async function launchBlock() {
  let commits = "";
  try {
    const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
    const { stdout } = await execFileP("git", ["log", "--since=7 days ago", "--no-merges", "--pretty=format:%ad %s", "--date=short", "-n", "80"], { cwd, timeout: 20000 });
    commits = stdout.trim();
  } catch { commits = ""; }
  const a = await appStore();
  return `\n---\nLIVE DATA:
COMMITS in the last 7 days (subjects only — translate the user-visible ones, skip the rest):
${commits || "(none, or git history unavailable in this run)"}
APP STORE: ${a ? `version ${a.version} · ${a.rating?.toFixed?.(2) ?? a.rating}★ (${a.ratings})\nCURRENT WHAT'S NEW:\n${String(a.notes ?? "").slice(0, 1500)}` : "no data"}`;
}

async function asoBlock() {
  const a = await appStore();
  const reviews = await recentReviews(5, 365, 10);
  return `\n---\nLIVE DATA — the listing as the App Store shows it right now:
- Name: ${a?.name ?? "no data"}
- Subtitle: ${a?.subtitle ?? "(not exposed by the lookup API — read it from the store page)"}
- Version: ${a?.version ?? "no data"} · Rating: ${a ? `${a.rating?.toFixed?.(2) ?? a.rating}★ from ${a.ratings}` : "no data"}
- Description (first 1200 chars): ${String(a?.description ?? "").slice(0, 1200)}
- What's new: ${String(a?.notes ?? "").slice(0, 600)}
- Last reviews (the words real users use): ${reviews.length ? reviews.map((r) => `${r.stars}★ "${r.title}": ${r.body.slice(0, 140)}`).join(" | ") : "none"}`;
}

/** Milo (social) + Addy (ads): which of OUR Instagram posts brought signups.
 *  Every Instagram link carries its post's own code (ig_p_<id>), and that code
 *  is the signup source — so this is a real count per post, not a guess from
 *  likes. Counts only; no commenter's name or text ever reaches a prompt. */
async function instagramBlock() {
  const since = isoAgo(30 * DAY);
  const posts = (await sbRows("agent_ig_posts", `select=media_id,code,caption,media_type,posted_at,like_count,comments_count&posted_at=gte.${since}&order=posted_at.desc&limit=30`)) ?? [];
  if (!posts.length) return "";
  const [events, clicks, signups] = await Promise.all([
    sbRows("agent_ig_events", `select=media_id,status&action=eq.link&created_at=gte.${since}&limit=5000`),
    sbRows("product_events", `select=props&name=eq.campaign_link_clicked&is_internal=eq.false&created_at=gte.${since}&limit=5000`),
    sbRows("profiles", `select=signup_source&signup_source=like.ig_*&created_at=gte.${since}&limit=5000`),
  ]);
  const tally = (rows, key) => { const m = {}; for (const r of rows ?? []) { const k = key(r); if (k) m[k] = (m[k] ?? 0) + 1; } return m; };
  const asked = tally(events, (e) => e.media_id);
  const tapped = tally(clicks, (c) => c.props?.code);
  const joined = tally(signups, (p) => p.signup_source);
  const ranked = posts.map((p) => ({ ...p, asked: asked[p.media_id] ?? 0, taps: tapped[p.code] ?? 0, signups: joined[p.code] ?? 0 }))
    .sort((a, b) => b.signups - a.signups || b.taps - a.taps || b.asked - a.asked);
  const total = (m) => Object.values(m).reduce((a, b) => a + b, 0);
  const line = (p) => `- "${String(p.caption ?? "").split("\n")[0].slice(0, 80) || "untitled"}" (${String(p.media_type ?? "post").toLowerCase()}, ${String(p.posted_at ?? "").slice(0, 10)}): ${p.asked} keyword comments, ${p.taps} link taps, ${p.signups} signups, ${p.like_count} likes`;
  return [
    "INSTAGRAM — WHICH OF OUR POSTS BROUGHT SIGNUPS (last 30 days, real counts; signups are the only goal)",
    `Totals: ${total(asked)} keyword comments → ${total(tapped)} link taps → ${total(joined)} signups, across ${posts.length} posts.`,
    "Posts, best first:",
    ...ranked.slice(0, 12).map(line),
    total(joined) + total(tapped) === 0
      ? "Nothing has converted yet — vary the format and the hook, and keep the keyword call to action on every post so the next ones can be measured."
      : "Make more of what is at the top (same format, same kind of hook, a new angle) and stop making what is at the bottom. Likes alone are not a reason to repeat a post.",
  ].join("\n");
}

const BLOCKS = { analyst: analystBlock, onboarding: onboardingBlock, upsell: upsellBlock, churn: churnBlock, proof: proofBlock, launch: launchBlock, aso: asoBlock, social: instagramBlock, ads: instagramBlock };

/** The LIVE DATA block for an agent, or "" for agents that don't get one / on any error. */
export async function dataBlock(agentId) {
  const fn = BLOCKS[agentId];
  if (!fn) return "";
  try { return await fn(); } catch (e) { console.log(`live data for ${agentId} unavailable: ${String(e?.message ?? e).slice(0, 160)}`); return ""; }
}

// ── The owner's weekly focus ─────────────────────────────────────────────────
// One sentence in Settings ("this week: realtors and the referral program")
// that every agent reads first. Missing column → "" (SQL not yet applied).
export async function focusBlock() {
  try {
    const row = (await sb("GET", "agent_system", { params: "select=weekly_focus&limit=1" }))?.[0];
    const f = String(row?.weekly_focus ?? "").trim();
    return f ? `\n---\nTHE OWNER'S FOCUS THIS WEEK (shapes everything you propose; an item that ignores it will not be picked):\n${f}` : "";
  } catch { return ""; }
}

// ── What the team already made this week ─────────────────────────────────────
// Repurposing beats inventing: Milo's post can be Eli's email, Nora's post can
// be Lena's launch note. The chosen/approved items of the last 7 days, so an
// agent builds on a colleague's work instead of duplicating it.
const REPURPOSE_FROM = ["blog", "social", "email", "video", "launch", "proof", "trends", "referral", "seo"];
export async function teamOutputBlock(agentId) {
  if (!["social", "email", "video", "launch", "blog", "trends", "referral", "proof", "ads", "pr", "local"].includes(agentId)) return "";
  try {
    const rows = (await sbRows("agent_queue_items", `select=agent_id,item_type,title,status,created_at&agent_id=in.(${REPURPOSE_FROM.filter((a) => a !== agentId).join(",")})&status=in.(approved,posted,published,done)&created_at=gte.${isoAgo(7 * DAY)}&order=created_at.desc&limit=25`)) ?? [];
    if (!rows.length) return "";
    return `\n---\nWHAT COLLEAGUES SHIPPED THIS WEEK (the owner picked these — reuse the angle, the asset, the hook; do not duplicate the item):\n` +
      rows.map((r) => `- ${r.agent_id} · ${r.item_type} · "${r.title}" (${String(r.created_at).slice(0, 10)})`).join("\n");
  } catch { return ""; }
}

/** The renewals file, for Atlas's digest. */
export function renewalsSoon() {
  try { return JSON.parse(readFileSync(new URL("../renewals.json", import.meta.url), "utf8")); } catch { return []; }
}
