import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { classify, scoreSignal, routeAgent, toSignals, redditFromAtom, telegramFromPreview, telegramFromUpdates, itemsFromFeed, hnFromAlgolia, reviewsFromAppStoreRss, stripHtml, RADAR_AGENTS } from "../marketing-agents/lib/radar.mjs";

const read = (p: string) => readFileSync(p, "utf8");

// ── The Radar, pinned (owner order 2026-09-30) ───────────────────────────────
// "All our agents and bots work for us in terms of marketing when we scan
// Reddit, Telegram and all relevant websites." Code listens, agents answer,
// the owner posts. These tests make each half of that a build failure to break.

const config = JSON.parse(read("marketing-agents/config.json")) as { radar: Record<string, unknown>; targets: Record<string, string[]> };
const list = {
  keywords: config.radar.keywords as string[], brand: config.targets.brand_variations, competitors: config.targets.competitors,
  ask_words: config.radar.ask_words as string[], complaint_words: config.radar.complaint_words as string[],
};

describe("radar: listening is code — no model, no tokens, no posting", () => {
  const src = read("marketing-agents/lib/radar.mjs");
  it("never imports or names an LLM", () => {
    for (const forbidden of ["claude", "anthropic", "openai", "gemini", "askClaude", "execFileSync"]) expect(src.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });
  it("only ever writes agent_radar_* rows (plus a comms line) — no platform write of any kind", () => {
    const writes = [...src.matchAll(/sb\("(POST|PATCH|DELETE)", "([a-z_]+)"/g)].map((m) => m[2]);
    expect(new Set(writes)).toEqual(new Set(["agent_radar_sources", "agent_radar_signals"]));
    // Reading Reddit through the official API is fine; posting never is.
    expect(src).not.toMatch(/api\/comment|api\/submit|sendMessage|\/2\/tweets/);
  });
  it("runs inside the always-on loop and wakes agents the way findings do", () => {
    const loop = read("marketing-agents/watchdog.mjs");
    expect(loop).toMatch(/import \{ radarTick \} from "\.\/lib\/radar\.mjs"/);
    expect(loop).toMatch(/await radarTick\(\{ dispatch: dispatchAgent \}\)/);
    expect(loop).toMatch(/async function dispatchAgent\(agentId, reason, trigger = "watchdog"\)/);
    // The watchdog pause gate still comes first — a closed office scans nothing.
    expect(loop.indexOf("if (sys.paused)")).toBeLessThan(loop.indexOf("await radarTick("));
    expect(src).toMatch(/"radar"\)/); // the wake trigger
    expect(src).toMatch(/wake_cooldown_min/); // never woken twice for the same conversations
  });
  it("the runner hands every listening agent its signals first and closes them when answered", () => {
    const runner = read("marketing-agents/run-agent.mjs");
    expect(runner).toMatch(/import \{ radarBlock, markSignalQueued \} from "\.\/lib\/radar\.mjs"/);
    expect(runner).toMatch(/await radarBlock\(agentId\),/);
    expect(runner).toMatch(/await markSignalQueued\(it\.signal_id, out\.id\)/);
    const brain = read("marketing-agents/lib/brain.mjs");
    expect(brain).toMatch(/"signal_id": "<only if this answers a LIVE RADAR SIGNAL/);
    expect(brain).toMatch(/signal_id: it\.signal_id \?\? null/);
    expect(read("marketing-agents/agent-competitors.mjs")).toMatch(/await chatterBlock\(\)/);
  });
  it("every agent the Radar feeds is briefed to work its signals first", () => {
    for (const id of RADAR_AGENTS) expect(read(`marketing-agents/agents/${id}.md`), `${id}.md`).toMatch(/LIVE RADAR\s+SIGNALS/);
    expect(RADAR_AGENTS).toEqual(["mentions", "forums", "outreach", "influencer", "pr"]);
  });
  it("has its schema, its workflow, and its secrets on the loop", () => {
    const sql = read("supabase/agent-radar.sql");
    for (const t of ["agent_radar_sources", "agent_radar_signals", "agent_system add column if not exists radar"]) expect(sql).toContain(t);
    expect(sql).toMatch(/unique \(platform, external_id\)/);
    expect(existsSync(".github/workflows/agent-radar.yml")).toBe(true);
    const wd = read(".github/workflows/agent-watchdog.yml");
    for (const k of ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "TELEGRAM_BOT_TOKEN", "YOUTUBE_API_KEY"]) expect(wd).toContain(k);
  });
  it("the owner's calls on a reply are the calls on its signal, and the tab shows the Radar", () => {
    const items = read("src/app/api/admin/agents/items/route.ts");
    expect(items).toMatch(/signal_id: p\.signal_id \?\? null/);
    expect(items).toMatch(/action === "rejected" \? "dismissed"/);
    const client = read("src/app/admin/agent-flow/AgentFlowClient.tsx");
    expect(client).toMatch(/\| "radar" \|/);
    expect(client).toMatch(/\["radar", "📡 Radar"\]/);
    expect(client).toMatch(/Radar — what we listen for/);
    expect(client).toMatch(/📡 Radar<\/span>/);
    expect(existsSync("src/app/api/admin/agents/radar/route.ts")).toBe(true);
  });
});

describe("radar: classification — about us, and what kind of post", () => {
  it("ignores posts that never mention the brand, a competitor or the topic", () => {
    expect(classify("I love my new puppy, best day ever?", list)).toBeNull();
    expect(classify("we moved from linq to sql server", list)).toBeNull();
    expect(classify("", list)).toBeNull();
  });
  it("a SwiftCard mention is always a brand signal, whatever else is said", () => {
    expect(classify("Just tried swiftcard, pretty neat", list)?.intent).toBe("brand");
    expect(classify("Swift Card charged me? Actually no, that was Blinq — refund pending", list)?.intent).toBe("brand");
  });
  it("a competitor plus a billing/cancel word is the complaint Ava wants", () => {
    const c = classify("Anyone using Blinq? Got charged for a renewal I never wanted, support won't refund", list);
    expect(c?.intent).toBe("competitor_complaint");
    expect(c?.matched).toContain("Blinq");
  });
  it("a question in the title is an ask; a '?' buried in a sales post is not", () => {
    expect(classify("What's the best digital business card for realtors?", list, { title: "What's the best digital business card for realtors?" })?.intent).toBe("ask");
    expect(classify("Popl vs Blinq — which one?", list, { title: "Popl vs Blinq — which one?" })?.intent).toBe("ask");
    const sales = classify("Our agency builds digital business card sites. ".repeat(6) + " Ready to grow? DM us.", list, { title: "Digital marketing services in Kerala" });
    expect(sales?.intent).toBe("topic");
  });
  it("generic competitor names need context (wave ≠ Wave Connect)", () => {
    expect(classify("riding a wave of digital business card hype", list)?.intent).toBe("topic");
    expect(classify("wave card review", list)?.intent).toBe("competitor");
  });
});

describe("radar: scoring and routing", () => {
  it("intent carries the score; freshness and engagement nudge it", () => {
    const fresh = scoreSignal({ intent: "ask", engagement: { ups: 12, comments: 8 }, posted_at: new Date(Date.now() - 3600e3).toISOString() });
    const stale = scoreSignal({ intent: "ask", engagement: {}, posted_at: new Date(Date.now() - 5 * 86400e3).toISOString() });
    expect(fresh).toBeGreaterThan(stale);
    expect(scoreSignal({ intent: "brand" })).toBeGreaterThan(scoreSignal({ intent: "topic" }));
    expect(scoreSignal({ intent: "brand", engagement: { ups: 1e6 }, posted_at: new Date().toISOString() })).toBeLessThanOrEqual(100);
  });
  it("routes each signal to the agent whose job it is", () => {
    expect(routeAgent("reddit", "ask")).toBe("mentions");
    expect(routeAgent("reddit", "brand")).toBe("mentions");
    expect(routeAgent("telegram", "brand")).toBe("mentions");
    expect(routeAgent("hn", "ask")).toBe("forums");
    expect(routeAgent("telegram", "topic")).toBe("forums");
    expect(routeAgent("reddit", "competitor_complaint")).toBe("outreach");
    expect(routeAgent("appstore", "competitor_complaint")).toBe("competitors");
    expect(routeAgent("reddit", "competitor")).toBe("competitors");
    expect(routeAgent("news", "press")).toBe("pr");
    expect(routeAgent("youtube", "creator")).toBe("influencer");
  });
  it("competitor chatter is filed as intel (noted), never as work", () => {
    const rows = toSignals([{ external_id: "t3_a", title: "Blinq pricing went up", body: "", posted_at: null, engagement: {} }], { platform: "reddit", source_id: "reddit:search", list });
    expect(rows[0].assigned_agent).toBe("competitors");
    expect(rows[0].status).toBe("noted");
    const ask = toSignals([{ external_id: "t3_b", title: "Best digital business card?", body: "", posted_at: null, engagement: {} }], { platform: "reddit", source_id: "reddit:search", list });
    expect(ask[0].status).toBe("new");
    expect(ask[0].assigned_agent).toBe("mentions");
  });
  it("news is press coverage (unless it is about us) and every App Store hit is a complaint", () => {
    const news = toSignals([{ external_id: "n1", title: "The 3 best digital business card apps", body: "", posted_at: null, engagement: {} }], { platform: "news", source_id: "rss:x", list });
    expect(news[0].intent).toBe("press"); expect(news[0].assigned_agent).toBe("pr");
    const rev = toSignals([{ external_id: "1:2", title: "Blinq · 1★ · Worst support", body: "Stay away", posted_at: null, engagement: {} }], { platform: "appstore", source_id: "appstore:blinq", list });
    expect(rev[0].intent).toBe("competitor_complaint"); expect(rev[0].status).toBe("noted");
  });
});

describe("radar: readers parse what the real feeds look like", () => {
  it("Reddit's Atom search feed — posts only, subreddits skipped", () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>t5_abc</id><title>popl</title><link href="https://www.reddit.com/r/popl/" /></entry><entry><author><name>/u/jane</name></author><category term="realtors" label="r/realtors"/><content type="html">&lt;div&gt;Looking for a digital business card that does lead capture. Any ideas?&lt;/div&gt; &lt;a href="x"&gt;[link]&lt;/a&gt; [comments]</content><id>t3_1xyz</id><link href="https://www.reddit.com/r/realtors/comments/1xyz/digital_cards/" /><published>2026-09-30T12:00:00+00:00</published><title>Digital cards for open houses?</title></entry></feed>`;
    const posts = redditFromAtom(xml);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ external_id: "t3_1xyz", community: "r/realtors", author: "u/jane", title: "Digital cards for open houses?" });
    expect(posts[0].body).toContain("lead capture");
    expect(posts[0].body).not.toContain("[link]");
  });
  it("a public Telegram channel preview", () => {
    const html = `<div class="tgme_channel_info_header_title"><span dir="auto">Realtor Talk</span></div><div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="realtortalk/42"><div class="tgme_widget_message_text js-message_text" dir="auto">Anyone using an NFC card at showings?<br/>Which one</div><span class="tgme_widget_message_views">1.2K</span><time datetime="2026-09-30T10:00:00+00:00">10:00</time></div></div>`;
    const posts = telegramFromPreview(html, "realtortalk");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ external_id: "realtortalk/42", url: "https://t.me/realtortalk/42", community: "Telegram · Realtor Talk", engagement: { views: 1200 } });
    expect(posts[0].body).toContain("Which one");
  });
  it("the bot's group updates, with a link into a private group", () => {
    const posts = telegramFromUpdates([
      { update_id: 1, message: { message_id: 7, date: 1790000000, chat: { id: -1001234567890, type: "supergroup", title: "NYC Agents" }, from: { first_name: "Sam", last_name: "K" }, text: "which digital business card do you all use?" } },
      { update_id: 2, message: { message_id: 8, date: 1790000001, chat: { id: -100999, type: "supergroup", title: "Pub", username: "pubgroup" }, from: { username: "amy" }, caption: "nfc card demo" } },
      { update_id: 3, message: { message_id: 9, date: 1, chat: { id: 1 }, from: {}, sticker: {} } },
    ]);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ external_id: "-1001234567890:7", url: "https://t.me/c/1234567890/7", author: "Sam K", community: "Telegram · NYC Agents" });
    expect(posts[1]).toMatchObject({ url: "https://t.me/pubgroup/8", author: "@amy" });
  });
  it("Hacker News via Algolia, RSS and Atom feeds, App Store reviews", () => {
    const hn = hnFromAlgolia(JSON.stringify({ hits: [{ objectID: "1", title: "Show HN: a business card app", author: "pg", points: 12, num_comments: 3, created_at: "2026-09-29T00:00:00Z" }] }));
    expect(hn[0]).toMatchObject({ external_id: "1", url: "https://news.ycombinator.com/item?id=1", engagement: { points: 12, comments: 3 } });
    const rss = itemsFromFeed(`<rss><channel><item><title>Digital business cards are back</title><link>https://ex.com/a</link><guid>g1</guid><pubDate>Tue, 30 Sep 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Body&lt;/p&gt;</description><source url="https://ex.com">Example News</source></item></channel></rss>`, "Feed");
    expect(rss[0]).toMatchObject({ external_id: "g1", url: "https://ex.com/a", community: "Example News", body: "Body" });
    const atom = itemsFromFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>T</title><link href="https://ex.com/b"/><id>id-b</id><updated>2026-09-30T00:00:00Z</updated><summary>S</summary></entry></feed>`, "Blog");
    expect(atom[0]).toMatchObject({ external_id: "id-b", url: "https://ex.com/b", community: "Blog" });
    const reviews = reviewsFromAppStoreRss(JSON.stringify({ feed: { entry: [
      { id: { label: "r1" }, "im:rating": { label: "1" }, title: { label: "Unhelpful support" }, content: { label: "Worst" }, author: { name: { label: "j" } }, updated: { label: "2026-09-10T19:29:55-07:00" } },
      { id: { label: "r2" }, "im:rating": { label: "5" }, title: { label: "Great" }, content: { label: "Love it" }, author: { name: { label: "k" } }, updated: { label: "2026-09-11T19:29:55-07:00" } },
    ] } }), { appId: "1324102258", name: "Blinq" });
    expect(reviews).toHaveLength(1);
    expect(reviews[0].title).toBe("Blinq · 1★ · Unhelpful support");
  });
  it("strips HTML and decodes entities", () => {
    expect(stripHtml("<p>A &amp; B</p><script>x()</script><br>C &#39;d&#39;")).toBe("A & B\nC 'd'");
  });
});
