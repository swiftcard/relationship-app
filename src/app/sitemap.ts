import type { MetadataRoute } from "next";
import { isUnlistedCardSlug } from "@/lib/seeded-views";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// Public marketing/informational pages only — authenticated app routes
// (dashboard, contacts, admin, settings, etc.) are excluded here and blocked
// in robots.ts, since there's nothing for search engines to index there.
// The nine /products/[slug] pages, which are statically generated and linked
// from the main nav and footer. Kept in sync by hand with the PRODUCTS map in
// src/app/products/[slug]/page.tsx (a page file can't safely export it).
// The /for/[slug] vertical landing pages — kept in sync by hand with
// FOR_VERTICALS in src/app/for/[slug]/page.tsx.
const FOR_SLUGS = [
  "real-estate-agents",
  "contractors",
  "insurance-agents",
  "loan-officers",
  "lawyers",
  "photographers",
  "barbers-and-stylists",
  "car-salespeople",
];

// /compare/[slug] competitor-alternative pages — kept in sync by hand with
// COMPETITORS in src/app/compare/[slug]/page.tsx.
const COMPARE_SLUGS = [
  "linktree-alternative",
  "popl-alternative",
  "blinq-alternative",
  "hihello-alternative",
  "mobilo-alternative",
  "linq-alternative",
];

const PRODUCT_SLUGS = [
  "digital-cards",
  "swiftlinks",
  "email-signatures",
  "lead-capture",
  "analytics",
  "teams",
  "wallet",
  "watch",
  "integrations",
];

// Revalidated hourly: the user-page section below reads Supabase, and a new
// card should surface without a deploy — that is the whole growth loop.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // /templates IS public (the earlier note here claimed the opposite — it is not
  // in the src/proxy.ts matcher and anonymous visitors can load it). It's linked
  // from the main nav and footer, so it belongs in the sitemap and is no longer
  // disallowed in robots.ts.
  const routes = [
    "", "/pricing", "/compare", "/contact", "/privacy", "/terms", "/company", "/about", "/press",
    "/business-card-view-tracking", "/link-in-bio-with-analytics",
    "/sms-terms", "/sms-consent", "/login", "/templates", "/testimonials", "/download",
    ...PRODUCT_SLUGS.map((s) => `/products/${s}`),
    ...FOR_SLUGS.map((s) => `/for/${s}`),
    ...COMPARE_SLUGS.map((s) => `/compare/${s}`),
  ];
  const marketing = routes.map((route) => ({
    url: `${APP_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: route === "" ? 1 : 0.6,
  }));

  // ── Public user pages: every live card and its Swift Links page ───────────
  // These pages are public by design (the privacy policy says exactly that),
  // already indexable, and the compounding surface the product's growth loop
  // rides on — a sitemap entry just gets them discovered without waiting for
  // an external link. A card is listed only if its pages actually SERVE: the
  // five lib/card-active kill-switch rules (deleted owner, offline, over the
  // Free limit, no plan chosen yet) are applied here from the same rows the
  // pages read. Until 2026-10-05 only two of them were, so a brand-new
  // account that had not picked a plan was in the sitemap while its /links/
  // page returned 404 — Google indexed the dead URL and the owner found it in
  // a search. DB trouble degrades to the marketing sitemap rather than a 500 —
  // a broken sitemap.xml can get the whole file ignored.
  try {
    const { getAdminSupabase } = await import("@/lib/supabase-admin");
    const { awaitingPlanChoice, ownerIsDeleted, pickFreeLiveCardIds } = await import("@/lib/card-active");
    const { isPaidPlan } = await import("@/lib/plan");
    const admin = getAdminSupabase();
    const { data: cards } = await admin
      .from("cards")
      .select("id, username, user_id, is_offline, created_at")
      .order("created_at", { ascending: true })
      .limit(1000);
    // Excludes our OWN test cards (App Review, IAP), the founders' unlisted
    // personal cards, and offline ones: the first are internal artifacts, not
    // content, and offering them to Google puts junk pages under the domain;
    // the second carry names the company does not publish. See lib/seeded-views.
    const candidates = (cards ?? []).filter(
      (c) => c.is_offline !== true && c.username && !isUnlistedCardSlug(c.username as string),
    );
    const ownerIds = [...new Set(candidates.map((c) => c.user_id))];
    const { data: owners } = ownerIds.length
      ? await admin.from("profiles").select("id, plan, customization, created_at, office_id, free_live_card_id").in("id", ownerIds)
      : { data: [] };
    const ownerById = new Map((owners ?? []).map((o) => [o.id as string, o]));
    // Which of a Free owner's cards serve — the same oldest-first / chosen-card
    // rule the pages apply, computed once per owner from the ordered card list
    // (cards arrive oldest first, so grouping preserves the order).
    const cardIdsByOwner = new Map<string, string[]>();
    for (const c of cards ?? []) {
      const list = cardIdsByOwner.get(c.user_id as string) ?? [];
      list.push(c.id as string);
      cardIdsByOwner.set(c.user_id as string, list);
    }
    const serves = (c: { id: string; user_id: string }) => {
      const owner = ownerById.get(c.user_id);
      // An owner row we cannot see is a card we cannot vouch for.
      if (!owner || ownerIsDeleted(owner.customization)) return false;
      if (awaitingPlanChoice(owner)) return false;
      if (isPaidPlan(owner.plan as string | null)) return true;
      const liveIds = pickFreeLiveCardIds(cardIdsByOwner.get(c.user_id) ?? [], owner.free_live_card_id as string | null);
      return liveIds.includes(c.id);
    };
    const userPages = candidates
      .filter((c) => serves(c as { id: string; user_id: string }))
      .flatMap((c) => {
        const lastModified = c.created_at ? new Date(c.created_at) : new Date();
        return [
          { url: `${APP_URL}/${c.username}`, lastModified, changeFrequency: "weekly" as const, priority: 0.5 },
          { url: `${APP_URL}/links/${c.username}`, lastModified, changeFrequency: "weekly" as const, priority: 0.4 },
        ];
      });
    // Blog posts (agent-published). Separate try: the table may not exist yet.
    let blogPages: MetadataRoute.Sitemap = [];
    try {
      const { data: posts } = await admin
        .from("agent_blog_posts").select("slug, published_at").eq("status", "published").limit(500);
      blogPages = (posts ?? []).map((b) => ({
        url: `${APP_URL}/blog/${b.slug}`,
        lastModified: b.published_at ? new Date(b.published_at) : new Date(),
        changeFrequency: "weekly" as const, priority: 0.55,
      }));
      if (blogPages.length) blogPages.unshift({ url: `${APP_URL}/blog`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.6 });
    } catch { /* pre-schema */ }
    return [...marketing, ...userPages, ...blogPages];
  } catch {
    return marketing;
  }
}
