import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { textOf } from "@/lib/crew/llm/anthropic";
import { blockedDomain, onDomain, searchItems, searchPlatform } from "@/lib/crew/sources/web-discovery";
import { fakeAgent, setup } from "./crew-helpers";

// Found live on 2026-10-20: web-search answers interleave narration with tool
// calls, free-form JSON arrived in pieces, low effort gave up with "[]", 3
// searches ran out, and Reddit blocks Anthropic's search tool entirely.

describe("reading the model's answer", () => {
  it("keeps only the text after the last tool block, joining cited pieces", () => {
    const blocks = [
      { type: "server_tool_use" },
      { type: "text", text: "Results are dicts in a list; retry." },
      { type: "web_search_tool_result" },
      { type: "thinking" },
      { type: "text", text: '{"items":[{"name":"A",' },
      { type: "text", text: '"website":"https://a.com"}]}' },
    ];
    expect(textOf(blocks)).toBe('{"items":[{"name":"A","website":"https://a.com"}]}');
    expect(textOf([{ type: "text", text: "plain" }])).toBe("plain");
  });
});

describe("web search agents", () => {
  it("ask for a required JSON shape, at medium effort, with enough searches", async () => {
    const { ctx, claude } = await setup({ def: fakeAgent(), script: () => JSON.stringify({ items: [{ url: "https://www.linkedin.com/posts/x", author: "Jo", title: "t", text: "about networking", community: "" }, { url: "https://evil.example.com/x", author: "", title: "", text: "", community: "" }] }) });
    const found = await searchPlatform(ctx, "linkedin", ["networking"], 5);
    const req = claude.calls[0];
    expect(req.schema).toBeTruthy();
    expect(req.effort).toBe("medium");
    expect(req.webSearch).toMatchObject({ maxUses: 6, allowedDomains: ["linkedin.com"] });
    expect(found.map((f) => f.url)).toEqual(["https://www.linkedin.com/posts/x"]); // off-domain URL dropped
    expect(found[0].community).toBeNull();
  });

  it("caps the list and survives a refusal", async () => {
    const { ctx } = await setup({ def: fakeAgent(), script: () => "__REFUSE__" });
    expect(await searchItems(ctx, { system: "s", prompt: "p", fields: ["name"] })).toEqual([]);
  });

  it("matches domains exactly, not by suffix tricks", () => {
    expect(onDomain("https://www.linkedin.com/posts/x", ["linkedin.com"])).toBe(true);
    expect(onDomain("https://notlinkedin.com/x", ["linkedin.com"])).toBe(false);
    expect(onDomain("not a url", ["linkedin.com"])).toBe(false);
  });

  it("Reddit never goes through web search (Reddit blocks it); without API keys only pasted posts", () => {
    expect(readFileSync("src/lib/crew/sources/web-discovery.ts", "utf8")).not.toMatch(/reddit:\s*\[/);
    for (const f of ["src/lib/crew/agents/replies.ts", "src/lib/crew/agents/contact.ts"]) expect(readFileSync(f, "utf8")).not.toMatch(/searchPlatform\(ctx, "reddit"/);
  });

  it("a site that blocks the search tool means no results, not a failed run", async () => {
    const msg = `400 {"type":"error","error":{"type":"invalid_request_error","message":"The following domains are not accessible to our user agent: ['threads.net']."}}`;
    expect(blockedDomain(new Error(msg))).toBe(true);
    expect(blockedDomain(new Error("overloaded"))).toBe(false);
    const { ctx } = await setup({
      def: fakeAgent(),
      script: () => {
        throw new Error(msg);
      },
    });
    expect(await searchPlatform(ctx, "threads", ["cards"], 5)).toEqual([]);
    expect(readFileSync("src/lib/crew/sources/web-discovery.ts", "utf8")).not.toMatch(/"threads\.net"/);
  });
});
