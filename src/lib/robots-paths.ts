// Which paths crawlers skip (robots.txt) and which carry a noindex header.
// Imported by src/app/robots.ts and next.config.ts, so keep it dependency-free
// and relative-import safe (no "@/" alias: next.config.ts can't resolve it).

// Paths crawlers should not spend time on: every one either redirects a
// signed-out visitor to /login, is an API, or is a short-link redirect. None
// has content to index.
//
// Each is written as an EXACT path segment ("/r$" + "/r/"), never a bare
// prefix. robots.txt rules are prefix matches and card pages live at the root
// (/<username>), so the old bare "Disallow: /r" blocked every card whose slug
// starts with "r" (Search Console flagged /rafalgabrysiak, which is in the
// sitemap), and "/cards", "/office", "/admin", "/join", "/auth" did the same to
// any slug starting with those letters. tests/robots-paths.test.ts checks every
// sitemap route against the generated rules.
//
// Pages a signed-out visitor CAN load but that must not be indexed (the guest
// Card Builder at /cards/new, /join/<token>, /auth/reset-password,
// /account-deleted, app screens like /upgrade) are deliberately NOT here: a
// robots block hides their noindex from Google, which can then index the bare
// URL from any link. They get the X-Robots-Tag header below instead.
export const CRAWL_BLOCKED_PATHS = [
  "/dashboard",
  "/contacts",
  "/admin",
  "/settings",
  "/onboarding",
  "/profile",
  "/office",
  "/welcome",
  "/api",
  "/r",
  "/go",
];

export function disallowRules(paths: readonly string[] = CRAWL_BLOCKED_PATHS): string[] {
  return paths.flatMap((p) => [`${p}$`, `${p}/`]);
}

// Private or one-person pages: sent with "X-Robots-Tag: noindex" on every
// response under them (next.config.ts headers()). Covers the signed-in app
// even where a page renders 200 to a signed-out visitor before its client-side
// gate runs, and every token/one-off page (invites, password reset,
// unsubscribe, checkout).
export const NOINDEX_PATHS = [
  ...CRAWL_BLOCKED_PATHS.filter((p) => p !== "/r" && p !== "/go"),
  "/cards",
  "/join",
  "/auth",
  "/account-deleted",
  "/grow",
  "/share",
  "/upgrade",
  "/checkout",
  "/email",
  "/unsubscribe",
  "/linkedin-connected",
];
