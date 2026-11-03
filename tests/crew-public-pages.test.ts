import { afterEach, describe, expect, it, vi } from "vitest";
import { mailtos, readSiteDetailed, robotsAllows } from "@/lib/crew/leads/fetch-page";

const reads: { url: string; at: number }[] = [];
const replies = new Map<string, { status?: number; body: string; redirect?: string }>();
vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: async (url: string, _init: unknown, _redirects: number, before?: (url: URL) => Promise<void>) => {
    await before?.(new URL(url));
    reads.push({ url, at: Date.now() });
    const response = replies.get(url) ?? { status: url.endsWith("robots.txt") ? 404 : 200, body: url.endsWith("robots.txt") ? "" : "Public business page" };
    const status = response.status ?? 200;
    if (response.redirect) {
      await before?.(new URL(response.redirect));
      reads.push({ url: response.redirect, at: Date.now() });
    }
    return { ok: status >= 200 && status < 300, status, url: response.redirect ?? url, headers: new Headers({ "content-type": "text/html" }), text: async () => response.body };
  },
}));
afterEach(() => { vi.useRealTimers(); reads.length = 0; replies.clear(); });

describe("bounded public website discovery", () => {
  it("follows nested team links beyond the old two-page limit, caps at 12, and spaces domain requests", async () => {
    vi.useFakeTimers();
    const root = "https://deep.example";
    replies.set(`${root}/`, { body: "<a href='/about'>About</a><a href='/contact'>Contact</a>" });
    replies.set(`${root}/about`, { body: "<a href='/team'>Team</a>" });
    replies.set(`${root}/team`, { body: Array.from({ length: 20 }, (_, i) => `<a href='/team/member${i}'>Staff</a>`).join("") });
    replies.set(`${root}/team/member0`, { body: "Alice Park, Owner alice@deep.example" });
    const pending = readSiteDetailed(`${root}/`);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.pages).toHaveLength(12);
    expect(result.pages.some((p) => p.url.endsWith("/team/member0"))).toBe(true);
    expect(result.pages.some((p) => p.html.includes("alice@deep.example"))).toBe(true);
    expect(reads).toHaveLength(13); // robots plus twelve pages
    for (let i = 1; i < reads.length; i++) expect(reads[i].at - reads[i - 1].at).toBeGreaterThanOrEqual(1000);
  });

  it("does not fetch restricted/social/off-origin/query links, and obeys robots on nested paths", async () => {
    vi.useFakeTimers();
    const root = "https://polite.example";
    replies.set(`${root}/robots.txt`, { body: "User-agent: *\nDisallow: /team/private" });
    replies.set(`${root}/`, { body: `<a href='/team/private'>Team</a><a href='https://linkedin.com/team/foo'>Team</a><a href='/team?login=1'>Team</a><a href='/team'>Team</a>` });
    const pending = readSiteDetailed(`${root}/`);
    await vi.runAllTimersAsync();
    expect((await pending).pages.map((p) => p.url)).toEqual([`${root}/`, `${root}/team`]);
    expect(reads.some((r) => /private|linkedin|login/.test(r.url))).toBe(false);
    expect((await readSiteDetailed("https://linkedin.com/team")).pages).toEqual([]);
  });

  it("refuses robots outages instead of treating them as permission, and stops on bot challenges", async () => {
    vi.useFakeTimers();
    replies.set("https://robotfail.example/robots.txt", { status: 503, body: "" });
    const pending = readSiteDetailed("https://robotfail.example/");
    await vi.runAllTimersAsync();
    expect((await pending).outcome).toBe("robots");
    expect(reads.some((r) => r.url === "https://robotfail.example/")).toBe(false);
    replies.set("https://challenge.example/", { body: "<title>Just a moment...</title>" });
    const challenge = readSiteDetailed("https://challenge.example/");
    await vi.runAllTimersAsync();
    expect((await challenge).outcome).toBe("http_403");
  });

  it("honors wildcard/end-anchor rules and allow ties; malformed mailtos cannot abort extraction", () => {
    expect(robotsAllows("User-agent: *\nDisallow: /team/*/private$", "/team/alice/private")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /team/*/private$", "/team/alice/private/contact")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /team\nAllow: /team", "/team")).toBe(true);
    expect(mailtos('<a href="mailto:%zz">bad</a><a href="mailto:jo%40example.com">good</a>')).toEqual(["jo@example.com"]);
  });

  it("keeps a brokerage-hosted team inside its own path and allows an empty successful robots file", async () => {
    vi.useFakeTimers();
    replies.set("https://compass.com/robots.txt", { body: "" });
    replies.set("https://compass.com/agents/jane/", { body: "<a href='/agents/jane/team'>Our team</a><a href='/agents/other/team'>Other team</a><a href='/about'>Corporate</a>" });
    const pending = readSiteDetailed("https://compass.com/agents/jane/");
    await vi.runAllTimersAsync();
    expect((await pending).pages.map((p) => p.url)).toEqual(["https://compass.com/agents/jane/", "https://compass.com/agents/jane/team"]);
  });

  it("refuses a team subpage redirecting to a different team before fetching that team's page", async () => {
    vi.useFakeTimers();
    replies.set("https://compass.com/agents/alice/", { body: "<a href='/agents/alice/about'>About</a>" });
    replies.set("https://compass.com/agents/alice/about", { body: "Bob Smith, Owner bob@other.com", redirect: "https://compass.com/agents/bob/" });
    const pending = readSiteDetailed("https://compass.com/agents/alice/");
    await vi.runAllTimersAsync();
    expect((await pending).pages).toHaveLength(1);
    expect(reads.some((r) => r.url === "https://compass.com/agents/bob/")).toBe(false);
  });
});
