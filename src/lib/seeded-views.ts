// ── Seeded demo views are not real traffic ───────────────────────────────────
//
// scripts/create-apple-review-account.js populates the App Review account with
// a month of synthetic card views so a reviewer opening the dashboard sees a
// working product instead of an empty state. That is deliberate and must stay.
//
// But those rows live in the SAME card_views table as real traffic, and the
// site-wide admin metrics counted them: 24 of 81 rows, so roughly 30% of the
// total view count was invented. Customer dashboards were never affected —
// each filters by its own card slug — but the numbers WE read to judge whether
// the product is working were inflated by a third.
//
// Identified by the visitor id the seeder writes ("demo-visitor-0" … "-8")
// rather than by the account slug: the marker travels with the rows, so it
// still holds if the review account is renamed or a second demo account is
// seeded later.
export const SEEDED_VISITOR_PREFIX = "demo-visitor";

/** True for a synthetic view planted for the App Review demo account. */
export function isSeededView(visitorId: string | null | undefined): boolean {
  return (visitorId ?? "").startsWith(SEEDED_VISITOR_PREFIX);
}

// ── Cards that exist for US, not for customers ──────────────────────────────
//
// The App Review account (created per submission, so there is a new one each
// time) and the In-App Purchase test cards are internal artifacts. They were
// being published in sitemap.xml alongside real customer cards and are
// therefore offered to Google for indexing — three of the thirteen live cards
// were these. That is junk content under our own domain at exactly the moment
// ranking is the problem the product has.
//
// NOT the demo cards: /demo-sales and /demo-realty are deliberate marketing
// showcases, linked from the preview page and the marketing components, and
// they should stay indexable. The distinction is "internal artifact" versus
// "content we chose to publish".
const INTERNAL_CARD_PREFIXES = ["apple-review-", "iaptest-"];

/**
 * True for a card slug that belongs to our own testing rather than to a
 * customer. Matched on the slug PREFIX because each submission mints a fresh
 * suffix (apple-review-7c9e9913, apple-review-bd38b805, …), so a list of exact
 * names would silently stop covering the next one.
 */
export function isInternalCardSlug(username: string | null | undefined): boolean {
  const slug = (username ?? "").toLowerCase();
  return INTERNAL_CARD_PREFIXES.some((p) => slug.startsWith(p));
}

// ── Cards kept out of search on purpose ─────────────────────────────────────
//
// The two founders' personal cards. They still work when handed to someone
// (the link, the QR, the NFC tap all open them), but the company presents
// itself as SwiftCard, not as people: the founders' names are off GitHub, off
// Product Hunt and off the marketing pages, and their cards were the only
// pages on the domain still carrying them — offered to Google via sitemap.xml
// and a schema.org Person node, so "swiftcard aaron lavi" found them (owner,
// 2026-10-05). Matched on the first-name / full-name prefix each founder
// actually uses for slugs (menashharooni-…, menash-…, aaronlavi, aaronlavi-…),
// so a card they add later is covered without an edit here.
const UNLISTED_CARD_PREFIXES = ["menash", "aaronlavi"];

/**
 * True for a card that must not be offered to search engines: left out of
 * sitemap.xml and served with a noindex robots tag (card page and Swift
 * Links page alike). Covers both the internal test cards and the founders'
 * unlisted personal cards.
 */
export function isUnlistedCardSlug(username: string | null | undefined): boolean {
  const slug = (username ?? "").toLowerCase();
  return isInternalCardSlug(slug) || UNLISTED_CARD_PREFIXES.some((p) => slug.startsWith(p));
}
