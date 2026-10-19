import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── BOTH PUBLIC-PAGE INVITES, RENDERED AND MEASURED ─────────────────────────
//
// Owner, 2026-09-23: on a Swift Links page, whatever the visitor presses must
// open "the exact same pop-up" as the corner badge; the SwiftCard invite's
// button says "See how yours looks — free" and shows a realistic card. "This
// is how we're going to be getting a lot of new clients" — so this drives the
// REAL components in Chromium with the app's compiled Tailwind at a small
// phone, a normal phone and a desktop, and measures what a visitor sees.
//
// Set SHOT_DIR to keep a screenshot of every state for a human to look at.

let browser: Browser;
let bundle: string;
let tmp: string;
const SHOT_DIR = process.env.SHOT_DIR;

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "invites-"));
  writeFileSync(
    join(tmp, "entry.tsx"),
    `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import SignupNudgeHost from "@/components/SignupNudgeHost";
    import SwiftLinksPromoBadge from "@/components/SwiftLinksPromoBadge";
    import { triggerSignupNudge } from "@/lib/nudge";

    (window as any).calls = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = (async (input: any, init: any) => {
      const url = String(typeof input === "string" ? input : input?.url ?? "");
      (window as any).calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/api/account-exists")) {
        return new Response(JSON.stringify({ exists: false }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.startsWith("/api/")) return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      return realFetch(input, init);
    }) as any;

    (window as any).fire = (src: string) => triggerSignupNudge(src);
    (window as any).mount = (variant: "card" | "links") => {
      const root = createRoot(document.getElementById("root")!);
      root.render(h("div", { style: { position: "relative", height: "300px" } },
        variant === "links" ? h(SwiftLinksPromoBadge, { username: "alex", appUrl: "https://swiftcard.me" }) : null,
        h(SignupNudgeHost, { cardUsername: "alex", variant }),
      ));
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
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function mount(variant: "card" | "links", width: number): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 780 : 900 });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;background:#FAF7F2}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`;
  // A real https origin (localStorage works), and the example card's photo
  // served from public/ exactly as the site serves it.
  await page.route("https://swiftcard.me/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = resolve("public", "." + path);
    if (path !== "/" && existsSync(file)) {
      return route.fulfill({ status: 200, contentType: path.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream", body: readFileSync(file) });
    }
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  });
  await page.goto("https://swiftcard.me/alex");
  await page.evaluate((v) => (window as never as { mount: (v: string) => void }).mount(v), variant);
  return page;
}

const fire = (page: Page, src: string) => page.evaluate((s) => (window as never as { fire: (s: string) => void }).fire(s), src);
const shot = async (page: Page, name: string) => { if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) }); };

/** The sheet panel is on screen, inside the viewport, with nothing past the page edge. */
async function panelFits(page: Page, label: string) {
  return page.evaluate((l) => {
    const dlg = document.querySelector(`[aria-label="${l}"]`) as HTMLElement | null;
    const panel = dlg?.firstElementChild as HTMLElement | null;
    if (!panel) return { ok: false, why: "no panel" };
    const r = panel.getBoundingClientRect();
    const overflow = document.documentElement.scrollWidth > window.innerWidth;
    return {
      ok: r.left >= 0 && r.right <= window.innerWidth + 0.5 && r.top >= 0 && r.bottom <= window.innerHeight + 0.5 && !overflow,
      why: JSON.stringify({ l: r.left, r: r.right, t: r.top, b: r.bottom, w: window.innerWidth, h: window.innerHeight, overflow }),
    };
  }, label);
}

const WIDTHS = [320, 390, 1280];

describe("the SwiftCard invite on a card page", () => {
  for (const width of WIDTHS) {
    it(`at ${width}px: says "See how yours looks — free", shows a real card, and fits`, async () => {
      const page = await mount("card", width);
      await page.waitForTimeout(300);
      await fire(page, "vcard");
      await page.waitForSelector('[aria-label="Create your own SwiftCard"]');
      // The example card: the real template, with its photo actually loaded.
      await page.waitForFunction(() => {
        const img = document.querySelector('[aria-label="Create your own SwiftCard"] img[src*="simone.jpg"]') as HTMLImageElement | null;
        return !!img && img.complete && img.naturalWidth > 0;
      }, undefined, { timeout: 15000 });
      await page.waitForTimeout(700); // the entrance animation
      const cta = page.locator('[aria-label="Create your own SwiftCard"] a[href^="/cards/new"]');
      // The example is a picture: its real card links (tel:, mailto:) can be
      // neither focused nor clicked.
      expect(await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('[aria-label="Create your own SwiftCard"] a')) as HTMLElement[];
        return links.filter((l) => !l.closest("[inert]")).map((l) => l.getAttribute("href"));
      })).toEqual(["/cards/new?src=vcard"]);
      expect((await cta.innerText()).trim()).toBe("See how yours looks — free");
      expect(await cta.getAttribute("href")).toBe("/cards/new?src=vcard");
      const example = await page.evaluate(() => {
        const t = document.querySelector('[aria-label="Create your own SwiftCard"]')!.textContent ?? "";
        const img = document.querySelector('[aria-label="Create your own SwiftCard"] img[src*="simone.jpg"]')!.getBoundingClientRect();
        const el = document.querySelector('[aria-label="Create your own SwiftCard"] img[src*="simone.jpg"]')!;
        return { hasName: t.includes("Simone Adler"), hasCompany: t.includes("Adler & Grant LLP"), imgW: img.width, imgH: img.height, radius: getComputedStyle(el).borderTopLeftRadius, stub: t.includes("Your Name") };
      });
      expect(example.hasName).toBe(true);
      expect(example.hasCompany).toBe(true);
      expect(example.stub).toBe(false);
      expect(example.imgW).toBeGreaterThan(40);
      expect(example.imgH).toBeGreaterThan(40);
      // Owner, 2026-10-19: the headshot is a circle — square box, fully rounded.
      expect(Math.abs(example.imgW - example.imgH)).toBeLessThan(1.5);
      expect(parseFloat(example.radius)).toBeGreaterThanOrEqual(example.imgW / 2 - 1);
      const fit = await panelFits(page, "Create your own SwiftCard");
      expect(fit.ok, fit.why).toBe(true);
      await shot(page, `card-invite-${width}`);
      await page.close();
    });
  }
});

describe("a Swift Links page: every invite IS the corner badge's sheet", () => {
  for (const width of WIDTHS) {
    it(`at ${width}px: a link tap opens the same sheet as the badge, word for word, and both fit and close`, async () => {
      const page = await mount("links", width);
      await page.waitForTimeout(300);
      await fire(page, "link_button");
      const dlg = page.locator('[aria-label="Create your own Swift Links"]');
      await dlg.waitFor();
      await page.waitForTimeout(700);
      const fromMoment = (await dlg.innerText()).replace(/\s+/g, " ").trim();
      expect(fromMoment).toContain("See how yours looks — free");
      expect(await dlg.locator("a").first().getAttribute("href")).toBe("/cards/new?src=link_button");
      // No SwiftCard invite on a Swift Links page.
      expect(await page.locator('[aria-label="Create your own SwiftCard"]').count()).toBe(0);
      const fit1 = await panelFits(page, "Create your own Swift Links");
      expect(fit1.ok, fit1.why).toBe(true);
      await shot(page, `links-invite-${width}`);

      // ✕ closes it.
      await dlg.getByRole("button", { name: "Dismiss" }).click();
      await page.waitForTimeout(500);
      expect(await dlg.count()).toBe(0);

      // The corner badge opens the very same sheet.
      await page.getByRole("button", { name: "What is Swift Links?" }).click();
      await dlg.waitFor();
      await page.waitForTimeout(700);
      const fromBadge = (await dlg.innerText()).replace(/\s+/g, " ").trim();
      expect(fromBadge).toBe(fromMoment);
      expect(await dlg.locator("a").first().getAttribute("href")).toBe("/cards/new?src=links_promo_badge");
      const fit2 = await panelFits(page, "Create your own Swift Links");
      expect(fit2.ok, fit2.why).toBe(true);
      await shot(page, `links-badge-${width}`);

      // Escape closes it.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      expect(await dlg.count()).toBe(0);
      await page.close();
    });
  }

  it("a Swift Links page never loads the SwiftCard example", async () => {
    const page = await mount("links", 390);
    await page.waitForTimeout(2500); // past the idle warm-up
    await fire(page, "vcard");
    await page.locator('[aria-label="Create your own Swift Links"]').waitFor();
    await page.waitForTimeout(600);
    expect(await page.locator('img[src*="simone.jpg"]').count()).toBe(0);
    await page.close();
  });
});
