import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BLOG_TOPICS, marketingUrls, mentionRate, nextBlogTopic, seoProblems } from "@/lib/crew/agents/marketing";
import { cleanOptions, finalBody, socialManager, type SocialSpec } from "@/lib/crew/agents/social";
import { decide } from "@/lib/crew/decide";
import { LAUNCH_CAPTIONS, SIZES, SOCIAL_PLATFORMS } from "@/lib/crew/marketing/social-style";
import { AGENTS } from "@/lib/crew/registry";
import { setup } from "./crew-helpers";

// Phase 6, Marketing: SEO problems found by code, a blog topic queue, the GEO
// mention rate, and the social manager's two-step flow (pick an option, then
// get the finished set). Nothing publishes on its own.

afterEach(() => vi.unstubAllEnvs());

describe("SEO", () => {
  it("finds the usual search problems in a page", () => {
    const html = `<html><head><title>Hi</title></head><body><h1>A</h1><h1>B</h1><img src="x.png"></body></html>`;
    expect(seoProblems("https://swiftcard.me/compare/x", html)).toEqual([
      "title is only 2 characters",
      "no meta description",
      "2 <h1> headings (use one)",
      "no canonical link",
      "no structured data (JSON-LD)",
      "1 images without alt text",
    ]);
    const good = `<title>Digital business cards for realtors | SwiftCard</title><meta name="description" content="${"Make a digital business card with a link-in-bio page, lead capture and Apple Wallet. ".repeat(1)}Free to start."><link rel="canonical" href="x"><h1>x</h1>`;
    expect(seoProblems("https://swiftcard.me/", good)).toEqual([]);
  });
  it("checks our marketing pages, never customers' card pages", () => {
    const xml = ["https://swiftcard.me", "https://swiftcard.me/pricing", "https://swiftcard.me/compare/popl-alternative", "https://swiftcard.me/janedoe-acmerealty", "https://evil.example.com/x"].map((u) => `<loc>${u}</loc>`).join("");
    expect(marketingUrls(xml)).toEqual(["https://swiftcard.me", "https://swiftcard.me/pricing", "https://swiftcard.me/compare/popl-alternative"]);
  });
});

describe("blog and GEO", () => {
  it("never repeats a topic that already has a post", () => {
    expect(nextBlogTopic([])?.keyword).toBe(BLOG_TOPICS[0].keyword);
    expect(nextBlogTopic(["hihello alternative"])?.keyword).toBe(BLOG_TOPICS[1].keyword);
    expect(nextBlogTopic(BLOG_TOPICS.map((t) => t.keyword))).toBeNull();
  });
  it("mention rate", () => {
    expect(mentionRate([{ mentioned: true }, { mentioned: false }, { mentioned: false }, { mentioned: true }])).toBe(50);
  });
});

describe("social manager", () => {
  it("keeps the model's slides inside the launch posts' style", () => {
    const [o] = cleanOptions([{ name: "x", format: "image", slides: [{ headline: "One card for everything you are today", accent: "nope", sub: "a — b", visual: "phone" as never }] }]);
    expect(o.slides[0].headline.split(" ").length).toBeLessThanOrEqual(5);
    expect(o.slides[0].accent).toBe("you"); // falls back to the last word
    expect(o.slides[0].sub).not.toContain("—");
    expect(o.slides[0].visual).toBe("card");
  });

  it("without the render workflow: idea → pick (step 1) → finished set with a caption per platform (step 2)", async () => {
    vi.stubEnv("CREW_GITHUB_TOKEN", "");
    const idea = { idea: "Update once, every card changes", options: [1, 2, 3].map((n) => ({ name: `Option ${n}`, format: "image", slides: [{ headline: "Never Reprint", accent: "Reprint", sub: "Change it once.", visual: "card" }] })) };
    const captions = Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, `${p} caption`]));
    const { ctx, store } = await setup({ def: socialManager, script: (req) => (String(JSON.stringify(req.schema)).includes("options") ? JSON.stringify(idea) : JSON.stringify(captions)) });

    expect((await socialManager.run(ctx)).summary).toMatch(/Proposed 3 options/);
    const step1 = store.approvals[0];
    expect(step1.meta.step).toBe(1);
    expect((step1.meta.options as unknown[]).length).toBe(3);
    expect(step1.body).not.toContain("(I work on SwiftCard"); // our own account: no disclosure line
    expect((await socialManager.run(ctx)).summary).toBe("Nothing to do this hour.");

    await decide(store, step1.id, { action: "approve", choice: "2", by: "owner" });
    const r2 = await socialManager.run(ctx);
    expect(r2.summary).toMatch(/Option 2 chosen/);
    expect((await store.getApproval(step1.id))!.status).toBe("done");
    expect((await socialManager.run(ctx)).summary).toMatch(/ready to publish/);
    const step2 = store.approvals.find((a) => a.meta.step === 2)!;
    for (const p of SOCIAL_PLATFORMS) expect(step2.body).toContain(`${p} caption`);
    expect(step2.body).toContain("render workflow isn't set up");
    // One idea a day: nothing new until tomorrow.
    expect((await socialManager.run(ctx)).summary).toBe("Nothing to do this hour.");
  });

  it("the finished set lists each platform's pictures at its size", () => {
    const spec: SocialSpec = { id: "2026-10-20-abcde", day: "2026-10-20", idea: "x", stage: "done", requested_at: "", choice: 1, sizes: SIZES, captions: { pinterest: "Pin title" }, options: [{ name: "A", format: "image", slides: [{ headline: "A B", accent: "B", sub: "s", visual: "card" }] }] };
    const body = finalBody(spec, { at: "", files: [{ key: "pin-1", url: "https://x/pin-1.png" }, { key: "portrait-1", url: "https://x/portrait-1.png" }] });
    expect(body).toMatch(/=== PINTEREST \(1000x1500\) ===\nSlide 1: https:\/\/x\/pin-1\.png\nPin title/);
    expect(body).toMatch(/=== INSTAGRAM \(1080x1350\) ===\nSlide 1: https:\/\/x\/portrait-1\.png/);
  });

  it("learns from the launch posts: their captions are quoted in the style", () => {
    const captions = readFileSync("marketing/instagram/launch/captions.md", "utf8");
    for (const c of LAUNCH_CAPTIONS) expect(captions).toContain(c);
  });

  it("the render workflow draws and stores pictures but can't publish or run spec text in a shell", () => {
    const wf = readFileSync(".github/workflows/crew-render.yml", "utf8");
    expect(wf).toContain("scripts/crew-render-social.mjs");
    expect(wf).not.toMatch(/run: [^\n]*\$\{\{ inputs\./);
    expect(wf).toContain("persist-credentials: false");
    expect(wf).not.toMatch(/instagram|graph\.facebook|linkedin\.com\/v2|api\.pinterest/i);
  });
});

describe("registry", () => {
  it("every Marketing agent from the spec, with a manager", () => {
    for (const id of ["marketing-seo", "marketing-geo", "marketing-blog", "marketing-social", "competitor-watch", "marketing-manager"]) expect(AGENTS.some((a) => a.id === id), id).toBe(true);
  });
  it("covers every agent in the plan's table", () => {
    const n = AGENTS.filter((a) => a.role === "worker").length;
    expect(n).toBeGreaterThanOrEqual(35);
  });
});
