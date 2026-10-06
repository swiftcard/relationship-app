import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── The homepage "Start from scratch" builder opens Custom design for AI ─────
//
// Owner, 2026-09-18: Custom design appears on every card-design screen. Since
// 901ca554 (2026-09-30) the real builder opens it for someone building their
// FIRST card — AI design works, "Copy a card or template you like" keeps its
// PRO tag and stays locked. Owner, 2026-10-02: the homepage builder must match
// the real builder. Driven for real: open the builder, walk to "Make it
// yours", open Custom design, look.

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
  tmp = mkdtempSync(join(cache, "homecustom-"));
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
    import CardMiniBuilder from "@/components/site/CardMiniBuilder";
    createRoot(document.getElementById("root")!).render(createElement(CardMiniBuilder, { linkedinEnabled: false }));
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
  if (!bundle || bundle.length < 1000) throw new Error("CardMiniBuilder bundle is empty — the esbuild step failed");
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("homepage card builder", () => {
  for (const width of [390, 1280]) {
    it(`opens Custom design with AI design, Copy still PRO, at ${width}px`, async () => {
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
      await page.click("text=Start from scratch");
      // Walk forward to "Make it yours" (the design step).
      for (let i = 0; i < 6 && !(await page.$("button[aria-label^='Custom design']")); i++) {
        const inputs = page.locator("input[type=text], input:not([type])");
        if ((await inputs.count()) && !(await inputs.first().inputValue())) await inputs.first().fill("Alex Morgan");
        await page.click("button:has-text('Continue')");
        await page.waitForTimeout(300);
      }
      expect(await page.$("button[aria-label='Custom design (Pro, locked)']")).toBeNull();
      const row = await page.$("button[aria-label='Custom design']");
      expect(row, "the open Custom design row").not.toBeNull();
      expect(await row!.isDisabled()).toBe(false);
      await row!.click();
      // The real designer: AI design open, Copy locked with its PRO tag.
      const ai = page.locator("button", { hasText: "AI design" }).first();
      await ai.waitFor({ timeout: 5_000 });
      expect(await ai.isDisabled()).toBe(false);
      const copy = page.locator("button", { hasText: "Copy a card or template you like" }).first();
      expect(await copy.isDisabled()).toBe(true);
      expect(await copy.innerText()).toContain("PRO");
      // The colour/font steps give way to the designer, as in the real builder.
      expect(await page.innerText("#root")).not.toContain("unlock the custom designer with Pro");
      // Nothing spills sideways at either width.
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await page.close();
    });
  }
});
