import { describe, expect, it, vi } from "vitest";
import {
  AGENT_ID,
  COMMENT_SYSTEM,
  PASTE_MIN_SCORE,
  PASTE_OVERRIDE_MIN_SCORE,
  TURNED_DOWN_KEY,
  commentProblems,
  fromPaste,
  instagramLinkedinBio,
  rejectReason,
  type Scored,
  type TurnedDown,
} from "@/lib/crew/agents/instagram-conversations";
import { FakeClaude } from "@/lib/crew/llm/fake";
import type { LlmRequest } from "@/lib/crew/llm/types";
import { AGENTS } from "@/lib/crew/registry";
import { MemoryStore } from "@/lib/crew/store-memory";
import { runAgent } from "@/lib/crew/tick";
import type { CrewInput } from "@/lib/crew/types";

// Paste a Post after the first live test (2026-11-05). The owner pasted a real
// realtor post, a joke about two phones and 15 conversations. Scoring gave it
// 0.35 ("a humorous vent with little to discuss about networking") and it
// still got a comment, because pasted posts only needed 0.25. The first try
// failed the writing check twice and nothing showed what it had written.

/** The live paste, as it came from the Sheet (crew_inputs, production, 2026-11-05). */
const LIVE = {
  url: "https://www.instagram.com/p/DfXHRTpobMu/",
  text: "@hollyhoustonrealtor Two phones, 15 conversations, 6 houses to show, and somehow I’m still answering, “Absolutely, I can make that work!” #RealtorLife #RealEstateHumor #TexasRealtor #RealtorProblems #pov",
};
/** What the agent drafted for it on the 19:15 UTC run (crew_approvals 3fec1d47). */
const LIVE_COMMENT =
  "Two phones and 15 conversations makes me curious how you decide who gets a callback first. Do you ever hand the overflow to another agent, or send people a scheduling link so the showings sort themselves out?";
const OPEN_HOUSE = {
  url: "https://www.instagram.com/p/DAbc123OpenH/",
  text: "@kayla.homes.denver Sunday open house recap: 31 groups through the door, 19 signed the sheet, and I could read maybe 12 of the phone numbers. Realtors, what do you use for sign in that people actually fill out?",
};
const GOOD = "A QR code on the sign in table that opens a short form usually beats paper for legibility, and you can ask one question there like timeline. Did the 12 you could read include most of the serious buyers?";

function script(o: { score?: (block: string) => { score: number; kind?: Scored["post_kind"] }; draft?: (n: number) => string } = {}) {
  let drafts = 0;
  return (req: LlmRequest) => {
    if (req.webSearch) throw new Error("no web search in paste mode");
    const schema = JSON.stringify(req.schema ?? {});
    if (schema.includes("post_kind")) {
      return JSON.stringify({
        items: req.prompt.split("\n\n").map((b, i) => {
          const s = o.score ? o.score(b) : /two phones/i.test(b) ? { score: 0.35, kind: "story" as const } : { score: 0.85, kind: "question" as const };
          return { i, score: s.score, post_kind: s.kind ?? "question", professional: true, why_selected: s.score < 0.5 ? "A humorous vent with little to discuss about networking or contact exchange." : "A realtor asking how others handle open house sign in.", angle: "a practical idea", mention_ok: false };
        }),
      });
    }
    if (schema.includes("reply_fit")) return JSON.stringify({ reply: o.draft ? o.draft(++drafts) : /two phones/i.test(req.prompt) ? LIVE_COMMENT : GOOD, reply_fit: "Builds on what the post says." });
    return "";
  };
}

async function runPaste(store: MemoryStore, s = script()) {
  await store.patchAgentState(AGENT_ID, { enabled: true });
  const claude = new FakeClaude(s);
  await runAgent({ def: instagramLinkedinBio, store, providers: { claude, critic: null } });
  const [run] = await store.recentRuns(AGENT_ID, 1);
  return { claude, run };
}

describe("Paste a Post: relevance before a comment", () => {
  it("the live post (score 0.35) gets no comment now, says why and how to override, and spends nothing on drafting", async () => {
    const store = new MemoryStore();
    await store.addInput({ platform: "instagram", kind: "post", url: LIVE.url, text: LIVE.text });
    const { claude, run } = await runPaste(store);
    expect(store.approvals).toHaveLength(0);
    expect(claude.calls.map((c) => JSON.stringify(c.schema ?? {}).includes("reply_fit"))).toEqual([false]);
    expect(run.stats).toMatchObject({ pasted_inputs: 1, rejected_low_relevance: 1, posts_scored: 1 });
    expect(run.summary).toMatch(/DfXHRTpobMu.*low relevance, score 0\.35: A humorous vent/);
    expect(run.summary).toMatch(/"comment anyway"/);
    const [t] = (await store.kvGet<TurnedDown[]>(TURNED_DOWN_KEY(AGENT_ID)))!;
    expect(t).toMatchObject({ url: LIVE.url, author: "@hollyhoustonrealtor", stage: "score", score: 0.35, reason: expect.stringMatching(/^low relevance: A humorous vent/) });
  });

  it('"comment anyway" in the pasted text overrides the score, and is not shown to the model', async () => {
    const store = new MemoryStore();
    await store.addInput({ platform: "instagram", kind: "post", url: LIVE.url, text: `${LIVE.text}\ncomment anyway` });
    const { claude } = await runPaste(store);
    expect(store.approvals.map((a) => a.body)).toEqual([LIVE_COMMENT]);
    expect(claude.calls.every((c) => !/comment anyway/i.test(c.prompt))).toBe(true);
    expect(store.approvals[0].meta).toMatchObject({ score: 0.35, source: "paste" });
  });

  it("the override never passes an ad, a giveaway or a post scored under the floor", () => {
    const s = (score: number, post_kind: Scored["post_kind"] = "story"): Scored => ({ i: 0, score, post_kind, professional: false, why_selected: "", angle: "", mention_ok: false });
    expect(PASTE_MIN_SCORE).toBe(0.5);
    expect(rejectReason(s(0.49), true)).toBe("low relevance");
    expect(rejectReason(s(0.5), true)).toBeNull();
    expect(rejectReason(s(0.35), true, true)).toBeNull();
    expect(rejectReason(s(PASTE_OVERRIDE_MIN_SCORE - 0.01), true, true)).toBe("low relevance");
    expect(rejectReason(s(0.9, "giveaway"), true, true)).toBe("ad or giveaway");
    expect(rejectReason(s(0.9, "ad_or_promo"), true, true)).toBe("ad or giveaway");
    // Search finds are unchanged: 0.6 and a professional.
    expect(rejectReason({ ...s(0.65), professional: true }, false)).toBeNull();
    expect(rejectReason(s(0.65), false)).toBe("not a professional");
  });

  it("reads the override wherever it is written, and keeps the caption intact", () => {
    const i = (text: string): CrewInput => ({ id: "x", created_at: "", platform: "instagram", kind: "post", url: LIVE.url, text, status: "new" });
    expect(fromPaste(i(`${LIVE.text} comment anyway.`))).toMatchObject({ override: true, text: LIVE.text, handle: "hollyhoustonrealtor" });
    expect(fromPaste(i(`Comment anyway\n${LIVE.text}`))).toMatchObject({ override: true, text: LIVE.text });
    expect(fromPaste(i(LIVE.text))?.override).toBeUndefined();
  });

  it("an on-topic paste is still drafted as before", async () => {
    const store = new MemoryStore();
    await store.addInput({ platform: "instagram", kind: "post", url: OPEN_HOUSE.url, text: OPEN_HOUSE.text });
    await runPaste(store);
    expect(store.approvals.map((a) => ({ body: a.body, status: a.status, kind: a.kind }))).toEqual([{ body: GOOD, status: "pending", kind: "comment" }]);
  });
});

describe("Paste a Post: what it turned down can be reviewed", () => {
  it("both rejected drafts and the reasons are kept for the admin page, not the Sheet; no caption is stored", async () => {
    const store = new MemoryStore();
    await store.addInput({ platform: "instagram", kind: "post", url: OPEN_HOUSE.url, text: OPEN_HOUSE.text });
    const drafts = ["Which sign in tool do they fill out? Do you collect emails too?", "Love this, so true. What do you think?"];
    const { run } = await runPaste(store, script({ draft: (n) => drafts[n - 1] }));
    expect(store.approvals).toHaveLength(0);
    expect(run.stats).toMatchObject({ drafts_failed_checks: 1 });
    const [t] = (await store.kvGet<TurnedDown[]>(TURNED_DOWN_KEY(AGENT_ID)))!;
    expect(t).toMatchObject({ url: OPEN_HOUSE.url, author: "@kayla.homes.denver", stage: "writing check", score: 0.85, drafts });
    expect(t.reason).toMatch(/generic engagement question/);
    expect(JSON.stringify(t)).not.toContain("19 signed the sheet");
  });

  it("keeps the newest 30", async () => {
    const store = new MemoryStore();
    for (let n = 0; n < 32; n++) await store.addInput({ platform: "instagram", kind: "post", url: `https://www.instagram.com/p/DLow${String(n).padStart(4, "0")}x/`, text: LIVE.text });
    for (let n = 0; n < 7; n++) await runPaste(store);
    expect((await store.kvGet<TurnedDown[]>(TURNED_DOWN_KEY(AGENT_ID)))!).toHaveLength(30);
  });

  it("the admin Agents page shows it on that agent's card, folded away, and on no other card", async () => {
    const { loadDashboard } = await import("@/lib/crew/dashboard");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { default: SheetAgents } = await import("@/app/admin/crew/SheetAgents");
    const store = new MemoryStore();
    await store.addInput({ platform: "instagram", kind: "post", url: LIVE.url, text: LIVE.text });
    await runPaste(store);
    const d = await loadDashboard(store, new Date());
    const rows = "sheetAgents" in d ? d.sheetAgents : [];
    expect(rows.find((r) => r.id === AGENT_ID)?.turnedDown.map((t) => t.url)).toEqual([LIVE.url]);
    expect(rows.filter((r) => r.turnedDown.length).map((r) => r.id)).toEqual([AGENT_ID]);
    const html = renderToStaticMarkup(createElement(SheetAgents, { rows, sheetUrl: null }));
    expect(html).toMatch(/<details[^>]*data-turned-down="contact-instagram-linkinbio"/);
    expect(html).toContain("Turned down lately (1)");
    expect(html).toContain("Not drafted: low relevance: A humorous vent");
  });
});

describe("Comments that start a conversation, not engagement", () => {
  it("engagement bait is caught; specific questions pass", () => {
    const bait = [
      "Juggling two phones on a Saturday is a whole sport. What do you think the answer is?",
      "Fifteen conversations before lunch is wild. Anyone else feel this on weekends with showings?",
      "Six showings and two phones in one day. How do you do it all and still answer everyone?",
      "Sign in sheets with unreadable numbers are a classic open house problem. Thoughts?",
      "That line about making it work is every realtor on a Saturday afternoon, who can relate here",
    ];
    for (const b of bait) expect(commentProblems(b, { mentionOk: false }), b).toEqual(expect.arrayContaining([expect.stringMatching(/generic engagement question/)]));
    expect(commentProblems(GOOD, { mentionOk: false })).toEqual([]);
    expect(commentProblems(LIVE_COMMENT, { mentionOk: false })).toEqual([]);
  });

  it("the writer is told to build on contact exchange only where the post raises it", () => {
    expect(COMMENT_SYSTEM).toMatch(/meeting people, swapping contact details, capturing leads or keeping in touch/);
    expect(COMMENT_SYSTEM).toMatch(/never steer the talk toward networking/);
    expect(COMMENT_SYSTEM).toMatch(/Never engagement bait/);
  });
});

// ── Who takes a pasted Instagram post ──────────────────────────────────────
// The production check on 2026-11-05 could only show that Instagram DMs left
// the post alone while it was out of budget (it stops before reading Paste a
// Post). These run every agent in the registry with money to spend.

describe("Pasted Instagram posts: only Instagram LinkedIn Bio takes them", () => {
  const PROFILE = { url: "https://www.instagram.com/denver.lender.mike/", text: "@denver.lender.mike Mortgage loan officer in Denver. NMLS 123456." };

  it("every agent in the registry, each with budget left, leaves a pasted post alone except Instagram LinkedIn Bio", async () => {
    const takers: string[] = [];
    for (const def of AGENTS) {
      const store = new MemoryStore();
      await store.updateSettings({ kill_all: false, daily_usd_cap: 3 });
      await store.patchAgentState(def.id, { enabled: true });
      await store.addInput({ platform: "instagram", kind: "post", url: OPEN_HOUSE.url, text: OPEN_HOUSE.text });
      const claude = new FakeClaude((req) => (JSON.stringify(req.schema ?? {}).includes("reply_fit") ? JSON.stringify({ reply: GOOD, reply_fit: "x" }) : JSON.stringify({ items: [] })));
      await runAgent({ def, store, providers: { claude, critic: null } }).catch(() => null);
      if (store.inputs[0].status !== "new") takers.push(def.id);
    }
    expect(takers).toEqual([AGENT_ID]);
  }, 60_000);

  it("Instagram DMs with budget left takes the pasted profile and leaves the post, wherever the post sits in the queue", async () => {
    const dms = AGENTS.find((d) => d.id === "contact-instagram")!;
    const store = new MemoryStore();
    await store.patchAgentState(dms.id, { enabled: true });
    for (let n = 0; n < 8; n++) await store.addInput({ platform: "instagram", kind: "post", url: `https://www.instagram.com/p/DQueue${n}xx/`, text: OPEN_HOUSE.text });
    await store.addInput({ platform: "instagram", kind: "profile", url: PROFILE.url, text: PROFILE.text });
    const claude = new FakeClaude(() => JSON.stringify({ items: [] }));
    await runAgent({ def: dms, store, providers: { claude, critic: null } });
    const [run] = await store.recentRuns(dms.id, 1);
    expect(run.status).not.toBe("budget");
    expect(store.inputs.filter((i) => i.status !== "new").map((i) => i.url)).toEqual([PROFILE.url]);
  });
});

// ── The production code path: SupabaseStore.takeInputs ────────────────────
// MemoryStore is what the tests above run on; production claims rows in
// Supabase. A fake table checks the real query: it never writes to a row the
// agent doesn't accept, even with more posts ahead than one look covers.

type Row = CrewInput & { used_by?: string | null };
const table: { rows: Row[]; updates: string[] } = { rows: [], updates: [] };

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: () => {
      const f: ((r: Row) => boolean)[] = [];
      let lim = Infinity;
      let patch: Partial<Row> | null = null;
      const q = {
        select: () => q,
        update: (p: Partial<Row>) => ((patch = p), q),
        eq: (c: keyof Row, v: unknown) => (f.push((r) => r[c] === v), q),
        in: (c: keyof Row, v: unknown[]) => (f.push((r) => v.includes(r[c])), q),
        order: () => q,
        limit: (n: number) => ((lim = n), q),
        then(ok: (v: unknown) => unknown) {
          const hit = table.rows.filter((r) => f.every((x) => x(r)));
          if (patch) {
            for (const r of hit) {
              Object.assign(r, patch);
              table.updates.push(r.id);
            }
            return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok);
          }
          return Promise.resolve({ data: hit.slice(0, lim), error: null }).then(ok);
        },
      };
      return q;
    },
  }),
}));

describe("Pasted Instagram posts: the Supabase claim", () => {
  it("Instagram DMs' filter claims only profiles; no update ever touches a post row, even with 60 posts ahead", async () => {
    const { SupabaseStore } = await import("@/lib/crew/store-supabase");
    const { isPastedPost } = await import("@/lib/crew/agents/instagram-conversations");
    const row = (n: number, url: string, kind: CrewInput["kind"]): Row => ({ id: `r${n}`, created_at: new Date(Date.UTC(2026, 10, 5, 0, n)).toISOString(), platform: "instagram", kind, url, text: "t", status: "new" });
    table.rows = [...Array.from({ length: 60 }, (_, n) => row(n, `https://www.instagram.com/p/DPost${n}xx/`, "post")), row(60, "https://www.instagram.com/denver.lender.mike/", "profile"), row(61, "https://www.instagram.com/kayla.homes.denver/", "profile")];
    table.updates = [];
    const store = new SupabaseStore();
    const near = await store.takeInputs(["instagram"], 5, "contact-instagram", (i) => !isPastedPost(i));
    // 60 posts fill the first look (50 rows): nothing is claimed, nothing is written.
    expect(near).toEqual([]);
    expect(table.updates).toEqual([]);
    table.rows = table.rows.slice(20);
    const got = await store.takeInputs(["instagram"], 5, "contact-instagram", (i) => !isPastedPost(i));
    expect(got.map((r) => r.id)).toEqual(["r60", "r61"]);
    expect(table.updates).toEqual(["r60", "r61"]);
    expect(table.rows.filter((r) => r.kind === "post").every((r) => r.status === "new")).toBe(true);
    // And the comment agent's filter takes posts only.
    const posts = await store.takeInputs(["instagram"], 5, AGENT_ID, isPastedPost);
    expect(posts.map((r) => r.kind)).toEqual(["post", "post", "post", "post", "post"]);
  });
});
