import { describe, it, expect } from "vitest";
import { assertSafeUrl, isZapierWebhookUrl } from "@/lib/safe-fetch";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// These cover every branch that does NOT require a network/DNS round-trip, so
// the suite stays hermetic: scheme, hostname blocklist, and literal-IP checks.
describe("assertSafeUrl", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(assertSafeUrl(new URL("ftp://example.com"))).rejects.toThrow("blocked scheme");
    await expect(assertSafeUrl(new URL("file:///etc/passwd"))).rejects.toThrow("blocked scheme");
  });

  it("rejects loopback / internal hostnames by name", async () => {
    await expect(assertSafeUrl(new URL("http://localhost/"))).rejects.toThrow("blocked host");
    await expect(assertSafeUrl(new URL("http://foo.localhost/"))).rejects.toThrow("blocked host");
    await expect(assertSafeUrl(new URL("http://svc.internal/"))).rejects.toThrow("blocked host");
    await expect(assertSafeUrl(new URL("http://metadata.google.internal/"))).rejects.toThrow("blocked host");
  });

  it("rejects literal private / loopback / link-local IPs", async () => {
    await expect(assertSafeUrl(new URL("http://127.0.0.1/"))).rejects.toThrow("blocked ip");
    await expect(assertSafeUrl(new URL("http://10.0.0.5/"))).rejects.toThrow("blocked ip");
    await expect(assertSafeUrl(new URL("http://192.168.1.1/"))).rejects.toThrow("blocked ip");
    await expect(assertSafeUrl(new URL("http://172.16.0.1/"))).rejects.toThrow("blocked ip");
    // Cloud metadata endpoint — the classic SSRF target.
    await expect(assertSafeUrl(new URL("http://169.254.169.254/"))).rejects.toThrow("blocked ip");
    // IPv6 loopback + IPv4-mapped private (dotted AND hex forms — the URL
    // parser normalizes the dotted form into hex, which was an SSRF bypass).
    await expect(assertSafeUrl(new URL("http://[::1]/"))).rejects.toThrow("blocked ip");
    await expect(assertSafeUrl(new URL("http://[::ffff:127.0.0.1]/"))).rejects.toThrow("blocked ip");
    await expect(assertSafeUrl(new URL("http://[::ffff:7f00:1]/"))).rejects.toThrow("blocked ip");
    await expect(assertSafeUrl(new URL("http://[::ffff:0a00:1]/"))).rejects.toThrow("blocked ip"); // 10.0.0.1
  });

  it("allows a literal public IP (no DNS involved)", async () => {
    await expect(assertSafeUrl(new URL("http://8.8.8.8/"))).resolves.toBeUndefined();
    await expect(assertSafeUrl(new URL("https://1.1.1.1/"))).resolves.toBeUndefined();
  });
});

describe("isZapierWebhookUrl", () => {
  it("accepts only https hooks.zapier.com URLs", () => {
    expect(isZapierWebhookUrl("https://hooks.zapier.com/hooks/catch/123/abc")).toBe(true);
    expect(isZapierWebhookUrl("https://x.hooks.zapier.com/hooks/catch/1/a")).toBe(true);
  });

  it("rejects http, look-alike hosts, and non-strings", () => {
    expect(isZapierWebhookUrl("http://hooks.zapier.com/x")).toBe(false); // not https
    expect(isZapierWebhookUrl("https://hooks.zapier.com.evil.com/x")).toBe(false);
    expect(isZapierWebhookUrl("https://evil.com/hooks.zapier.com")).toBe(false);
    expect(isZapierWebhookUrl("not a url")).toBe(false);
    expect(isZapierWebhookUrl(null)).toBe(false);
    expect(isZapierWebhookUrl(12345)).toBe(false);
  });
});

// ── SSRF regression guards ───────────────────────────────────────────────────
// Routes that fetch a URL held in a user-controlled DB column must go through
// safeFetch. The public vCard endpoint fetched card.photo_url with a bare
// fetch(), which let any card owner point an unauthenticated public endpoint at
// cloud metadata or an internal address. Flagged by security review 2026-07-31.
describe("SSRF: user-controlled URLs go through safeFetch", () => {
  // The fetch itself moved into lib/contact-photo (fetchVCardPhoto), shared by
  // the card vCard and the lead vCard since 2026-09-24. Both routes must reach
  // it only through that helper; the helper itself must use safeFetch.
  const fetchers = ["src/lib/contact-photo.ts"];
  const routes = [
    "src/app/api/card/[username]/vcard/route.ts",
    "src/app/api/leads/vcard/route.ts",
    // The link-preview stand-in embeds the same owner-controlled photo/logo.
    "src/app/card/[username]/opengraph-image.tsx",
  ];
  const strip = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it.each(fetchers)("%s uses safeFetch, never bare fetch", (rel) => {
    const src = strip(rel);
    expect(src).toMatch(/safeFetch\(/);
    // `await fetch(` with no safe- prefix is the pattern that was vulnerable.
    expect(src).not.toMatch(/[^e]\bfetch\(/);
  });

  it.each(routes)("%s fetches pictures only through fetchVCardPhoto", (rel) => {
    const src = strip(rel);
    expect(src).toMatch(/fetchVCardPhoto\(/);
    expect(src).not.toMatch(/[^e]\bfetch\(/);
  });
});
