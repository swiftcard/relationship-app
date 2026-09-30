import type { MetadataRoute } from "next";
import { isInternalCardSlug } from "@/lib/seeded-views";

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
    "/sms-terms", "/sms-consent", "/login", "/templates", "/testimonials",
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
  // an external link. Excluded: offline cards (their pages 404) and cards
  // whose owner soft-deleted their account. DB trouble degrades to the
  // marketing sitemap rather than a 500 — a broken sitemap.xml can get the
  // whole file ignored.
  try {
    const { getAdminSupabase } = await import("@/lib/supabase-admin");
    const admin = getAdminSupabase();
    const { data: cards } = await admin
      .from("cards")
      .select("username, user_id, is_offline, created_at")
      .order("created_at", { ascending: true })
      .limit(1000);
    // Excludes our OWN test cards (App Review, IAP) as well as offline ones:
    // they are internal artifacts, not content, and offering them to Google
    // puts junk pages under the domain. See lib/seeded-views.
    const live = (cards ?? []).filter(
      (c) => c.is_offline !== true && c.username && !isInternalCardSlug(c.username as string),
    );
    const ownerIds = [...new Set(live.map((c) => c.user_id))];
    const { data: owners } = ownerIds.length
      ? await admin.from("profiles").select("id, customization").in("id", ownerIds)
      : { data: [] };
    const deleted = new Set(
      (owners ?? [])
        .filter((o) => (o.customization as { _deleted?: boolean } | null)?._deleted === true)
        .map((o) => o.id),
    );
    const userPages = live
      .filter((c) => !deleted.has(c.user_id))
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
