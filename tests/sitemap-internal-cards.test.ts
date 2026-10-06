import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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

  it("covers the QA scripts' throwaway cards (indexed as dead results, 2026-10-05)", () => {
    // Real ones Google was holding in a site: search after the accounts were
    // deleted: qa-au-55191296, qa-crm-951343, qa-free-m-09708875.
    for (const slug of ["qa-au-55191296", "qa-crm-951343", "qa-free-m-09708875", "qa-flows-1a2b3c", "qa-pro-m-47744724"]) {
      expect(isInternalCardSlug(slug), `${slug} is a QA artifact`).toBe(true);
    }
    // But not a customer whose slug merely contains "qa".
    expect(isInternalCardSlug("qatar-airways")).toBe(false);
    expect(isInternalCardSlug("maria-qa-consulting")).toBe(false);
  });

  it("a missing card answers with a real 404, not a 200 skeleton", () => {
    // src/app/[username]/loading.tsx streamed a 200 shell before the page could
    // call notFound(), so deleted/renamed cards were "soft 404s" that Google kept
    // as live results (site: search, 2026-10-05). The Swift Links page has no
    // loading boundary and 404s correctly — the card page must match it.
    expect(existsSync(join(process.cwd(), "src/app/[username]/loading.tsx"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src/app/links/[username]/loading.tsx"))).toBe(false);
  });

  it("leaves the marketing demos alone", () => {
    // /demo-sales and /demo-realty are linked from the preview page and the
    // marketing components. They are content we chose to publish, and pulling
    // them from the sitemap would be a self-inflicted SEO loss.
    for (const slug of ["demo-sales", "demo-realty", "swiftcard", "swiftcardinc"]) {
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
    const liveFilter = sitemap.slice(sitemap.indexOf("const candidates ="), sitemap.indexOf("const ownerIds"));
    expect(liveFilter).toContain("isUnlistedCardSlug");
  });
});

describe("the founders' personal cards are unlisted (2026-10-05)", () => {
  // The founders' names are off GitHub, Product Hunt and every marketing page;
  // their cards were the last pages on the domain carrying them, and the
  // sitemap was handing them to Google — "swiftcard aaron lavi" found them.
  const FOUNDER_CARDS = [
    "menashharooni-swiftcardinc", "menash-malvecapital", "menashharooni-swiftcard",
    "aaronlavi", "aaronlavi-malvecapital", "aaronlavi-nadlanhomesllc", "aaronlavi-swiftcardinc",
  ];

  it("recognises every founder card live today, case-insensitively", () => {
    for (const slug of FOUNDER_CARDS) {
      expect(isUnlistedCardSlug(slug), slug).toBe(true);
      expect(isUnlistedCardSlug(slug.toUpperCase())).toBe(true);
    }
  });

  it("covers a card a founder adds later without an edit", () => {
    expect(isUnlistedCardSlug("menash-newventure")).toBe(true);
    expect(isUnlistedCardSlug("menashharooni-newventure")).toBe(true);
    expect(isUnlistedCardSlug("aaronlavi-newventure")).toBe(true);
  });

  it("never catches a customer whose name only STARTS like a founder's", () => {
    // A bare prefix match would have noindexed these and dropped them from the
    // sitemap without anyone noticing.
    for (const slug of ["menashe-cohen", "menashecohen-realty", "aaronlavine-realty", "aaronlavin"]) {
      expect(isUnlistedCardSlug(slug), `${slug} must stay indexable`).toBe(false);
    }
  });

  it("still covers the internal test cards", () => {
    expect(isUnlistedCardSlug("apple-review-7c9e9913")).toBe(true);
    expect(isUnlistedCardSlug("iaptest-033f30")).toBe(true);
  });

  it("leaves customers, demos and the company card indexable", () => {
    for (const slug of ["demo-sales", "demo-realty", "swiftcardinc", "levleveducationalfund", "aaron-smith-acme", "demishasmith-remarkitcapital", "", null, undefined]) {
      expect(isUnlistedCardSlug(slug), `${slug} must stay indexable`).toBe(false);
    }
  });

  it("the sitemap lists only cards whose pages actually serve (2026-10-05 dead /links/ URL)", () => {
    // A new account that had not chosen a plan was in the sitemap while its
    // pages 404'd. Every lib/card-active kill-switch rule must be applied to
    // the card list, from the same owner fields the pages read.
    const sitemap = read("src/app/sitemap.ts");
    const section = sitemap.slice(sitemap.indexOf("const candidates ="), sitemap.indexOf("const userPages ="));
    for (const rule of ["awaitingPlanChoice(", "ownerIsDeleted(", "pickFreeLiveCardIds(", "isPaidPlan("]) {
      expect(section, `sitemap applies ${rule}`).toContain(rule);
    }
    // The owner select carries every field those rules read.
    for (const field of ["plan", "customization", "created_at", "office_id", "free_live_card_id"]) {
      expect(section).toMatch(new RegExp(`from\\("profiles"\\)\\.select\\("[^"]*\\b${field}\\b`));
    }
    expect(sitemap).toContain("is_offline !== true");
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
