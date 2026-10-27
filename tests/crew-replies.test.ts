import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { factChanges } from "@/lib/crew/agents/competitor-watch";
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
  it("drafts only up to today's warmed-up cap, with disclosure and a tracked link", async () => {
    const { ctx, store } = await setup({ def: fakeAgent({ id: "replies-reddit", maxPending: 10 }), script: script("Same boat last year. I moved to SwiftCard since it does the card and the link page together: https://swiftcard.me/go/rd_cr_reply_abc") });
    const r = await runEngagement(ctx, { platform: "reddit", kind: "reply", action: "reply", ceiling: 8, register: "", length: "", label: (c) => c.title, find: async () => [post(1), post(2), post(3), post(4)] });
    expect(r.summary).toMatch(/added 1 to the Sheet/); // week 1: 20% of 8 = 1
    expect(store.approvals).toHaveLength(1);
    expect(store.approvals[0].body).toContain("(I work on SwiftCard, so I'm biased.)");
    expect(store.approvals[0].summary).toMatch(/post it yourself/);
  });

  it("never pitches where the community bans promotion, even if the model does", async () => {
    const { ctx, store } = await setup({ def: fakeAgent({ id: "replies-reddit", maxPending: 10 }), script: script("You should try SwiftCard for this.") });
    await store.setRateLimit("reddit", "reply", 50, "2026-01-01");
    const r = await runEngagement(ctx, { platform: "reddit", kind: "reply", action: "reply", ceiling: 50, register: "", length: "", label: (c) => c.title, find: async () => [post(1, { promoAllowed: false })] });
    expect(store.approvals).toHaveLength(0);
    expect(r.summary).toMatch(/added 0 to the Sheet/);
    expect(ctx.stats.skipped_pitch_not_allowed).toBe(1);
  });

  it("off-topic posts never reach a model; seen posts are not re-read", async () => {
    const { ctx, claude } = await setup({ def: fakeAgent({ id: "replies-reddit" }), script: script("x") });
    const offTopic = post(9, { title: "Best lunch spot downtown?", text: "Hungry." });
    await runEngagement(ctx, { platform: "reddit", kind: "reply", action: "reply", ceiling: 8, register: "", length: "", label: (c) => c.title, find: async () => [offTopic] });
    expect(claude.calls).toHaveLength(0);
    await runEngagement(ctx, { platform: "reddit", kind: "reply", action: "reply", ceiling: 8, register: "", length: "", label: (c) => c.title, find: async () => [offTopic] });
    expect(claude.calls).toHaveLength(0);
  });

  it("comments mention SwiftCard in at most about 1 in 3", async () => {
    const { ctx, store } = await setup({ def: fakeAgent({ id: "replies-instagram", maxPending: 20, approvalKind: "comment" }), script: script("Great point about open houses. SwiftCard helps with this.") });
    await store.setRateLimit("instagram", "comment", 6, "2026-01-01");
    await runEngagement(ctx, { platform: "instagram", kind: "comment", action: "comment", ceiling: 6, pitchShare: 1 / 3, keywordFilter: false, register: "", length: "", label: (c) => c.title, find: async () => [1, 2, 3, 4, 5, 6].map((i) => post(i, { platform: "instagram", url: `https://instagram.com/p/${i}` })) });
    // Every draft here mentions SwiftCard, so only the pitch budget's worth survive.
    expect(store.approvals.length).toBe(2);
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
  it("detects what changed", () => {
    expect(factChanges([{ fact: "price", value: "$9" }], [{ fact: "price", value: "$12" }, { fact: "trial", value: "7 days" }])).toEqual([
      { fact: "price", from: "$9", to: "$12" },
      { fact: "trial", from: null, to: "7 days" },
    ]);
  });
});

describe("registry", () => {
  it("one Replies agent per platform from the spec, all drafting by hand, plus a manager", () => {
    const platforms = ["reddit", "instagram", "threads", "bluesky", "facebook", "quora", "indiehackers", "linkedin"];
    for (const p of platforms) expect(REPLIES.some((a) => a.id === `replies-${p}`), p).toBe(true);
    expect(AGENTS.some((a) => a.id === "replies-manager")).toBe(true);
    expect(AGENTS.some((a) => a.id === "competitor-watch" && a.schedule.kind === "daily" && JSON.stringify(a.schedule.days) === "[0,3]")).toBe(true);
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

  it("drafts only; mentions SwiftCard in at most about 1 in 3", () => {
    expect(blueskyReplies.approvalKind).toBe("reply");
    expect(readFileSync("src/lib/crew/agents/replies.ts", "utf8")).toMatch(/id: "replies-bluesky"[\s\S]*?pitchShare: 1 \/ 3/);
    expect(readFileSync("src/lib/crew/sources/bluesky.ts", "utf8")).not.toMatch(/createRecord|createSession|method: "POST"/);
  });
});
