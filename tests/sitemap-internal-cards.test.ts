import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isInternalCardSlug, isUnlistedCardSlug } from "@/lib/seeded-views";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("our own test cards are not offered to Google", () => {
  it("recognises the App Review and IAP test slugs", () => {
    // Real ones observed live in sitemap.xml.
    for (const slug of ["apple-review-7c9e9913", "apple-review-bd38b805", "iaptest-033f30"]) {
      expect(isInternalCardSlug(slug), `${slug} is ours, not a customer's`).toBe(true);
    }
  });

  it("matches on prefix, because each submission mints a new suffix", () => {
    expect(isInternalCardSlug("apple-review-anything-at-all")).toBe(true);
    expect(isInternalCardSlug("APPLE-REVIEW-UPPERCASE")).toBe(true);
  });

  it("leaves the marketing demos alone", () => {
    // /demo-sales and /demo-realty are linked from the preview page and the
    // marketing components. They are content we chose to publish, and pulling
    // them from the sitemap would be a self-inflicted SEO loss.
    for (const slug of ["demo-sales", "demo-realty", "swiftcard", "aaronlavi-malvecapital"]) {
      expect(isInternalCardSlug(slug), `${slug} must stay indexable`).toBe(false);
    }
  });

  it("never treats a real customer slug as internal", () => {
    for (const slug of ["johnsmith-acme", "applecare-repairs", "iaptechnologies", "", null, undefined]) {
      expect(isInternalCardSlug(slug)).toBe(false);
    }
  });

  it("the sitemap actually applies the filter", () => {
    const sitemap = read("src/app/sitemap.ts");
    expect(sitemap).toContain("isUnlistedCardSlug");
    // Applied to the card list, not somewhere decorative.
    const liveFilter = sitemap.slice(sitemap.indexOf("const live ="), sitemap.indexOf("const ownerIds"));
    expect(liveFilter).toContain("isUnlistedCardSlug");
  });
});

describe("the owner's personal cards are unlisted (2026-10-05)", () => {
  // The founder's name is off GitHub, Product Hunt and every marketing page;
  // these two cards were the last pages on the domain carrying it, and the
  // sitemap was handing them to Google.
  const OWNER_CARDS = ["menashharooni-swiftcardinc", "menash-malvecapital"];

  it("recognises both cards, case-insensitively", () => {
    for (const slug of OWNER_CARDS) {
      expect(isUnlistedCardSlug(slug)).toBe(true);
      expect(isUnlistedCardSlug(slug.toUpperCase())).toBe(true);
    }
  });

  it("still covers the internal test cards", () => {
    expect(isUnlistedCardSlug("apple-review-7c9e9913")).toBe(true);
    expect(isUnlistedCardSlug("iaptest-033f30")).toBe(true);
  });

  it("is an exact match — a customer who shares the first name stays indexable", () => {
    for (const slug of ["menash", "menash-acme", "demo-sales", "aaronlavi-swiftcardinc", "", null, undefined]) {
      expect(isUnlistedCardSlug(slug), `${slug} must stay indexable`).toBe(false);
    }
  });

  it("the card page and the Swift Links page both serve noindex for them", () => {
    for (const page of ["src/app/[username]/page.tsx", "src/app/links/[username]/page.tsx"]) {
      const src = read(page);
      const meta = src.slice(src.indexOf("export async function generateMetadata"), src.indexOf("export default async function"));
      expect(meta, `${page} generateMetadata gates robots on the unlisted set`).toContain("isUnlistedCardSlug(username)");
      expect(meta).toContain("index: false");
    }
  });
});
