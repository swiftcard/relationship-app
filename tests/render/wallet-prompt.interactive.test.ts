import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// THE NEW-CARD WALLET PROMPT, MEASURED (owner, 2026-10-19).
//
// The REAL WalletPrompt at the top of the dashboard's Share box (its exact
// classes), above a Show QR button, at real phone widths with mobile emulation
// in both themes, for Apple (iPhone app) and Google (Android). It pins what a
// source scan can't see: nothing widens the page, the X is a full 44px target
// clear of the heading, Google's badge is never under 48px or wider than its
// box, and closing it removes BOTH copies of the Share box's prompt (the
// dashboard renders that box twice) and leaves no gap above Show QR.
// ─────────────────────────────────────────────────────────────────────────────

let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

const UA = {
  apple: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 SwiftCardApp SwiftCardSplash/3",
  google: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
} as const;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "wallet-prompt-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import WalletPrompt from "@/components/WalletPrompt";

    // Every request to the prompt's route, for the assertions (the
    // analytics sink posts through fetch too, and is not counted).
    (window as any).__posts = [];
    window.fetch = (async (url: string, init: RequestInit = {}) => {
      if (String(url).includes("/wallet-prompt")) (window as any).__posts.push({ url: String(url), method: init.method, keepalive: init.keepalive });
      return new Response("{}");
    }) as typeof fetch;

    // The dashboard's Share box, exactly as page.tsx draws it, with a stand-in
    // Show QR in QRCodeModal's primary classes.
    const shareBox = (id: string, kind: "apple" | "google", hidden: boolean) =>
      h("div", { key: id, "data-copy": id, style: hidden ? { display: "none" } : undefined, className: "bg-gray-900 border border-gray-800/80 rounded-2xl p-5 space-y-2" },
        h(WalletPrompt, { cardId: "c1", username: "alex-morgan", kind }),
        h("button", { type: "button", "data-show-qr": "", className: "w-full flex items-center justify-center gap-2 py-3.5 px-5 rounded-full font-bold text-sm text-white bg-blue-600" }, "Show QR"),
        h("button", { type: "button", className: "w-full rounded-full py-3 text-sm" }, "Share link"));

    (window as any).mount = (kind: "apple" | "google") => {
      createRoot(document.getElementById("root")!).render(
        h("main", { className: "sc-app bg-gray-950 min-h-screen pt-6" },
          h("div", { className: "max-w-5xl mx-auto px-4" }, shareBox("phone", kind, false), shareBox("desktop", kind, true))));
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_APP_URL": '"https://swiftcard.me"' },
    alias: { "@": resolve("src") },
    // lib/events reads NEXT_PUBLIC_ keys Next would inline; none here.
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

async function open(width: number, light: boolean, kind: "apple" | "google", before = ""): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA[kind] });
  // The page's own origin, serving public/ — so Google's badge is the real
  // file, loaded and measured, not a broken-image box.
  await ctx.route("https://swiftcard.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    try {
      await route.fulfill({ body: readFileSync(resolve("public" + path)), contentType: path.endsWith(".svg") ? "image/svg+xml" : undefined });
    } catch { await route.fulfill({ status: 404 }); }
  });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html${light ? ' data-sc-theme="light"' : ""}><head><base href="https://swiftcard.test/"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
    <body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`);
  if (before) await page.evaluate(before);
  await page.evaluate((k) => (window as unknown as { mount: (k: string) => void }).mount(k), kind);
  await page.locator('[data-copy="phone"] [data-wallet-prompt]').waitFor({ state: "attached" });
  // useWalletMode / useIsAndroidDevice settle after mount.
  await page.waitForTimeout(100);
  await page.waitForLoadState("networkidle");
  return { page, close: () => ctx.close() };
}

for (const kind of ["apple", "google"] as const) {
  describe.each([[320, false], [375, true], [390, false], [390, true], [430, false]] as [number, boolean][])(
    `${kind} prompt, %ipx phone, light theme: %s`,
    (width, light) => {
      it("fits, with a full-size X clear of the heading and a real wallet button", async () => {
        const { page, close } = await open(width, light, kind);
        try {
          const m = await page.evaluate(() => {
            const box = document.querySelector('[data-copy="phone"]')!;
            const panel = box.querySelector("[data-wallet-prompt] section")!;
            const x = panel.querySelector('button[aria-label="Dismiss"]')!;
            const title = panel.querySelector("p")!;
            const link = panel.querySelector("a")!;
            const img = [...panel.querySelectorAll("img")].find((i) => getComputedStyle(i).display !== "none") ?? null;
            const r = (e: Element) => e.getBoundingClientRect();
            const vv = window.visualViewport!;
            return {
              scale: vv.scale, docWidth: document.documentElement.scrollWidth,
              panel: r(panel).toJSON(), x: r(x).toJSON(), title: r(title).toJSON(), link: r(link).toJSON(),
              linkText: link.textContent ?? "", img: img ? r(img).toJSON() : null,
              imgLoaded: !!img && img.complete && img.naturalWidth > 0,
              bg: getComputedStyle(panel).backgroundColor,
            };
          });
          expect(m.scale, "the phone zoomed the page out").toBeCloseTo(1, 2);
          expect(m.docWidth, "the page is wider than the phone").toBeLessThanOrEqual(width);
          expect(m.panel.right).toBeLessThanOrEqual(width);
          expect(m.x.width).toBeGreaterThanOrEqual(44);
          expect(m.x.height).toBeGreaterThanOrEqual(44);
          expect(m.x.right).toBeLessThanOrEqual(m.panel.right);
          expect(m.x.top).toBeGreaterThanOrEqual(m.panel.top);
          // The heading never runs under the X.
          expect(m.title.right <= m.x.left + 1 || m.title.top >= m.x.bottom).toBe(true);
          expect(m.link.right).toBeLessThanOrEqual(m.panel.right);
          expect(m.bg, "the panel lost its tint").not.toBe("rgba(0, 0, 0, 0)");
          if (kind === "apple") {
            expect(m.linkText).toContain("Add to Apple Wallet");
          } else {
            // Google's rules: the badge as shipped, at least 48px tall, never
            // squeezed — and here, never wider than the panel.
            expect(m.img, "no visible Google badge").not.toBeNull();
            expect(m.imgLoaded, "Google's badge file did not load").toBe(true);
            expect(m.img!.height).toBeGreaterThanOrEqual(48);
            expect(m.img!.left).toBeGreaterThanOrEqual(m.panel.left);
            expect(m.img!.right).toBeLessThanOrEqual(m.panel.right);
          }
          if (width === 390) await page.screenshot({ path: `node_modules/.cache/wallet-prompt-${kind}-${light ? "light" : "dark"}.png` });
        } finally { await close(); }
      });
    },
  );

  it(`${kind}: the X records it once, removes both copies, and Show QR moves up with no gap`, async () => {
    const { page, close } = await open(390, true, kind);
    try {
      await page.locator('[data-copy="phone"] button[aria-label="Dismiss"]').click();
      await page.waitForTimeout(450);
      const m = await page.evaluate(() => {
        const box = document.querySelector('[data-copy="phone"]')!;
        const qr = box.querySelector("[data-show-qr]")!;
        return {
          prompts: document.querySelectorAll("[data-wallet-prompt]").length,
          posts: (window as unknown as { __posts: { url: string; method: string; keepalive: boolean }[] }).__posts,
          gap: Math.round(qr.getBoundingClientRect().top - box.getBoundingClientRect().top),
        };
      });
      expect(m.prompts, "a copy of the prompt survived").toBe(0);
      expect(m.posts).toEqual([{ url: "/api/cards/c1/wallet-prompt", method: "POST", keepalive: true }]);
      // 20px box padding + 1px border: Show QR sits where it does on a card
      // that never had the prompt.
      expect(m.gap).toBe(21);
    } finally { await close(); }
  });
}

it("pressing Add to Apple Wallet ends it too", async () => {
  const { page, close } = await open(390, false, "apple");
  try {
    // Stop the pass download itself; only the prompt's reaction matters here.
    await page.evaluate(() => document.addEventListener("click", (e) => e.preventDefault(), { capture: false }));
    await page.locator('[data-copy="phone"] a:has-text("Add to Apple Wallet")').click();
    await page.waitForTimeout(450);
    expect(await page.locator("[data-wallet-prompt]").count()).toBe(0);
    const posts = await page.evaluate(() => (window as unknown as { __posts: unknown[] }).__posts.length);
    expect(posts).toBe(1);
  } finally { await close(); }
});

it("a Mac running the iPhone app never shows it", async () => {
  const { page, close } = await open(1280, false, "apple", `document.documentElement.dataset.scMac = "1"`);
  try {
    const shown = await page.evaluate(() => getComputedStyle(document.querySelector('[data-copy="phone"] [data-wallet-prompt]')!).display);
    expect(shown).toBe("none");
  } finally { await close(); }
});
