import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLUESKY_QUERIES, blueskyReplies, guessAuthor, interleave, isOwnBlueskyHandle, REPLIES } from "@/lib/crew/agents/replies";
import { competitorFacts, freshFacts } from "@/lib/crew/facts";
import { normalizeHandle } from "@/lib/crew/ledger";
import { runEngagement, type Candidate } from "@/lib/crew/replies/engine";
import { searchBluesky, toPosts } from "@/lib/crew/sources/bluesky";
import { rulesBanPromotion } from "@/lib/crew/sources/reddit";
import { AGENTS } from "@/lib/crew/registry";
import { fakeAgent, setup } from "./crew-helpers";

// Phase 2, the Replies team: drafts only, a cap per day, no product mention
// where a community bans it, disclosure and a tracked link where it's allowed,
// and competitor claims only from fresh, sourced facts.

const post = (i: number, o: Partial<Candidate> = {}): Candidate => ({
  platform: "reddit",
  url: `https://www.reddit.com/r/realtors/comments/${i}/x/`,
  author: `agent${i}`,
  title: `Linktree is getting expensive, alternatives? #${i}`,
  text: "I pay for Linktree and a separate digital business card app. Anyone combine both?",
  community: "realtors",
  promoAllowed: true,
  ...o,
});

function script(draft: string) {
  return (req: { schema?: unknown; prompt: string }) => {
    if (req.schema && JSON.stringify(req.schema).includes("asks_for_tools")) {
      const n = (req.prompt.match(/^#\d+/gm) ?? []).length;
      return JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ i, score: 0.9 - i * 0.01, why: "They want one tool for a card and a link page", angle: "combine card and link page", asks_for_tools: true, business_pro: true })) });
    }
    return draft;
  };
}

describe("the engagement engine", () => {
  it("drafts up to today's full target from day one (no warm-up, owner 2026-10-29), with disclosure and a tracked link", async () => {
    const { ctx, store } = await setup({ def: fakeAgent({ id: "replies-reddit", maxPending: 10 }), script: script("Same boat last year. I moved to SwiftCard since it does the card and the link page together: https://swiftcard.me/go/rd_cr_reply_abc") });
    // An old warmed-up ceiling in the database follows the code's target.
    await store.setRateLimit("reddit", "reply", 8, new Date().toISOString().slice(0, 10));
    const r = await runEngagement(ctx, { platform: "reddit", kind: "reply", action: "reply", ceiling: 3, register: "", length: "", label: (c) => c.title, find: async () => [post(1), post(2), post(3), post(4)] });
    expect(r.summary).toMatch(/added 3 to the Sheet/);
    expect(store.approvals).toHaveLength(3);
    expect((await store.getRateLimit("reddit", "reply"))!.ceiling).toBe(3);
    expect(store.approvals[0].body).toContain("(I work on SwiftCard, so I'm biased.)");
    expect(store.approvals[0].summary).toMatch(/post it yourself/);
  });

  it("where the community bans promotion, the post is skipped before any model is asked (2026-10-29: every message promotes SwiftCard)", async () => {
    const { ctx, store, claude } = await setup({ def: fakeAgent({ id: "replies-reddit", maxPending: 10 }), script: script("You should try SwiftCard for this.") });
    await store.setRateLimit("reddit", "reply", 50, "2026-01-01");
    const before = claude.calls.length;
    const r = await runEngagement(ctx, { platform: "reddit", kind: "reply", action: "reply", ceiling: 50, register: "", length: "", label: (c) => c.title, find: async () => [post(1, { promoAllowed: false })] });
    expect(store.approvals).toHaveLength(0);
    expect(r.summary).toMatch(/added 0 to the Sheet/);
    expect(ctx.stats.skipped_promo_banned).toBe(1);
    // Only the scoring call ran; nothing was drafted for it.
    expect(claude.calls.filter((c) => c.purpose === "draft")).toHaveLength(0);
    expect(claude.calls.length).toBeGreaterThanOrEqual(before);
  });

  it("a draft that leaves SwiftCard out gets one rewrite, and is dropped if it still does", async () => {
    const { ctx, store } = await setup({ def: fakeAgent({ id: "replies-reddit", maxPending: 10 }), script: script("Just follow up within a day and you'll be fine.") });
    await store.setRateLimit("reddit", "reply", 50, "2026-01-01");
    await runEngagement(ctx, { platform: "reddit", kind: "reply", action: "reply", ceiling: 50, register: "", length: "", label: (c) => c.title, find: async () => [post(1)] });
    expect(store.approvals).toHaveLength(0);
    expect(ctx.stats.skipped_no_swiftcard).toBe(1);
  });

  it("off-topic posts never reach a model; seen posts are not re-read", async () => {
    const { ctx, claude } = await setup({ def: fakeAgent({ id: "replies-reddit" }), script: script("x") });
    const offTopic = post(9, { title: "Best lunch spot downtown?", text: "Hungry." });
    await runEngagement(ctx, { platform: "reddit", kind: "reply", action: "reply", ceiling: 8, register: "", length: "", label: (c) => c.title, find: async () => [offTopic] });
    expect(claude.calls).toHaveLength(0);
    await runEngagement(ctx, { platform: "reddit", kind: "reply", action: "reply", ceiling: 8, register: "", length: "", label: (c) => c.title, find: async () => [offTopic] });
    expect(claude.calls).toHaveLength(0);
  });

  it("every comment may mention SwiftCard now (the old one in three cap is gone, owner 2026-10-29)", async () => {
    const { ctx, store } = await setup({ def: fakeAgent({ id: "replies-instagram", maxPending: 20, approvalKind: "comment" }), script: script("Open house sign in sheets get lost so fast. I built SwiftCard so people tap and save you instead.") });
    await store.setRateLimit("instagram", "comment", 6, "2026-01-01");
    await runEngagement(ctx, { platform: "instagram", kind: "comment", action: "comment", ceiling: 6, keywordFilter: false, register: "", length: "", label: (c) => c.title, find: async () => [1, 2, 3, 4, 5, 6].map((i) => post(i, { platform: "instagram", url: `https://instagram.com/p/${i}` })) });
    expect(store.approvals.length).toBe(6);
  });
});

describe("rules and parsing", () => {
  it("reads a subreddit's self-promotion rule", () => {
    expect(rulesBanPromotion("No self-promotion: Posts promoting your business will be removed.")).toBe(true);
    expect(rulesBanPromotion("Self-promotion is not allowed outside the weekly thread")).toBe(true);
    expect(rulesBanPromotion("Be civil: no personal attacks.")).toBe(false);
  });
  it("finds the author in pasted text", () => {
    expect(guessAuthor("@jane.sells.homes posted: open house tips", "instagram")).toBe("jane.sells.homes");
    expect(guessAuthor("posted by u/Window_Pro22 3h ago", "reddit")).toBe("Window_Pro22");
  });
});

describe("competitor facts", () => {
  it("only fresh facts are offered to the drafters", async () => {
    const { store } = await setup();
    store.facts.push({ competitor: "linktree", fact: "pro_monthly_price", value: "$9/month", source_url: "https://linktr.ee/s/pricing", seen_at: new Date().toISOString() });
    store.facts.push({ competitor: "popl", fact: "pro_monthly_price", value: "$7/month", source_url: "https://popl.co/pricing", seen_at: new Date(Date.now() - 40 * 86400_000).toISOString() });
    const block = await competitorFacts(store, new Date());
    expect(block).toContain("Linktree pro monthly price: $9/month");
    expect(block).not.toContain("Popl");
    expect(freshFacts(store.facts, new Date())).toHaveLength(1);
  });
});

describe("registry", () => {
  it("one Replies agent per platform from the spec, all drafting by hand, and no manager", () => {
    const platforms = ["reddit", "x", "instagram", "tiktok", "threads", "bluesky", "facebook", "quora", "indiehackers", "linkedin"];
    for (const p of platforms) expect(REPLIES.some((a) => a.id === `replies-${p}`), p).toBe(true);
    expect(AGENTS.some((a) => a.id === "replies-manager")).toBe(false); // retired 2026-10-27: the Sheet replaced its room
    // Removed 2026-10-29 (owner): nothing on the Sheet came from it.
    expect(AGENTS.some((a) => a.id === "competitor-watch")).toBe(false);
  });
});

describe("Bluesky", () => {
  const raw = (o: Record<string, unknown> = {}) => ({
    uri: "at://did:plc:abc123/app.bsky.feed.post/3mygjozbl422n",
    author: { handle: "jane.realtor.bsky.social" },
    record: { text: "Linktree keeps raising prices.\nAny digital business card that does both?" },
    replyCount: 2,
    ...o,
  });

  it("turns search results into bsky.app links and skips labeled or broken posts", () => {
    const posts = toPosts([raw(), raw({ labels: [{ val: "porn" }] }), raw({ author: { handle: "handle.invalid" } }), raw({ uri: "at://did/other/x" }), raw({ record: { text: "  " } })]);
    expect(posts).toEqual([
      { url: "https://bsky.app/profile/jane.realtor.bsky.social/post/3mygjozbl422n", author: "jane.realtor.bsky.social", title: "Linktree keeps raising prices.", text: "Linktree keeps raising prices.\nAny digital business card that does both?", replyCount: 2, isReply: false },
    ]);
  });

  it("a refused search is no results, not a failed run", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response("<html>403</html>", { status: 403 })) as typeof fetch;
    try {
      expect(await searchBluesky("linktree")).toEqual([]);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("one person per handle, however it was written", () => {
    expect(normalizeHandle("bluesky", "https://bsky.app/profile/Jane.Realtor.bsky.social")).toBe("@jane.realtor.bsky.social");
    expect(normalizeHandle("bluesky", "@jane.realtor.bsky.social")).toBe("@jane.realtor.bsky.social");
  });

  it("takes one post from each search in turn, so one search can't fill the scored batch", () => {
    expect(interleave([[1, 2, 3], [], [10, 20], [100]])).toEqual([1, 10, 100, 2, 20, 3]);
    expect(BLUESKY_QUERIES).not.toContain("linktree");
  });

  it("never replies to our own account", () => {
    expect(isOwnBlueskyHandle("swiftcardapp.bsky.social")).toBe(true);
    expect(isOwnBlueskyHandle("jane.realtor.bsky.social")).toBe(false);
  });

  it("drafts only, and no agent caps how many messages mention SwiftCard (owner, 2026-10-29)", () => {
    expect(blueskyReplies.approvalKind).toBe("reply");
    expect(readFileSync("src/lib/crew/agents/replies.ts", "utf8")).not.toContain("pitchShare");
    expect(readFileSync("src/lib/crew/sources/bluesky.ts", "utf8")).not.toMatch(/createRecord|createSession|method: "POST"/);
  });
});
