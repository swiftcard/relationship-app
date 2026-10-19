import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// The marketing Swift Links phone (homepage + /products/swiftlinks) is the
// REAL page scrolling inside a phone (owner, 2026-10-19: "it does not look the
// same anymore, it works differently"). It used to be a hand-drawn copy that
// every redesign left behind. What has to hold, measured in a real Chromium
// and WebKit because a source scan sees none of it:
//   • the phone scrolls (the page inside is inert, its scroller is not);
//   • the header photo stays pinned at the top of the PHONE and dissolves
//     over the live page's 165px, exactly as on /links/[username];
//   • the mini header and the corner badge appear once the photo has gone.

const PHOTO =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#9a8f7a"/></svg>';

let bundle: string;
let tmp: string;

beforeAll(async () => {
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "slphone-"));
  writeFileSync(
    join(tmp, "entry.tsx"),
    `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import SwiftLinksPhone from "@/components/site/SwiftLinksPhone";
    window.fetch = (async () => new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } })) as any;
    createRoot(document.getElementById("root")!).render(h(SwiftLinksPhone));
  `,
  );
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_APP_URL": '"https://swiftcard.me"' },
    alias: { "@": resolve("src") },
    banner: { js: 'var process={env:{NODE_ENV:"production"}};' },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function mount(browser: Browser, width: number): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
  await page.setViewportSize({ width, height: 900 });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>body{margin:0;padding:20px}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`;
  await page.route("https://swiftcard.me/**", (route) => {
    const u = route.request().url();
    if (/\.(jpe?g|png)$/.test(u)) return route.fulfill({ status: 200, contentType: "image/svg+xml", body: PHOTO });
    if (u.includes("/api/")) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  });
  await page.goto("https://swiftcard.me/");
  await page.waitForSelector("[data-swiftlinks-phone-scroll] h1");
  return page;
}

async function scrollPhone(page: Page, y: number) {
  await page.evaluate((v) => { document.querySelector("[data-swiftlinks-phone-scroll]")!.scrollTop = v; }, y);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const state = (page: Page) =>
  page.evaluate(() => {
    const sc = document.querySelector("[data-swiftlinks-phone-scroll]") as HTMLElement;
    const hero = sc.querySelector("[data-sl-hero]") as HTMLElement;
    const box = sc.getBoundingClientRect();
    const name = Array.from(sc.querySelectorAll("span")).find((e) => e.textContent === "Alex Morgan" && e.className.includes("truncate"));
    const screen = sc.parentElement!.getBoundingClientRect();
    return {
      scrollable: sc.scrollHeight - sc.clientHeight,
      heroOffset: hero.getBoundingClientRect().top - box.top,
      heroOpacity: Number(getComputedStyle(hero).opacity),
      bar: name ? Number(getComputedStyle(name.parentElement!).opacity) : -1,
      badge: !!sc.querySelector('button[aria-label="What is Swift Links?"]'),
      // The scaled page fills the screen box exactly, edge to edge.
      fit: { w: Math.abs(box.width - screen.width), h: Math.abs(box.height - screen.height) },
    };
  });

const engines = [["chromium", chromium], ["webkit", webkit]] as const;

describe.each(engines)("marketing Swift Links phone (%s)", (_name, engine) => {
  let browser: Browser;
  beforeAll(async () => { browser = await engine.launch(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  for (const width of [1280, 360]) {
    it(`renders the real page, pinned photo and all, at ${width}px`, async () => {
      const page = await mount(browser, width);
      let s = await state(page);
      expect(s.scrollable, "the phone does not scroll").toBeGreaterThan(300);
      expect(s.fit.w).toBeLessThan(1.5);
      expect(s.fit.h).toBeLessThan(1.5);
      expect(s.heroOpacity).toBe(1);
      expect(s.badge, "the corner badge is missing").toBe(true);

      await scrollPhone(page, 70);
      s = await state(page);
      expect(Math.abs(s.heroOffset), "the photo scrolled away instead of staying pinned").toBeLessThan(1);
      expect(s.heroOpacity).toBeGreaterThan(0.4);
      expect(s.heroOpacity).toBeLessThan(0.75);

      await scrollPhone(page, 300);
      s = await state(page);
      expect(Math.abs(s.heroOffset)).toBeLessThan(1);
      expect(s.heroOpacity).toBe(0);
      await expect.poll(async () => (await state(page)).bar, { timeout: 3000 }).toBe(1);

      await scrollPhone(page, 0);
      s = await state(page);
      expect(s.heroOpacity).toBe(1);
      await page.close();
    });
  }
});
