import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FACEBOOK, FB_DEFAULTS, fbPostCode, mergeFbSettings, parseFacebookWebhook } from "@/lib/facebook-bot";
import {
  processComment, processMessage,
  type IgContext, type IgEventRow, type IgIo, type IgQueueItem,
} from "@/lib/instagram-bot";
import { isCampaignSource, isSignupSource } from "@/lib/referral";
import { campaignLink } from "@/lib/campaign-links";
import { getSignupSourceLabel } from "@/lib/source-labels";

// Owner order 2026-10-02: every platform gets its bot, and the goal is signups.
// The Facebook bot is the Instagram bot's decisions run for the SwiftCard Page:
// "Comment CARD and we'll send you one" under our own posts, and answers to the
// questions people ask the Page. These pin the rules that keep it safe (it only
// answers people who wrote to the Page, once, and only when switched on) and
// the tracking that makes a signup countable per post.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir))) {
    const p = `${dir}/${f}`;
    if (statSync(join(root, p)).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(f)) out.push(p);
  }
  return out;
}

// ── A fake Page + database, so the decisions can be run for real ─────────────
function harness(over: Record<string, unknown> = {}, opts: { sendFails?: { error: string; code?: number }; answer?: string | null } = {}) {
  const events: Array<IgEventRow & { id: string; item_id?: string | null }> = [];
  const queued: IgQueueItem[] = [];
  const sent: Array<{ via: string; to: string; text: string }> = [];
  const fail = () => ({ ok: false as const, error: opts.sendFails!.error, code: opts.sendFails!.code });
  const io: IgIo = {
    record: async (row) => {
      if (events.some((e) => e.kind === row.kind && e.external_id === row.external_id)) return null;
      const id = `e${events.length + 1}`;
      events.push({ ...row, id });
      return id;
    },
    update: async (id, patch) => { Object.assign(events.find((e) => e.id === id)!, patch); },
    alreadyLinked: async (userId, postId) => events.some((e) => e.ig_user_id === userId && e.media_id === postId && e.action === "link" && ["sent", "queued", "new"].includes(e.status)),
    sentToday: async () => events.filter((e) => e.status === "sent").length,
    queue: async (item) => { queued.push(item); return `q${queued.length}`; },
    permalink: async () => "https://www.facebook.com/swiftcard/posts/123",
    answer: async () => (opts.answer === undefined ? "It's free to start." : opts.answer),
    privateReply: async (id, text) => { if (opts.sendFails) return fail(); sent.push({ via: "private", to: id, text }); return { ok: true }; },
    replyToComment: async (id, text) => { if (opts.sendFails) return fail(); sent.push({ via: "public", to: id, text }); return { ok: true }; },
    sendMessage: async (id, text) => { if (opts.sendFails) return fail(); sent.push({ via: "message", to: id, text }); return { ok: true }; },
  };
  const ctx: IgContext = { settings: { ...mergeFbSettings(over), hashtags: [] }, ownUsername: "SwiftCard", ownUserId: "1000", io, channel: FACEBOOK };
  return { ctx, events, queued, sent };
}
const POST = "1000_555000111";
const comment = (id: string, text: string, user = "u1") => ({ id, text, username: "Dana Reyes", userId: user, mediaId: POST, timestamp: new Date().toISOString() });

describe("the Facebook bot is off until the owner turns it on", () => {
  it("defaults: off, answers are drafts, the keyword is CARD", () => {
    expect(FB_DEFAULTS).toMatchObject({ enabled: false, auto_answers: false, keywords: ["CARD"] });
    expect(mergeFbSettings(null)).toEqual(FB_DEFAULTS);
    expect(FB_DEFAULTS.message).toContain("{link}");
    expect(mergeFbSettings({ message: "no link here" }).message).toBe(FB_DEFAULTS.message);
    expect(mergeFbSettings({ enabled: "yes" }).enabled).toBe(false);
  });
  it("while off, a CARD comment is filed for a one-tap Approve — nothing is sent", async () => {
    const h = harness();
    expect(await processComment(comment("c1", "CARD"), h.ctx)).toBe("queued");
    expect(h.sent).toEqual([]);
    expect(h.queued[0]).toMatchObject({ item_type: "fb_dm", target: "Dana Reyes", dedupe_key: "fb:comment:c1" });
    expect(h.queued[0].payload).toMatchObject({ platform: "facebook", comment_id: "c1", code: fbPostCode(POST) });
    expect(h.queued[0].content).toContain(campaignLink(fbPostCode(POST)));
    expect(h.events[0]).toMatchObject({ status: "queued", reason: "bot_is_off" });
  });
});

describe("when it is on", () => {
  it("CARD → the link in Messenger, tracked to that post, plus a short public reply", async () => {
    const h = harness({ enabled: true });
    expect(await processComment(comment("c2", "card please!"), h.ctx)).toBe("sent");
    expect(h.sent.map((s) => s.via)).toEqual(["private", "public"]);
    expect(h.sent[0].text).toContain(`/go/${fbPostCode(POST)}`);
    expect(h.sent[1].text).not.toMatch(/swiftcard\.me|https?:/);
    expect(FB_DEFAULTS.public_replies).toContain(h.sent[1].text);
  });
  it("one link per person per post, and never twice for the same comment", async () => {
    const h = harness({ enabled: true });
    await processComment(comment("c3", "CARD"), h.ctx);
    expect(await processComment(comment("c3", "CARD"), h.ctx)).toBe("seen");
    expect(await processComment(comment("c4", "CARD"), h.ctx)).toBe("skipped");
    expect(h.sent.filter((s) => s.via === "private")).toHaveLength(1);
  });
  it("a sentence that merely uses the word is not a request", async () => {
    const h = harness({ enabled: true });
    expect(await processComment(comment("c5", "love the card design on this one, really clean work"), h.ctx)).toBe("skipped");
    expect(h.sent).toEqual([]);
  });
  it("never answers the Page's own comments", async () => {
    const h = harness({ enabled: true });
    expect(await processComment({ ...comment("c6", "CARD"), userId: "1000" }, h.ctx)).toBe("own");
    expect(h.events).toEqual([]);
  });
  it("a question is drafted for the owner until the second switch is on", async () => {
    const draft = harness({ enabled: true });
    expect(await processComment(comment("c7", "does it work with Android?"), draft.ctx)).toBe("queued");
    expect(draft.queued[0]).toMatchObject({ item_type: "fb_reply", title: "Dana Reyes asked a question on Facebook" });
    expect(draft.sent).toEqual([]);
    const auto = harness({ enabled: true, auto_answers: true });
    expect(await processComment(comment("c8", "does it work with Android?"), auto.ctx)).toBe("sent");
    expect(auto.sent).toEqual([{ via: "public", to: "c8", text: "It's free to start." }]);
  });
  it("a Messenger message: CARD gets the link, a question gets a draft, 'thanks' gets nothing", async () => {
    const h = harness({ enabled: true });
    expect(await processMessage({ id: "m1", text: "CARD", userId: "psid1" }, h.ctx)).toBe("sent");
    expect(h.sent[0]).toMatchObject({ via: "message", to: "psid1" });
    expect(h.sent[0].text).toContain("/go/fb_dm");
    expect(await processMessage({ id: "m2", text: "how much is Pro?", userId: "psid2" }, h.ctx)).toBe("queued");
    expect(h.queued[0]).toMatchObject({ item_type: "fb_message", target_url: FACEBOOK.inbox, dedupe_key: "fb:message:m2" });
    expect(h.queued[0].payload).toMatchObject({ platform: "facebook", igsid: "psid2" });
    expect(await processMessage({ id: "m3", text: "thanks", userId: "psid3" }, h.ctx)).toBe("skipped");
  });
  it("when Facebook refuses for lack of permission, the owner gets it instead of a silent failure", async () => {
    const h = harness({ enabled: true }, { sendFails: { error: "(#200) Requires pages_messaging permission", code: 200 } });
    expect(await processComment(comment("c9", "CARD"), h.ctx)).toBe("queued");
    expect(h.events[0].reason).toMatch(/^facebook_refused: /);
    expect(h.queued).toHaveLength(1);
  });
});

describe("it can only answer people who wrote to the Page first", () => {
  const SEND = "src/lib/facebook-send.ts";
  it("every send needs a comment id or the id of someone who messaged us", () => {
    const c = code(SEND);
    const exported = [...c.matchAll(/export function (\w+)\(([^)]*)\)/g)].map((m) => [m[1], m[2]]);
    expect(exported.map(([n]) => n).sort()).toEqual(["fbPrivateReply", "fbReplyToComment", "fbSendMessage"]);
    expect(exported.find(([n]) => n === "fbPrivateReply")![1]).toContain("commentId");
    expect(exported.find(([n]) => n === "fbReplyToComment")![1]).toContain("commentId");
    expect(exported.find(([n]) => n === "fbSendMessage")![1]).toContain("psid");
    expect(c).not.toMatch(/username|\/likes|\/groups|friends|\/feed/i);
  });
  it("only the bot and the owner's Approve button can send", () => {
    const importers = walk("src").filter((f) => f !== SEND && /from "@\/lib\/facebook-send"/.test(read(f)));
    expect(importers.sort()).toEqual(["src/lib/agent-execute.ts", "src/lib/facebook-bot.ts"]);
  });
  it("the bot's own reads of the Page are GETs — its only writes go through the send module", () => {
    const c = code("src/lib/facebook-bot.ts");
    expect(c).not.toMatch(/method:\s*"(POST|DELETE|PUT)"/);
    expect(c).not.toMatch(/\/groups|\/feed\b/);
  });
  it("the scheduled route refuses a missing secret, and the admin route refuses a non-admin", () => {
    expect(code("src/app/api/agents/facebook/tick/route.ts")).toMatch(/if \(!botAuthorized\(req\)\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);
    expect(code("src/app/api/admin/agents/facebook/route.ts").match(/if \(!\(await requireAdmin\(\)\)\) return NextResponse\.json\(\{ error: "Forbidden" \}, \{ status: 403 \}\)/g)).toHaveLength(2);
  });
});

describe("Meta's webhook, for the Page", () => {
  const body = { object: "page", entry: [{
    id: "1000",
    changes: [
      { field: "feed", value: { item: "comment", verb: "add", comment_id: "555000111_9", post_id: POST, message: "CARD", from: { id: "42", name: "Dana Reyes" }, created_time: 1790000000 } },
      { field: "feed", value: { item: "comment", verb: "add", comment_id: "555000111_10", post_id: POST, message: "Sent! Check your Messenger", from: { id: "1000", name: "SwiftCard" } } },
      { field: "feed", value: { item: "comment", verb: "edited", comment_id: "555000111_11", post_id: POST, message: "CARD", from: { id: "43", name: "Sam" } } },
      { field: "feed", value: { item: "reaction", verb: "add", post_id: POST, from: { id: "44", name: "Lee" } } },
    ],
    messaging: [
      { sender: { id: "77" }, timestamp: 1790000000000, message: { mid: "m9", text: "how much?" } },
      { sender: { id: "1000" }, message: { mid: "m10", text: "echo of our own reply", is_echo: true } },
    ],
  }] };
  it("reads new comments and messages; drops our own, edits, reactions and echoes", () => {
    const r = parseFacebookWebhook(body);
    expect(r.comments).toEqual([{ id: "555000111_9", text: "CARD", username: "Dana Reyes", userId: "42", mediaId: POST, timestamp: new Date(1790000000 * 1000).toISOString() }]);
    expect(r.messages.map((m) => m.id)).toEqual(["m9"]);
    expect(parseFacebookWebhook({ object: "instagram", entry: [] })).toEqual({ comments: [], messages: [] });
    expect(parseFacebookWebhook(null)).toEqual({ comments: [], messages: [] });
  });
  it("the one webhook route serves both, after the signature check", () => {
    const c = code("src/app/api/meta/webhook/route.ts");
    expect(c.indexOf("verifyMetaSignature(raw")).toBeLessThan(c.indexOf("handleFacebookWebhook(body)"));
    expect(c).toContain("handleWebhook(body)");
    const oauth = read("src/lib/agent-connect-oauth.ts");
    expect(oauth).toContain("subscribed_fields=messages,feed");
    for (const p of ["pages_read_engagement", "pages_manage_engagement", "pages_read_user_content", "pages_messaging"]) expect(oauth).toContain(p);
  });
});

describe("every Facebook signup is countable", () => {
  it("each post's link code is a valid signup source", () => {
    const c = fbPostCode(POST);
    expect(c).toMatch(/^fb_p_[a-z0-9]+$/);
    expect(isCampaignSource(c)).toBe(true);
    expect(isSignupSource(c)).toBe(true);
    expect(fbPostCode("not a post id")).toBe("fb_dm");
    expect(fbPostCode("1000_555000111")).not.toBe(fbPostCode("1000_555000112"));
    expect(isCampaignSource("fb_dm")).toBe(true);
    expect(isCampaignSource("fb_page")).toBe(true);
    expect(getSignupSourceLabel(c)).toMatch(/^Facebook/);
  });
  it("the admin route ranks posts by signups under those codes", () => {
    const route = code("src/app/api/admin/agents/facebook/route.ts");
    expect(route).toMatch(/\.like\("signup_source", "fb\\\\_%"\)/);
    expect(route).toMatch(/\.sort\(\(a, b\) => b\.signups - a\.signups/);
  });
});

describe("the owner's surface and the schedule", () => {
  it("Approve sends the three Facebook kinds; without a connection they are Approve & Copy", () => {
    const exec = code("src/lib/agent-execute.ts");
    expect(exec).toMatch(/FB_ENGAGE_KINDS = new Set\(\["fb_dm", "fb_reply", "fb_message"\]\)/);
    expect(exec).toMatch(/ready: \(c\) => !!c\.meta\?\.meta\.page_id,\s*matches: \(it\) => FB_ENGAGE_KINDS\.has\(it\.item_type\)/);
    const ui = code("src/app/admin/agent-flow/AgentFlowClient.tsx");
    expect(ui).toMatch(/id: "facebook_engage"/);
    for (const k of ["fb_dm", "fb_reply", "fb_message"]) expect(ui).toMatch(new RegExp(`COPY_KINDS = new Set\\(\\[[^\\]]*"${k}"`));
    expect(read("src/app/admin/agent-flow/AgentFlowClient.tsx")).toContain("<FacebookBotCard />");
  });
  it("runs every 10 minutes from GitHub (Vercel Hobby has no spare cron)", () => {
    const wf = read(".github/workflows/facebook-bot.yml");
    expect(wf).toContain('cron: "5-59/10 * * * *"');
    expect(wf).toContain("https://swiftcard.me/api/agents/facebook/tick");
    expect(read("vercel.json")).not.toContain("facebook");
  });
  it("the schema is service-role only and de-duplicates on Facebook's own id", () => {
    const sql = read("supabase/agent-facebook.sql");
    expect(sql).toMatch(/unique \(kind, external_id\)/);
    expect(sql).toMatch(/alter table agent_fb_events enable row level security/);
    expect(sql).toMatch(/alter table agent_fb_posts\s+enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
  });
  it("Milo ends every Facebook post with the keyword call to action, and leaves groups alone", () => {
    const brief = read("marketing-agents/agents/social.md");
    expect(brief).toContain("Comment CARD and we'll send you one.");
    expect(brief).toMatch(/Facebook GROUPS are not yours and not the bot's/);
  });
});
