// Pure card-slug normalizer — the single source of truth for turning any text
// (a name, a name+company, a hand-typed URL) into a valid card slug. No server
// imports, so it's safe in client components (the new-card wizard's live URL
// preview, the card-URL editor) AND server code (the cards API), guaranteeing
// the URL a user is shown while creating/editing a card is exactly the one that
// gets saved.
//
// Charset: [a-z0-9-], no leading/trailing hyphen, no runs, capped at 60.
export function normalizeSlug(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-") // spaces / punctuation → hyphen
    .replace(/-+/g, "-")          // collapse runs
    .replace(/^-+|-+$/g, "")      // trim hyphens
    .slice(0, 60)
    .replace(/-+$/g, "");         // no trailing hyphen after the slice
}

// ── Reserved slugs ───────────────────────────────────────────────────────────
//
// Card pages live at the ROOT (swiftcard.me/<slug>) since 2026-08-19, so a
// slug that matches an app route would produce a card page the router can
// never reach (static routes always win over the dynamic segment). Reserved
// names are treated as taken during slug generation and custom-URL changes.
// The list holds every current top-level route plus names likely to become
// one — reserving generously is free, un-reserving a shipped username is not.
export const RESERVED_SLUGS = new Set([
  // current app routes
  "account-deleted", "admin", "api", "auth", "card", "cards", "checkout",
  "company", "compare", "contact", "for", "contacts", "dashboard", "go", "grow", "join",
  "links", "login", "office", "onboarding", "preview", "pricing", "privacy",
  "products", "profile", "r", "settings", "share", "sms-consent", "sms-terms",
  "templates", "terms", "testimonials", "unsubscribe", "upgrade", "welcome",
  // platform/static paths
  "favicon", "robots", "sitemap", "manifest", "icon", "apple-icon",
  "opengraph-image", "_next", "well-known",
  // likely future routes
  "about", "app", "blog", "docs", "help", "home", "index", "jobs", "legal",
  "logout", "new", "news", "partners", "press", "signin", "signup", "signout",
  "static", "status", "support", "team",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(normalizeSlug(slug));
}

// ── The card slug, owner format 2026-08-26 ──────────────────────────────────
//
// "Aaron Lavi" + "Malve Capital" → pretty "AaronLavi-MalveCapital", canonical
// "aaronlavi-malvecapital": the words of each part FUSE (no hyphen inside the
// name or inside the company); the single hyphen separates name from company.
// The canonical (lowercase) form is what's stored and routed — the public
// card/links routes lowercase the incoming path, so the pretty capitalization
// can be shared and typed freely and still resolves.

/** One part (a name, a company) with its words fused CamelCase: "Malve Capital" → "MalveCapital". */
function fuseWords(part: string): string {
  return String(part ?? "")
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** Display form: "AaronLavi-MalveCapital" (or just "AaronLavi" without a company). */
export function prettyCardSlug(name: string, company?: string | null): string {
  const n = fuseWords(name);
  const c = fuseWords(company ?? "");
  return c ? `${n}-${c}` : n;
}

/** Stored/routed form: the pretty slug lowercased through the normalizer. */
export function cardSlug(name: string, company?: string | null): string {
  return normalizeSlug(prettyCardSlug(name, company));
}
