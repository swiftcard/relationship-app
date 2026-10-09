import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";
import { META } from "@/lib/template-style-presets";

// ── Admin → Users → "Create card for business", with Photo First ────────────
//
// Owner, 2026-10-09: Photo First's Original / Circle photo, and the panel
// colour behind a circle, belong everywhere a card is designed — including
// the admin page. This mounts the real admin Users screen, opens the create
// form, and uses it in Chromium and WebKit at a phone and a desktop width.

const ORIGIN = "https://sc.test";
const PANEL = META["photo-first"].surface!.presets;
let bundle: string;
let css: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "admincreate-"));
  writeFileSync(join(tmp, "nav-stub.tsx"), `
    export function useRouter() { return { push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return "/admin/users"; }
    export function useSearchParams() { return new URLSearchParams(); }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import UsersClient from "@/app/admin/users/UsersClient";
    createRoot(document.getElementById("root")!).render(h("main", { className: "sc-app min-h-screen bg-gray-950 px-4 py-6" }, h(UsersClient)));
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "next/navigation": join(tmp, "nav-stub.tsx"), "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

type Sent = { path: string; body: Record<string, unknown> | null };

async function open(engine: string, width: number): Promise<{ page: Page; sent: Sent[]; errors: string[] }> {
  const ctx = await browsers[engine].newContext({ viewport: { width, height: 900 }, ...(engine === "Chromium" && width < 600 ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  const sent: Sent[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === ORIGIN && url.pathname === "/") {
      return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><style>body{margin:0;background:#030712}</style></head><body class="sc-app"><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>` });
    }
    if (url.pathname === "/api/admin/users") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ users: [] }) });
    if (url.pathname.startsWith("/api/")) {
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(req.postData() || "null"); } catch { body = null; }
      sent.push({ path: url.pathname, body });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cardUrl: "https://swiftcard.me/card/dana" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`${ORIGIN}/`);
  await page.getByText("+ Create card for business").click();
  await page.waitForTimeout(300);
  return { page, sent, errors };
}

const modal = (page: Page) => page.locator("form").filter({ hasText: "Card template" });

/** Every control inside the modal and the screen; none on top of another. */
const layoutProblems = (page: Page) => page.evaluate(() => {
  const problems: string[] = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) problems.push("the page scrolls sideways");
  const form = [...document.querySelectorAll("form")].find((f) => f.textContent?.includes("Card template"))!;
  const box = form.getBoundingClientRect();
  const controls = [...form.querySelectorAll<HTMLElement>("button, input, select")].map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.width > 0);
  for (const { el, r } of controls) {
    const name = el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName;
    if (r.right > box.right + 0.5 || r.left < box.left - 0.5) problems.push(`"${name}" spills out of the form`);
    if (r.right > vw + 0.5) problems.push(`"${name}" is off screen`);
  }
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i].r, b = controls[j].r;
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) problems.push(`controls ${i} and ${j} overlap`);
  }
  return problems;
});

const RUNS: Array<[string, number]> = [["Chromium", 390], ["Chromium", 1280], ["WebKit", 390], ["WebKit", 1280]];

for (const [engine, width] of RUNS) {
  describe(`${engine} · ${width}px`, () => {
    it("Photo First offers Original or Circle; Circle opens the panel colours; the choice is sent", async () => {
      const { page, sent, errors } = await open(engine, width);
      const form = modal(page);
      await form.locator("input[placeholder='Jane Smith']").fill("Dana Ellis");
      await form.locator("input[placeholder='jane@company.com']").fill("dana@northbeam.com");
      const username = form.locator("input").nth(2);
      await username.fill("dana-ellis");

      // Only Photo First has a photo to shape.
      expect(await form.getByText("Photo", { exact: true }).count()).toBe(0);
      await form.locator("select").nth(1).selectOption("photo-first");
      const shape = form.locator("select").nth(2);
      expect(await shape.inputValue()).toBe("original");
      expect(await form.locator('button[aria-label="Color preset"]').count()).toBe(0);

      await shape.selectOption("circle");
      expect(await form.locator('button[aria-label="Color preset"]').count()).toBe(PANEL.length);
      await form.locator('button[aria-label="Color preset"]').nth(2).click();
      expect(await form.locator('button[aria-label="Color preset"]').nth(2).getAttribute("aria-pressed")).toBe("true");
      expect(await layoutProblems(page)).toEqual([]);
      if (process.env.SHOT_DIR) await form.screenshot({ path: `${process.env.SHOT_DIR}/admin-create-${engine}-${width}.png` });

      await form.locator('button[type="submit"]').click();
      await expect.poll(() => sent.filter((s) => s.path === "/api/admin/create-card").length).toBe(1);
      const body = sent.find((s) => s.path === "/api/admin/create-card")!.body!;
      expect(body.template).toBe("photo-first");
      expect(body.photoShape).toBe("circle");
      expect(body.surfaceColor).toBe(PANEL[2]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 90_000);

    it("switching to another template takes the Photo row away", async () => {
      const { page, errors } = await open(engine, width);
      const form = modal(page);
      await form.locator("select").nth(1).selectOption("photo-first");
      expect(await form.getByText("Photo", { exact: true }).count()).toBe(1);
      await form.locator("select").nth(1).selectOption("classic-pro");
      expect(await form.getByText("Photo", { exact: true }).count()).toBe(0);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 60_000);
  });
}
