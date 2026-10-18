import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

// ── Audit round 19 (2026-10-18): a deleted account changes nothing, a link
//    scanner unsubscribes nobody, the offline cache keeps no signed-in page ──
//
// SEC-12  A deleted account could still sign in and, through the API, make
//         cards, upload, add contacts and start a new subscription.
// SEC-20  GET /api/unsubscribe unsubscribed — and mail scanners open links.
// SEC-21  The service worker would save any same-origin path it was sent.

let profile: Record<string, unknown> | null = null;
const updates: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => ({ data: table === "profiles" ? profile : null, error: null }),
        update: (v: Record<string, unknown>) => { updates.push(v); return chain; },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ user_id: "u1" }], error: null }).then(res),
      };
      return chain;
    },
  }),
}));

import { deletedAccountResponse } from "@/lib/live-account";
import { GET as unsubscribeGet, POST as unsubscribePost } from "@/app/api/unsubscribe/route";

const read = (p: string) => readFileSync(p, "utf8");
beforeEach(() => { profile = null; updates.length = 0; });

describe("SEC-12: a deleted account creates nothing through the API", () => {
  it("answers 403 for an account in its deletion window, nothing for a live one", async () => {
    profile = { customization: { _deleted: true } };
    expect((await deletedAccountResponse("u1"))?.status).toBe(403);
    profile = { customization: {} };
    expect(await deletedAccountResponse("u1")).toBeNull();
  });

  it.each([
    "src/app/api/cards/route.ts",
    "src/app/api/leads/manual/route.ts",
    "src/app/api/stripe/checkout/route.ts",
    "src/app/api/scanner/route.ts",
    "src/app/api/upload/route.ts",
    "src/app/api/upload/link-video/route.ts",
  ])("%s asks first", (f) => {
    expect(read(f)).toMatch(/const gone = await deletedAccountResponse\(user\.id\); if \(gone\) return gone;/);
  });
});

describe("SEC-20: opening the link asks; the button (or the provider's one-click POST) unsubscribes", () => {
  const url = "https://swiftcard.me/api/unsubscribe?token=abc";

  it("GET changes nothing and lands on the confirm page", async () => {
    const res = await unsubscribeGet(new NextRequest(url));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/unsubscribe?confirm=1&token=abc");
    expect(updates).toEqual([]);
  });

  it("the confirm page's button POSTs and comes back to a page", async () => {
    const res = await unsubscribePost(new NextRequest(`${url}&ui=1`, { method: "POST" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/unsubscribe?success=1");
    expect(updates).toEqual([{ marketing_emails: false }]);
  });

  it("the provider's one-click POST still answers JSON", async () => {
    const res = await unsubscribePost(new NextRequest(url, { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("the page's button is a plain form POST, working before any JavaScript", () => {
    expect(read("src/app/unsubscribe/UnsubscribeContent.tsx")).toContain('<form method="post" action={`/api/unsubscribe?ui=1&token=${encodeURIComponent(token)}`}>');
  });
});

describe("SEC-21: the offline cache never holds a signed-in page", () => {
  const sw = read("public/sw.js");
  const appPath = new RegExp(sw.match(/const APP_PATH = \/(.+)\/i;/)![1], "i");
  const proxy = read("src/proxy.ts");
  const guarded = [...proxy.matchAll(/"\/([a-z-]+)\/:path\*"/g)].map((m) => m[1]);

  it("refuses every page the sign-in proxy guards", () => {
    expect(guarded.length).toBeGreaterThan(10);
    for (const p of guarded) expect(appPath.test(`/${p}`), p).toBe(true);
    for (const p of ["/dashboard", "/contacts?lead=1".split("?")[0], "/settings/flows", "/office/admin"]) expect(appPath.test(p), p).toBe(true);
  });

  it("but still saves and serves a public card", () => {
    expect(appPath.test("/dana")).toBe(false);
    expect(appPath.test("/dana__links")).toBe(false);
    expect(appPath.test("/cardsmith")).toBe(false);
  });

  it("both the save and the navigation path apply it — app pages keep the no-signal screen", () => {
    expect(sw).toContain("if (APP_PATH.test(path)) return;");
    expect(sw).toContain("const saved = APP_PATH.test(url.pathname) ? undefined : await cache.match(key);");
  });
});
