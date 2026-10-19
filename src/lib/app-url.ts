/**
 * This deployment's own address, for every absolute URL the SERVER builds:
 * payment return pages, OAuth callbacks, links in CRM payloads.
 *
 * NEXT_PUBLIC_APP_URL is set for Production only (checked in Vercel
 * 2026-10-18). The 85 copies of `NEXT_PUBLIC_APP_URL || "https://swiftcard.me"`
 * therefore made every PREVIEW deployment call itself production: a checkout
 * started on a preview returned to swiftcard.me, and an OAuth connect
 * completed against production's callback (audit E-02). A preview now uses
 * its own Vercel address, local development uses localhost, and production
 * is the fallback only where it is production.
 */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_ENV === "preview") {
    const host = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
    if (host) return `https://${host}`;
  }
  if (process.env.NODE_ENV === "development") return `http://localhost:${process.env.PORT || 3000}`;
  return "https://swiftcard.me";
}
