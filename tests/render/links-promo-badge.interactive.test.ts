import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── THE SWIFT LINKS CORNER BADGE, DRIVEN FOR REAL ────────────────────────────
//
// The Linktree-style bolt chip at the top-left of every Swift Links page
// (owner order 2026-09-02) and the "Create your own Swift Links" sheet it
// opens. Same discipline as signup-nudge.interactive: bundle the REAL
// SwiftLinkProfile, hydrate in headless Chromium with the app's compiled
// Tailwind, click the actual chip, and measure what a visitor sees.

let browser: Browser;
let bundle: string;
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "lbp-"));

  writeFileSync(
    join(tmp, "entry.tsx"),
    `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import SwiftLinkProfile from "@/components/SwiftLinkProfile";

    (window as any).calls = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = (async (input: any, init: any) => {
      const url = String(typeof input === "string" ? input : input?.url ?? "");
      (window as any).calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (url.startsWith("/api/")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return realFetch(input, init);
    }) as any;

    let _root: any = null;
    (window as any).mount = (embedded: boolean) => {
      const el = document.getElementById("root")!;
      if (!_root) _root = createRoot(el);
      _root.render(
        h(SwiftLinkProfile, {
          name: "Alex Morgan", username: "alex-morgan", photoUrl: null,
          subtitle: "Broker  ·  Morgan Realty", bio: "Helping you find home.",
          verified: false, socials: [], links: [],
          appUrl: "https://swiftcard.me", embedded,
        }),
      );
    };
  `,
  );

  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_APP_URL": '"https://swiftcard.me"',
    },
    alias: { "@": resolve("src") },
    // next/link's internals read process.env keys beyond the two defined
    // above (define only substitutes exact matches), so give the bundle a
    // real `process` global too or it dies at module scope in the browser.
    banner: { js: 'var process={env:{NODE_ENV:"production"}};' },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function mount(opts: { embedded?: boolean; width?: number } = {}): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
  await page.setViewportSize({ width: opts.width ?? 390, height: 844 });

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`;
  await page.route("https://swiftcard.me/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
  );
  await page.goto("https://swiftcard.me/links/alex-morgan");
  await page.evaluate((embedded) => (window as never as { mount: (e: boolean) => void }).mount(!!embedded), opts.embedded);
  await page.waitForSelector("h1");
  return page;
}

const CHIP = '[aria-label="What is Swift Links?"]';
const SHEET = '[aria-label="Create your own Swift Links"]';

/** On screen, in the viewport, opaque. */
async function visible(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.5 &&
      r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
  }, selector);
}

describe("Swift Links promo badge (real browser)", () => {
  it("chip sits at the top-left of the public page; tapping it opens the invite sheet", async () => {
    const page = await mount();
    expect(await visible(page, CHIP)).toBe(true);
    const box = (await page.locator(CHIP).boundingBox())!;
    expect(box.x).toBeLessThan(60);
    expect(box.y).toBeLessThan(60);

    await page.locator(CHIP).click();
    await page.waitForSelector(SHEET, { timeout: 8000 });
    expect(await visible(page, SHEET)).toBe(true);

    // The owner-dictated copy, verbatim.
    const text = await page.locator(SHEET).innerText();
    expect(text).toContain("Create your own Swift Links");
    expect(text).toContain("Comes with a SwiftCard and Swift Signature");
    expect(text).toContain("One link to share everything about you");
    expect(text).toContain("See how yours looks for free");
    expect(text).toContain("Explore more about SwiftCard");

    // CTA → the card/links creation flow; explore → the marketing site.
    expect(await page.locator(`${SHEET} a:has-text("See how yours looks")`).getAttribute("href"))
      .toBe("/cards/new?src=links_promo_badge");
    expect(await page.locator(`${SHEET} a:has-text("Explore more")`).getAttribute("href"))
      .toBe("https://swiftcard.me/?src=links_promo_badge");

    // Funnel event fired on open.
    const calls = await page.evaluate(() => (window as never as { calls: { url: string; body: { event_type?: string } | null }[] }).calls);
    expect(calls.some((c) => c.url.includes("/api/analytics/event") && c.body?.event_type === "links_badge_open")).toBe(true);

    await page.screenshot({ path: "node_modules/.cache/lbp-sheet.png" });
    await page.close();
  });

  it("the X dismisses the sheet; the chip stays for another look", async () => {
    const page = await mount();
    await page.locator(CHIP).click();
    await page.waitForSelector(SHEET);
    await page.locator(`${SHEET} [aria-label="Dismiss"]`).click();
    await page.waitForFunction((sel) => !document.querySelector(sel), SHEET, { timeout: 4000 });
    expect(await visible(page, CHIP)).toBe(true);
    await page.close();
  });

  it("never renders inside an embedded preview (the owner's editor)", async () => {
    const page = await mount({ embedded: true });
    expect(await page.locator(CHIP).count()).toBe(0);
    await page.close();
  });
});
