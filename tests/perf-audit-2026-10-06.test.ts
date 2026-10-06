import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Source pins for the 2026-10-06 performance + bug pass. Each of these was a
// measured cost or a reproducible bug; each is the kind of thing a later
// "simplification" would quietly undo.
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("marketing pages do not download the homepage in the background", () => {
  it("HomeLink never prefetches on sight, only on intent", () => {
    const src = code("src/components/site/HomeLink.tsx");
    expect(src).toMatch(/prefetch=\{false\}/);
    expect(src).toMatch(/router\.prefetch\("\/"\)/);
    expect(src).toMatch(/onTouchStart/);
  });

  it.each([
    "src/components/site/SiteNav.tsx",
    "src/components/site/SiteFooter.tsx",
    "src/components/site/SiteFooterMini.tsx",
    "src/app/cards/new/NewCardWizard.tsx",
  ])("%s links home through HomeLink", (p) => {
    const src = code(p);
    expect(src, "a plain <Link href=\"/\"> prefetches the whole homepage (~170 KB)").not.toMatch(/<Link\s+href="\/"[\s>]/);
    expect(src).toContain("<HomeLink");
  });
});

describe("analytics stay off the critical path", () => {
  it("the PostHog SDK loads only after the page has loaded and gone idle", () => {
    const src = code("src/lib/events.ts");
    const loader = src.slice(src.indexOf("async function getPostHog"), src.indexOf("export function track("));
    expect(loader.indexOf("await whenIdleAfterLoad()")).toBeGreaterThan(-1);
    expect(loader.indexOf("await whenIdleAfterLoad()")).toBeLessThan(loader.indexOf('import("posthog-js")'));
  });

  it("the push-unbind chunk is only fetched when an unbind is actually pending", () => {
    const guard = code("src/components/AccountIsolationGuard.tsx");
    const key = read("src/lib/push-device.ts").match(/UNBIND_PENDING_KEY = "([^"]+)"/)?.[1];
    expect(key).toBeTruthy();
    expect(guard).toContain(`localStorage.getItem("${key}")`);
    const retry = guard.indexOf("retryPendingPushUnbind");
    expect(guard.lastIndexOf("if (unbindPending)", retry)).toBeGreaterThan(-1);
  });

  it("the service worker registers after load, not during it", () => {
    const src = code("src/components/ServiceWorkerRegistrar.tsx");
    expect(src).toMatch(/addEventListener\("load", register/);
  });
});

describe("Swift Links previews", () => {
  it("the CDN may cache link previews (s-maxage), not just the browser", () => {
    const src = code("src/app/api/link-preview/route.ts");
    expect(src).toMatch(/s-maxage=\d+/);
    expect(src).not.toMatch(/"Cache-Control": "public, max-age=86400" \}/);
  });

  it("previews are keyed by URL and fetched once, not per keystroke", () => {
    const src = code("src/components/SwiftLinkButtons.tsx");
    expect(src).toMatch(/useState<Record<string, Preview>>/);
    expect(src).toMatch(/\}, \[previewUrlsKey\]\);/);
    expect(src).not.toMatch(/\}, \[links\]\);/);
    expect(src).toMatch(/previews\[href\]/);
  });

  it("a favicon Google has no icon for falls back instead of showing a broken image", () => {
    const src = code("src/components/SwiftLinkButtons.tsx");
    const imgs = src.match(/<img src=\{favicon\}[^>]*>/g) ?? [];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(img).toContain("onError");
  });
});

describe("billing races", () => {
  it("only the latest promo-code check may set the answer", () => {
    const src = code("src/components/PromoCodeBox.tsx");
    expect(src).toMatch(/const seq = \+\+seqRef\.current/);
    expect((src.match(/if \(seq !== seqRef\.current\) return false/g) ?? []).length).toBe(2);
  });

  it("the plan-change switch refuses a second change while one is in flight", () => {
    const src = code("src/components/BillingManager.tsx");
    const choose = src.slice(src.indexOf('async function choose(plan: "pro" | "office")'));
    expect(choose.slice(0, 200)).toMatch(/if \(busy\) return;/);
    expect(src).toMatch(/choose\("pro"\)\} disabled=\{busy !== null\}/);
    expect(src).toMatch(/choose\("office"\)\} disabled=\{busy !== null\}/);
  });

  it("checkout auto-resume waits for the subscriber preview and the promo check", () => {
    const src = code("src/app/checkout/CheckoutClient.tsx");
    expect(src).toMatch(/if \(!resumeRef\.current \|\| previewLoading \|\| promoChecking\) return;/);
    expect(src).toMatch(/if \(promoBlocks\) return;/);
  });
});

describe("signed-in pages start their reads at once", () => {
  it.each([
    "src/app/share/page.tsx",
    "src/app/cards/[id]/edit/page.tsx",
    "src/app/profile/page.tsx",
    "src/app/upgrade/page.tsx",
    "src/lib/office-admin-guard.ts",
  ])("%s runs getUser() inside the data batch, behind getClaims()", (p) => {
    const src = code(p);
    const claims = src.indexOf("auth.getClaims()");
    const all = src.indexOf("Promise.all([", claims);
    const getUser = src.indexOf("supabase.auth.getUser()");
    expect(claims).toBeGreaterThan(-1);
    expect(getUser, "getUser() must be one entry of the batch, not a round trip in front of it").toBeGreaterThan(all);
    // The getUser result is still checked: a deleted account with a live token
    // must be turned away.
    expect(src).toMatch(/if \(!user \|\| user\.id !== uid\) redirect\(/);
  });

  it("the office context asks the owner and member questions together", () => {
    const src = code("src/lib/office-roles.ts");
    const fn = src.slice(src.indexOf("export const resolveOfficeContext"), src.indexOf("export const resolveOfficeContext") + 900);
    expect(fn).toMatch(/await Promise\.all\(\[/);
  });

  it("the Google button occupies one fixed slot through loading and ready", () => {
    const src = code("src/components/GoogleSignInButton.tsx");
    expect(src).toMatch(/fixedSlot \? " h-\[44px\]"/);
  });
});
