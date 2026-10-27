import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { chromium, webkit, type Browser, type Page } from "playwright";
import type { ReactElement } from "react";
import { appCss } from "./harness";

// ── The site admin (/admin), measured ───────────────────────────────────────
//
// The owner asked for the console to be light and "very organized and also
// visually organized" (2026-10-27). Neither can be checked by reading the
// source: a sidebar that spills, a tab row that drags the page sideways on a
// phone, a card that pokes past the screen edge, or a canvas that came out
// dark are all layout facts. So every admin page is rendered from its real
// components, inside the real shell, with the app's real CSS (globals.css +
// admin.css), at a phone and a computer width, in Chromium and WebKit, and
// measured.

const nav = vi.hoisted(() => ({ pathname: "/admin" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

let css = "";
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = (await appCss()) + readFileSync("src/app/admin/admin.css", "utf8");
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
});

/** The page's markup inside the real AdminShell, as the server would send it. */
async function inShell(pathname: string, page: ReactElement): Promise<string> {
  nav.pathname = pathname;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { default: AdminShell } = await import("@/app/admin/AdminShell");
  return renderToStaticMarkup(createElement(AdminShell, { email: "hello@swiftcard.me" }, page));
}

async function open(engine: string, width: number, markup: string): Promise<Page> {
  const page = await browsers[engine].newPage({ viewport: { width, height: 900 } });
  // data-sc-theme="light" is what ForceLightTheme / the boot script set.
  await page.setContent(
    `<!doctype html><html data-sc-theme="light"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1">
     <style>${css}</style><style>body{margin:0}</style></head><body>${markup}</body></html>`,
    { waitUntil: "load" },
  );
  await page.waitForTimeout(100);
  return page;
}

/** Nothing scrolls the page sideways, and no card, header or heading pokes past the screen. */
async function layoutProblems(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const spill: string[] = [];
    document.querySelectorAll(".adm-card, .adm-notracked, aside, header, h1, h2, .adm-tabs, main").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) spill.push(`${el.tagName}.${String(el.className).slice(0, 60)} → ${Math.round(r.left)}..${Math.round(r.right)}`);
    });
    return { sideways: document.documentElement.scrollWidth > vw, spill };
  });
}

const ENGINES = ["Chromium", "WebKit"] as const;

async function sandbox() {
  const { createElement } = await import("react");
  const { default: PlansClient } = await import("@/app/admin/plans/PlansClient");
  return inShell("/admin/plans", createElement(PlansClient, { userId: "u-admin", email: "hello@swiftcard.me", initialPlan: "pro" }));
}

describe.each(ENGINES)("the admin shell (%s)", (engine) => {
  it("is light: the canvas is the app's grouped grey, cards are white", async () => {
    const page = await open(engine, 1280, await sandbox());
    try {
      const bg = await page.evaluate(() => ({
        canvas: getComputedStyle(document.querySelector(".sc-admin")!).backgroundColor,
        card: getComputedStyle(document.querySelector(".adm-card")!).backgroundColor,
      }));
      expect(bg.canvas).toBe("rgb(242, 242, 247)");
      expect(bg.card).toBe("rgb(255, 255, 255)");
    } finally { await page.close(); }
  });

  it("shows the sidebar on a computer, grouped, with the current section marked", async () => {
    const page = await open(engine, 1280, await sandbox());
    try {
      const s = await page.evaluate(() => {
        const aside = document.querySelector("aside")!;
        const menu = document.querySelector("summary")!;
        return {
          sidebar: getComputedStyle(aside).display !== "none" && aside.getBoundingClientRect().width > 200,
          menuHidden: menu.getBoundingClientRect().width === 0,
          groups: [...aside.querySelectorAll(".adm-nav-group")].map((g) => g.textContent),
          current: aside.querySelector('[aria-current="page"]')?.textContent,
        };
      });
      expect(s.sidebar).toBe(true);
      expect(s.menuHidden).toBe(true);
      expect(s.groups).toEqual(["Business", "Tools"]);
      expect(s.current).toBe("Sandbox");
    } finally { await page.close(); }
  });

  it("puts the same list behind Menu on a phone, inside the screen", async () => {
    const page = await open(engine, 390, await sandbox());
    try {
      expect(await page.locator("aside").isVisible()).toBe(false);
      const summary = page.locator("summary", { hasText: "Menu" });
      expect(await summary.isVisible()).toBe(true);
      expect(await page.locator(".adm-menu-panel").isVisible()).toBe(false);
      await summary.click();
      const panel = page.locator(".adm-menu-panel");
      await panel.waitFor({ state: "visible" });
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      for (const label of ["Overview", "Users", "Company Analytics", "Website", "Marketing", "Agents", "Sandbox"]) {
        expect(await panel.getByRole("link", { name: label, exact: true }).isVisible(), label).toBe(true);
      }
      // Every item is a real tap target.
      const heights = await panel.locator(".adm-nav-item").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    } finally { await page.close(); }
  });

  for (const width of [390, 1280]) {
    it(`lays the Sandbox out with nothing spilling at ${width}px`, async () => {
      const page = await open(engine, width, await sandbox());
      try {
        const p = await layoutProblems(page);
        expect(p.spill, `spills at ${width}px`).toEqual([]);
        expect(p.sideways, `the page scrolls sideways at ${width}px`).toBe(false);
        const text = await page.evaluate(() => document.body.innerText);
        for (const s of ["Sandbox", "Switch your plan", "Try it as this plan", "What each plan unlocks", "Open dashboard as Pro"]) expect(text).toContain(s);
      } finally { await page.close(); }
    });
  }
});
