import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_SLUGS, normalizeSlug } from "@/lib/slug";

// 2026-11-15: scanners probe /.env, /wp-login.php, /graphql and friends all
// day. Each probe used to run the proxy and a serverless function just to be
// told 404, and those invocations counted toward the limit that got the site
// disabled. vercel.json now denies them at Vercel's firewall: no function
// runs and denied requests are not billed.
//
// A deny rule in front of every request is only safe if it can never match a
// real page. This walks src/app and proves it.

const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
  routes?: { src: string; mitigate?: { action: string } }[];
  crons?: { path: string }[];
};
const rules = (vercel.routes ?? []).filter((r) => r.mitigate);
const denied = (path: string) => rules.some((r) => new RegExp(r.src).test(path));

/** Every route under src/app as a concrete URL path, dynamic segments filled
 *  with a sample value. */
function appPaths(dir = "src/app", url = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith("_")) continue;
      const seg = name.startsWith("(") ? "" : name.startsWith("[") ? "/sample-value-1" : `/${name}`;
      out.push(...appPaths(full, url + seg));
    } else if (/^(page|route)\.tsx?$/.test(name)) {
      out.push(url || "/");
    }
  }
  return out;
}

describe("scanner paths are refused before any function runs", () => {
  it("there is exactly one firewall rule, and it denies", () => {
    // One rule: Vercel's Hobby plan allows very few custom rules.
    expect(rules).toHaveLength(1);
    expect(rules[0].mitigate).toEqual({ action: "deny" });
    // vercel.json supports only deny and challenge here; a rule with anything
    // else (a dest, a status, a continue) would be a routing change.
    expect(Object.keys(rules[0]).sort()).toEqual(["mitigate", "src"]);
  });

  it.each([
    "/.env", "/.env.local", "/.env.production", "/.env.bak", "/api/.env", "/app/.env", "/admin/.env.save",
    "/.git/config", "/.git/HEAD", "/.gitignore", "/.aws/credentials", "/.ssh/id_rsa", "/.htaccess", "/.htpasswd",
    "/wp-login.php", "/xmlrpc.php", "/index.php", "/admin.php", "/wp-admin/setup-config.php", "/shell.php7", "/a/b/c.php",
    "/info.phtml", "/default.aspx", "/login.asp", "/index.jsp", "/cgi-bin/luci", "/test.cgi",
    "/wp-admin", "/wp-admin/", "/wp-content/plugins/x/readme.txt", "/wp-includes/wlwmanifest.xml", "/wp-json/wp/v2/users", "/wp-config.bak",
    "/wordpress", "/wordpress/wp-admin", "/phpmyadmin", "/phpmyadmin/index", "/actuator", "/actuator/env",
    "/graphql", "/api/graphql", "/graphql/console", "/api/config", "/api/config/",
  ])("%s is denied", (path) => {
    expect(denied(path)).toBe(true);
  });

  it("no page or API route in the app can ever be denied", () => {
    const paths = appPaths();
    expect(paths.length).toBeGreaterThan(200);
    expect(paths.filter(denied)).toEqual([]);
  });

  it("the paths the platform and the phone apps rely on stay open", () => {
    for (const path of [
      "/", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/favicon.ico", "/sw.js", "/offline.html",
      "/.well-known/apple-app-site-association", "/.well-known/assetlinks.json",
      "/_next/static/chunks/main-abc123.js", "/_next/image", "/icon.png", "/apple-icon.png", "/opengraph-image",
      "/og/brand.png", "/hero-bg.mp4", "/google7ae8a7569211003b.html",
      "/api/health", "/api/watch/card", "/api/wallet/v1/log", "/api/upload", "/api/leads", "/api/card-events",
      "/api/settings/crm", "/api/admin/website", "/api/integrations/google/connect",
      ...(vercel.crons ?? []).map((c) => c.path),
    ]) {
      expect(denied(path), path).toBe(false);
    }
    // A deny rule that matched a cron path would silently stop that job:
    // every cron path is in the list checked above.
    expect((vercel.crons ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("no card address can be denied: slugs are [a-z0-9-], and the bare names the rule uses are reserved", () => {
    // Real-looking slugs, including ones that START like a scanner path.
    for (const slug of [
      "aaronlavi", "aaronlavi-malvecapital", "wp-realty", "wp", "wp-adminson", "php", "phpdev-acme", "env", "git",
      "graphql-consulting", "config", "configsmith-homes", "wordpress-dev", "cgi", "actuator-labs", "asp-net-guy", "jsp",
    ]) {
      expect(normalizeSlug(slug)).toBe(slug);
      expect(denied(`/${slug}`), slug).toBe(false);
      expect(denied(`/links/${slug}`), slug).toBe(false);
      expect(denied(`/card/${slug}/opengraph-image`), slug).toBe(false);
    }
    // A slug can never contain a dot, which is what the file-type half keys on.
    expect(normalizeSlug("jane.php")).toBe("jane-php");
    expect(normalizeSlug(".env")).toBe("env");
    // Any single-segment name the rule denies must be impossible to claim.
    for (const name of ["graphql", "wp-admin", "wp-login", "wp-content", "wp-includes", "wp-json", "wp-config", "wordpress", "phpmyadmin", "cgi-bin", "actuator"]) {
      expect(denied(`/${name}`), name).toBe(true);
      expect(RESERVED_SLUGS.has(name), `${name} must be in RESERVED_SLUGS`).toBe(true);
    }
  });

  it("search engines and AI crawlers are not blocked anywhere", () => {
    // The rule keys on the PATH only: no user-agent, no header, no country.
    expect(JSON.stringify(vercel.routes)).not.toMatch(/user.?agent|"has"|"missing"|header/i);
    const robots = readFileSync(join(process.cwd(), "src/app/robots.ts"), "utf8");
    // One rule for everyone, and it allows the site. No crawler is singled out.
    expect(robots).toMatch(/userAgent: "\*"/);
    expect(robots).toMatch(/allow: "\/"/);
    expect(robots.match(/userAgent:/g)).toHaveLength(1);
    expect(robots).not.toMatch(/GPTBot|ClaudeBot|anthropic|CCBot|PerplexityBot|Google-Extended|Bytespider|Applebot/i);
  });
});
