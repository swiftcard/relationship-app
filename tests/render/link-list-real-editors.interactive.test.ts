import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// ── Reorder and edit links in the REAL editors (owner, 2026-11-06) ──────────
//
// tests/render/link-list-editor drives the list on its own. This drives it
// where people meet it, Edit card → Socials, the Add card builder's Socials
// step and Office admin → Branding → Links, in Chromium and in WebKit (Safari
// and the iPhone app) at a phone width and a computer width, and checks what
// Save actually SENDS: the new order, the edited link, the section header in
// the right place, the company link still first. Same rig as
// title-company-editors: the real screens bundled with esbuild, /api answered
// locally, nothing reaches the internet.

const ORIGIN = "https://sc.test";
let bundle: string;
let css: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "linklist-real-"));
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
    import OfficeBranding from "@/components/OfficeBranding";
    const FRAMES: any = {
      edit: (c: any) => h("main", { className: "sc-app min-h-screen bg-gray-950 px-5 py-10" }, h("div", { className: "max-w-4xl mx-auto" }, c)),
      wizard: (c: any) => c,
      branding: (c: any) => h("main", { className: "sc-app max-w-6xl mx-auto px-5 pt-6 pb-28 md:pb-16" }, c),
    };
    const SCREENS: any = { edit: CardEditForm, wizard: NewCardWizard, branding: OfficeBranding };
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

async function mount(page: Page, screen: "edit" | "wizard" | "branding", props: Record<string, unknown>) {
  await page.evaluate(([s, p]) => (window as unknown as { mount: (s: string, p: unknown) => void }).mount(s as string, p), [screen, props] as const);
  await page.waitForTimeout(900);
}

async function clickButton(page: Page, label: string) {
  const btn = page.locator(`button:visible:has-text("${label}")`).first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForTimeout(500);
}

const rows = (page: Page) => page.locator("[data-link-list] li");
const rowTexts = (page: Page) => rows(page).evaluateAll((els) => els.map((li) => {
  const input = li.querySelector("input");
  return input ? `[${input.value}]` : (li.querySelector("span.font-semibold")?.textContent ?? "").trim();
}));

/** Drag row `from` by its grip until its centre sits just past row `to`'s midpoint. */
async function drag(page: Page, from: number, to: number) {
  const grip = rows(page).nth(from).locator("button[aria-label^='Move']");
  // Centre it on screen: on a phone a pinned preview covers the top.
  await grip.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  const g = (await grip.boundingBox())!;
  const t = (await rows(page).nth(to).boundingBox())!;
  const x = g.x + g.width / 2;
  const y = g.y + g.height / 2;
  const goal = to < from ? t.y + 4 : t.y + t.height - 4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + (goal > y ? 6 : -6), { steps: 2 });
  await page.mouse.move(x, goal, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Open a link, change both boxes, Save link. */
async function editLink(page: Page, label: string, next: { label: string; url: string }) {
  const btn = page.locator(`[data-link-list] button[aria-label="Edit ${label}"]`);
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  const li = page.locator("[data-link-list] li", { has: page.locator("button:has-text('Save link')") });
  await li.locator("input").nth(0).fill(next.label);
  await li.locator("input").nth(1).fill(next.url);
  await li.locator("button:has-text('Save link')").click();
  await page.waitForTimeout(150);
}

/** "+ Add a section header" sits under the list and above the add form's "Button text". */
async function headerButtonAboveForm(page: Page) {
  const btn = (await page.locator("button:visible:has-text('+ Add a section header')").first().boundingBox())!;
  const form = (await page.locator("[data-add-link]:visible").first().boundingBox())!;
  return btn.y + btn.height <= form.y + 1;
}

const saves = (calls: Call[], path: string) => calls.filter((c) => c.path === path && c.method !== "GET" && c.body);
type L = { label: string; url: string; kind?: string; office?: boolean; size?: string };
const brief = (links: L[]) => links.map((l) => (l.kind === "header" ? `[${l.label}]` : `${l.label} ${l.url}`));

const BOOK = { label: "Book a meeting", url: "https://calendly.com/dana", size: "featured" };
const YT = { label: "My YouTube", url: "https://youtube.com/@dana" };
const SHOP = { label: "Shop now", url: "https://dana.shop" };
const CARD = {
  id: "c1", username: "dana-ellis", name: "Dana Ellis", title: "Principal Broker", company: "Northbeam Group",
  email: "dana@northbeam.com", phone: "(415) 555-0192", website: "northbeam.com",
  linkedin: "", instagram: "", twitter: "", tiktok: "",
  template: "classic-pro",
  customization: { bio: "Principal broker helping Bay Area families buy and sell.", links: [BOOK, YT, SHOP] } as Record<string, unknown>,
};

const RUNS: Array<[string, number]> = [["Chromium", 390], ["Chromium", 1280], ["WebKit", 390], ["WebKit", 1280]];

for (const [engine, width] of RUNS) {
  describe(`${engine} · ${width}px`, () => {
    it("Edit card, Pro: add a section header, drag it above a link, move a link, edit a link, Save sends exactly that", async () => {
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: CARD, isPro: true, initialTab: "sharing" });
      expect(await rowTexts(page)).toEqual(["Book a meeting", "My YouTube", "Shop now"]);
      expect(await headerButtonAboveForm(page), '"+ Add a section header" is under the add form').toBe(true);

      await clickButton(page, "+ Add a section header");
      await page.keyboard.type("Watch");
      expect(await rowTexts(page)).toEqual(["Book a meeting", "My YouTube", "Shop now", "[Watch]"]);

      await drag(page, 3, 1); // the header above My YouTube
      expect(await rowTexts(page)).toEqual(["Book a meeting", "[Watch]", "My YouTube", "Shop now"]);
      await drag(page, 0, 2); // Book a meeting under My YouTube
      expect(await rowTexts(page)).toEqual(["[Watch]", "My YouTube", "Book a meeting", "Shop now"]);

      await editLink(page, "Shop now", { label: "Shop my store", url: "dana.shop/new" });
      expect(await rowTexts(page)).toEqual(["[Watch]", "My YouTube", "Book a meeting", "Shop my store"]);

      await clickButton(page, "Save changes");
      const sent = (saves(calls, "/api/cards/c1").at(-1)?.body?.customization as { links?: L[] } | undefined)?.links ?? [];
      expect(brief(sent)).toEqual(["[Watch]", "My YouTube https://youtube.com/@dana", "Book a meeting https://calendly.com/dana", "Shop my store https://dana.shop/new"]);
      // The moved link took its look with it.
      expect(sent[2]).toMatchObject({ label: "Book a meeting", size: "featured" });
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);

    it("Edit card, Free: the two links can be swapped and edited; no section header offered", async () => {
      const { page, calls, errors } = await rig(engine, width);
      // Plain links: a Featured size is a Pro look and would open the Pro panel at Save.
      await mount(page, "edit", { card: { ...CARD, customization: { ...CARD.customization, links: [{ label: BOOK.label, url: BOOK.url }, YT] } }, isPro: false, initialTab: "sharing" });
      expect(await page.locator("button:has-text('+ Add a section header')").count()).toBe(0);
      await drag(page, 1, 0);
      expect(await rowTexts(page)).toEqual(["My YouTube", "Book a meeting"]);
      await editLink(page, "Book a meeting", { label: "Book a call", url: "https://calendly.com/dana/call" });
      await clickButton(page, "Save changes");
      const sent = (saves(calls, "/api/cards/c1").at(-1)?.body?.customization as { links?: L[] } | undefined)?.links ?? [];
      expect(brief(sent).slice(0, 2)).toEqual(["My YouTube https://youtube.com/@dana", "Book a call https://calendly.com/dana/call"]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);

    it("Edit card, Office member: the company link stays first and fixed; theirs move under it", async () => {
      const company = { label: "Company booking", url: "https://northwind.com/book" };
      const org = {
        company: "Northwind", website: null, logoUrl: null, phone: null, fax: null, address: null,
        officeLinks: [company], linkBio: null, linkInstagram: null, lockLinkDesign: false,
      };
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: { ...CARD, customization: { ...CARD.customization, links: [{ ...company, office: true }, BOOK, YT] } }, isPro: true, org, initialTab: "sharing" });
      const first = rows(page).nth(0);
      expect(await first.locator("button").count(), "a company row has no grip, edit or remove").toBe(0);
      expect(await first.innerText()).toMatch(/company/i);
      await drag(page, 2, 0); // try to put My YouTube above the company link
      expect(await rowTexts(page)).toEqual(["Company booking", "My YouTube", "Book a meeting"]);
      await clickButton(page, "Save changes");
      const sent = (saves(calls, "/api/cards/c1").at(-1)?.body?.customization as { links?: L[] } | undefined)?.links ?? [];
      expect(brief(sent)).toEqual(["Company booking https://northwind.com/book", "My YouTube https://youtube.com/@dana", "Book a meeting https://calendly.com/dana"]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);

    it("Add a card, Pro: links added on Socials can be reordered and edited before the card is created", async () => {
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
      for (const l of [BOOK, YT]) {
        await page.fill("#wizard-link-label", l.label);
        await page.fill("#wizard-link-url", l.url.replace("https://", ""));
        await clickButton(page, "+ Add link");
      }
      expect(await headerButtonAboveForm(page)).toBe(true);
      await drag(page, 1, 0);
      await editLink(page, "Book a meeting", { label: "Book a viewing", url: "calendly.com/dana/viewing" });
      expect(await rowTexts(page)).toEqual(["My YouTube", "Book a viewing"]);
      await clickButton(page, "Next: Social design");
      await clickButton(page, "Create card");
      await expect.poll(() => saves(calls, "/api/cards").length, { timeout: 20_000 }).toBeGreaterThan(0);
      const sent = (saves(calls, "/api/cards").at(-1)?.body?.customization as { links?: L[] } | undefined)?.links ?? [];
      expect(brief(sent)).toEqual(["My YouTube https://youtube.com/@dana", "Book a viewing https://calendly.com/dana/viewing"]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);

    it("Office admin, Branding → Links: company links reorder and edit, and Save & apply sends that order", async () => {
      const office = {
        brand_company: "Northwind", brand_website: "northwind.com", brand_template: "classic-pro", brand_design: {},
        brand_links: [{ label: "Book a viewing", url: "https://northwind.com/book" }, { label: "Listings", url: "", kind: "header" }, { label: "Our listings", url: "https://northwind.com/listings" }],
      };
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "branding", { office });
      await page.locator("[role='tab']:has-text('Links')").click();
      await page.waitForTimeout(400);
      expect(await headerButtonAboveForm(page)).toBe(true);
      await drag(page, 1, 0); // the Listings header to the top
      await editLink(page, "Book a viewing", { label: "Book a showing", url: "northwind.com/showing" });
      expect(await rowTexts(page)).toEqual(["[Listings]", "Book a showing", "Our listings"]);
      await clickButton(page, "Save & apply to team Swift Links");
      const sent = (saves(calls, "/api/office/brand").at(-1)?.body?.links as L[] | undefined) ?? [];
      expect(brief(sent)).toEqual(["[Listings]", "Book a showing https://northwind.com/showing", "Our listings https://northwind.com/listings"]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);
  });
}
