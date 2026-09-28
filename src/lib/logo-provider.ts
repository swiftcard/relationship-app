import { safeFetch } from "@/lib/safe-fetch";

// ── Company logo / branding suggestion ───────────────────────────────────────
// Given a company NAME, business EMAIL, or DOMAIN, suggest the official logo +
// canonical name + domain so a user can pick the right one for their card. We
// never auto-apply and never scrape Google / image search / company sites — the
// ONLY data source is a branding provider's own API (default: Logo.dev's Brand
// Search API). The provider is behind an interface so it can be swapped later
// without touching the route or the UI.
//
// FAIL SAFE: when no provider credential is configured, isConfigured() is false
// and the whole feature is hidden upstream — no errors, no half-working button.

// A single candidate the user can confirm. `logoUrl` is a ready-to-render image
// URL returned by the provider (it embeds the provider's own publishable token).
export type LogoCandidate = {
  name: string;
  domain: string;
  logoUrl: string;
};

// Every outcome the UI must distinguish. Keeping these explicit (rather than
// throwing) means the route can map each to a clean, non-alarming response.
export type LogoSuggestStatus =
  | "ok"              // one or more candidates to choose from
  | "no_match"        // provider reached, nothing matched
  | "personal_domain" // gmail/outlook/etc — skip, there's no company to suggest
  | "invalid_input"   // empty / not a usable name or domain
  | "not_configured"  // no provider credential — feature is disabled
  | "rate_limited"    // provider throttled us
  | "provider_error"; // provider outage / unexpected response

export type LogoSuggestResult = {
  status: LogoSuggestStatus;
  candidates: LogoCandidate[];
};

export interface LogoProvider {
  /** Stable id for logging / future multi-provider routing. */
  readonly id: string;
  /** True only when the credential this provider needs is present. */
  isConfigured(): boolean;
  /** Resolve a raw user input to candidate companies. Never throws. */
  suggest(input: string): Promise<LogoSuggestResult>;
}

// ── Pure helpers (unit-tested; no network) ───────────────────────────────────

// Free / personal mailbox providers — a business card's "company" can't be
// inferred from these, so we skip the suggestion entirely rather than offer a
// nonsense match (e.g. suggesting "Google" for a gmail.com address).
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com", "hotmail.co.uk",
  "yahoo.com", "yahoo.co.uk", "ymail.com", "rocketmail.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "aim.com",
  "proton.me", "protonmail.com", "pm.me",
  "gmx.com", "gmx.net", "gmx.de",
  "mail.com", "email.com",
  "zoho.com",
  "yandex.com", "yandex.ru",
  "fastmail.com", "hey.com", "duck.com",
  "qq.com", "163.com", "126.com", "naver.com",
]);

export function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(domain.trim().toLowerCase().replace(/\.$/, ""));
}

/** Extract the domain from an email, or null if the string isn't email-shaped. */
export function extractEmailDomain(input: string): string | null {
  const m = input.trim().toLowerCase().match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/);
  return m ? m[1].replace(/\.$/, "") : null;
}

// A permissive but real hostname check: labels of a-z0-9/hyphen, at least one
// dot, a 2+ char TLD. Rejects spaces, schemes, paths, and bare words. Not meant
// to validate registrability — just to decide "is this a domain or a name?".
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function isValidDomain(input: string): boolean {
  return DOMAIN_RE.test(input.trim().toLowerCase().replace(/\.$/, ""));
}

// Decide how to treat a raw input and produce the query string to search on.
//   - email → its domain (unless personal, which short-circuits upstream)
//   - domain → the domain
//   - anything else non-empty → treated as a company name
export type NormalizedQuery =
  | { kind: "personal" }
  | { kind: "invalid" }
  | { kind: "query"; query: string };

export function normalizeLogoInput(raw: string): NormalizedQuery {
  const input = (raw ?? "").trim();
  if (!input || input.length > 200) return { kind: "invalid" };

  const emailDomain = extractEmailDomain(input);
  if (emailDomain) {
    if (isPersonalEmailDomain(emailDomain)) return { kind: "personal" };
    return { kind: "query", query: emailDomain };
  }

  // A bare "@something" or a string with an @ that isn't a valid email is junk.
  if (input.includes("@")) return { kind: "invalid" };

  const lower = input.toLowerCase().replace(/\.$/, "");
  if (isValidDomain(lower)) {
    if (isPersonalEmailDomain(lower)) return { kind: "personal" };
    return { kind: "query", query: lower };
  }

  // Otherwise it's a company name — needs at least one letter/digit.
  if (!/[a-z0-9]/i.test(input)) return { kind: "invalid" };
  return { kind: "query", query: input };
}

// ── Logo.dev adapter ─────────────────────────────────────────────────────────
// Brand Search API: GET https://api.logo.dev/search?q=<query>
//   Authorization: Bearer <LOGO_DEV_TOKEN>   (secret key, sk_...)
// Returns up to 10 ranked matches: [{ name, domain, logo_url }]. Each logo_url
// is ready to render (embeds Logo.dev's own publishable token), so we surface it
// as-is and never construct our own image URLs from scraped data.
const LOGO_DEV_SEARCH = "https://api.logo.dev/search";

type LogoDevMatch = { name?: string; domain?: string; logo_url?: string };

export class LogoDevProvider implements LogoProvider {
  readonly id = "logodev";
  private token: string | undefined;

  constructor(token = process.env.LOGO_DEV_TOKEN) {
    this.token = token && token.trim() ? token.trim() : undefined;
  }

  isConfigured(): boolean {
    return !!this.token;
  }

  async suggest(input: string): Promise<LogoSuggestResult> {
    if (!this.isConfigured()) return { status: "not_configured", candidates: [] };

    const norm = normalizeLogoInput(input);
    if (norm.kind === "personal") return { status: "personal_domain", candidates: [] };
    if (norm.kind === "invalid") return { status: "invalid_input", candidates: [] };

    let res: Response;
    try {
      const url = `${LOGO_DEV_SEARCH}?q=${encodeURIComponent(norm.query)}`;
      // safeFetch guards against SSRF; the host is fixed but we route ALL
      // third-party calls through it per the outbound-fetch policy.
      res = await safeFetch(url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
      });
    } catch {
      return { status: "provider_error", candidates: [] };
    }

    if (res.status === 429) return { status: "rate_limited", candidates: [] };
    if (!res.ok) return { status: "provider_error", candidates: [] };

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { status: "provider_error", candidates: [] };
    }

    const candidates = parseLogoDevMatches(body);
    if (!candidates.length) return { status: "no_match", candidates: [] };
    return { status: "ok", candidates };
  }
}

// Defensively map the provider payload to our candidate shape. Exported so the
// parsing (the part most likely to drift with the provider) is unit-tested
// without a network round trip. Drops any entry missing name/domain/logo.
export function parseLogoDevMatches(body: unknown): LogoCandidate[] {
  const arr = Array.isArray(body) ? body : [];
  const out: LogoCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of arr as LogoDevMatch[]) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    const domain = typeof raw?.domain === "string" ? raw.domain.trim().toLowerCase() : "";
    const logoUrl = typeof raw?.logo_url === "string" ? raw.logo_url.trim() : "";
    if (!name || !domain || !logoUrl) continue;
    // Only surface https image URLs — never a data:, http:, or javascript: URL.
    if (!/^https:\/\//i.test(logoUrl)) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push({ name, domain, logoUrl });
    if (out.length >= 10) break;
  }
  return out;
}

// The single place the rest of the app asks for a provider. Swap the class here
// (or branch on an env var) to change providers without touching callers.
export function getLogoProvider(): LogoProvider {
  return new LogoDevProvider();
}
