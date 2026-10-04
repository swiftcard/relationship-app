import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import {
  IG_DEFAULTS, buildDm, isQuestion, matchKeyword, mergeIgSettings, parseWebhook, pickPublicReply, postCode,
  processComment, processMessage, verifyMetaSignature,
  type IgContext, type IgEventRow, type IgIo, type IgQueueItem, type IgSettings,
} from "@/lib/instagram-bot";
import { isCampaignSource, isSignupSource } from "@/lib/referral";
import { campaignDestination, campaignLink, PROFESSION_TEMPLATE } from "@/lib/campaign-links";
import { campaignSourceLabel, getSignupSourceLabel } from "@/lib/source-labels";
import { isSocialInAppBrowser } from "@/lib/in-app-browser";
import { PRESET_TEMPLATES } from "@/components/card-templates/TemplatePicker";

// Owner order 2026-10-02: the Instagram bot — "Comment CARD and I'll send you
// one" — built for one thing, signups. These pin the rules that keep it safe
// (it only answers people who wrote to us, once, and only when switched on)
// and the tracking that makes a signup countable per post.

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

// ── A fake Instagram + database, so the decisions can be run for real ────────
function harness(over: Partial<IgSettings> = {}, opts: { sendFails?: { error: string; code?: number }; answer?: string | null; sentToday?: number } = {}) {
  const events: Array<IgEventRow & { id: string; item_id?: string | null }> = [];
  const queued: IgQueueItem[] = [];
  const sent: Array<{ via: string; to: string; text: string }> = [];
  let answers = 0;
  const fail = () => ({ ok: false as const, error: opts.sendFails!.error, code: opts.sendFails!.code });
  const io: IgIo = {
    record: async (row) => {
      if (events.some((e) => e.kind === row.kind && e.external_id === row.external_id)) return null;
      const id = `e${events.length + 1}`;
      events.push({ ...row, id });
      return id;
    },
    update: async (id, patch) => { Object.assign(events.find((e) => e.id === id)!, patch); },
    alreadyLinked: async (userId, mediaId) => events.some((e) => e.ig_user_id === userId && e.media_id === mediaId && e.action === "link" && ["sent", "queued", "new"].includes(e.status)),
    sentToday: async () => opts.sentToday ?? events.filter((e) => e.status === "sent").length,
    queue: async (item) => { queued.push(item); return `q${queued.length}`; },
    permalink: async () => "https://www.instagram.com/reel/abc/",
    answer: async () => { answers++; return opts.answer === undefined ? "It's free to start." : opts.answer; },
    privateReply: async (id, text) => { if (opts.sendFails) return fail(); sent.push({ via: "private", to: id, text }); return { ok: true }; },
    replyToComment: async (id, text) => { if (opts.sendFails) return fail(); sent.push({ via: "public", to: id, text }); return { ok: true }; },
    sendMessage: async (id, text) => { if (opts.sendFails) return fail(); sent.push({ via: "message", to: id, text }); return { ok: true }; },
  };
  const ctx: IgContext = { settings: mergeIgSettings({ ...over }), ownUsername: "swiftcard", ownUserId: "999", io };
  return { ctx, events, queued, sent, answers: () => answers };
}
const comment = (id: string, text: string, user = "u1", media = "17900000000000001") =>
  ({ id, text, username: `user_${user}`, userId: user, mediaId: media, timestamp: new Date().toISOString() });

describe("the keyword: a short comment that asks for it", () => {
  it("matches the keyword on its own or in a short ask, any case, with punctuation or emoji", () => {
    for (const t of ["CARD", "card", "Card!", "card please", "CARD 🙌🙌", "send me the card"]) expect(matchKeyword(t, ["CARD"]), t).toBe("CARD");
  });
  it("does not treat a sentence that merely uses the word as a request", () => {
    for (const t of ["love the card design on this one", "my business card looks nothing like that honestly", "cardio day", "discard", ""]) {
      expect(matchKeyword(t, ["CARD"]), t).toBeNull();
    }
  });
  it("knows a question from a compliment", () => {
    expect(isQuestion("how much does it cost?")).toBe(true);
    expect(isQuestion("does it work on android")).toBe(true);
    expect(isQuestion("🔥🔥🔥")).toBe(false);
    expect(isQuestion("love this")).toBe(false);
  });
});

describe("OFF by default — nothing is sent until the owner turns it on", () => {
  it("ships switched off, with answers as drafts", () => {
    expect(IG_DEFAULTS.enabled).toBe(false);
    expect(IG_DEFAULTS.auto_answers).toBe(false);
    expect(mergeIgSettings(null).enabled).toBe(false);
    // Only a literal true turns it on — a truthy string from a bad save does not.
    expect(mergeIgSettings({ enabled: "true", auto_answers: 1 }).enabled).toBe(false);
    expect(mergeIgSettings({ enabled: "true", auto_answers: 1 }).auto_answers).toBe(false);
  });
  it("while off, a keyword comment is filed for a one-tap Approve and nothing goes out", async () => {
    const h = harness();
    expect(await processComment(comment("c1", "CARD"), h.ctx)).toBe("queued");
    expect(h.sent).toEqual([]);
    expect(h.queued).toHaveLength(1);
    expect(h.queued[0].item_type).toBe("ig_dm");
    expect(h.queued[0].payload.comment_id).toBe("c1");
    expect(h.queued[0].content).toContain("/go/ig_p_");
    expect(h.events[0].reason).toBe("bot_is_off");
  });
});

describe("switched on: the card link goes out once", () => {
  it("sends the link privately, then a public reply, and records it as sent", async () => {
    const h = harness({ enabled: true });
    expect(await processComment(comment("c1", "card please"), h.ctx)).toBe("sent");
    expect(h.sent.map((s) => s.via)).toEqual(["private", "public"]);
    expect(h.sent[0].to).toBe("c1");
    expect(h.sent[0].text).toContain(`https://swiftcard.me/go/${postCode("17900000000000001")}`);
    expect(h.events[0]).toMatchObject({ status: "sent", action: "link", keyword: "CARD" });
    expect(h.queued).toEqual([]);
  });
  it("the same comment arriving twice (webhook + the 10-minute pass) sends once", async () => {
    const h = harness({ enabled: true });
    await processComment(comment("c1", "CARD"), h.ctx);
    expect(await processComment(comment("c1", "CARD"), h.ctx)).not.toBe("sent");
    expect(h.sent.filter((s) => s.via === "private")).toHaveLength(1);
  });
  it("one link per person per post — a second 'CARD' from them is not messaged again", async () => {
    const h = harness({ enabled: true });
    await processComment(comment("c1", "CARD", "u1"), h.ctx);
    expect(await processComment(comment("c2", "CARD!!", "u1"), h.ctx)).toBe("skipped");
    expect(h.sent.filter((s) => s.via === "private")).toHaveLength(1);
    // …but the same person on a DIFFERENT post asked again, and gets that post's link.
    expect(await processComment(comment("c3", "CARD", "u1", "17900000000000002"), h.ctx)).toBe("sent");
    // …and a different person on the first post is a new request.
    expect(await processComment(comment("c4", "CARD", "u2"), h.ctx)).toBe("sent");
  });
  it("stops at the daily cap and hands the rest to the owner", async () => {
    const h = harness({ enabled: true, daily_cap: 5 }, { sentToday: 5 });
    expect(await processComment(comment("c1", "CARD"), h.ctx)).toBe("queued");
    expect(h.sent).toEqual([]);
    expect(h.events[0].reason).toBe("daily_cap_reached");
  });
  it("never answers our own comments, or ones too old for Instagram to allow", async () => {
    const h = harness({ enabled: true });
    expect(await processComment({ ...comment("c1", "CARD"), username: "SwiftCard", userId: "999" }, h.ctx)).toBe("own");
    expect(await processComment({ ...comment("c2", "CARD"), timestamp: new Date(Date.now() - 8 * 86400e3).toISOString() }, h.ctx)).toBe("skipped");
    expect(h.sent).toEqual([]);
  });
  it("a compliment is recorded and left alone", async () => {
    const h = harness({ enabled: true });
    expect(await processComment(comment("c1", "love this 🔥"), h.ctx)).toBe("skipped");
    expect(h.sent).toEqual([]);
    expect(h.queued).toEqual([]);
  });
  it("when Instagram refuses for lack of permission, the owner gets it instead of a silent failure", async () => {
    const h = harness({ enabled: true }, { sendFails: { error: "(#10) Application does not have permission for this action", code: 10 } });
    expect(await processComment(comment("c1", "CARD"), h.ctx)).toBe("queued");
    expect(h.queued[0].item_type).toBe("ig_dm");
    expect(h.events[0].reason).toMatch(/^instagram_refused/);
  });
  it("any other send error is recorded as failed, not retried into a duplicate", async () => {
    const h = harness({ enabled: true }, { sendFails: { error: "This comment was deleted", code: 100 } });
    expect(await processComment(comment("c1", "CARD"), h.ctx)).toBe("failed");
    expect(h.events[0].status).toBe("failed");
  });
});

describe("questions: the sales assistant drafts, the owner's second switch sends", () => {
  it("a question becomes a draft in the queue while auto_answers is off — even with the bot on", async () => {
    const h = harness({ enabled: true });
    expect(await processComment(comment("c1", "how much does it cost?"), h.ctx)).toBe("queued");
    expect(h.sent).toEqual([]);
    expect(h.queued[0]).toMatchObject({ item_type: "ig_reply", content: "It's free to start." });
  });
  it("with both switches on, the answer is posted under the comment", async () => {
    const h = harness({ enabled: true, auto_answers: true });
    expect(await processComment(comment("c1", "does it work on android?"), h.ctx)).toBe("sent");
    expect(h.sent).toEqual([{ via: "public", to: "c1", text: "It's free to start." }]);
  });
  it("no answer in the knowledge base → it goes to the owner, never a canned line", async () => {
    const h = harness({ enabled: true, auto_answers: true }, { answer: null });
    expect(await processComment(comment("c1", "can you integrate with my brokerage's CRM?"), h.ctx)).toBe("queued");
    expect(h.sent).toEqual([]);
    expect(h.events[0].reason).toBe("no_answer");
  });
  it("a comment already handled does not cost another model call", async () => {
    const h = harness({ enabled: true });
    await processComment(comment("c1", "how much is it?"), h.ctx);
    await processComment(comment("c1", "how much is it?"), h.ctx);
    expect(h.answers()).toBe(1);
  });
  it("a message asking for the keyword gets the link; a question waits for the second switch", async () => {
    const h = harness({ enabled: true });
    expect(await processMessage({ id: "m1", text: "CARD", userId: "u5" }, h.ctx)).toBe("sent");
    expect(h.sent[0]).toMatchObject({ via: "message", to: "u5" });
    expect(h.sent[0].text).toContain("/go/ig_dm");
    expect(await processMessage({ id: "m2", text: "is there a free plan?", userId: "u6" }, h.ctx)).toBe("queued");
    expect(await processMessage({ id: "m3", text: "thanks!", userId: "u6" }, h.ctx)).toBe("skipped");
    expect(h.sent).toHaveLength(1);
  });
});

describe("it cannot write to anyone who did not write to us first", () => {
  const SEND = "src/lib/instagram-send.ts";
  it("the three sends each need a comment id or a messaging id — there is no send by username", () => {
    const c = code(SEND);
    const exported = [...c.matchAll(/export function (\w+)\(([^)]*)\)/g)].map((m) => [m[1], m[2]]);
    expect(exported.map(([n]) => n).sort()).toEqual(["igPrivateReply", "igReplyToComment", "igSendMessage", "isAccessError"]);
    expect(exported.find(([n]) => n === "igPrivateReply")![1]).toContain("commentId");
    expect(exported.find(([n]) => n === "igReplyToComment")![1]).toContain("commentId");
    expect(exported.find(([n]) => n === "igSendMessage")![1]).toContain("igsid");
    expect(c).not.toMatch(/username|\/follow|\/likes|business_discovery/i);
  });
  it("only the bot and the owner's Approve button can send", () => {
    const importers = walk("src").filter((f) => f !== SEND && /from "@\/lib\/instagram-send"/.test(read(f)));
    expect(importers.sort()).toEqual(["src/lib/agent-execute.ts", "src/lib/instagram-bot.ts"]);
  });
  it("the bot's own reads of Instagram are GETs — its only writes go through the send module", () => {
    const c = code("src/lib/instagram-bot.ts");
    expect(c).not.toMatch(/method:\s*"(POST|DELETE|PUT)"/);
    // The Radar's side stays read-only too.
    const radar = code("marketing-agents/lib/radar.mjs");
    expect(radar).toContain("/api/agents/instagram/hashtags");
    expect(radar).not.toMatch(/graph\.facebook\.com|\/me\/messages|\/replies/);
  });
  it("the scheduled routes refuse a missing or short secret", () => {
    const c = code("src/lib/instagram-bot-auth.ts");
    expect(c).toMatch(/if \(!auth\) return false/);
    expect(c).toMatch(/s\.length >= 16/);
    for (const r of ["src/app/api/agents/instagram/tick/route.ts", "src/app/api/agents/instagram/hashtags/route.ts"]) {
      expect(code(r)).toMatch(/if \(!botAuthorized\(req\)\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);
    }
  });
});

describe("Meta's webhook", () => {
  const secret = "app-secret-for-tests";
  const body = JSON.stringify({ object: "instagram", entry: [{
    changes: [{ field: "comments", value: { id: "c9", text: "CARD", from: { id: "42", username: "maya" }, media: { id: "17900000000000001" } } }],
    messaging: [
      { sender: { id: "77" }, timestamp: 1790000000000, message: { mid: "m9", text: "how much?" } },
      { sender: { id: "999" }, message: { mid: "m10", text: "echo of our own reply", is_echo: true } },
    ],
  }] });
  const sign = (b: string, s = secret) => `sha256=${createHmac("sha256", s).update(b, "utf8").digest("hex")}`;

  it("accepts only a body signed with the app secret", () => {
    expect(verifyMetaSignature(body, sign(body), secret)).toBe(true);
    expect(verifyMetaSignature(body + " ", sign(body), secret)).toBe(false);
    expect(verifyMetaSignature(body, sign(body, "someone-else"), secret)).toBe(false);
    expect(verifyMetaSignature(body, null, secret)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", secret)).toBe(false);
    // No secret configured must never mean "anything goes".
    expect(verifyMetaSignature(body, sign(body, ""), undefined)).toBe(false);
  });
  it("the route checks the signature over the raw body before doing anything", () => {
    const c = code("src/app/api/meta/webhook/route.ts");
    expect(c.indexOf("await req.text()")).toBeGreaterThan(-1);
    expect(c.indexOf("verifyMetaSignature(raw")).toBeLessThan(c.indexOf("handleWebhook("));
    expect(c).toMatch(/hub\.verify_token"\) === expected/);
    expect(c).toMatch(/if \(expected && /);
  });
  it("reads comments and messages, and drops echoes of our own sends", () => {
    const r = parseWebhook(JSON.parse(body));
    expect(r.comments).toEqual([{ id: "c9", text: "CARD", username: "maya", userId: "42", mediaId: "17900000000000001" }]);
    expect(r.messages.map((m) => m.id)).toEqual(["m9"]);
    expect(parseWebhook({ object: "page", entry: [] })).toEqual({ comments: [], messages: [] });
    expect(parseWebhook(null)).toEqual({ comments: [], messages: [] });
  });
});

describe("every Instagram signup is countable", () => {
  it("campaign codes are valid signup sources (they were dropped to 'direct' before)", () => {
    for (const s of ["ig_bio", "ig_dm", "ig_ad", "ig_prospect", "ig_creator_maya_sells", postCode("17900000000000001"), "li_page", "fb_ad"]) {
      expect(isSignupSource(s), s).toBe(true);
      expect(isCampaignSource(s), s).toBe(true);
    }
    for (const s of ["ig_", "instagram", "ig_Bio", "ig_bio;drop", "xx_bio"]) expect(isCampaignSource(s), s).toBe(false);
  });
  it("each post gets its own short, valid code", () => {
    const a = postCode("17900000000000001"), b = postCode("17900000000000002");
    expect(a).toMatch(/^ig_p_[a-z0-9]{6,20}$/);
    expect(a).not.toBe(b);
    expect(postCode("not-a-number")).toBe("ig_dm");
  });
  it("the message carries that post's link, on the chosen profession's design", () => {
    const s = mergeIgSettings({ profession: "real-estate-agents" });
    expect(buildDm(s, "ig_p_abc")).toContain("https://swiftcard.me/go/ig_p_abc?for=real-estate-agents");
    expect(buildDm(mergeIgSettings({}), "ig_p_abc")).toContain("https://swiftcard.me/go/ig_p_abc");
    // A message saved without {link} would send a greeting with nothing to tap.
    expect(mergeIgSettings({ message: "hi there" }).message).toBe(IG_DEFAULTS.message);
    expect(code("src/app/api/admin/agents/instagram/route.ts")).toMatch(/!body\.settings\.message\.includes\("\{link\}"\)/);
  });
  it("/go/<code> lands in the builder with the source, and on the profession's template", () => {
    expect(campaignDestination("ig_bio")).toBe("/cards/new?src=ig_bio");
    expect(campaignDestination("ig_bio", "real-estate-agents")).toBe("/cards/new?src=ig_bio&template=photo-first");
    // A mistyped code still reaches the builder — never a dead end, never a bogus source.
    expect(campaignDestination("nonsense")).toBe("/cards/new");
    expect(campaignLink("ig_bio")).toBe("https://swiftcard.me/go/ig_bio");
    const ids = new Set(PRESET_TEMPLATES.map((t) => t.id));
    for (const [slug, t] of Object.entries(PROFESSION_TEMPLATE)) expect(ids.has(t), `${slug} → ${t}`).toBe(true);
  });
  it("the /go route counts real taps only, and is a temporary redirect", () => {
    const c = code("src/app/go/[code]/route.ts");
    expect(c).toContain('name: "campaign_link_clicked"');
    expect(c).toMatch(/next-router-prefetch"\) === "1" \|\| isLikelyBot/);
    expect(c).toContain("307");
    expect(c).not.toContain("308");
    // Clicks are written by our server only — a browser cannot forge them.
    expect(code("src/lib/events.ts")).toMatch(/SERVER_EVENTS = \["campaign_link_clicked"\]/);
    expect(read("src/lib/slug.ts")).toMatch(/"go"/);
  });
  it("the admin reads a campaign source as words", () => {
    expect(campaignSourceLabel("ig_bio")).toBe("Instagram — bio link");
    expect(getSignupSourceLabel("ig_p_ab12")).toBe("Instagram — post ab12");
    expect(getSignupSourceLabel("ig_creator_maya")).toBe("Instagram — creator @maya");
    expect(campaignSourceLabel("badge")).toBeNull();
  });
  it("the public reply is stable per comment and varies across comments", () => {
    const s = mergeIgSettings({});
    expect(pickPublicReply(s, "c1")).toBe(pickPublicReply(s, "c1"));
    expect(new Set(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].map((c) => pickPublicReply(s, c))).size).toBeGreaterThan(1);
  });
});

describe("Instagram's own browser must not strand a signup", () => {
  it("recognises the in-app browsers Google refuses to sign in from", () => {
    expect(isSocialInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.20.100 (iPhone15,2; iOS 18_0)")).toBe(true);
    expect(isSocialInAppBrowser("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]")).toBe(true);
    expect(isSocialInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isSocialInAppBrowser(null)).toBe(false);
  });
  it("the Google button steps aside there and points at email signup", () => {
    const c = code("src/components/GoogleSignInButton.tsx");
    expect(c).toMatch(/isSocialInAppBrowser\(navigator\.userAgent\)[\s\S]{0,120}setPhase\("in_app"\)/);
    expect(c).toMatch(/phase === "in_app"[\s\S]{0,300}Use your email below/);
  });
});

describe("the owner's surface and the schedule", () => {
  it("Approve sends the three Instagram kinds; without a connection they are Approve & Copy", () => {
    const exec = code("src/lib/agent-execute.ts");
    expect(exec).toMatch(/IG_ENGAGE_KINDS = new Set\(\["ig_dm", "ig_reply", "ig_message"\]\)/);
    const ui = code("src/app/admin/agent-flow/AgentFlowClient.tsx");
    expect(ui).toMatch(/id: "instagram_engage"/);
    for (const k of ["ig_dm", "ig_reply", "ig_message", "ig_comment"]) expect(ui).toMatch(new RegExp(`COPY_KINDS = new Set\\(\\[[^\\]]*"${k}"`));
    expect(read("src/app/admin/agent-flow/AgentFlowClient.tsx")).toContain("<InstagramBotCard />");
  });
  it("runs every 10 minutes from GitHub (Vercel Hobby has no spare cron)", () => {
    const wf = read(".github/workflows/instagram-bot.yml");
    expect(wf).toContain('cron: "*/10 * * * *"');
    expect(wf).toContain("https://swiftcard.me/api/agents/instagram/tick");
    expect(read("vercel.json")).not.toContain("instagram");
  });
  it("the schema is service-role only and de-duplicates on Instagram's own id", () => {
    const sql = read("supabase/agent-instagram.sql");
    expect(sql).toMatch(/unique \(kind, external_id\)/);
    expect(sql).toMatch(/alter table agent_ig_events enable row level security/);
    expect(sql).toMatch(/alter table agent_ig_posts\s+enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
  });
  it("the Radar routes Instagram hashtag posts to Ava as prospects, and her brief knows what to do", () => {
    const radar = read("marketing-agents/lib/radar.mjs");
    expect(radar).toMatch(/instagram_hashtag: "instagram"/);
    expect(radar).toMatch(/intent === "prospect"\) return "outreach"/);
    expect(read("marketing-agents/agents/outreach.md")).toContain("`ig_comment`");
    expect(read("marketing-agents/agents/social.md")).toContain("Comment CARD and I'll send you one.");
  });
});

// ── TikTok (owner order 2026-10-02): "reuse the best Instagram videos" ───────
// No tool may post to TikTok or reply there (its Content Sharing Guidelines
// rule out a utility that uploads to your own account), so the bot is the
// hand-off: the agent writes the TikTok version of what converted on Instagram,
// the queue hands over the video file, and the bio link makes signups countable.
describe("TikTok: prepared by agents, posted by hand, counted by signups", () => {
  it("TikTok links are valid sources, read as words, and land in the builder", () => {
    for (const s of ["tt_bio", "tt_dm", "tt_creator_maya"]) expect(isSignupSource(s), s).toBe(true);
    expect(getSignupSourceLabel("tt_bio")).toBe("TikTok — bio link");
    expect(getSignupSourceLabel("tt_creator_maya")).toBe("TikTok — creator @maya");
    expect(campaignLink("tt_bio")).toBe("https://swiftcard.me/go/tt_bio");
    expect(campaignDestination("tt_bio")).toBe("/cards/new?src=tt_bio");
  });
  it("TikTok's own browser gets email signup, not a Google button that cannot work", () => {
    expect(isSocialInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.0.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US")).toBe(true);
    expect(isSocialInAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0 Mobile Safari/537.36 trill_360000 BytedanceWebview/d8a21c6")).toBe(true);
  });
  it("there is still no TikTok posting code — the owner posts it", () => {
    const exec = code("src/lib/agent-execute.ts");
    expect(exec).not.toMatch(/tiktokapis|open\.tiktok|tiktok\.com/i);
    expect(read("src/lib/agent-connections.ts")).not.toMatch(/"tiktok"/);
  });
  it("the queue hands over the video file, so a hand-posted item is postable", () => {
    const route = code("src/app/api/admin/agents/items/route.ts");
    expect(route).toMatch(/assets: await assetsFor\(admin, data \?\? \[\]\)/);
    expect(route).toMatch(/a\.status === "ready" && a\.url/);
    const ui = read("src/app/admin/agent-flow/AgentFlowClient.tsx");
    expect(ui).toContain("<AssetFiles payload={it.payload} assets={assets} />");
    expect(ui).toContain("Download the video");
  });
  it("Milo writes the TikTok version of what converted, with the bio-link call to action", () => {
    const brief = read("marketing-agents/agents/social.md");
    expect(brief).toContain("NOT on TikTok yet");
    expect(brief).toContain("Free card: link in bio.");
    expect(brief).toMatch(/Do NOT write\s+"Comment CARD" on TikTok/);
    const insights = read("marketing-agents/lib/insights.mjs");
    expect(insights).toContain("NOT on TikTok yet");
    expect(insights).toMatch(/social: instagramBlock, ads: instagramBlock/);
  });
  it("the Sunday scorecard and the Tracked links card report TikTok by signups", () => {
    const sc = read("marketing-agents/scorecard.mjs");
    expect(sc).toMatch(/\["tt", "TikTok"\]/);
    for (const row of ["· link taps`", "· signups`", "· Pro trials`"]) expect(sc).toContain(row);
    const links = code("src/app/api/admin/agents/links/route.ts");
    expect(links).toMatch(/if \(!\(await requireAdmin\(\)\)\)/);
    expect(links).toContain("swiftcard-test.invalid");
    expect(read("src/app/admin/agent-flow/AgentFlowClient.tsx")).toContain("<TrackedLinksCard />");
  });
});

// ── LinkedIn (owner order 2026-10-04) ────────────────────────────────────────
// LinkedIn gives no API for finding people and its search cannot be driven
// from the owner's account (it signed him out). The finder therefore reads
// public new-hire announcements — "Newcastle Realty welcomes John Pedlowe" —
// through Google News RSS inside the Radar, and Ava finds the person on
// LinkedIn and writes the comment + connection note the owner sends.
describe("LinkedIn: new-hire announcements → Ava → the owner's tap", () => {
  it("the Radar has a hires source, read-only, routed to Ava as prospects", () => {
    const radar = read("marketing-agents/lib/radar.mjs");
    expect(radar).toMatch(/hires_feed: "hires"/);
    expect(radar).toMatch(/platform === "hires"\) c = \{ intent: "prospect"/);
    expect(radar).toMatch(/kind === "hires_feed"\) await finish\(s, await readFeed\(/);
    expect(radar).toContain("when:7d");
    const cfg = JSON.parse(read("marketing-agents/config.json"));
    expect(Array.isArray(cfg.radar.hire_queries) && cfg.radar.hire_queries.length).toBeTruthy();
    expect(read("src/app/api/admin/agents/radar/route.ts")).toContain('"hire_queries"');
    expect(read("src/app/admin/agent-flow/AgentFlowClient.tsx")).toContain('["hire_queries", ');
  });
  it("Ava's and Milo's LinkedIn rules carry the tracked links and the Page-only rule", () => {
    const ava = read("marketing-agents/agents/outreach.md");
    expect(ava).toContain("`li_prospect`");
    expect(ava).toContain("swiftcard.me/go/li_dm");
    expect(ava).toMatch(/under 300 characters/);
    expect(ava).toMatch(/Never a link in a public\s+comment/);
    const milo = read("marketing-agents/agents/social.md");
    expect(milo).toContain("swiftcard.me/go/li_post");
    expect(milo).toMatch(/never a\s+person/);
    for (const s of ["li_dm", "li_post", "li_page", "rd_realtors"]) expect(isSignupSource(s), s).toBe(true);
    expect(getSignupSourceLabel("li_post")).toBe("LinkedIn — post");
  });
  it("the Sunday scorecard reports every social platform by signups", () => {
    const sc = read("marketing-agents/scorecard.mjs");
    expect(sc).toMatch(/\["ig", "Instagram"\], \["tt", "TikTok"\], \["li", "LinkedIn"\], \["rd", "Reddit"\], \["fb", "Facebook"\]/);
    expect(sc).toContain("· signups`");
  });
});

// ── Pinterest + YouTube (owner order 2026-10-04): long-term traffic ─────────
describe("Pinterest: every pin is a real design, posted once, linking back", () => {
  it("every pin idea has a persona the homepage renders, a board, and a valid code", async () => {
    const { PIN_IDEAS, pinCode } = await import("@/lib/pinterest-pins");
    const src = read("src/components/site/HeroShowcase.tsx");
    expect(PIN_IDEAS.length).toBeGreaterThanOrEqual(10);
    for (const p of PIN_IDEAS) {
      expect(src, `${p.slug}: persona "${p.persona}" is not a homepage persona`).toContain(`key: "${p.persona}"`);
      expect(isCampaignSource(pinCode(p.slug)), pinCode(p.slug)).toBe(true);
      expect(p.description.length).toBeLessThanOrEqual(800);
      expect(p.headline.length).toBeLessThanOrEqual(100);
    }
    expect(new Set(PIN_IDEAS.map((p) => p.slug)).size).toBe(PIN_IDEAS.length);
    expect(getSignupSourceLabel("pin_luxury_business_cards")).toBe("Pinterest — luxury business cards");
  });
  it("the pin page is static and noindex, and the picture is 1000×1500", () => {
    const page = read("src/app/pin/[slug]/page.tsx");
    expect(page).toContain('export const dynamic = "force-static"');
    expect(page).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(read("src/app/pin/[slug]/PinPicture.tsx")).toMatch(/width: PIN_W, height: PIN_H/);
    const idx = read("src/lib/knowledge/index.ts");
    expect(idx).toContain('"/pin/[slug]"');
  });
  it("the route posts each idea once, needs the bot secret, and links through /go", () => {
    const r = code("src/app/api/agents/pinterest/pin/route.ts");
    expect(r).toMatch(/if \(!botAuthorized\(req\)\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);
    expect(r).toMatch(/existing\?\.status === "posted"\) return NextResponse\.json\(\{ ok: true, already: true/);
    expect(r).toContain("campaignLink(code, idea.profession)");
    expect(r).toContain("onConflict: \"slug\"");
    const script = read("scripts/pinterest-pins.mjs");
    expect(script).toContain("/api/agents/pinterest/pin");
    expect(script).toMatch(/viewport: \{ width: 1000, height: 1500 \}/);
    expect(read(".github/workflows/pinterest-pins.yml")).toContain("node scripts/pinterest-pins.mjs");
    expect(read("supabase/agent-pinterest.sql")).toMatch(/values \('pins', 'pins', true\)/);
  });
  it("Pinterest is a connectable account with a refresh path", () => {
    const conns = read("src/lib/agent-connections.ts");
    expect(conns).toContain('"pinterest"');
    expect(conns).toMatch(/conn\.provider === "pinterest"/);
    const oauth = read("src/lib/agent-connect-oauth.ts");
    expect(oauth).toContain("https://www.pinterest.com/oauth/");
    expect(oauth).toContain("https://api.pinterest.com/v5/oauth/token");
    expect(read("src/app/admin/agent-flow/AgentFlowClient.tsx")).toContain('id: "pinterest"');
  });
  it("YouTube: titles are the search, and the description carries the tracked link", () => {
    const milo = read("marketing-agents/agents/social.md");
    expect(milo).toMatch(/Best digital business card for\s+realtors/);
    expect(milo).toContain("swiftcard.me/go/yt_<slug>");
    expect(milo).toMatch(/lands PRIVATE/);
    expect(read("marketing-agents/agents/video.md")).toContain("YouTube how-tos");
    expect(isSignupSource("yt_linq_alternative")).toBe(true);
  });
});
