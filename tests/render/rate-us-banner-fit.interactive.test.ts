import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// THE "RATE US" BANNER FITS A PHONE.
//
// Nightly production QA, 2026-09-29: on a phone every tab of the bottom bar was
// untappable. The dashboard's Rate us banner (shown once an account has a real
// contact) put "Rate us on the App Store" + the App Store badge + Dismiss on
// one line that could not wrap (~380px). It ran past the screen, the phone
// zoomed the whole page out to fit it, and the fixed tab bar sat below the
// visible screen — a tap on "Contacts" landed on the Share box. The REAL
// banner, in the dashboard's box, at real phone sizes with mobile emulation
// (which is what zooms), in both themes.
// ─────────────────────────────────────────────────────────────────────────────

let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "rate-us-fit-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import RateUsBanner from "@/components/RateUsBanner";
    createRoot(document.getElementById("root")!).render(
      h("main", { className: "sc-app bg-gray-950 min-h-screen pt-20" },
        h("div", { className: "max-w-5xl mx-auto px-5" },
          h(RateUsBanner, { leadCount: 1, viewCount: 0, dismissedAt: null }),
          h("div", { className: "bg-gray-900 border border-gray-800/80 rounded-2xl p-5" }, "My Cards"))),
    );
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"production"',
      // A live listing, so the banner (and its badge) actually render.
      "process.env.NEXT_PUBLIC_APP_STORE_URL": '"https://apps.apple.com/us/app/swiftcard/id6749999999"',
    },
    alias: { "@": resolve("src") },
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

describe.each([[320, false], [375, false], [390, false], [390, true], [430, false]] as [number, boolean][])(
  "%ipx phone, light theme: %s",
  (width, light) => {
    it("the banner and its buttons stay inside the screen — nothing makes the page wider", async () => {
      // isMobile: a phone zooms OUT to fit anything wider than the screen —
      // which is exactly the failure — so this measures what a phone does.
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      try {
        await page.setContent(`<!doctype html><html${light ? ' data-sc-theme="light"' : ""}><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
          <body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`);
        await page.getByRole("button", { name: "Dismiss" }).waitFor();
        const m = await page.evaluate(() => {
          const vv = window.visualViewport!;
          const dismiss = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Dismiss")!;
          const banner = dismiss.closest(".rounded-2xl")!;
          return {
            visible: vv.width, scale: vv.scale,
            docWidth: document.documentElement.scrollWidth,
            bannerRight: banner.getBoundingClientRect().right,
            dismissRight: dismiss.getBoundingClientRect().right,
          };
        });
        expect(m.scale, "the phone zoomed the page out").toBeCloseTo(1, 2);
        expect(m.docWidth, "the page is wider than the phone").toBeLessThanOrEqual(width);
        expect(m.bannerRight).toBeLessThanOrEqual(width);
        expect(m.dismissRight).toBeLessThanOrEqual(m.bannerRight);
        if (width === 390 && !light) await page.screenshot({ path: "node_modules/.cache/rate-us-390.png" });
      } finally { await ctx.close(); }
    });
  },
);
