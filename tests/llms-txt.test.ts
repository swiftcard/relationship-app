import { describe, it, expect } from "vitest";
import { GET, buildLlmsTxt } from "@/app/llms.txt/route";
import { PLAN_PRICES } from "@/lib/plan";

describe("/llms.txt", () => {
  it("serves plain text", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect((await res.text()).startsWith("# SwiftCard")).toBe(true);
  });

  it("reads prices from plan.ts and links the key pages", () => {
    const t = buildLlmsTxt("https://x.test");
    expect(t).toContain(`$${(PLAN_PRICES.PRO_MONTHLY_CENTS / 100).toFixed(2)}`);
    expect(t).toContain(`$${(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS / 100).toFixed(2)}`);
    for (const p of ["/pricing", "/compare", "/faq", "/for/lawyers"]) expect(t).toContain(`https://x.test${p}`);
  });
});
