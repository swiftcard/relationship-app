import { describe, expect, it, vi } from "vitest";
import { searchItems } from "@/lib/crew/sources/web-discovery";
import type { LlmResponse } from "@/lib/crew/llm/types";
import { fakeAgent, setup } from "./crew-helpers";

// Office Prospects' searches came back empty three times on 2026-11-03 and
// the run kept no record of why. An empty search now says which of these it was.

const reply = (o: Partial<LlmResponse>): LlmResponse => ({ text: "", model: "m", refused: false, truncated: false, stopReason: "end_turn", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, webSearches: 3 }, ...o });

async function run(r: LlmResponse) {
  const { ctx } = await setup({ def: fakeAgent() });
  vi.spyOn(ctx.llm, "ask").mockResolvedValue(r);
  const items = await searchItems(ctx, { system: "s", prompt: "p", fields: ["name"] });
  return { items, stats: ctx.stats };
}

describe("an empty web search says why", () => {
  it("the model answered an empty list", async () => {
    const { items, stats } = await run(reply({ text: '{"items":[]}' }));
    expect(items).toEqual([]);
    expect(stats).toMatchObject({ search_empty_answer: 1, search_answer_chars: 12, search_web_searches: 3 });
    expect(stats.search_unparsed).toBeUndefined();
  });

  it("the turn paused before any answer (pause_turn)", async () => {
    expect((await run(reply({ stopReason: "pause_turn" }))).stats).toMatchObject({ search_empty_answer: 1, search_paused: 1, search_answer_chars: 0 });
  });

  it("the answer was cut off, refused, or not JSON", async () => {
    expect((await run(reply({ text: '{"items":[{"na', truncated: true, stopReason: "max_tokens" }))).stats).toMatchObject({ search_truncated: 1 });
    expect((await run(reply({ refused: true, stopReason: "refusal" }))).stats).toMatchObject({ search_refused: 1 });
    expect((await run(reply({ text: "Here are some teams I found" }))).stats).toMatchObject({ search_unparsed: 1 });
  });

  it("a search with results records none of this", async () => {
    const { items, stats } = await run(reply({ text: '{"items":[{"name":"A"}]}' }));
    expect(items).toEqual([{ name: "A" }]);
    expect(Object.keys(stats).filter((k) => k.startsWith("search_"))).toEqual([]);
  });
});
