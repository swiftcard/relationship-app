import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS → PROFILE: WHERE THE FREE PERIOD'S DAYS LEFT LIVE.
//
// Owner, 2026-10-02: the dashboard bubble is for the account's first day only;
// after that the days left are here. The real GeneralSettings in Chromium with
// the app's real Tailwind, for every kind of free period, at phone and desktop
// width, light and dark — present, readable, nothing cut off, no price.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";
const DAY = 86_400_000;
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();

const CASES = [
  { name: "card trial", plan: "pro", freePeriod: { kind: "trial", planName: "Pro", endsAt: inDays(12), daysLeft: 12, isTrial: true, canceled: false }, label: "Free trial", value: /^12 days left · ends [A-Z][a-z]{2} \d{1,2}, \d{4}$/ },
  { name: "cancelled trial", plan: "pro", freePeriod: { kind: "trial", planName: "Pro", endsAt: inDays(2), daysLeft: 2, isTrial: true, canceled: true }, label: "Free trial", value: /^2 days left · cancelled, you won't be charged$/ },
  { name: "free Pro", plan: "pro", freePeriod: { kind: "grant", planName: "Pro", endsAt: inDays(1), daysLeft: 1, isTrial: false, canceled: false }, label: "Free Pro", value: /^1 day left · ends / },
  { name: "free Office", plan: "enterprise", freePeriod: { kind: "grant", planName: "Office", endsAt: inDays(25), daysLeft: 25, isTrial: false, canceled: false }, label: "Free Office", value: /^25 days left · ends / },
] as const;

let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "settings-free-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import GeneralSettings from "@/components/GeneralSettings";
    (window as any).mount = (props: any) => {
      createRoot(document.getElementById("root")!).render(
        h("main", { className: "sc-app min-h-screen bg-gray-950 p-4" },
          h(GeneralSettings, { email: "dana@example.com", cardCount: 1, isPro: true, defaultOpen: true, ...props })),
      );
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

describe("Settings → Profile shows the free period's days left", () => {
  for (const c of CASES) {
    for (const width of [390, 1280]) {
      for (const theme of ["light", "dark"] as const) {
        it(`${c.name}, ${width}px, ${theme}`, async () => {
          const ctx = await browser.newContext({ viewport: { width, height: 844 } });
          const page = await ctx.newPage();
          try {
            await page.route(`${ORIGIN}/`, (r) => r.fulfill({
              status: 200, contentType: "text/html",
              body: `<!doctype html><html${theme === "light" ? ' data-sc-theme="light"' : ""}><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
                     <body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`,
            }));
            await page.goto(`${ORIGIN}/`);
            await page.evaluate((p) => (window as unknown as { mount: (x: unknown) => void }).mount(p), { plan: c.plan, freePeriod: c.freePeriod });
            const label = page.getByText(c.label, { exact: true });
            await label.waitFor();
            const value = label.locator("xpath=following-sibling::span[1]");
            expect((await value.innerText()).trim()).toMatch(c.value);
            const text = await page.locator("main").innerText();
            expect(text, "a price in Settings → Profile").not.toMatch(/\$\d/);
            const l = await page.evaluate(() => {
              const spans = [...document.querySelectorAll("main span")];
              return {
                overflowX: document.documentElement.scrollWidth > window.innerWidth,
                clipped: spans.filter((s) => (s as HTMLElement).scrollWidth > (s as HTMLElement).clientWidth + 1 && getComputedStyle(s).overflow !== "visible").map((s) => s.textContent),
              };
            });
            expect(l.overflowX).toBe(false);
            expect(l.clipped.filter((t) => t && !t.includes("@"))).toEqual([]);
            if (process.env.SHOT_DIR) await page.screenshot({ path: join(process.env.SHOT_DIR, `settings-${c.name.replace(/ /g, "-")}-${width}-${theme}.png`) });
          } finally { await ctx.close(); }
        });
      }
    }
  }

  it("no free period: no row", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    try {
      await page.route(`${ORIGIN}/`, (r) => r.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head><style>${css}</style></head><body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>` }));
      await page.goto(`${ORIGIN}/`);
      await page.evaluate(() => (window as unknown as { mount: (x: unknown) => void }).mount({ plan: "pro", freePeriod: null }));
      await page.getByText("Plan", { exact: true }).waitFor();
      expect(await page.getByText(/days left/).count()).toBe(0);
    } finally { await ctx.close(); }
  });
});
