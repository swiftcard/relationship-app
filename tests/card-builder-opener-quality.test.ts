import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { messageStatLabel, openerResults, openerStats, FEW_SENDS, type MessageEvent } from "@/lib/prospect-preview/learn";
import { checkOpeners, checkOpenerText, openerFacts, openerSentVariant, openerStatKey, openerStatLabel, openerText, rankOpeners, readOpeners, revealsOpen, type OpenerCandidate } from "@/lib/prospect-preview/opener";
import { applyJudge, judgeMessage, judgeOpeners, judgeOrder, JUDGE_MAX_TOKENS, readJudgeInFile, readJudgeVerdict } from "@/lib/prospect-preview/opener-judge";
import { checkOutreach, readOutreach, REVEALS_OPEN_KEYS } from "@/lib/prospect-preview/outreach";
import type { PreviewListRow, ProspectPreview, Specific } from "@/lib/prospect-preview/types";

// ── Card Builder: opener quality (owner, 2026-11-17) ────────────────────────
// 1. An independent judge picks the default, not the writer grading itself.
// 2. Real open rates go back to the writer.
// 3. The owner's edits are credited to him, not to the model's hook.
// 4. Nothing sent after the card says "saw you opened it".

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const spec = (text: string, extra: Partial<Specific> = {}): Specific => ({ kind: "listing", text, source_url: "https://harborrealty.com/x", dated: "2026-11-10", uncertain: false, ...extra });
const P: Pick<ProspectPreview, "owner_name" | "office_name" | "owner_title" | "address" | "specialty" | "team_members" | "team_size" | "specifics" | "sources" | "warm_path"> = {
  owner_name: "Dana Whitfield", office_name: "Harbor Realty Group", owner_title: "Owner & Principal Broker",
  address: "12 Middle Neck Rd, Great Neck, NY 11021", specialty: "North Shore homes since 2009",
  team_members: [{ name: "Marcus Lee", title: "Associate Broker" }], team_size: 14,
  specifics: [
    spec("Listed 41 Cedar Ln, Great Neck, a 4-bedroom colonial, at $1.6M"),
    spec("212 reviews on Zillow, 4.9 stars", { kind: "other" }),
    spec("Sold 9 Plandome Rd, Manhasset, in October", { kind: "sale" }),
  ],
  sources: { team_size: { url: "https://harborrealty.com/team", uncertain: false, note: "" } },
  warm_path: null,
};
const ctx = { owner_name: P.owner_name, facts: openerFacts(P) };
const GOOD = {
  listing: "Hey Dana, Menash here. Saw your listing on Cedar Ln in Great Neck, so I made you a card that shows it off with your photo and your number. It's yours if you want it:",
  team: "Hi Dana, it's Menash. I put together cards for you and the 14 agents at Harbor Realty Group so everyone matches when they hand one out. Figured you'd want to see it:",
  reviews: "Hey Dana, Menash here. 212 reviews on Zillow is a lot to keep to yourself, so I made you a card that puts them right under your name. Figured you'd want to see it:",
  recent: "Hey Dana, Menash here. Saw the Plandome Rd sale in Manhasset last month, so I made you a card with that and your contact info on it. It's yours if you want it:",
};
const cand = (hook: OpenerCandidate["hook"], text: string, uses: number | null, s = [8, 8, 8]): OpenerCandidate => ({ hook, text, uses, scores: { specificity: s[0], human: s[1], curiosity: s[2] } });
// The writer likes the listing one best (26); the judge will prefer another.
const FOUR = [cand("listing", GOOD.listing, 0, [9, 8, 9]), cand("team", GOOD.team, null, [8, 8, 7]), cand("reviews", GOOD.reviews, 1, [8, 7, 8]), cand("recent", GOOD.recent, 2, [7, 7, 7])];
const TEXTS = FOUR.map((c) => c.text);
/** The judge's answer naming candidates by position, translated to the numbers it was shown. */
const answer = (positions: number[], reason = (p: number) => `reason for ${p}`) => {
  const shown = judgeOrder(TEXTS);
  return { ranking: positions.map((p) => ({ n: shown.indexOf(p) + 1, reason: reason(p) })) };
};

describe("1. an independent judge picks the default", () => {
  it("the judge is shown the verified facts and the texts only: no hooks, no scores, and not in the writer's order", () => {
    const m = judgeMessage(ctx.facts, TEXTS);
    for (const t of TEXTS) expect(m).toContain(t);
    for (const f of ctx.facts) expect(m).toContain(`- ${f}`);
    expect(m).not.toMatch(/\b(listing|team|reviews|recent|niche|warm)\b:|hook|specificity|curiosity|scores?\b|\b26\b/i);
    // Same texts, same order, every time (so /build-card and set-openers agree); a permutation of all of them.
    expect(judgeOrder(TEXTS)).toEqual(judgeOrder([...TEXTS]));
    expect([...judgeOrder(TEXTS)].sort()).toEqual([0, 1, 2, 3]);
  });

  it("its ranking sets pick and alt; the writer's scores stay; each reason is kept on its candidate", () => {
    const writer = rankOpeners(FOUR, new Date("2026-11-17T12:00:00Z"));
    expect(writer.pick).toBe(0);
    const verdict = readJudgeVerdict(answer([2, 3, 0, 1]), TEXTS)!;
    expect(verdict.order).toEqual([2, 3, 0, 1]);
    const judged = applyJudge(writer, verdict, ctx);
    expect(judged.pick).toBe(2);
    expect(judged.alt).toBe(3);
    expect(judged.picked_by).toBe("judge");
    expect(openerText(judged)).toBe(GOOD.reviews);
    expect(judged.candidates[2].judge).toEqual({ rank: 1, reason: "reason for 2" });
    expect(judged.candidates[0].judge).toEqual({ rank: 3, reason: "reason for 0" });
    expect(judged.candidates.map((c) => c.scores)).toEqual(FOUR.map((c) => c.scores));
    // Saved and read back from the jsonb: the reasons and who picked survive.
    const back = readOpeners(JSON.parse(JSON.stringify(judged)))!;
    expect(back.pick).toBe(2);
    expect(back.picked_by).toBe("judge");
    expect(back.candidates[2].judge?.reason).toBe("reason for 2");
  });

  it("when the judge's top pick breaks a rule, the next one that passes is the default", () => {
    const broken = cand("niche", "Hey Dana, Menash here. Love your amazing North Shore work, so I made you a card for it with your photo and your number on it. It's yours if you want it:", null, [6, 6, 6]);
    expect(checkOpenerText(broken.text, ctx).length).toBeGreaterThan(0);
    const set = [...FOUR, broken];
    const texts = set.map((c) => c.text);
    const shown = judgeOrder(texts);
    const ranking = [4, 3, 1, 0, 2].map((p) => ({ n: shown.indexOf(p) + 1, reason: `r${p}` }));
    const judged = applyJudge(rankOpeners(set), readJudgeVerdict({ ranking }, texts)!, ctx);
    expect(judged.pick).toBe(3);
    expect(judged.alt).toBe(1);
    expect(judged.candidates[4].judge?.rank).toBe(1);
  });

  it("an answer that doesn't rank every text exactly once, with a reason, is not used", () => {
    expect(readJudgeVerdict(null, TEXTS)).toBeNull();
    expect(readJudgeVerdict({ ranking: answer([0, 1, 2]).ranking }, TEXTS)).toBeNull();
    const dup = answer([0, 1, 2, 3]); dup.ranking[1].n = dup.ranking[0].n;
    expect(readJudgeVerdict(dup, TEXTS)).toBeNull();
    expect(readJudgeVerdict(answer([0, 1, 2, 3], () => ""), TEXTS)).toBeNull();
    expect(readJudgeVerdict({ ranking: [{ n: 9, reason: "x" }, ...answer([1, 2, 3]).ranking] }, TEXTS)).toBeNull();
  });

  it("asks once more when the answer can't be read, and never holds a prospect back when the judge can't be had", async () => {
    const writer = rankOpeners(FOUR);
    let calls = 0;
    const good = await judgeOpeners(writer, ctx, async (_m, retry) => { calls++; return retry ? JSON.stringify(answer([1, 0, 2, 3])) : "no idea"; }, (r) => { try { return JSON.parse(r); } catch { return null; } });
    expect(calls).toBe(2);
    expect(good.openers.pick).toBe(1);
    expect(good.openers.picked_by).toBe("judge");
    const down = await judgeOpeners(writer, ctx, async () => { throw new Error("overloaded"); }, () => null);
    expect(down.openers.pick).toBe(writer.pick);
    expect(down.openers.picked_by).toBe("writer");
    expect(down.note).toMatch(/overloaded/);
  });

  it("the writer's own best still has to be good enough, whichever one the judge picked", () => {
    const judged = applyJudge(rankOpeners(FOUR), readJudgeVerdict(answer([3, 2, 1, 0]), TEXTS)!, ctx);
    expect(judged.pick).toBe(3); // 21 of 30 by the writer
    expect(checkOpeners(judged, P)).toEqual([]);
  });

  it("one rubric file, used by the server (Sonnet, no web) and by /build-card step 10b", () => {
    const agent = read(".claude/agents/opener-judge.md");
    expect(agent).toMatch(/^---\nname: opener-judge\n/);
    expect(agent).toMatch(/lock screen/);
    expect(agent).toMatch(/would I tap the link/);
    expect(agent).toMatch(/"ranking"/);
    const jobs = code("src/lib/card-builder-jobs/jobs.ts");
    expect(jobs).toContain('export const JUDGE_MODEL = "claude-sonnet-5-5"');
    expect(jobs).toMatch(/turn\(judgeConvo, \{ system: agentText\("opener-judge"\), web: false/);
    expect(jobs).toMatch(/judgeOpeners\(ranked, \{ owner_name: p\.owner_name, facts: openerFacts\(p\), stale \}/);
    expect(read("next.config.ts")).toContain('"./.claude/agents/opener-judge.md"');
    const build = read(".claude/commands/build-card.md");
    expect(build).toMatch(/^10b\. \*\*Have them judged, independently, then save\.\*\*/m);
    expect(build).toContain("judge-input <id> <file.json>");
    expect(build).toContain("`opener-judge` agent");
    expect(build.indexOf("judge-input")).toBeLessThan(build.indexOf("set-openers <id> <file.json>"));
    const tool = code("tests/tools/card-builder.tool.ts");
    expect(tool).toMatch(/readJudgeInFile\(raw\.judge/);
    expect(tool).toMatch(/judgeMessage\(openerFacts\(p\)/);
    // The Mac's batch runs can reach that one agent.
    const mac = read("scripts/card-builder-mac/agent.mjs");
    expect(mac).toContain('join(ROOT, ".claude", "agents", "opener-judge.md")');
    expect(mac).toMatch(/"--allowedTools", "[^"]*Agent\(opener-judge\)/);
  });

  it("Approve shows the judge's reason in All versions", () => {
    const view = read("src/app/admin/card-builder/approve/ApproveView.tsx");
    expect(view).toContain("data-judge-reason");
    expect(view).toContain("Judge: {c.judge.reason}");
  });
});

// ── 2 and 3: open rates, and whose words went ──────────────────────────────

const row = (id: string, over: Partial<PreviewListRow> = {}) => ({ id, batch_id: null, last_viewed_at: null, ...over }) as unknown as PreviewListRow;
const sent = (preview_id: string, variant: string | null, at = "2026-11-10T15:00:00Z"): MessageEvent => ({ at, preview_id, kind: "sent", message: "opener", variant, before: null, after: null });

describe("2. real open rates go back to the writer", () => {
  it("sent and opened by hook, by segment and by hook within a segment; under 10 sends is 'too few to tell'", () => {
    const rows: PreviewListRow[] = [], events: MessageEvent[] = [];
    for (let i = 0; i < 12; i++) { rows.push(row(`l${i}`, { batch_id: "b1", last_viewed_at: i < 6 ? "2026-11-11T00:00:00Z" : null } as Partial<PreviewListRow>)); events.push(sent(`l${i}`, "listing")); }
    for (let i = 0; i < 3; i++) { rows.push(row(`t${i}`, { last_viewed_at: "2026-11-11T00:00:00Z" } as Partial<PreviewListRow>)); events.push(sent(`t${i}`, "team")); }
    const stats = openerStats(events, rows, new Map([["b1", "realtors in Great Neck"]]));
    expect(stats.byHook).toEqual([{ key: "listing", sent: 12, opened: 6 }, { key: "team", sent: 3, opened: 3 }]);
    expect(stats.bySegmentHook).toContainEqual({ segment: "realtors in Great Neck", hook: "listing", sent: 12, opened: 6 });
    const r = openerResults(stats, "realtors in Great Neck");
    expect(FEW_SENDS).toBe(10);
    expect(r.by_hook.find((x) => x.hook === "listing")?.rate).toBe("50% opened");
    expect(r.by_hook.find((x) => x.hook === "team")?.rate).toBe("too few to tell");
    expect(r.by_segment.find((x) => x.segment === "One at a time")?.rate).toBe("too few to tell");
    expect(r.this_segment?.by_hook).toEqual([expect.objectContaining({ hook: "listing", sent: 12, opened: 6, rate: "50% opened" })]);
    expect(r.how_to_use).toMatch(/Never invent a fact/);
    expect(openerResults(stats).this_segment).toBeNull();
  });

  it("the writer sees them: `style` returns them, writeOpener sends them with the facts, step 10 leans on them", () => {
    const tool = code("tests/tools/card-builder.tool.ts");
    expect(tool).toMatch(/const opener_results = await loadOpenerResults\(p\)/);
    expect(tool).toMatch(/\.\.\.notes, opener_results/);
    const jobs = code("src/lib/card-builder-jobs/jobs.ts");
    expect(jobs).toContain("const results = await loadOpenerResults(p);");
    expect(jobs).toMatch(/"How earlier openers did[^"]*", JSON\.stringify\(results\)/);
    const build = read(".claude/commands/build-card.md");
    expect(build).toContain("**Lean toward what's getting opened.**");
    expect(build).toContain("this_segment");
    expect(build).toContain('"too few to tell" (under 10 sends)');
    expect(build).toContain("**Never invent a fact to use a hook that's doing well**");
  });
});

describe("3. the owner's edit is credited to him, not to the model's hook", () => {
  const o = rankOpeners(FOUR);
  it("a sent opener records whether the model's words or his edit went out", () => {
    expect(openerSentVariant(o)).toBe("listing");
    expect(openerSentVariant({ ...o, edited: "my words" })).toBe("edit:listing");
    expect(openerSentVariant(o, true)).toBe("edit:listing"); // reworded on the Send screen
    expect(openerSentVariant(null)).toBeNull();
    expect(openerStatKey("edit:listing")).toBe("edit");
    expect(openerStatKey("listing")).toBe("listing");
    expect(openerStatLabel("edit")).toBe("Your edit");
  });

  it("openerStats counts each hook and 'your edit' separately", () => {
    const rows = [row("a", { last_viewed_at: "2026-11-11T00:00:00Z" } as Partial<PreviewListRow>), row("b"), row("c", { last_viewed_at: "2026-11-11T00:00:00Z" } as Partial<PreviewListRow>)];
    const stats = openerStats([sent("a", "listing"), sent("b", "edit:listing"), sent("c", "edit:reviews")], rows, new Map());
    expect(stats.byHook).toEqual([{ key: "edit", sent: 2, opened: 1 }, { key: "listing", sent: 1, opened: 1 }]);
  });

  it("both ways an opener goes record it: the Send screen and the Mac's outbox", () => {
    const route = code("src/app/api/admin/card-builder/[id]/route.ts");
    expect(route).toContain('openerSentVariant(p.openers, !!words && words !== saved)');
    const outbox = code("src/lib/prospect-preview/outbox.ts");
    expect(outbox).toContain("hook: openerSentVariant(p.openers)");
    // The Mac copies the outbox row's value onto the sent event as it is.
    expect(read("scripts/card-builder-mac/agent.mjs")).toMatch(/kind: "sent", message: "opener", variant: row\.hook/);
    expect(code("src/app/admin/card-builder/CardBuilderView.tsx")).toContain('label={openerStatLabel}');
  });
});

describe("4. nothing after the card says 'saw you opened it'", () => {
  const SPECIFICS = [spec("Open house at 88 Hicks St, Sunday Nov 16", { kind: "open_house" }), spec("Listed 14 Garden Pl at $3.4M"), spec("Most agents list a personal cell number on the team page", { kind: "cell_numbers" })];
  const base = {
    first_text: "Hi Dana, Menash from SwiftCard. Saw your open house at 88 Hicks St Sunday. I made you a card for it. Want me to send it?",
    link_text: "Dana, here's the card for 14 Garden Pl: {link}", email_subject: "Dana, a card for 14 Garden Pl",
    email_body: "Hi Dana,\n\nI made a card you could send with 14 Garden Pl.\n\nHere it is: {link}\n\nMenash",
    call_opener: "Hi Dana, it's Menash. I sent you a card for Sunday's open house at 88 Hicks. Do you have two minutes?",
    voicemail: "Hi Dana, it's Menash. Most of your agents give out their own cell, and I made Harbor a card for that. Text me back.",
    nudge_no_view: "Dana, the card for Sunday's open house is still up: {link}",
    nudge_viewed: "Dana, tried you earlier about 14 Garden Pl. Is tomorrow morning better for 5 minutes?",
  };
  const ctxO = { link: "https://swiftcard.me/p/harbor-k3x9qa", specifics: SPECIFICS };
  it("the four messages are checked with the opener's own revealsOpen, and a clean set passes", () => {
    expect(REVEALS_OPEN_KEYS).toEqual(["nudge_viewed", "nudge_no_view", "call_opener", "voicemail"]);
    expect(checkOutreach(readOutreach(base), ctxO)).toEqual([]);
  });

  it.each([
    ["nudge_viewed", "Dana, saw you opened the card. Tried you just now. Is later today better for 5 minutes?"],
    ["nudge_no_view", "Dana, noticed you haven't opened the card yet. Here it is again: {link}"],
    ["call_opener", "Hi Dana, it's Menash. I see you just looked at the card I made you. Got a minute?"],
    ["voicemail", "Hi Dana, it's Menash. Saw you opened the card for 88 Hicks. Call me back when you can."],
  ])("%s that gives it away is refused", (key, words) => {
    expect(revealsOpen(words)).toBe(true);
    expect(checkOutreach(readOutreach({ ...base, [key]: words }), ctxO).join(" ")).toMatch(/gives away that you saw them open the card/);
  });

  it("build-card's example no longer says it", () => {
    const build = read(".claude/commands/build-card.md");
    expect(build).not.toContain('"nudge_viewed": "Dana, saw you opened the card.');
    expect(build).toMatch(/\*\*Never say or hint that you saw them open it\*\*/);
    expect(build).not.toMatch(/"nudge_viewed": "[^"]*just now/);
    for (const m of build.matchAll(/"(nudge_viewed|nudge_no_view|call_opener|voicemail)": "([^"]*)"/g)) expect(revealsOpen(m[2]), m[1]).toBe(false);
  });
});

// ── Follow-up fixes (owner, 2026-11-17) ─────────────────────────────────────

describe("follow-up: the judge can be unavailable on the Mac without losing the prospect", () => {
  it("set-openers takes the agent's ranking, or { unavailable } alone, and refuses anything else", () => {
    const shown = judgeOrder(TEXTS);
    const ranking = shown.map((_, n) => ({ n: n + 1, reason: `r${n}` }));
    expect(readJudgeInFile({ ranking }, TEXTS)).toHaveProperty("verdict");
    expect(readJudgeInFile({ unavailable: "  agent timed out \n twice " }, TEXTS)).toEqual({ unavailable: "agent timed out twice" });
    expect(readJudgeInFile(undefined, TEXTS)).toBeNull();
    expect(readJudgeInFile({}, TEXTS)).toBeNull();
    expect(readJudgeInFile({ unavailable: "   " }, TEXTS)).toBeNull();
    expect(readJudgeInFile({ unavailable: 1 }, TEXTS)).toBeNull();
    // A broken ranking can't slip through by also saying "unavailable".
    expect(readJudgeInFile({ ranking: ranking.slice(1), unavailable: "x" }, TEXTS)).toBeNull();
    expect(readJudgeInFile({ ranking: ranking.slice(1) }, TEXTS)).toBeNull();
  });

  it("the tool saves the writer's own ranking when the judge was unavailable, and build-card says when that's allowed", () => {
    const tool = readFileSync("tests/tools/card-builder.tool.ts", "utf8");
    expect(tool).toContain("readJudgeInFile(raw.judge");
    expect(tool).toContain('{ ...ranked, picked_by: "writer" as const }');
    const cmd = readFileSync(".claude/commands/build-card.md", "utf8");
    expect(cmd).toMatch(/failed twice[\s\S]{0,200}"unavailable"/);
  });
});

describe("follow-up: the server gives the judge room to think", () => {
  it("the judge's turn has 16,000 tokens, not 4,000", () => {
    expect(JUDGE_MAX_TOKENS).toBeGreaterThanOrEqual(16_000);
    const jobs = readFileSync("src/lib/card-builder-jobs/jobs.ts", "utf8");
    expect(jobs).toContain("maxTokens: JUDGE_MAX_TOKENS");
    expect(jobs).not.toContain("maxTokens: 4000");
  });
});

describe("follow-up: the per-message table names an opener's hook, not its raw variant", () => {
  it("opener rows read as the hook or 'your edit'; the first text keeps version A or B", () => {
    expect(messageStatLabel("opener", "listing")).toBe("Opening text (with the link), a listing, by street");
    expect(messageStatLabel("opener", "edit:listing")).toBe("Opening text (with the link), your edit");
    expect(messageStatLabel("ask", "b")).toBe("First text, version B");
    expect(messageStatLabel("email", null)).toBe("Email");
    expect(readFileSync("src/app/admin/card-builder/CardBuilderView.tsx", "utf8")).toContain("messageStatLabel(s.message, s.variant)");
  });
});
