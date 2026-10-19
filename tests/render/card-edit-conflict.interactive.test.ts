import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// ── Saved somewhere else: the real Edit card asks (audit C02-006) ───────────
//
// Two devices editing one card used to overwrite each other in silence, and
// the losing one still said "Saved". Now the server refuses a save made over
// a newer card (409 CARD_CHANGED_ELSEWHERE) and the editor shows why, with
// "Reload the latest" and "Save mine anyway". This drives the REAL editor in
// Chromium and WebKit, at a phone and a desktop width, against a fake server
// that refuses the first save.

const ORIGIN = "https://sc.test";
let bundle: string;
let css: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "editconflict-"));
  writeFileSync(join(tmp, "nav-stub.tsx"), `
    export function useRouter() { return { push(u: string) { (window as any).__pushed = u; }, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return "/cards/c1/edit"; }
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
    import { createElement as h } from "react";
    import CardEditForm from "@/app/cards/[id]/edit/CardEditForm";
    (window as any).mount = (props: any) => {
      createRoot(document.getElementById("root")!).render(
        h("main", { className: "sc-app min-h-screen bg-gray-950 px-5 py-10" }, h("div", { className: "max-w-4xl mx-auto" }, h(CardEditForm, props))),
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
  if (!bundle || bundle.length < 1000) throw new Error("editor bundle is empty — the esbuild step failed");
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const CARD = {
  id: "c1", username: "dana-ellis", name: "Dana Ellis", title: "Principal Broker", company: "Northbeam Group",
  email: "dana@northbeam.com", phone: "(415) 555-0192", website: "northbeam.com",
  linkedin: "", instagram: "", twitter: "", tiktok: "", template: "classic-pro",
  customization: { bio: "Principal broker helping Bay Area families buy and sell." } as Record<string, unknown>,
};

type Save = Record<string, unknown>;

async function rig(engine: string, width: number) {
  const ctx = await browsers[engine].newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const saves: Save[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === ORIGIN && url.pathname === "/") {
      return route.fulfill({
        status: 200, contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
          <style>${css}</style><style>body{margin:0;background:#0b0f16}</style></head>
          <body class="sc-app"><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>`,
      });
    }
    if (url.pathname === "/api/cards/c1" && req.method() === "PATCH") {
      const body = JSON.parse(req.postData() || "{}") as Save;
      saves.push(body);
      // The card moved on since "v1" was loaded — unless the person said so.
      if (body.baseVersion === "v1" && body.force !== true) {
        return route.fulfill({
          status: 409, contentType: "application/json",
          body: JSON.stringify({ code: "CARD_CHANGED_ELSEWHERE", error: "changed_elsewhere", message: "This card was changed on another device or tab after you opened it. Saving now would replace those changes." }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, slug: "dana-ellis", version: "v2" }) });
    }
    if (url.pathname.startsWith("/api/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, available: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`${ORIGIN}/`);
  return { page, saves, errors };
}

async function mount(page: Page, props: Record<string, unknown>) {
  await page.evaluate((p) => (window as unknown as { mount: (p: unknown) => void }).mount(p), props);
  await page.waitForTimeout(900);
}

async function clickButton(page: Page, label: string) {
  const btn = page.locator(`button:visible:has-text("${label}")`).first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForTimeout(700);
}

for (const engine of ["Chromium", "WebKit"]) {
  for (const width of [390, 1280]) {
    describe(`${engine} · ${width}px`, () => {
      it("a save over a newer card is refused, says why, and Save mine anyway goes through", async () => {
        const { page, saves, errors } = await rig(engine, width);
        await mount(page, { card: CARD, isPro: true, editVersion: "v1" });

        await clickButton(page, "Save changes");
        expect(saves).toHaveLength(1);
        expect(saves[0].baseVersion).toBe("v1");
        expect(saves[0].force).toBeUndefined();

        const box = page.locator('[role="alert"]', { hasText: "changed on another device or tab" });
        await expect(box.isVisible()).resolves.toBe(true);
        // Nothing claims it saved, and the way forward is on screen, inside the screen.
        expect(await page.locator("button:visible", { hasText: "Saved!" }).count()).toBe(0);
        for (const label of ["Reload the latest", "Save mine anyway"]) {
          const b = page.locator(`button:visible:has-text("${label}")`).first();
          await b.scrollIntoViewIfNeeded();
          const r = await b.boundingBox();
          expect(r, label).not.toBeNull();
          expect(r!.x).toBeGreaterThanOrEqual(0);
          expect(r!.x + r!.width).toBeLessThanOrEqual(width);
          expect(r!.height).toBeGreaterThanOrEqual(24);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        await clickButton(page, "Save mine anyway");
        expect(saves).toHaveLength(2);
        expect(saves[1].baseVersion).toBe("v1");
        expect(saves[1].force).toBe(true);
        // The same card went: the second save carries what the first did.
        expect(saves[1].name).toBe(saves[0].name);
        expect(saves[1].customization).toEqual(saves[0].customization);
        expect(await box.count()).toBe(0);
        expect(errors).toEqual([]);
        await page.context().close();
      }, 90_000);

      it("a save with nothing saved elsewhere goes straight through, with its version and no prompt", async () => {
        const { page, saves, errors } = await rig(engine, width);
        await mount(page, { card: CARD, isPro: true, editVersion: "v2" });
        await clickButton(page, "Save changes");
        expect(saves).toHaveLength(1);
        expect(saves[0].baseVersion).toBe("v2");
        expect(await page.locator('[role="alert"]', { hasText: "changed on another device" }).count()).toBe(0);
        expect(errors).toEqual([]);
        await page.context().close();
      }, 90_000);
    });
  }
}
