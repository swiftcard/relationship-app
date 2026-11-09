import { describe, expect, it } from "vitest";
import { wellFormed } from "@/lib/crew/llm/anthropic";

// 2026-11-07: the first Instagram DM run on real captions failed with the API's
// "request body is not valid JSON: unexpected end of hex escape". A caption cut
// with .slice() ended in half an emoji.
describe("text sent to the model is well-formed", () => {
  it("replaces half an emoji so the request body is valid JSON for the API", () => {
    const cut = "Open house today 😀".slice(0, 18);
    expect(JSON.stringify(cut)).toMatch(/\\ud83d"$/);
    const fixed = wellFormed(cut);
    expect(fixed.isWellFormed()).toBe(true);
    expect(JSON.stringify(fixed)).not.toMatch(/\\ud8/);
  });

  it("leaves whole emoji and ordinary text alone", () => {
    expect(wellFormed("Sold! 🏡 Call me")).toBe("Sold! 🏡 Call me");
  });

  it("is applied to the system prompt and the user prompt", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/crew/llm/anthropic.ts", "utf8");
    expect(src).toContain("text: wellFormed(req.system)");
    expect(src).toContain("content: wellFormed(req.prompt)");
  });
});
