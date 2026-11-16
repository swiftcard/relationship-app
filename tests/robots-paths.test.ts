import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { CRAWL_BLOCKED_PATHS, NOINDEX_PATHS } from "@/lib/robots-paths";
import { robotsAllows } from "@/lib/crew/leads/fetch-page";

// Render robots() the way Next serves it, then ask a real robots matcher.
const r = robots();
const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
const txt = ["User-agent: *", "Allow: /", ...([] as string[]).concat(rules.disallow ?? []).map((d) => `Disallow: ${d}`)].join("\n");
const allowed = (path: string) => robotsAllows(txt, path, "googlebot");

describe("robots.txt never blocks a public page (Search Console 'Blocked by robots.txt', 2026-11-16)", () => {
  it("every marketing route in the sitemap is crawlable", () => {
    const src = readFileSync("src/app/sitemap.ts", "utf8");
    const literals = [...src.matchAll(/"(\/[a-z0-9-]*)"/g)].map((m) => m[1]);
    const slugs = [...src.matchAll(/^\s+"([a-z0-9-]+)",$/gm)].map((m) => m[1]);
    const paths = [...literals, ...slugs.flatMap((s) => [`/products/${s}`, `/for/${s}`, `/compare/${s}`]), "/blog", "/blog/some-post"];
    expect(paths.length).toBeGreaterThan(30);
    for (const p of paths) expect(allowed(p), p).toBe(true);
  });

  it("a card or Swift Links page whose slug starts with a blocked word is crawlable", () => {
    // /rafalgabrysiak was the live casualty of the old bare "Disallow: /r".
    for (const p of CRAWL_BLOCKED_PATHS) {
      const slug = `${p.slice(1)}smith-acme`;
      expect(allowed(`/${slug}`), slug).toBe(true);
      expect(allowed(`/links/${slug}`), slug).toBe(true);
    }
    for (const p of ["/rafalgabrysiak", "/review", "/cardsmith", "/officemax-jane", "/authorjane", "/joinery-co", "/apiary-bob"]) {
      expect(allowed(p), p).toBe(true);
    }
  });

  it("still blocks the private app, APIs and short-link redirects", () => {
    for (const p of ["/dashboard", "/dashboard/x", "/admin", "/admin/users", "/api/health", "/settings/devices", "/r/abc", "/go/abc", "/office/admin"]) {
      expect(allowed(p), p).toBe(false);
    }
  });

  it("pages that render to signed-out visitors are noindexed, not robots-blocked (a block hides the noindex)", () => {
    for (const p of ["/cards", "/join", "/auth", "/account-deleted", "/upgrade", "/checkout"]) {
      expect(NOINDEX_PATHS).toContain(p);
      expect(allowed(`${p}/x`), p).toBe(true);
    }
    expect(readFileSync("next.config.ts", "utf8")).toContain('NOINDEX_PATHS.map((p) => ({ source: `${p}/:path*`, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }))');
  });

  it("no public route is noindexed", () => {
    for (const p of NOINDEX_PATHS) {
      expect(["/", "/pricing", "/templates", "/links", "/blog", "/products", "/for", "/compare", "/preview", "/p", "/pin"]).not.toContain(p);
    }
  });
});
