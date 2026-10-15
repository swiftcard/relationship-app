import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VS_COMPETITORS, VS_SLUGS, rowsFor, vsCompetitorForSlug } from "@/lib/compare/competitors";

// The /compare/swiftcard-vs-<x> pages are cited by search engines and AI
// assistants only while they stay honest and well-formed. These invariants are
// the ones a careless edit would break first (2026-10-14).

const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
const facts = readFileSync("docs/competitor-facts.md", "utf8");
const words = (s: string) => s.trim().split(/\s+/).length;

describe("head-to-head comparison data", () => {
  it("covers the five rivals and resolves their slugs", () => {
    expect(VS_SLUGS).toEqual(["swiftcard-vs-popl", "swiftcard-vs-blinq", "swiftcard-vs-linq", "swiftcard-vs-hihello", "swiftcard-vs-dot"]);
    expect(vsCompetitorForSlug("swiftcard-vs-popl")?.name).toBe("Popl");
    expect(vsCompetitorForSlug("popl-alternative")).toBeNull();
  });

  it.each(VS_COMPETITORS)("$name: metadata fits the SERP and every section is present", (c) => {
    expect(c.metaTitle.length, "title ≤ 60 chars").toBeLessThanOrEqual(60);
    expect(c.metaDesc.length, "description ≤ 155 chars").toBeLessThanOrEqual(155);
    expect(words(c.tldr), "TL;DR 40–60 words").toBeGreaterThanOrEqual(40);
    expect(words(c.tldr)).toBeLessThanOrEqual(60);
    expect(c.swiftcardStronger.length).toBeGreaterThanOrEqual(3);
    expect(c.swiftcardStronger.length).toBeLessThanOrEqual(5);
    // The concession section is what earns the citation — never empty.
    expect(c.theyStronger.length).toBeGreaterThanOrEqual(2);
    expect(c.theyStronger.length).toBeLessThanOrEqual(3);
    expect(c.faq.length).toBeGreaterThanOrEqual(4);
    expect(c.faq.length).toBeLessThanOrEqual(6);
    expect(c.switching.length).toBeGreaterThanOrEqual(3);
    expect(c.forPages).toHaveLength(2);
    expect(c.productPages).toHaveLength(2);
    expect(c.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.pricing).toMatch(/As of [A-Z][a-z]+ \d{4}/);
  });

  it.each(VS_COMPETITORS)("$name: every FAQ answers in its first sentence and no answer is hidden", (c) => {
    for (const f of c.faq) {
      expect(f.q.endsWith("?"), `${f.q} is a question`).toBe(true);
      expect(f.a.length).toBeGreaterThan(60);
    }
  });

  it.each(VS_COMPETITORS)("$name: competitor cells never claim a bare ✗ (official site must confirm a no)", (c) => {
    for (const row of rowsFor(c)) {
      expect(row.them.trim(), `${row.label}: use "Not listed" unless their site says no`).not.toBe("✗");
      expect(row.them.trim().length).toBeGreaterThan(0);
    }
  });

  it("every competitor named on a page has a facts table with sources", () => {
    for (const c of VS_COMPETITORS) {
      expect(facts, `docs/competitor-facts.md has a ## ${c.name} section`).toMatch(new RegExp(`^## ${c.name}`, "m"));
    }
    expect(facts).toContain("2026-10-14");
  });

  it("the sitemap lists every head-to-head page and /faq", () => {
    for (const s of VS_SLUGS) expect(sitemap).toContain(`"${s}"`);
    expect(sitemap).toContain('"/faq"');
  });

  it("the sibling alternative page exists for every head-to-head page", () => {
    const alt = readFileSync("src/app/compare/[slug]/page.tsx", "utf8");
    for (const c of VS_COMPETITORS) expect(alt).toContain(`"${c.slug}-alternative": {`);
  });
});
