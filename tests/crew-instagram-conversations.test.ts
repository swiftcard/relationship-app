import { describe, expect, it } from "vitest";
import { agentById } from "@/lib/crew/registry";
import {
  AGENT_ID,
  COMMENT_SYSTEM,
  IG_CONVERSATIONS_USD,
  commentProblems,
  emptyReason,
  instagramLinkedinBio,
  pickPosts,
  type Scored,
} from "@/lib/crew/agents/instagram-conversations";
import { checkBudget } from "@/lib/crew/budget";
import type { LlmRequest } from "@/lib/crew/llm/types";
import { approvalRows } from "@/lib/crew/sheets/rows";
import { DEFAULT_SETTINGS } from "@/lib/crew/store";
import { runAgent } from "@/lib/crew/tick";
import { FakeClaude } from "@/lib/crew/llm/fake";
import { MemoryStore } from "@/lib/crew/store-memory";

// The Instagram LinkedIn Bio agent (2026-11-04). It found nothing for a week:
// it asked web search for Instagram PROFILES whose bio links to LinkedIn, and
// a search engine's copy of a profile never shows the bio's link, so every
// run answered {"items":[]} (12 characters, 5 to 7 searches, ~$0.10). It now
// finds public POSTS on networking, cards and events and drafts comments.
// These tests run the whole agent on recorded-shape search results with
// fake models: no network, no money.

/** What web search returns for Instagram (shapes as seen from contact-instagram's live runs). */
const SEARCH_RESULTS = [
  { url: "https://www.instagram.com/jane.sells.austin/p/C9netwk01/", author: "", title: 'Jane Price on Instagram: "Went to my first chamber mixer..."', text: "Went to my first chamber of commerce mixer last night. Met 20 people, came home with 14 business cards and no idea who half of them were. How do you all follow up after these?" },
  { url: "https://www.instagram.com/reel/C9loan0002/", author: "@Marco.Lends", title: "Marco Diaz (@marco.lends) on Instagram", text: "Realtors: the loan officer you want is the one who picks up on Saturday. Here's how I build referral partnerships that actually last, part 1." },
  { url: "https://www.instagram.com/brightsmile.dental/", author: "brightsmile.dental", title: "Bright Smile Dental (@brightsmile.dental)", text: "Family dentistry in Plano. Book online." },
  { url: "https://www.instagram.com/p/C9giveaway3/", author: "cardprintshop", title: "Card Print Shop on Instagram", text: "GIVEAWAY: win 500 free business cards! Follow, like and tag 3 friends to enter." },
  { url: "https://www.instagram.com/p/C9recipe004/", author: "foodie", title: "Foodie on Instagram", text: "My grandma's lasagna recipe, finally written down for all of you." },
];

const GOOD_COMMENTS: Record<string, string> = {
  "jane.sells.austin": "Writing one line on the back of each card before you leave the room helps a lot, like where they work and what you talked about. Who out of the 14 do you want to hear from first?",
  "marco.lends": "Saturday availability is such a real filter for realtors with weekend showings. Do you set that expectation in the first coffee meeting or wait until the first deal?",
};

type Script = (req: LlmRequest, n: number) => string;

function script(o: { search?: unknown[]; draft?: (handle: string, req: LlmRequest) => string; mentionOk?: boolean } = {}): Script {
  return (req) => {
    if (req.webSearch) return JSON.stringify({ items: o.search ?? SEARCH_RESULTS });
    const schema = JSON.stringify(req.schema ?? {});
    if (schema.includes("post_kind")) {
      // Scoring: the first two are good, the giveaway is an ad, the rest is off topic.
      const n = (req.prompt.match(/^#\d+/gm) ?? []).length;
      return JSON.stringify({
        items: Array.from({ length: n }, (_, i) => {
          const line = req.prompt.split("\n\n")[i] ?? "";
          const giveaway = /GIVEAWAY/.test(line);
          const good = /jane\.sells|marco\.lends/.test(line);
          return { i, score: good ? 0.85 : giveaway ? 0.3 : 0.1, post_kind: giveaway ? "giveaway" : good ? "question" : "other", professional: good, why_selected: good ? "A realtor or lender asking how people follow up after networking" : "not relevant", angle: good ? "a concrete follow up habit" : "", mention_ok: !!o.mentionOk };
        }),
      });
    }
    if (schema.includes("reply_fit")) {
      const handle = /INSTAGRAM POST by @([\w.]+)/.exec(req.prompt)?.[1] ?? "";
      const reply = o.draft ? o.draft(handle, req) : GOOD_COMMENTS[handle] ?? "Fair point about following up, what do you write down first?";
      return JSON.stringify({ reply, reply_fit: "Answers their follow up question with a concrete habit and asks about their situation." });
    }
    return "";
  };
}

async function run(s: Script, o: { store?: MemoryStore; config?: Record<string, unknown> } = {}) {
  const store = o.store ?? new MemoryStore();
  await store.patchAgentState(AGENT_ID, { enabled: true, ...(o.config ? { config: o.config } : {}) });
  const claude = new FakeClaude(s);
  const out = await runAgent({ def: instagramLinkedinBio, store, providers: { claude, critic: null } });
  const runs = await store.recentRuns(AGENT_ID, 1);
  return { store, claude, out, run: runs[0] };
}

describe("Instagram LinkedIn Bio: discovery", () => {
  it("is registered as a draft-only comment finder with its own small daily limit", () => {
    const def = agentById(AGENT_ID)!;
    expect(def).toBe(instagramLinkedinBio);
    expect(def.approvalKind).toBe("comment");
    expect(def.dailyUsd).toBe(IG_CONVERSATIONS_USD);
    expect(IG_CONVERSATIONS_USD).toBeLessThan(DEFAULT_SETTINGS.daily_usd_cap);
  });

  it("an empty search says so in the run summary and spends nothing more", async () => {
    const { claude, run: r } = await run(script({ search: [] }));
    expect(claude.calls).toHaveLength(1); // the search, and no scoring or drafting call
    expect(r.summary).toMatch(/returned no Instagram posts/);
    expect(r.stats.search_results).toBe(0);
  });

  it("finds the two real conversations, drafts a grounded comment on each, and explains why", async () => {
    const { store, run: r } = await run(script());
    const drafts = store.approvals;
    expect(drafts.map((a) => a.target_url).sort()).toEqual(["https://www.instagram.com/p/C9netwk01/", "https://www.instagram.com/reel/C9loan0002/"]);
    for (const a of drafts) {
      expect(a.kind).toBe("comment");
      expect(a.status).toBe("pending");
      expect(a.body).not.toMatch(/swift ?card/i);
      expect(a.meta).toMatchObject({ why: expect.stringMatching(/follow up/), reply_fit: expect.any(String), source: "web_search", pitched: false });
      // The Sheet row opens the exact post.
      const [row] = approvalRows(a, { known: new Map() } as unknown as Parameters<typeof approvalRows>[1]);
      expect(row.tab.id).toBe("instagram-linkedin-bio");
    }
    expect(r.stats).toMatchObject({ search_results: 5, dropped_not_a_post: 1, dropped_off_topic: 1, rejected_by_score: 1, drafts_made: 2 });
  });

  it("never suggests the same post twice, nor a post another Instagram agent already drafted for", async () => {
    const store = new MemoryStore();
    await store.insertApproval({ agent_id: "replies-instagram", team: "replies", kind: "comment", title: "t", summary: "s", body: "b", platform: "instagram", target_url: "https://www.instagram.com/reel/C9loan0002/", meta: { author: "@marco.lends" } });
    await run(script(), { store });
    expect(store.approvals.filter((a) => a.agent_id === AGENT_ID).map((a) => a.target_url)).toEqual(["https://www.instagram.com/p/C9netwk01/"]);
    const { run: second } = await run(script(), { store });
    expect(store.approvals.filter((a) => a.agent_id === AGENT_ID)).toHaveLength(1);
    expect(second.stats.dropped_seen).toBeGreaterThan(0);
    expect(second.summary).toMatch(/already seen/);
  });
});

describe("Instagram LinkedIn Bio: the comments", () => {
  it("a draft with an emoji, a compliment opener or a SwiftCard plug is rewritten, and dropped if it still fails", async () => {
    let n = 0;
    const { store, run: r } = await run(
      script({
        draft: (handle) => {
          n++;
          if (handle === "jane.sells.austin") return "Love this! 🙌 SwiftCard fixes exactly this, one tap and they have your info.";
          return GOOD_COMMENTS[handle];
        },
      }),
    );
    expect(n).toBe(3); // Jane's draft and its one rewrite, Marco's draft
    expect(store.approvals.map((a) => a.target_url)).toEqual(["https://www.instagram.com/reel/C9loan0002/"]);
    expect(r.stats.drafts_failed_checks).toBe(1);
  });

  it("mentions SwiftCard only when the post asked for a tool, and never when the owner says never", async () => {
    const plug = "Writing a note on each card helps. I work on SwiftCard, a digital business card, and people use it so the other person saves their details on the spot. What do you use now?";
    const asked = await run(script({ mentionOk: true, draft: () => plug }));
    expect(asked.store.approvals.length).toBeGreaterThan(0);
    expect(asked.store.approvals[0].meta).toMatchObject({ mention_ok: true, pitched: true });

    const never = await run(script({ mentionOk: true, draft: () => plug }), { config: { mention_swiftcard: "never" } });
    expect(never.store.approvals).toHaveLength(0);
  });

  it("the comment rules: specific, no emoji, no em dash, no invented experience, no repeats", () => {
    expect(commentProblems(GOOD_COMMENTS["jane.sells.austin"], { mentionOk: false })).toEqual([]);
    expect(commentProblems("Great post, so true.", { mentionOk: false })).toEqual(expect.arrayContaining(["opens with a generic compliment"]));
    expect(commentProblems("Follow up within a day — it matters more than the card you hand out at these events.", { mentionOk: false })).toEqual(expect.arrayContaining(["uses an em dash"]));
    expect(commentProblems("When I was a realtor my clients always asked for my card at the end of every open house.", { mentionOk: false })).toEqual(expect.arrayContaining(["claims a personal experience or client we can't back up"]));
    expect(commentProblems("Writing one line on the back of each card works, like where they work and what you talked about.", { mentionOk: false, recent: [GOOD_COMMENTS["jane.sells.austin"]] })).toEqual(expect.arrayContaining(["starts the same way as an earlier comment"]));
    expect(COMMENT_SYSTEM).toMatch(/Never invent personal experience/);
  });

  it("scoring picks: on topic pros only, no ads or giveaways, best first", () => {
    const s = (i: number, score: number, o: Partial<Scored> = {}): Scored => ({ i, score, post_kind: "question", professional: true, why_selected: "", angle: "", mention_ok: false, ...o });
    expect(pickPosts([s(0, 0.7), s(1, 0.95), s(2, 0.9, { post_kind: "ad_or_promo" }), s(3, 0.9, { professional: false }), s(4, 0.5), s(9, 0.99)], 5, 5).map((x) => x.i)).toEqual([1, 0]);
  });

  it("an empty run names where the posts went", () => {
    expect(emptyReason({ search_results: 6, dropped_not_a_post: 4, dropped_seen: 2 }, ["networking events: x", "business cards: y"])).toBe(
      "Found 6 Instagram results for networking events and business cards; 4 were profiles or pages, not posts, 2 were already seen.",
    );
  });
});

describe("Instagram LinkedIn Bio: money", () => {
  it("stops before the search once its own daily limit is spent", async () => {
    const store = new MemoryStore();
    await store.recordUsage({ run_id: null, agent_id: AGENT_ID, team: "contact", provider: "anthropic", model: "x", purpose: "discover", input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, web_searches: 0, batch: false, cost_usd: IG_CONVERSATIONS_USD - 0.01 });
    const { claude, out } = await run(script(), { store });
    expect(claude.calls).toHaveLength(0);
    expect(out.status).toBe("budget");
  });

  it("a per-agent limit set above the shared $3 still stops at the shared $3", () => {
    const totals = { total: { usd: 2.95, tokens: 0, cacheRead: 0, input: 0 }, byAgent: { [AGENT_ID]: { usd: 0.2, tokens: 0 } }, byTeam: {} } as unknown as Parameters<typeof checkBudget>[0]["totals"];
    const state = { id: AGENT_ID, enabled: true, daily_usd_cap: 10 } as unknown as Parameters<typeof checkBudget>[0]["state"];
    const c = checkBudget({ hardDisabled: false, settings: DEFAULT_SETTINGS, state, agent: { id: AGENT_ID, team: "contact", dailyUsd: IG_CONVERSATIONS_USD }, totals, estUsd: 0.1 });
    expect(c).toEqual({ ok: false, reason: expect.stringMatching(/All agents together/) });
  });

  it("drafts never post or send: everything lands as pending for a person to approve", async () => {
    const { store } = await run(script());
    expect(store.approvals.every((a) => a.status === "pending")).toBe(true);
  });
});

