import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// ── "Link to your business card" in the REAL editors (owner, 2026-11-06) ────
//
// The "View Contact Info →" link moved from the bottom of the Swift Links page
// to right under the Connect button. The owner's other half of the order: it
// must still work perfectly with the switch. tests/render/swiftlink-contact-
// link measures the page on its own; this drives the switch where people meet
// it — Edit card → Social design and the Add card builder's Social design step
// — in Chromium and WebKit (Safari and the iPhone app) at a phone width and a
// computer width, and checks both halves:
//
//   • the live preview: on → the link is there, under Connect, above the
//     links; off → it is gone;
//   • what Save actually SENDS: off → hideCardLink: true; back on → null
//     (the editor clears it), and a fresh card that keeps it on sends nothing.
//
// Same rig as link-list-real-editors: the real screens bundled with esbuild,
// /api answered locally, nothing reaches the internet.

const ORIGIN = "https://sc.test";
let bundle: string;
let css: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "contact-link-switch-"));
  writeFileSync(join(tmp, "nav-stub.tsx"), `
    export function useRouter() { return { push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
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
    import NewCardWizard from "@/app/cards/new/NewCardWizard";
    const FRAMES: any = {
      edit: (c: any) => h("main", { className: "sc-app min-h-screen bg-gray-950 px-5 py-10" }, h("div", { className: "max-w-4xl mx-auto" }, c)),
      wizard: (c: any) => c,
    };
    const SCREENS: any = { edit: CardEditForm, wizard: NewCardWizard };
    (window as any).mount = (screen: string, props: any) => {
      createRoot(document.getElementById("root")!).render(FRAMES[screen](h(SCREENS[screen], props)));
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
    logLevel: "error",
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

type Call = { method: string; path: string; body: Record<string, unknown> | null };

async function rig(engine: string, width: number, opts: { prefill?: Record<string, unknown>; signedIn?: boolean } = {}) {
  const ctx = await browsers[engine].newContext({
    viewport: { width, height: 900 },
    ...(engine === "Chromium" && width < 600 ? { hasTouch: true, isMobile: true } : {}),
  });
  if (opts.signedIn) await ctx.addCookies([{ name: "sb-example-auth-token", value: "qa", url: ORIGIN }]);
  const page = await ctx.newPage();
  const calls: Call[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === ORIGIN && url.pathname === "/") {
      return route.fulfill({
        status: 200, contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
          <style>body{margin:0;background:#0b0f16}</style></head>
          <body class="sc-app"><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>`,
      });
    }
    if (url.pathname.startsWith("/api/")) {
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(req.postData() || "null"); } catch { body = null; }
      calls.push({ method: req.method(), path: url.pathname, body });
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, available: true, id: "c1", username: "dana-ellis", card: { id: "c1", username: "dana-ellis" } }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  if (opts.prefill) {
    await page.addInitScript((p) => { try { localStorage.setItem("swiftcard_prefill", JSON.stringify(p)); } catch {} }, opts.prefill);
  }
  await page.goto(`${ORIGIN}/`);
  return { page, calls, errors };
}

async function mount(page: Page, screen: "edit" | "wizard", props: Record<string, unknown>) {
  await page.evaluate(([s, p]) => (window as unknown as { mount: (s: string, p: unknown) => void }).mount(s as string, p), [screen, props] as const);
  await page.waitForTimeout(900);
}

async function clickButton(page: Page, label: string) {
  const btn = page.locator(`button:visible:has-text("${label}")`).first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForTimeout(500);
}

const theSwitch = (page: Page) => page.getByRole("switch", { name: "Link to your business card" });

async function flip(page: Page) {
  const sw = theSwitch(page);
  await sw.scrollIntoViewIfNeeded();
  await sw.click();
  await page.waitForTimeout(300);
}

/**
 * Every live preview of the Swift Links page on screen (a phone pins one at
 * the top; a computer shows it in the right-hand column), and where the card
 * link sits in each: after Connect and before the first link tile, in both
 * DOM order and on screen.
 */
async function previews(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const s = getComputedStyle(el as HTMLElement);
      const r = (el as HTMLElement).getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    return [...document.querySelectorAll(".sc-sl-body")].filter(visible).map((body) => {
      const connect = [...body.querySelectorAll("button")].find((b) => /Connect with/.test(b.textContent || ""));
      const link = body.querySelector('a[href*="source=swift_links"]');
      const anchor = body.querySelector('[data-sl-section="links"]');
      const tiles = anchor?.nextElementSibling ?? null;
      const firstTile = tiles ? [...tiles.children].find((c) => c.tagName !== "STYLE") ?? null : null;
      const r = (e: Element | null | undefined) => (e ? e.getBoundingClientRect() : null);
      const c = r(connect), l = r(link), t = r(firstTile);
      const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        hasLink: !!link,
        label: link?.textContent?.trim() ?? null,
        href: link?.getAttribute("href") ?? null,
        afterConnect: !!(link && connect && before(connect, link) && c && l && l.top >= c.bottom - 0.5),
        aboveTiles: !firstTile || !!(link && before(link, firstTile) && l && t && l.bottom <= t.top + 0.5),
      };
    });
  });
}

const saves = (calls: Call[], path: string) => calls.filter((c) => c.path === path && c.method !== "GET" && c.body);
const sentCustomization = (calls: Call[], path: string) =>
  (saves(calls, path).at(-1)?.body?.customization ?? {}) as Record<string, unknown>;

const CARD = {
  id: "c1", username: "dana-ellis", name: "Dana Ellis", title: "Principal Broker", company: "Northbeam Group",
  email: "dana@northbeam.com", phone: "(415) 555-0192", website: "northbeam.com",
  linkedin: "", instagram: "", twitter: "", tiktok: "",
  template: "classic-pro",
  customization: {
    bio: "Principal broker helping Bay Area families buy and sell.",
    links: [{ label: "My YouTube", url: "https://youtube.com/@dana" }, { label: "Shop now", url: "https://dana.shop" }],
  } as Record<string, unknown>,
};

const RUNS: Array<[string, number]> = [["Chromium", 390], ["Chromium", 1280], ["WebKit", 390], ["WebKit", 1280]];

for (const [engine, width] of RUNS) {
  describe(`${engine} · ${width}px`, () => {
    it("Edit card: ON shows the link under Connect; switching it OFF hides it and Save sends hideCardLink: true", async () => {
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: CARD, isPro: true, initialTab: "linkdesign" });
      expect(await theSwitch(page).getAttribute("aria-checked")).toBe("true");
      let shown = await previews(page);
      expect(shown.length, "no live preview of the page on Social design").toBeGreaterThan(0);
      for (const p of shown) {
        expect(p.hasLink).toBe(true);
        expect(p.label).toBe("View Contact Info →");
        expect(p.href).toBe("/dana-ellis?source=swift_links");
        expect(p.afterConnect, "the preview's link is not under Connect").toBe(true);
        expect(p.aboveTiles, "the preview's link fell below the links").toBe(true);
      }

      await flip(page);
      expect(await theSwitch(page).getAttribute("aria-checked")).toBe("false");
      shown = await previews(page);
      expect(shown.length).toBeGreaterThan(0);
      for (const p of shown) expect(p.hasLink, "switched off, the preview still shows the link").toBe(false);

      await clickButton(page, "Save changes");
      expect(sentCustomization(calls, "/api/cards/c1").hideCardLink).toBe(true);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);

    it("Edit card: a card saved with it OFF opens off; switching it back ON puts it under Connect and Save clears the flag", async () => {
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: { ...CARD, customization: { ...CARD.customization, hideCardLink: true } }, isPro: true, initialTab: "linkdesign" });
      expect(await theSwitch(page).getAttribute("aria-checked")).toBe("false");
      for (const p of await previews(page)) expect(p.hasLink).toBe(false);

      await flip(page);
      expect(await theSwitch(page).getAttribute("aria-checked")).toBe("true");
      const shown = await previews(page);
      expect(shown.length).toBeGreaterThan(0);
      for (const p of shown) {
        expect(p.hasLink).toBe(true);
        expect(p.afterConnect).toBe(true);
        expect(p.aboveTiles).toBe(true);
      }

      await clickButton(page, "Save changes");
      const sent = saves(calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown> | undefined;
      expect(sent, "Save sent no customization").toBeTruthy();
      expect("hideCardLink" in sent!, "the editor must SEND the key so the server merge can clear it").toBe(true);
      expect(sent!.hideCardLink).toBeNull();
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);

    it("Add a card: on by default under Connect; switched off on Social design, Create card sends hideCardLink: true", async () => {
      const prefill = {
        product: "card", step: 1, name: "Dana Ellis", title: "Principal Broker", company: "Northbeam Group", phone: "(415) 555-0192",
        template: "classic-pro", bio: "Principal broker helping Bay Area families buy and sell.",
      };
      const { page, calls, errors } = await rig(engine, width, { prefill, signedIn: true });
      await mount(page, "wizard", { isPro: true });
      const nickname = page.locator("#wizard-nickname");
      if (await nickname.isVisible().catch(() => false)) await nickname.fill("Work card");
      await clickButton(page, "Next: Card design");
      await clickButton(page, "Next: Socials");
      await clickButton(page, "Next: Social design");

      expect(await theSwitch(page).getAttribute("aria-checked")).toBe("true");
      const shown = await previews(page);
      expect(shown.length).toBeGreaterThan(0);
      for (const p of shown) {
        expect(p.hasLink).toBe(true);
        expect(p.label).toBe("View Contact Info →");
        expect(p.afterConnect).toBe(true);
      }

      await flip(page);
      for (const p of await previews(page)) expect(p.hasLink).toBe(false);

      await clickButton(page, "Create card");
      await expect.poll(() => saves(calls, "/api/cards").length, { timeout: 20_000 }).toBeGreaterThan(0);
      expect(sentCustomization(calls, "/api/cards").hideCardLink).toBe(true);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);
  });
}
