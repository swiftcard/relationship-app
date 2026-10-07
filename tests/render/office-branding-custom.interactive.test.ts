import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── Office Branding: a custom design for the whole team, clicked for real ────
//
// Owner, 2026-09-18: Custom design shows on every card-design screen, and an
// Office admin may set one as the look the whole team inherits. This bundles
// the REAL OfficeBranding page, answers its network calls here, and clicks:
// the row is open, it opens the card editor's own designer in TEAM mode, the
// save carries the layout — and nothing ever shows or saves an image with one
// person's details baked into it.

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
  tmp = mkdtempSync(join(cache, "officecustom-"));
  writeFileSync(join(tmp, "nav-stub.tsx"), `
    export function useRouter() { return { push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return "/office/admin/branding"; }
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
    import OfficeBranding from "@/components/OfficeBranding";
    (window as any).mount = (office: any) => {
      createRoot(document.getElementById("root")!).render(
        createElement("div", { className: "sc-app p-4" }, createElement(OfficeBranding, { office })),
      );
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    // The logo uploader's cropper imports its own stylesheet; the app's CSS is
    // injected separately, and the cropper is not what this test is about.
    loader: { ".css": "empty" },
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://example.supabase.co"',
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"anon"',
      "process.env.NEXT_PUBLIC_APP_URL": '"https://sc.test"',
      "process.env.NEXT_PUBLIC_APP_STORE_URL": "undefined",
      "process.env.NEXT_PUBLIC_APP_STORE_ID": "undefined",
      "process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY": "undefined",
    },
    alias: {
      "next/navigation": join(tmp, "nav-stub.tsx"),
      "next/link": join(tmp, "link-stub.tsx"),
      "@": resolve("src"),
    },
  });
  bundle = out.outputFiles[0].text;
  if (!bundle || bundle.length < 1000) throw new Error("OfficeBranding bundle is empty — the esbuild step failed");
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const FACE = "https://example.supabase.co/storage/v1/object/public/cards/owner-face.png";

async function rig(office: Record<string, unknown>, width = 1280): Promise<{ page: Page; saves: Array<Record<string, unknown>> }> {
  const ctx = await browser.newContext({ viewport: { width, height: 1400 } });
  const page = await ctx.newPage();
  const saves: Array<Record<string, unknown>> = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === ORIGIN && url.pathname === "/") {
      return route.fulfill({
        status: 200, contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
          <style>body{margin:0;background:#0b0f16}</style></head>
          <body><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>`,
      });
    }
    if (url.pathname === "/api/office/brand" && req.method() === "PATCH") {
      saves.push(JSON.parse(req.postData() || "{}"));
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    // Everything else (logo suggestions, images): answered empty, never the internet.
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((o) => (window as unknown as { mount: (x: unknown) => void }).mount(o), office);
  await page.locator("button[aria-pressed]:visible").first().waitFor();
  return { page, saves };
}

const BASE = { brand_company: "Northwind Partners", brand_website: "northwind.com", brand_template: "classic-pro", brand_locks: { template: true } };

describe("Office Branding offers a custom design for the whole team", () => {
  it("the row is there and OPEN — no PRO tag, no lock", async () => {
    const { page } = await rig(BASE);
    const row = await page.$("button[aria-label='Custom design']");
    expect(row).not.toBeNull();
    expect(await row!.isDisabled()).toBe(false);
    expect(await page.$$eval("[data-ds='badge']", (els) => els.length)).toBe(0);
    await page.context().close();
  });

  it("choosing it opens the designer in team mode, in place of the style steps", async () => {
    const { page } = await rig(BASE);
    expect(await page.locator("text=Copy a card or template you like").count()).toBe(0);
    await page.click("button[aria-label='Custom design']");
    await page.waitForSelector("text=Copy a card or template you like");
    // Team words: the layout, filled with each teammate's own details.
    // innerText of the page, not textContent of <body>: the body also holds the
    // bundled script, whose source contains every string the designer can show.
    const seen = await page.innerText("#root");
    expect(seen).toContain("every teammate's card fills it with their own details");
    expect(seen).not.toContain("with YOUR details on it");
    await page.context().close();
  });

  it("saves the layout with the brand — and never a face image", async () => {
    const { page, saves } = await rig(BASE);
    await page.click("button[aria-label='Custom design']");
    await page.waitForSelector("text=Copy a card or template you like");
    await page.click("text=Save & apply to team cards");
    await page.waitForSelector("text=Applied to your team's cards");
    expect(saves).toHaveLength(1);
    expect(saves[0].template).toBe("custom");
    const layout = saves[0].customLayout as Record<string, unknown>;
    expect(layout && typeof layout).toBe("object");
    expect(Array.isArray(layout.blocks)).toBe(true);
    expect("faceImage" in layout).toBe(false);
    await page.context().close();
  });

  it("a brand seeded from an owner's exact-copy card never shows that picture to the team", async () => {
    const { page, saves } = await rig({ ...BASE, brand_template: "custom", brand_custom_layout: { faceImage: FACE, blocks: [] } });
    await page.waitForSelector("text=Copy a card or template you like");
    expect(await page.$$eval(`img[src="${FACE}"]`, (els) => els.length)).toBe(0);
    await page.click("text=Save & apply to team cards");
    await page.waitForSelector("text=Applied to your team's cards");
    expect("faceImage" in (saves[0].customLayout as object)).toBe(false);
    await page.context().close();
  });

  it("switching back to a template saves no layout", async () => {
    const { page, saves } = await rig({ ...BASE, brand_template: "custom" });
    await page.click("button[aria-label='Modern Bold']");
    await page.click("text=Save & apply to team cards");
    await page.waitForSelector("text=Applied to your team's cards");
    expect(saves[0].template).toBe("modern-bold");
    expect("customLayout" in saves[0]).toBe(false);
    await page.context().close();
  });

  it("fits a phone", async () => {
    const { page } = await rig(BASE, 360);
    await page.click("button[aria-label='Custom design']");
    await page.waitForSelector("text=Copy a card or template you like");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.context().close();
  });
});
