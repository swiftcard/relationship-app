import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { relatedPages } from "@/lib/blog-related";

// Every blog post links to at least two real /for or /products pages (SEO
// audit, 2026-10-14: the first four posts linked to none), and the pages it
// links to exist — the lists here are the sitemap's own.

const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
const slugs = (name: string) =>
  [...(sitemap.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const ROUTES = new Set([
  "/compare", "/pricing", "/company",
  ...slugs("PRODUCT_SLUGS").map((s) => `/products/${s}`),
  ...slugs("FOR_SLUGS").map((s) => `/for/${s}`),
  ...slugs("COMPARE_SLUGS").map((s) => `/compare/${s}`),
]);

// The posts live on the day of the audit, plus a few shapes the writer agent produces.
const POSTS = [
  { slug: "swiftcard-raises-250000-private-angel-funding", title: "SwiftCard raises $250,000 in private angel funding", keyword: "SwiftCard funding" },
  { slug: "digital-business-card-with-lead-capture", title: "A Digital Business Card With Lead Capture: How It Actually Works", keyword: "digital business card with lead capture" },
  { slug: "fall-trade-show-follow-up-before-leads-go-cold", title: "Fall Trade Show Season Is Here: How to Follow Up Before Your Leads Go Cold", keyword: "trade show lead follow up" },
  { slug: "blinq-vs-swiftcard-vs-hihello", title: "Blinq vs. SwiftCard vs. HiHello: Which Digital Business Card Is Actually Worth It?", keyword: "digital business card comparison" },
  { slug: "best-digital-business-card-for-realtors", title: "The best digital business card for realtors in 2026", keyword: "digital business card for real estate agents" },
  { slug: "hello-world", title: "Hello", keyword: null },
];

describe("blog posts link to the pages they are about", () => {
  it("guards the sitemap reader", () => {
    expect(ROUTES.size).toBeGreaterThan(15);
  });

  it.each(POSTS)("$slug gets two to four real, distinct pages", (post) => {
    const pages = relatedPages(post);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.length).toBeLessThanOrEqual(4);
    expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length);
    for (const p of pages) expect(ROUTES.has(p.href), `${p.href} is a real route`).toBe(true);
    expect(pages.filter((p) => /^\/(for|products)\//.test(p.href)).length, "at least one /for or /products page").toBeGreaterThanOrEqual(1);
  });

  it("a lead-capture post points at Lead Capture first", () => {
    expect(relatedPages(POSTS[1])[0].href).toBe("/products/lead-capture");
  });

  it("a comparison post points at the competitor pages it names", () => {
    const hrefs = relatedPages(POSTS[3]).map((p) => p.href);
    expect(hrefs).toContain("/compare/blinq-alternative");
    expect(hrefs).toContain("/compare/hihello-alternative");
  });

  it("a realtor post points at the real-estate page", () => {
    expect(relatedPages(POSTS[4]).map((p) => p.href)).toContain("/for/real-estate-agents");
  });

  it("the post page renders the related rows", () => {
    const src = readFileSync("src/app/blog/[slug]/page.tsx", "utf8");
    expect(src).toContain("relatedPages(");
    expect(src).toContain("Keep reading");
    expect(src).toMatch(/\.neq\("slug", /);
  });
});
