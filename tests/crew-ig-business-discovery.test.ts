import { beforeEach, describe, expect, it, vi } from "vitest";

// Instagram Business Discovery in the crew (2026-11-06). The fixtures are real
// responses from the live test in Graph API Explorer (SwiftCard Discovery app,
// asked as @swiftcard.me), trimmed to what the agents read.

const conn = { current: null as null | Record<string, unknown> };
vi.mock("@/lib/agent-connections", () => ({
  loadConnections: async () => (conn.current ? { meta: conn.current } : {}),
  freshAccessToken: async (c: { access_token: string }) => c.access_token,
}));

import { META_DISCOVERY_SCOPES } from "@/lib/agent-connect-oauth";
import { ENRICH_PER_RUN } from "@/lib/crew/agents/contact";
import { AGENT_ID as COMMENTS_ID, ON_TOPIC, instagramLinkedinBio } from "@/lib/crew/agents/instagram-conversations";
import { FakeClaude } from "@/lib/crew/llm/fake";
import type { LlmRequest } from "@/lib/crew/llm/types";
import { AGENTS } from "@/lib/crew/registry";
import {
  DISCOVERED_KEEP,
  DISCOVERED_POSTS_KEY,
  commentablePosts,
  daysSincePost,
  lookupBusiness,
  profileText,
  queueDiscovered,
  takeDiscovered,
  type DiscoveredPost,
  type IgApiProfile,
} from "@/lib/crew/sources/instagram-discovery";
import { MemoryStore } from "@/lib/crew/store-memory";
import { runAgent } from "@/lib/crew/tick";

// Fixed: the fixtures are real posts from 2026-11-06, and "active" means a post in the last 30 days.
const NOW = new Date("2026-11-06T16:00:00Z");
const AUTH = { igUserId: "17841443384324190", token: "TEST-TOKEN" };

/** @mike.mclean_realtor, 2026-11-06: active, posts about his area. */
const MIKE = {
  business_discovery: {
    username: "mike.mclean_realtor",
    name: "Mike McLean | Long Island Realtor",
    biography: "Your Neighborhood Realtor #MikeMcLean 631-375-3667. Covering Suffolk and Nassau Counties. #MikeMcLean",
    website: "https://youtube.com/@realtalk-mikemclean?si=OYvu5tV0_7hParNc",
    followers_count: 11196,
    media_count: 1135,
    media: {
      data: [
        { caption: "Check out - Island Lake Diner in Ronkonkoma. Have you been? Thoughts? #goneviral #islandlakediner #yourneighborhoodrealtor", timestamp: "2026-11-06T09:59:14+0000", permalink: "https://www.instagram.com/reel/DfZVlh5hwCf/", media_type: "VIDEO", comments_count: 0 },
        { caption: "35 + years of friendship. We have shared laughs, tears, ups and downs but she’s still the peanut butter to my Jelly. I love you always Mrs H.\nWe might share a passion of Real Estate but together it’s far more than that.", timestamp: "2026-11-05T02:08:17+0000", permalink: "https://www.instagram.com/reel/DfV6zQHRJbG/", media_type: "VIDEO", comments_count: 0 },
        { caption: "#longislandhomeproperties #selfworth", timestamp: "2026-10-31T14:14:20+0000", permalink: "https://www.instagram.com/reel/DfKWK9ox_R7/", media_type: "VIDEO", comments_count: 1 },
        { caption: "Why has this place gone Viral? Have you been?\nI get the answers — and if you haven’t been - GO!\nislandlakediner located at 625 Portion Road, Lake Ronkonkoma - www.islandlakediner.com #realtor #yourneighborhoodrealtor", timestamp: "2026-10-19T09:18:04+0000", permalink: "https://www.instagram.com/reel/Deq6UisxB0E/", media_type: "VIDEO", comments_count: 12 },
        { caption: "Long Island Home Properties — watch for us on the Long Island Roadways - servicing Long Island. Because we are Long Island. #lihp #realtor #yourneighborhoodrealtor", timestamp: "2026-10-11T15:32:25+0000", permalink: "https://www.instagram.com/reel/DeW-9HmRFcs/", media_type: "VIDEO", comments_count: 6 },
      ],
    },
  },
};

/** @tampaonemortgage, 2026-11-06: the Sheet's top-scored prospect (0.9), last post 2024-02-29. */
const TAMPA = {
  business_discovery: {
    username: "tampaonemortgage",
    name: "Tampa One powered by The Mortgage Firm",
    biography: "Chris Kidder\nNMLS: 228600/I-199505/189233\nTampa Trusted Mortgage Lender\nEqual Housing Lender\n📲 Text Us 813-710-4746\nGet Qualified ⬇️",
    website: "https://linktr.ee/tampaone",
    followers_count: 561,
    media_count: 424,
    media: {
      data: [
        { caption: "#tampaone #themortgagefirm #tampamortgage #mortgagelender #Tampaloan #mortgagereview #clientreview #mortgagetestimonial", timestamp: "2024-02-29T13:10:14+0000", permalink: "https://www.instagram.com/p/C37r0STqV_c/", media_type: "IMAGE", comments_count: 0 },
        { caption: "When are rates going to get better?", timestamp: "2022-10-20T16:01:41+0000", permalink: "https://www.instagram.com/tv/Cj8QMToJvql/", media_type: "VIDEO", comments_count: 0 },
        { timestamp: "2022-07-14T15:29:21+0000", permalink: "https://www.instagram.com/reel/Cf_2sZ4uO9T/", media_type: "VIDEO", comments_count: 0 },
      ],
    },
  },
};

/** What Meta answers for a username with no business or creator account (live, 2026-11-06). */
const NOT_FOUND = { error: { message: "Invalid user id", type: "OAuthException", code: 110, error_subcode: 2207013, error_user_title: "Cannot find User" } };

function graph(byHandle: Record<string, unknown>) {
  const calls: { url: string; auth: string | null }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, auth: new Headers(init?.headers).get("authorization") });
    const handle = /business_discovery\.username\(([^)]+)\)/.exec(decodeURIComponent(u))?.[1] ?? "";
    return new Response(JSON.stringify(byHandle[handle] ?? NOT_FOUND), { status: byHandle[handle] ? 200 : 400 });
  });
  return { f: f as unknown as typeof fetch, calls };
}

async function profileOf(fixture: unknown): Promise<IgApiProfile> {
  const h = (fixture as typeof MIKE).business_discovery.username;
  const r = await lookupBusiness(AUTH, h, graph({ [h]: fixture }).f);
  if (!r.ok) throw new Error(r.detail);
  return r.profile;
}

describe("lookupBusiness: one account, read-only", () => {
  it("reads the bio, website, followers and each post's caption, date and link, with the token in the header only", async () => {
    const g = graph({ "mike.mclean_realtor": MIKE });
    const r = await lookupBusiness(AUTH, "@Mike.McLean_Realtor", g.f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile).toMatchObject({ handle: "mike.mclean_realtor", followers: 11196, mediaCount: 1135, website: expect.stringContaining("youtube.com") });
    expect(r.profile.bio).toContain("631-375-3667");
    expect(r.profile.posts).toHaveLength(5);
    expect(r.profile.posts[0]).toEqual({ url: "https://www.instagram.com/reel/DfZVlh5hwCf/", caption: expect.stringMatching(/^Check out - Island Lake Diner/), at: "2026-11-06T09:59:14.000Z", type: "VIDEO", comments: 0 });
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0].auth).toBe("Bearer TEST-TOKEN");
    expect(g.calls[0].url).not.toContain("TEST-TOKEN");
    expect(g.calls[0].url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.0\/17841443384324190\?fields=/);
  });

  it("names Meta's errors: no business account, a lapsed login, the hourly limit", async () => {
    const answer = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 400 })) as unknown as typeof fetch;
    expect(await lookupBusiness(AUTH, "zz_no_such_user", answer(NOT_FOUND))).toMatchObject({ ok: false, reason: "not_business" });
    expect(await lookupBusiness(AUTH, "someone", answer({ error: { code: 190, message: "Error validating access token" } }))).toMatchObject({ ok: false, reason: "auth" });
    expect(await lookupBusiness(AUTH, "someone", answer({ error: { code: 4, message: "Application request limit reached" } }))).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(await lookupBusiness(AUTH, "someone", (async () => { throw new Error("network down"); }) as unknown as typeof fetch)).toMatchObject({ ok: false, reason: "error" });
  });

  it("never sends something that isn't a username", async () => {
    const g = graph({});
    expect(await lookupBusiness(AUTH, "a b){injected}", g.f)).toMatchObject({ ok: false, reason: "error" });
    expect(g.calls).toHaveLength(0);
  });
});

describe("what the scorer and the writer read", () => {
  it("an active account: bio, website, activity and recent posts", async () => {
    const p = await profileOf(MIKE);
    expect(daysSincePost(p, NOW)).toBe(0);
    const t = profileText(p, NOW);
    expect(t).toMatch(/^Instagram profile, read through Instagram's API on 2026-11-06: Mike McLean \| Long Island Realtor \(@mike\.mclean_realtor\), 11196 followers, 1135 posts\./);
    expect(t).toContain('Bio: "Your Neighborhood Realtor #MikeMcLean 631-375-3667.');
    expect(t).toContain("Activity: active, newest post 0 days ago.");
    expect(t).toContain("- 2026-11-06 https://www.instagram.com/reel/DfZVlh5hwCf/: \"Check out - Island Lake Diner");
    // The activity line sits before the posts, inside the first 700 characters the scorer reads.
    expect(t.slice(0, 700)).toContain("Activity:");
  });

  it("an inactive business is described, not dropped: the Sheet's top prospect hasn't posted since February 2024", async () => {
    const p = await profileOf(TAMPA);
    expect(daysSincePost(p, NOW)).toBeGreaterThan(600);
    const t = profileText(p, NOW);
    expect(t).toMatch(/Activity: no post in the last 30 days \(newest is \d+ days old\)\./);
    expect(t).toContain("Text Us 813-710-4746");
    expect(t).toContain("Website: https://linktr.ee/tampaone");
  });
});

describe("posts for the comment agent", () => {
  it("recent, captioned and on topic only", async () => {
    const mike = commentablePosts(await profileOf(MIKE), NOW, ON_TOPIC).map((x) => x.url);
    // The friendship post says "Real Estate", the diner and roadways posts say #realtor; the hashtag-only one is too thin.
    expect(mike).toEqual(["https://www.instagram.com/reel/DfZVlh5hwCf/", "https://www.instagram.com/reel/DfV6zQHRJbG/", "https://www.instagram.com/reel/Deq6UisxB0E/", "https://www.instagram.com/reel/DeW-9HmRFcs/"]);
    expect(commentablePosts(await profileOf(TAMPA), NOW, ON_TOPIC)).toEqual([]);
  });

  it("the queue keeps the newest 40, no repeats, and drops posts that went stale while waiting", async () => {
    const store = new MemoryStore();
    const post = (n: number, daysOld: number): DiscoveredPost => ({ url: `https://www.instagram.com/p/Q${n}x/`, handle: `pro.${n}`, name: null, caption: "realtor networking night recap, great people", at: new Date(NOW.getTime() - daysOld * 86400_000).toISOString(), found: NOW.toISOString() });
    await queueDiscovered(store, Array.from({ length: 45 }, (_, n) => post(n, n % 20)));
    await queueDiscovered(store, [post(0, 0)]);
    const all = (await store.kvGet<DiscoveredPost[]>(DISCOVERED_POSTS_KEY))!;
    expect(all).toHaveLength(DISCOVERED_KEEP);
    expect(new Set(all.map((x) => x.url)).size).toBe(DISCOVERED_KEEP);
    const later = new Date(NOW.getTime() + 15 * 86400_000);
    const took = await takeDiscovered(store, 5, later);
    expect(took).toHaveLength(5);
    expect(took.every((x) => later.getTime() - Date.parse(x.at) <= 30 * 86400_000)).toBe(true);
    const left = (await store.kvGet<DiscoveredPost[]>(DISCOVERED_POSTS_KEY))!;
    expect(left.every((x) => later.getTime() - Date.parse(x.at) <= 30 * 86400_000)).toBe(true);
    expect(left.some((x) => took.some((t) => t.url === x.url))).toBe(false);
  });
});

// ── The agents ──────────────────────────────────────────────────────────────

const dms = AGENTS.find((d) => d.id === "contact-instagram")!;

/** Fake Claude for the DM agent: no web results, records what scoring read, drafts nothing. */
function dmClaude(seen: string[]) {
  return new FakeClaude((req: LlmRequest) => {
    if (req.webSearch) return JSON.stringify({ items: [] });
    if (JSON.stringify(req.schema ?? {}).includes("business_pro")) {
      seen.push(req.prompt);
      return JSON.stringify({ items: req.prompt.split(/\n\n(?=#\d)/).map((_, i) => ({ i, score: 0.3, why: "x", angle: "x", business_pro: true, asks_for_tools: false })) });
    }
    return JSON.stringify({ items: [] });
  });
}

describe("Instagram DMs: real profiles before scoring", () => {
  beforeEach(() => {
    conn.current = null;
    vi.unstubAllGlobals();
  });

  async function runDms(profiles: string[], byHandle: Record<string, unknown>) {
    const store = new MemoryStore();
    await store.patchAgentState(dms.id, { enabled: true });
    for (const h of profiles) await store.addInput({ platform: "instagram", kind: "profile", url: `https://www.instagram.com/${h}/`, text: `@${h}` });
    const g = graph(byHandle);
    vi.stubGlobal("fetch", g.f);
    const seen: string[] = [];
    await runAgent({ def: dms, store, providers: { claude: dmClaude(seen), critic: null }, now: () => NOW });
    const [run] = await store.recentRuns(dms.id, 1);
    return { store, run, seen, calls: g.calls };
  }

  it("scores from the API profile, says when an account is inactive or not a business, and queues on-topic posts for comments", async () => {
    conn.current = { provider: "meta", access_token: "TEST-TOKEN", refresh_token: null, expires_at: null, meta: { ig_user_id: AUTH.igUserId } };
    const { store, run, seen, calls } = await runDms(["mike.mclean_realtor", "tampaonemortgage", "a.personal.account"], { "mike.mclean_realtor": MIKE, tampaonemortgage: TAMPA });
    expect(calls).toHaveLength(3);
    expect(run.stats).toMatchObject({ ig_api_profiles: 2, ig_api_inactive: 1, ig_api_not_business: 1, ig_api_posts_queued: 4 });
    const prompt = seen.join("\n");
    expect(prompt).toContain("read through Instagram's API");
    expect(prompt).toContain("Activity: active, newest post 0 days ago.");
    expect(prompt).toMatch(/tampaonemortgage[\s\S]*Activity: no post in the last 30 days/);
    expect(prompt).toContain("Instagram's API found no business or creator account named @a.personal.account");
    // All three were scored: inactivity and "not a business" are signals, nobody was dropped before scoring.
    expect(prompt.match(/^#\d/gm)).toHaveLength(3);
    expect((await store.kvGet<DiscoveredPost[]>(DISCOVERED_POSTS_KEY))!.map((x) => x.handle)).toEqual(Array(4).fill("mike.mclean_realtor"));
    expect(store.approvals).toHaveLength(0);
  });

  it("without a Meta connection nothing changes: no API calls, the search snippet is scored as before", async () => {
    const { run, seen, calls } = await runDms(["mike.mclean_realtor"], { "mike.mclean_realtor": MIKE });
    expect(calls).toHaveLength(0);
    expect(run.stats).toMatchObject({ ig_api_not_connected: 1 });
    expect(seen.join("\n")).not.toContain("Instagram's API");
  });

  it("a lapsed login stops the lookups for the run and says to reconnect", async () => {
    conn.current = { provider: "meta", access_token: "OLD", refresh_token: null, expires_at: null, meta: { ig_user_id: AUTH.igUserId } };
    const store = new MemoryStore();
    await store.patchAgentState(dms.id, { enabled: true });
    for (const h of ["one.realtor", "two.realtor", "three.realtor"]) await store.addInput({ platform: "instagram", kind: "profile", url: `https://www.instagram.com/${h}/`, text: `@${h}` });
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { code: 190, message: "Error validating access token: Session has expired" } }), { status: 400 }));
    vi.stubGlobal("fetch", f);
    await runAgent({ def: dms, store, providers: { claude: dmClaude([]), critic: null }, now: () => NOW });
    const [run] = await store.recentRuns(dms.id, 1);
    expect(f).toHaveBeenCalledTimes(1);
    expect(run.stats).toMatchObject({ ig_api_auth: 1 });
    expect(run.summary).toContain("/api/admin/connect/meta");
  });

  it("looks up at most ENRICH_PER_RUN accounts a run", () => {
    expect(ENRICH_PER_RUN).toBe(15);
  });
});

describe("Instagram LinkedIn Bio: queued API posts, every gate still on", () => {
  beforeEach(() => vi.unstubAllGlobals());

  function commentClaude(prompts: string[]) {
    return new FakeClaude((req: LlmRequest) => {
      if (req.webSearch) throw new Error("no web search");
      const schema = JSON.stringify(req.schema ?? {});
      if (schema.includes("post_kind")) {
        prompts.push(req.prompt);
        return JSON.stringify({ items: req.prompt.split("\n\n").map((_, i) => ({ i, score: 0.45, post_kind: "story", professional: true, why_selected: "Mostly about a diner, not about meeting people.", angle: "x", mention_ok: false })) });
      }
      return JSON.stringify({ reply: "x", reply_fit: "x" });
    });
  }

  it("takes them as found posts: scored with the 0.6 bar, the 30-day account rule applies, nothing drafted below the bar", async () => {
    const store = new MemoryStore();
    await store.patchAgentState(COMMENTS_ID, { enabled: true });
    await queueDiscovered(store, commentablePosts(await profileOf(MIKE), NOW, ON_TOPIC));
    const prompts: string[] = [];
    await runAgent({ def: instagramLinkedinBio, store, providers: { claude: commentClaude(prompts), critic: null }, now: () => NOW });
    const [run] = await store.recentRuns(COMMENTS_ID, 1);
    // One account, so the 30-day-per-account rule leaves one of its four posts to score.
    expect(run.stats).toMatchObject({ api_posts: 4, dropped_recent_person: 3, posts_scored: 1, rejected_low_relevance: 1 });
    expect(prompts[0]).toMatch(/^#0 @mike\.mclean_realtor: Mike McLean \| Long Island Realtor on Instagram \(2026-11-0\d\)/);
    expect(store.approvals).toHaveLength(0);
    expect(run.summary).toMatch(/Read 4 posts from Instagram's API, no comment drafted: .*3 were from accounts drafted for in the last 30 days.*1 weren't about networking/);
    expect(await store.kvGet<DiscoveredPost[]>(DISCOVERED_POSTS_KEY)).toEqual([]);
  });

  it("a person the DM agent already has a draft for gets no comment from their queued post", async () => {
    const store = new MemoryStore();
    await store.patchAgentState(COMMENTS_ID, { enabled: true });
    await store.insertApproval({ agent_id: "contact-instagram", team: "contact", kind: "dm", title: "DM", summary: "", body: "hi", platform: "instagram", target_url: "https://www.instagram.com/mike.mclean_realtor/", person_id: null, debate: null, model_used: null, meta: { author: "mike.mclean_realtor" } });
    await queueDiscovered(store, commentablePosts(await profileOf(MIKE), NOW, ON_TOPIC));
    const prompts: string[] = [];
    await runAgent({ def: instagramLinkedinBio, store, providers: { claude: commentClaude(prompts), critic: null }, now: () => NOW });
    const [run] = await store.recentRuns(COMMENTS_ID, 1);
    expect(run.stats).toMatchObject({ api_posts: 4, dropped_recent_person: 4 });
    expect(prompts).toHaveLength(0);
  });

  it("is still off in the registry defaults and only ever drafts (no automatic posting)", () => {
    expect(instagramLinkedinBio.approvalKind ?? "comment").toBe("comment");
  });
});

describe("the Meta connection asks for read-only access", () => {
  it("exactly the four Business Discovery permissions, nothing that can post or message", () => {
    expect(META_DISCOVERY_SCOPES.split(" ").sort()).toEqual(["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"]);
    expect(META_DISCOVERY_SCOPES).not.toMatch(/publish|manage_posts|messag|manage_comments|business_management/);
  });
});
