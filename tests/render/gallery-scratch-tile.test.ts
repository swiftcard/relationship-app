import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── The homepage gallery's "Start from scratch" tile is the size of a card ───
//
// Owner, 2026-10-01: the dashed box must be "the same exact size" as the
// template cards above it, on the phone and the computer. (It had been a
// 150px-min box taller than the cards, then a banner across the whole row.)
// So: one grid cell, the template card's exact width and height, at every
// width, with "See how your card looks" un-clipped and inside the box.
// Measured in the real gallery (real templates, real CardScaler, real
// Tailwind), inside the homepage's own px-5 container.

const ORIGIN = "https://sc.test";
let browser: Browser;
let bundle: string;
let css: string;
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "scratchtile-"));
  writeFileSync(join(tmp, "nav-stub.tsx"), `
    export function useRouter() { return { push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return "/"; }
    export function useSearchParams() { return new URLSearchParams(); }
  `);
  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement } from "react";
    export default function Link(props: any) {
      const { href, children, prefetch, scroll, ...rest } = props;
      return createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children);
    }
    export function useLinkStatus() { return { pending: false }; }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement } from "react";
    import TemplateGallery from "@/components/site/TemplateGallery";
    createRoot(document.getElementById("root")!).render(
      createElement("div", { className: "max-w-7xl mx-auto px-5 sm:px-6" },
        createElement(TemplateGallery, { linkedinEnabled: false })));
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    alias: {
      "next/navigation": join(tmp, "nav-stub.tsx"),
      "next/link": join(tmp, "link-stub.tsx"),
      "@": resolve("src"),
    },
  });
  bundle = out.outputFiles[0].text;
  if (!bundle || bundle.length < 1000) throw new Error("TemplateGallery bundle is empty — the esbuild step failed");
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("homepage gallery: Start from scratch tile", () => {
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    it(`is exactly a template card's size at ${width}px`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route(`${ORIGIN}/**`, (route) =>
        new URL(route.request().url()).pathname === "/"
          ? route.fulfill({
              status: 200, contentType: "text/html",
              body: `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
                <body><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>`,
            })
          : route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
      );
      await page.goto(`${ORIGIN}/`);
      await page.waitForSelector("text=Start from scratch");
      await page.waitForTimeout(300); // CardScaler measures after mount

      const m = await page.evaluate(() => {
        const tile = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Start from scratch"))!;
        const box = (el: Element) => el.getBoundingClientRect();
        const templates = [...tile.parentElement!.children].filter((c) => c !== tile);
        const tileBox = box(tile.children[1]);
        const cards = templates.map((t) => box(t.children[1]));
        const lines = [...tile.children[1].querySelectorAll("p")].filter((p) => p.getClientRects().length > 0).map((p) => ({
          text: p.textContent, clipped: p.scrollWidth > p.clientWidth + 1,
          inside: box(p).left >= tileBox.left && box(p).right <= tileBox.right
            && box(p).top >= tileBox.top && box(p).bottom <= tileBox.bottom,
        }));
        return {
          tile: { left: tileBox.left, w: tileBox.width, h: tileBox.height },
          leftColumn: cards[0].left,
          cardW: { min: Math.min(...cards.map((c) => c.width)), max: Math.max(...cards.map((c) => c.width)) },
          cardH: { min: Math.min(...cards.map((c) => c.height)), max: Math.max(...cards.map((c) => c.height)) },
          title: tile.children[1].querySelector("p")?.textContent,
          lines,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
        };
      });

      expect(m.title).toBe("See how your card looks");
      expect(Math.abs(m.tile.left - m.leftColumn), "sits in a grid column").toBeLessThanOrEqual(1);
      expect(m.cardW.max - m.cardW.min, "templates share one width").toBeLessThanOrEqual(1);
      expect(m.cardH.max - m.cardH.min, "templates share one height").toBeLessThanOrEqual(1);
      expect(Math.abs(m.tile.w - m.cardW.min), `tile ${m.tile.w}px wide vs card ${m.cardW.min}px`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.tile.h - m.cardH.min), `tile ${m.tile.h}px tall vs card ${m.cardH.min}px`).toBeLessThanOrEqual(1);
      for (const l of m.lines) {
        expect(l.clipped, `"${l.text}" is clipped`).toBe(false);
        expect(l.inside, `"${l.text}" spills out of the tile`).toBe(true);
      }
      expect(m.overflowX, "no sideways page scroll").toBeLessThanOrEqual(0);

      // The button is outline-none: keyboard focus must still show (a ring).
      const ring = await page.evaluate(async () => {
        const tile = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Start from scratch"))!;
        const shadow = () => getComputedStyle(tile.children[1]).boxShadow;
        const before = shadow();
        (tile as HTMLElement & { focus(o?: { focusVisible?: boolean }): void }).focus({ focusVisible: true });
        await new Promise((r) => setTimeout(r, 250)); // past the 200ms transition
        return { before, after: shadow(), focused: document.activeElement === tile };
      });
      expect(ring.focused).toBe(true);
      expect(ring.after, "focus ring on keyboard focus").not.toBe(ring.before);
      await page.close();
    });
  }
});
