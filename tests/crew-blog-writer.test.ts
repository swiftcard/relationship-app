import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderBlogMarkdown } from "@/lib/blog-md";
import { BATCH_KEY, BLOG_IMAGES, BLOG_WRITER, LOG_KEY, RESEARCH_KEY, WRITING_STALE_MS, batchState, blogProblems, cleanBlogMarkdown, finish, generateBatch, publishChoice, withCover, type BlogBatch, type BlogLogEntry, type MarketResearch } from "@/lib/crew/blog/writer";
import { COMPETITORS, INTERNAL_LINKS, marketBrief } from "@/lib/crew/blog/market";
import { TOPIC_PLAN, nextTopics } from "@/lib/crew/blog/topics";
import { FakeClaude } from "@/lib/crew/llm/fake";
import type { LlmRequest } from "@/lib/crew/llm/types";
import { AGENTS } from "@/lib/crew/registry";
import { MemoryStore } from "@/lib/crew/store-memory";

// ── The Blog Writer (owner, 2026-10-29) ─────────────────────────────────────
// "I click Generate ... It'll generate me two posts and show me those exact
// two blog posts and I will click the one that I want. When I click one, it
// posts it on our blog ... keep a log ... so it doesn't repeat ... It doesn't
// work on its own." Plus: rank on Google, sell SwiftCard, sound human, no
// hyphens, pictures, and know the competitors and the market.

const read = (p: string) => readFileSync(p, "utf8");

/** A post that passes every check: long enough, FAQ, the invite, our pictures and pages only. */
function goodPost(keyword: string) {
  const para = `Most ${keyword} advice stops at the card itself. The part that matters is what happens after someone has your details, and whether you ever hear from them again. We built SwiftCard so the person you meet can save you in one tap and send you their details back.`;
  const body = [
    `${para} ${para}`,
    `## Why ${keyword} matters more than the card`,
    ...Array.from({ length: 16 }, () => para),
    "![A SwiftCard digital business card open on a phone](/press/01-public-card.jpg)",
    "Want to see it on your own phone? [Create a free card](/cards/new?src=blog) in a couple of minutes.",
    "| | Paper | SwiftCard |",
    "| --- | --- | --- |",
    "| Updates | Reprint | Instant |",
    "## Frequently asked questions",
    "### Is it free?",
    "Yes, you can start free. See [pricing](/pricing).",
    "Ready? [Create your free card](/cards/new?src=blog).",
  ].join("\n\n");
  return { title: `The ${keyword} guide nobody wrote`, slug: keyword.replace(/\s+/g, "-"), description: "A real look at what makes this work after the handshake, and why the people who follow up fast are the ones who win the deal in the end.", og_title: "x", content_md: body };
}

describe("it never works on its own", () => {
  it("isn't in the agents' clock, so only Generate starts it", () => {
    expect(AGENTS.some((a) => a.id === BLOG_WRITER.id)).toBe(false);
    expect(BLOG_WRITER.schedule.kind).toBe("on_input");
  });

  it("Generate answers at once and writes after the response; every button is a form post", () => {
    const route = read("src/app/api/admin/crew/blog/route.ts");
    expect(route).toContain("after(() => generateBatch(");
    expect(route).toContain("if (!(await requireAdmin()))");
    const view = read("src/app/admin/crew/blog/BlogWriterView.tsx");
    for (const f of view.match(/<form [^>]*>/g) ?? []) expect(f).toContain('method="post" action={FORM}');
    expect(read("src/app/admin/crew/Home.tsx")).toContain('href="/admin/crew/blog"');
  });
});

describe("it knows the market", () => {
  it("the brief names every competitor our compare pages cover, honestly, with no prices", () => {
    const brief = marketBrief();
    for (const name of ["Linktree", "Popl", "Blinq", "HiHello", "Mobilo", "Linq", "Dot", "Paper business cards"]) expect(brief, name).toContain(name);
    expect(brief).not.toMatch(/\$\d/);
    expect(brief).toMatch(/Never state a competitor's price/);
    for (const c of COMPETITORS.filter((x) => x.compare)) expect(INTERNAL_LINKS.map((l) => l.href)).toContain(c.compare);
  });
});

describe("no hyphens, done in code", () => {
  it("dashes and hyphenated words go; links, pictures, bullets, table rules and slugs keep theirs", () => {
    const md = "## A follow-up plan — that works\n\n- Tap-to-call up top\n\n| a | b |\n| --- | --- |\n\nSee [the guide](/blog/trade-show-follow-up) and ![x](/press/01-public-card.jpg).";
    expect(cleanBlogMarkdown(md)).toBe("## A follow up plan, that works\n\n- Tap to call up top\n\n| a | b |\n| --- | --- |\n\nSee [the guide](/blog/trade-show-follow-up) and ![x](/press/01-public-card.jpg).");
  });
});

describe("what makes a post ready", () => {
  it("a good post has no problems", () => {
    expect(blogProblems({ ...goodPost("qr code business card"), keyword: "qr code business card" })).toEqual([]);
  });

  it("names what's wrong: AI phrases, hyphens, a picture or a page we don't have, too short, no FAQ", () => {
    const bad = { title: "A game-changer", slug: "Bad Slug", description: "short", keyword: "nfc business card", content_md: "# Title\n\nIt's not just a card but a seamless page. ![x](https://evil.example/x.png) [here](/nowhere)" };
    const p = blogProblems(bad).join(" | ");
    for (const s of ['uses "seamless"', "hyphenated word", 'not just X but Y', "single # heading", "words", "slug", "description", "FAQ", "free card", "picture we don't have", "page that may not exist"]) expect(p, s).toContain(s);
  });

  it("a finished draft is cleaned, opens with its cover, and never reuses a slug", () => {
    const d = finish(goodPost("qr code business card"), TOPIC_PLAN[4], [{ slug: "qr-code-business-card" }]);
    expect(d.slug).toMatch(/^qr-code-business-card-[a-z0-9]{4}$/);
    expect(d.content_md.startsWith(`![The qr code business card guide nobody wrote](/blog/${d.slug}/cover)\n\n`)).toBe(true);
    expect(withCover(d.content_md, d.slug, d.title).match(/\/cover\)/g)).toHaveLength(1);
  });
});

describe("it never writes the same topic twice", () => {
  it("skips what the blog already has, by keyword, slug or title", () => {
    const used = { keywords: ["best digital business card app"], slugs: ["linktree-alternative-for-pros"], titles: ["The digital business card for real estate agents playbook"] };
    expect(nextTopics(used, 2).map((t) => t.keyword)).toEqual(["free digital business card", "qr code business card"]);
  });

  it("a Generate cut off mid way reads as failed, so the button is never stuck", () => {
    const b: BlogBatch = { id: "b", status: "writing", started_at: new Date(Date.now() - WRITING_STALE_MS - 1000).toISOString(), finished_at: null, step: "Writing both posts", drafts: [], error: null, published: null };
    expect(batchState(b)?.status).toBe("failed");
    expect(batchState({ ...b, started_at: new Date().toISOString() })?.status).toBe("writing");
  });
});

/** A fake model that answers each step by what it was asked for. */
function script(req: LlmRequest): string {
  const props = JSON.stringify(req.schema ?? {});
  if (props.includes('"notes"')) return JSON.stringify({ notes: "- Popl lists Pro at $X (popl.co/pricing, October 2026)", sources: [{ title: "Popl pricing", url: "https://popl.co/pricing" }] });
  if (props.includes('"gap"')) return JSON.stringify({ results: [{ title: "Top result", url: "https://example.com", covers: "basics" }], questions: ["Is it free?"], gap: "Nobody covers the follow up." });
  if (props.includes('"content_md"')) {
    const keyword = /The post for the search "([^"]+)"/.exec(req.prompt)?.[1] ?? /search "([^"]+)"/.exec(req.prompt)?.[1] ?? "topic";
    return JSON.stringify(goodPost(keyword));
  }
  return "{}";
}

describe("Generate → two posts → publish one", () => {
  it("writes two finished posts, even while Pause all is on and the agents' money is spent", async () => {
    const store = new MemoryStore();
    await store.updateSettings({ kill_all: true, daily_usd_cap: 0 });
    const claude = new FakeClaude(script);
    const batchId = "batch-1";
    await store.kvSet(BATCH_KEY, { id: batchId, status: "writing", started_at: new Date().toISOString(), finished_at: null, step: "", drafts: [], error: null, published: null });
    const b = await generateBatch(store, { claude, critic: null }, { batchId, posts: [{ slug: "blinq-vs-swiftcard-vs-hihello", title: "Blinq vs. SwiftCard vs. HiHello", keyword: "digital business card comparison" }] });
    expect(b.error).toBeNull();
    expect(b.status).toBe("ready");
    expect(b.drafts).toHaveLength(2);
    expect(b.drafts.map((d) => d.keyword)).toEqual([TOPIC_PLAN[0].keyword, TOPIC_PLAN[1].keyword]);
    for (const d of b.drafts) {
      expect(d.content_md).toContain(`/blog/${d.slug}/cover`);
      expect(d.problems).toEqual([]);
    }
    // The market research is kept for the next two weeks, and the writer saw it.
    expect((await store.kvGet<MarketResearch>(RESEARCH_KEY))?.sources).toHaveLength(1);
    expect(claude.calls.some((c) => c.system.includes("popl.co/pricing"))).toBe(true);
    expect(claude.calls.some((c) => c.model === "claude-opus-5-5")).toBe(true);
  });

  it("the pick goes live, the log remembers it, and it can't be published twice", async () => {
    const store = new MemoryStore();
    const d0 = finish(goodPost("free digital business card"), TOPIC_PLAN[3], []);
    const d1 = finish(goodPost("qr code business card"), TOPIC_PLAN[4], []);
    await store.kvSet(BATCH_KEY, { id: "b1", status: "ready", started_at: new Date().toISOString(), finished_at: new Date().toISOString(), step: "", drafts: [d0, d1], error: null, published: null });
    const inserted: Record<string, unknown>[] = [];
    const insert = async (row: Record<string, unknown>) => (inserted.push(row), { error: null });
    expect(await publishChoice(store, insert, { batchId: "old", index: 1 })).toMatchObject({ ok: false });
    const r = await publishChoice(store, insert, { batchId: "b1", index: 1 });
    expect(r).toMatchObject({ ok: true, slug: d1.slug });
    expect(inserted).toEqual([expect.objectContaining({ slug: d1.slug, title: d1.title, keyword: "qr code business card", status: "published", content_md: d1.content_md })]);
    expect((await store.kvGet<BlogLogEntry[]>(LOG_KEY))?.[0]).toMatchObject({ slug: d1.slug, keyword: "qr code business card" });
    expect((await publishChoice(store, insert, { batchId: "b1", index: 0 })).ok).toBe(false);
    expect(inserted).toHaveLength(1);
  });

  it("a slug already on the blog is refused in plain words", async () => {
    const store = new MemoryStore();
    const d = finish(goodPost("nfc business card"), TOPIC_PLAN[5], []);
    await store.kvSet(BATCH_KEY, { id: "b2", status: "ready", started_at: new Date().toISOString(), finished_at: null, step: "", drafts: [d, d], error: null, published: null });
    const r = await publishChoice(store, async () => ({ error: { code: "23505", message: "dup" } }), { batchId: "b2", index: 0 });
    expect(r).toEqual({ ok: false, message: "A post with that address already exists." });
  });
});

describe("pictures on the blog", () => {
  it("our own pictures and a post's cover render; anything else never becomes an image", () => {
    const html = renderBlogMarkdown(`![A card on a phone](${BLOG_IMAGES[0].src})\n\n![Cover](/blog/qr-code-business-card/cover)\n\n![x](https://evil.example/x.png)\n\n![y](/press/../secret.jpg)`);
    expect(html).toContain(`<img src="${BLOG_IMAGES[0].src}" alt="A card on a phone"`);
    expect(html).toContain('<img src="/blog/qr-code-business-card/cover" alt="Cover"');
    expect(html.match(/<img /g)).toHaveLength(2);
  });

  it("a table broken up by blank lines (a model can write one) renders instead of crashing the post", () => {
    expect(() => renderBlogMarkdown(["| a | b |", "| --- | --- |", "| 1 | 2 |"].join(String.fromCharCode(10, 10)))).not.toThrow();
    expect(renderBlogMarkdown("| --- | --- |")).toBe("");
  });

  it("the cover is drawn only for a published post, or for an admin looking at a draft", () => {
    const route = read("src/app/blog/[slug]/cover/route.tsx");
    expect(route).toContain('.eq("status", "published")');
    expect(route.indexOf("requireAdmin()")).toBeLessThan(route.indexOf("BATCH_KEY).catch"));
  });
});
