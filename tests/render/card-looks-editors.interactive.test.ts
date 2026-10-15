import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";
import { META } from "@/lib/template-style-presets";

// ── The card's Looks (Original · Solid · Gradient · Glass), in the REAL editors ─
//
// Owner, 2026-10-14: the card's Look step works like Social design's — three
// rows that open onto big preview tiles — and it has to be "in the office plan
// and the admin page on branding… for all account types… updated accordingly
// for the plan they have." card-look-families.interactive.test.ts mounts the
// picker alone; this bundles the real screens a card is designed on — Edit
// card (Pro and Free), the new-card builder and the Office admin's Branding
// page — and uses the picker as a person does, in Chromium and WebKit (the
// iPhone app and Safari), at a phone width and a desktop width: open a row,
// tap a look, watch the live card take it, save, open it again.
// The same rig as photo-shape-editors.interactive.test.ts.

const ORIGIN = "https://sc.test";
let bundle: string;
let css: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "looks-editors-"));
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

// ── The rig ─────────────────────────────────────────────────────────────────

type Call = { method: string; path: string; body: Record<string, unknown> | null };
type Rig = { page: Page; calls: Call[]; errors: string[] };

const CARD = {
  id: "c1", username: "dana-ellis", name: "Dana Ellis", title: "Principal Broker", company: "Northbeam Group",
  email: "dana@northbeam.com", phone: "(415) 555-0192", website: "northbeam.com",
  linkedin: "", instagram: "", twitter: "", tiktok: "",
  template: "classic-pro",
  customization: { bio: "Principal broker helping Bay Area families buy and sell." } as Record<string, unknown>,
};

const look = (template: string, name: string) => {
  const l = META[template].looks.find((x) => x.name === name);
  if (!l) throw new Error(`${template} has no look "${name}"`);
  return l;
};
const ARCTIC = look("classic-pro", "Arctic");
const IVORY = look("classic-pro", "Ivory & Ink");
const NEON_DUSK = look("modern-bold", "Neon Dusk");

async function rig(engine: string, width: number, opts: { prefill?: Record<string, unknown>; signedIn?: boolean } = {}): Promise<Rig> {
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

// The CARD's Look step — the one with Original. Office Branding also has the
// Swift Links page's own Look step (Social design) on the same screen.
const lookStep = (page: Page) => page.locator('[data-design-step="look"]').filter({ has: page.locator("button[aria-pressed]", { hasText: "Original" }) });
const row = (page: Page, family: "Solid" | "Gradient" | "Glass") => lookStep(page).locator("button[aria-expanded]", { hasText: family });
const original = (page: Page) => lookStep(page).locator("button[aria-pressed]", { hasText: "Original" });
const tiles = (page: Page) => lookStep(page).locator(".grid > button[aria-pressed]");
// A tile's text is its "Aa" specimen, then the look's name (and PRO, on Free).
const tile = (page: Page, name: string) => lookStep(page).locator(".grid > button[aria-pressed]", { hasText: new RegExp(`^Aa${name}(PRO)?$`) });

async function openRow(page: Page, family: "Solid" | "Gradient" | "Glass") {
  await row(page, family).scrollIntoViewIfNeeded();
  await row(page, family).click();
  await page.waitForTimeout(400);
}

async function pickLook(page: Page, name: string) {
  await tile(page, name).scrollIntoViewIfNeeded();
  await tile(page, name).click();
  await page.waitForTimeout(300);
}

/** Is a colour painted anywhere on the live card — outside the design steps (so not a tile)? */
const cardShows = (page: Page, rgb: string) => page.evaluate((c) => {
  return [...document.querySelectorAll<HTMLElement>(".sc-card, .sc-card *")].some((el) => {
    if (el.closest("[data-design-step]")) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.backgroundImage.includes(c) || s.backgroundColor === c;
  });
}, rgb);

/** Nothing in the Look step overlaps, spills, is cut off or is too small to tap. */
const lookProblems = (page: Page) => page.evaluate(() => {
  const problems: string[] = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
  const li = [...document.querySelectorAll<HTMLElement>('[data-design-step="look"]')].find((el) => el.textContent?.includes("Original"));
  if (!li) return ["no Look step"];
  const box = li.getBoundingClientRect();
  const buttons = [...li.querySelectorAll<HTMLElement>("button")].map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.width > 0);
  for (const { el, r } of buttons) {
    const name = el.textContent?.trim().slice(0, 30) || "button";
    if (r.right > box.right + 0.5 || r.left < box.left - 0.5) problems.push(`"${name}" spills out of the step`);
    if (r.height < 44 - 0.5) problems.push(`"${name}" is ${r.height}px tall`);
  }
  for (let i = 0; i < buttons.length; i++) {
    for (let j = i + 1; j < buttons.length; j++) {
      const a = buttons[i].r, b = buttons[j].r;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) problems.push(`"${buttons[i].el.textContent?.trim().slice(0, 20)}" overlaps "${buttons[j].el.textContent?.trim().slice(0, 20)}"`);
    }
  }
  for (const el of li.querySelectorAll<HTMLElement>(".truncate")) {
    if (el.scrollWidth > el.clientWidth + 1) problems.push(`"${el.textContent}" is cut off`);
  }
  return problems;
});

async function clickSave(page: Page, label: string) {
  const btn = page.locator(`button:visible:has-text("${label}")`).first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForTimeout(700);
}

const saves = (calls: Call[], path: string) => calls.filter((c) => c.path === path && c.method !== "GET" && c.body);
const proTagsIn = (page: Page, family: "Solid" | "Gradient" | "Glass") => row(page, family).locator('[data-ds="badge"]', { hasText: "PRO" }).count();
const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
// Arctic's first stop, #0c2d48 — on the live card only once Arctic is on it.
const ARCTIC_INK = rgbOf("#0c2d48");

// ── The matrix ──────────────────────────────────────────────────────────────

const RUNS: Array<[string, number]> = [["Chromium", 390], ["Chromium", 1280], ["WebKit", 390], ["WebKit", 1280]];

for (const [engine, width] of RUNS) {
  describe(`${engine} · ${width}px`, () => {
    it("Edit card, Pro: open Glass, tap Arctic, the card takes it, saves every key, and opens again on Arctic", async () => {
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: CARD, isPro: true, initialTab: "design" });
      expect(await original(page).getAttribute("aria-pressed")).toBe("true");
      for (const f of ["Solid", "Gradient", "Glass"] as const) expect(await row(page, f).getAttribute("aria-expanded")).toBe("false");
      expect(await proTagsIn(page, "Glass")).toBe(0);
      expect(await cardShows(page, ARCTIC_INK)).toBe(false);

      await openRow(page, "Glass");
      expect(await tiles(page).count()).toBe(8);
      expect(await lookProblems(page)).toEqual([]);
      await pickLook(page, "Arctic");
      expect(await tile(page, "Arctic").getAttribute("aria-pressed")).toBe("true");
      expect(await original(page).getAttribute("aria-pressed")).toBe("false");
      await expect(row(page, "Glass").textContent()).resolves.toContain("Arctic");
      expect(await cardShows(page, ARCTIC_INK)).toBe(true);

      await clickSave(page, "Save changes");
      const sent = saves(calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown>;
      expect(sent.bgColor).toBe(ARCTIC.bg);
      expect(sent.textColor).toBe(ARCTIC.text);
      expect(sent.finish).toBe("frosted");
      expect(sent.surfaceColor).toBe(ARCTIC.surface);
      expect(sent.titleColor).toBe(ARCTIC.title);
      expect(sent.companyColor).toBe(ARCTIC.company);
      expect(errors).toEqual([]);
      await page.context().close();

      const again = await rig(engine, width);
      await mount(again.page, "edit", { card: { ...CARD, customization: { ...CARD.customization, ...sent } }, isPro: true, initialTab: "design" });
      await expect(row(again.page, "Glass").textContent()).resolves.toContain("Arctic");
      expect(await original(again.page).getAttribute("aria-pressed")).toBe("false");
      expect(await cardShows(again.page, ARCTIC_INK)).toBe(true);
      expect(again.errors).toEqual([]);
      await again.page.context().close();
    }, 120_000);

    it("Edit card, Free: Glass carries PRO; a Solid look saves straight through; Glass is named at Save and drops only its frost", async () => {
      const first = await rig(engine, width);
      await mount(first.page, "edit", { card: CARD, isPro: false, initialTab: "design" });
      expect(await proTagsIn(first.page, "Glass")).toBe(1);
      expect(await proTagsIn(first.page, "Solid")).toBe(0);
      expect(await proTagsIn(first.page, "Gradient")).toBe(0);

      await openRow(first.page, "Solid");
      expect(await tiles(first.page).count()).toBe(10);
      expect(await lookProblems(first.page)).toEqual([]);
      await pickLook(first.page, "Ivory & Ink");
      await clickSave(first.page, "Save changes");
      const kept = saves(first.calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown>;
      expect(kept.bgColor).toBe(IVORY.bg);
      expect(kept.titleColor).toBe(IVORY.title);
      expect(kept.companyColor).toBe(IVORY.company);
      // The whole card, not half of it: the info panel, details and accent too.
      expect(kept.surfaceColor).toBe(IVORY.surface);
      expect(kept.infoColor).toBe(IVORY.info);
      expect(kept.accentColor).toBe(IVORY.accent);
      expect(first.errors).toEqual([]);
      await first.page.context().close();

      // Glass previews on Free like everything else; Save is the wall.
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: { ...CARD, customization: { ...CARD.customization, ...kept } }, isPro: false, initialTab: "design" });
      await expect(row(page, "Solid").textContent()).resolves.toContain("Ivory & Ink");
      await openRow(page, "Glass");
      expect(await tiles(page).count()).toBe(8);
      await pickLook(page, "Arctic");
      expect(await cardShows(page, ARCTIC_INK)).toBe(true);
      const before = saves(calls, "/api/cards/c1").length;
      await clickSave(page, "Save changes");
      await expect.poll(() => page.getByText("Frosted finish").first().isVisible()).toBe(true);
      expect(saves(calls, "/api/cards/c1").length).toBe(before);
      await clickSave(page, "Save without them");
      const sent = saves(calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown>;
      expect(sent.finish ?? null).toBeNull();
      expect(sent.bgColor).toBe(ARCTIC.bg);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);

    it("Office admin, Branding: the team look takes a Gradient look, saves it for the team, and opens again on it", async () => {
      const office = { brand_company: "Northwind", brand_website: "northwind.com", brand_template: "modern-bold", brand_phone: "(555) 111-2222", brand_design: {} };
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "branding", { office });
      expect(await original(page).getAttribute("aria-pressed")).toBe("true");
      // Office is a paid plan: nothing in the Look step is tagged.
      expect(await lookStep(page).locator('[data-ds="badge"]').count()).toBe(0);
      await openRow(page, "Gradient");
      expect(await tiles(page).count()).toBe(8);
      expect(await lookProblems(page)).toEqual([]);
      await pickLook(page, "Neon Dusk");
      await expect(row(page, "Gradient").textContent()).resolves.toContain("Neon Dusk");
      await clickSave(page, "Save & apply to team cards");
      const design = saves(calls, "/api/office/brand").at(-1)?.body?.design as Record<string, unknown>;
      expect(design.bgColor).toBe(NEON_DUSK.bg);
      expect(design.textColor).toBe(NEON_DUSK.text);
      expect(errors).toEqual([]);
      await page.context().close();

      const again = await rig(engine, width);
      await mount(again.page, "branding", { office: { ...office, brand_design: design } });
      await expect(row(again.page, "Gradient").textContent()).resolves.toContain("Neon Dusk");
      await openRow(again.page, "Gradient");
      expect(await tile(again.page, "Neon Dusk").getAttribute("aria-pressed")).toBe("true");
      expect(again.errors).toEqual([]);
      await again.page.context().close();
    }, 120_000);

    it("Add a card, Pro: the builder's Look step opens the same rows and the new card is created in the look", async () => {
      const prefill = {
        product: "card", step: 1, name: "Dana Ellis", title: "Principal Broker", company: "Northbeam Group", phone: "(415) 555-0192",
        template: "classic-pro", bio: "Principal broker helping Bay Area families buy and sell.",
      };
      const { page, calls, errors } = await rig(engine, width, { prefill, signedIn: true });
      await mount(page, "wizard", { isPro: true });
      const nickname = page.locator("#wizard-nickname");
      if (await nickname.isVisible().catch(() => false)) await nickname.fill("Work card");
      await clickSave(page, "Next: Card design");
      await lookStep(page).waitFor();
      expect(await original(page).getAttribute("aria-pressed")).toBe("true");
      await openRow(page, "Glass");
      expect(await lookProblems(page)).toEqual([]);
      await pickLook(page, "Arctic");
      expect(await cardShows(page, ARCTIC_INK)).toBe(true);
      await clickSave(page, "Next: Socials");
      await clickSave(page, "Next: Social design");
      await clickSave(page, "Create card");
      await expect.poll(() => saves(calls, "/api/cards").length, { timeout: 20_000 }).toBeGreaterThan(0);
      const cust = saves(calls, "/api/cards").at(-1)?.body?.customization as Record<string, unknown> | undefined;
      expect(cust?.bgColor).toBe(ARCTIC.bg);
      expect(cust?.finish).toBe("frosted");
      expect(cust?.titleColor).toBe(ARCTIC.title);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);
  });
}
