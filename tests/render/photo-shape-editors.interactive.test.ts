import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";
import { META, freeSafeValues } from "@/lib/template-style-presets";

// ── Photo First's Photo shape, used in the REAL editors ─────────────────────
//
// Owner, 2026-10-09: Photo First gets an option to keep the photo as it is or
// put it in a circle, and with the circle a colour for the photo panel behind
// it — "everywhere it needs to be… the office admin… all account types and
// account plans… nothing overlapping, no glitches or bugs when editing or
// adding a card… the website, the app, the web app, on all device types."
//
// So this bundles the three real screens a card is designed on — Edit card,
// the new-card builder and the Office admin's Branding page — and uses them as
// a person does, in Chromium and WebKit (the iPhone app and Safari), at a phone
// width and a desktop width: switch to Photo First, choose Circle, pick a
// colour, watch the preview, save, open it again, go back to Original. Pro,
// Free (swatch, and the free-hand colour named at Save), an Office member with
// the design locked and unlocked, the Office admin, a guest arriving from a
// homepage builder, a Pro creating a card, and the light theme.
// The same rig as title-company-editors.interactive.test.ts.

const ORIGIN = "https://sc.test";
let bundle: string;
let css: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "photoshape-"));
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

/** A real headshot: a portrait with its own pixel size, like any upload. */
const HEADSHOT = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect width="300" height="400" fill="#cbd5e1"/><circle cx="150" cy="150" r="70" fill="#f1c27d"/><rect x="60" y="240" width="180" height="160" rx="60" fill="#1e3a8a"/></svg>`,
);
const CARD = {
  id: "c1", username: "dana-ellis", name: "Dana Ellis", title: "Principal Broker", company: "Northbeam Group",
  email: "dana@northbeam.com", phone: "(415) 555-0192", website: "northbeam.com",
  linkedin: "", instagram: "", twitter: "", tiktok: "",
  template: "classic-pro",
  customization: { bio: "Principal broker helping Bay Area families buy and sell." } as Record<string, unknown>,
};
const ORG = {
  company: "Northwind", website: null, logoUrl: null, phone: null, fax: null, address: null,
  officeLinks: null, linkBio: null, linkInstagram: null, lockLinkDesign: false,
};
const PANEL = META["photo-first"].surface!.presets;
const NAVY = PANEL.indexOf("#0e1b35");
const GREEN = PANEL.indexOf("#052e2b");
const WHITE = PANEL.indexOf("#ffffff");

async function rig(engine: string, width: number, opts: { theme?: "light"; prefill?: Record<string, unknown>; signedIn?: boolean } = {}): Promise<Rig> {
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
        body: `<!doctype html><html${opts.theme === "light" ? ' data-sc-theme="light"' : ""}><head><meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
          <style>body{margin:0;background:${opts.theme === "light" ? "#f7f5f0" : "#0b0f16"}}</style></head>
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

const shapeStep = (page: Page) => page.locator('[data-design-step="surface"]');
const swatch = (page: Page, i: number) => shapeStep(page).locator('button[aria-label="Color preset"]').nth(i);
const swatchCount = (page: Page) => shapeStep(page).locator('button[aria-label="Color preset"]').count();
const segment = (page: Page, label: "Original" | "Circle") => shapeStep(page).locator('[role="group"][aria-label="Photo shape"] button', { hasText: label });

async function tap(page: Page, label: "Original" | "Circle") {
  await segment(page, label).scrollIntoViewIfNeeded();
  await segment(page, label).click();
  await page.waitForTimeout(200);
}

async function pick(page: Page, i: number) {
  await swatch(page, i).scrollIntoViewIfNeeded();
  await swatch(page, i).click();
  await page.waitForTimeout(200);
}

async function pickAnyColor(page: Page, hex: string) {
  await shapeStep(page).locator('input[type="color"]').evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, hex);
  await page.waitForTimeout(200);
}

async function pickTemplate(page: Page, label: string) {
  const tile = page.locator(`button[aria-label="${label}"]`).first();
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  await page.waitForTimeout(400);
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

type Preview = {
  bg: string;
  circle: { w: number; h: number; radius: number; inside: boolean } | null;
  scrim: boolean;
  fullPhoto: boolean;
  nameColor: string;
  nameUnderCircle: boolean;
};

/** Every live Photo First preview on screen — the gallery thumbnails left out
 *  (each has its select button laid over it as a sibling). */
const previews = (page: Page): Promise<Preview[]> => page.evaluate(() => {
  const isThumb = (el: Element) => {
    for (let p = el.parentElement, n = 0; p && n < 6; p = p.parentElement, n++) {
      if ([...p.children].some((c) => c.tagName === "BUTTON" && c.hasAttribute("aria-pressed") && c.classList.contains("inset-0"))) return true;
    }
    return false;
  };
  return [...document.querySelectorAll<HTMLElement>(".sc-card")]
    .filter((c) => !isThumb(c) && c.getBoundingClientRect().width > 0 && getComputedStyle(c).visibility !== "hidden")
    .map((c) => {
      const panel = c.firstElementChild as HTMLElement;
      const pr = panel.getBoundingClientRect();
      // In circle mode the photo (or initials) is the panel's own child.
      const round = [...panel.children].find((el) => el.classList.contains("rounded-full")) as HTMLElement | undefined;
      const r = round?.getBoundingClientRect();
      const name = panel.querySelector("h2") as HTMLElement;
      return {
        bg: getComputedStyle(panel).backgroundColor,
        circle: r ? {
          w: r.width, h: r.height,
          radius: parseFloat(getComputedStyle(round!).borderTopLeftRadius),
          inside: r.left >= pr.left - 1 && r.right <= pr.right + 1 && r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1,
        } : null,
        scrim: [...panel.querySelectorAll<HTMLElement>("div")].some((d) => /rgba\(0,\s*0,\s*0,\s*0\.72\)/.test(d.style.background)),
        fullPhoto: !!panel.querySelector("img.absolute.inset-0"),
        nameColor: getComputedStyle(name).color,
        nameUnderCircle: r ? name.getBoundingClientRect().top >= r.bottom - 1 : false,
      };
    });
});

async function expectCircle(page: Page, color?: string) {
  const ps = await previews(page);
  expect(ps.length, "no live Photo First preview").toBeGreaterThan(0);
  for (const p of ps) {
    expect(p.circle, "the preview's photo is not in a circle").not.toBeNull();
    expect(Math.abs(p.circle!.w - p.circle!.h), "circle is not round").toBeLessThanOrEqual(1);
    expect(p.circle!.radius).toBeGreaterThanOrEqual(p.circle!.w / 2 - 1);
    expect(p.circle!.inside, "circle leaves the photo panel").toBe(true);
    expect(p.nameUnderCircle, "name is not under the circle").toBe(true);
    expect(p.scrim, "the photo scrim is still drawn").toBe(false);
    if (color) expect(p.bg, "panel colour").toBe(rgb(color));
  }
}

async function expectFullPhoto(page: Page) {
  const ps = await previews(page);
  expect(ps.length, "no live Photo First preview").toBeGreaterThan(0);
  for (const p of ps) {
    expect(p.fullPhoto, "the photo does not fill the panel").toBe(true);
    expect(p.circle).toBeNull();
    expect(p.scrim).toBe(true);
  }
}

/**
 * Nothing in the design steps overlaps, spills or sits off screen — the Photo
 * shape step first, and every step around it, which it must not disturb.
 */
const layoutProblems = (page: Page) => page.evaluate(() => {
  const problems: string[] = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
  for (const li of document.querySelectorAll<HTMLElement>("li[data-design-step]")) {
    const key = li.dataset.designStep;
    const box = li.getBoundingClientRect();
    if (box.right > vw + 0.5 || box.left < -0.5) problems.push(`${key}: step runs off screen`);
    const label = li.querySelector("p")!.getBoundingClientRect();
    const controls = [...li.querySelectorAll<HTMLElement>("button, input[type='color']")].map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.width > 0);
    for (const { el, r } of controls) {
      const name = el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName;
      if (r.right > box.right + 0.5 || r.left < box.left - 0.5 || r.bottom > box.bottom + 0.5) problems.push(`${key}: "${name}" spills out of its step`);
      if (r.top < label.bottom - 0.5 && r.bottom > label.top + 0.5 && r.left < label.right && r.right > label.left) problems.push(`${key}: "${name}" covers the step label`);
    }
    for (const el of li.querySelectorAll<HTMLElement>(".truncate")) {
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`${key}: "${el.textContent}" is cut off`);
    }
    const tappables = controls.filter(({ el }) => el.tagName === "BUTTON");
    for (let i = 0; i < tappables.length; i++) {
      for (let j = i + 1; j < tappables.length; j++) {
        const a = tappables[i].r, b = tappables[j].r;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1 && !tappables[i].el.contains(tappables[j].el) && !tappables[j].el.contains(tappables[i].el)) problems.push(`${key}: controls ${i} and ${j} overlap`);
      }
    }
  }
  return problems;
});

async function clickSave(page: Page, label: string) {
  const btn = page.locator(`button:visible:has-text("${label}")`).first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForTimeout(700);
}

async function toCardDesign(page: Page) {
  const nickname = page.locator("#wizard-nickname");
  if (await nickname.isVisible().catch(() => false)) await nickname.fill("Work card");
  await clickSave(page, "Next: Card design");
  await shapeStep(page).or(page.locator('[data-design-step="title"]')).first().waitFor();
}

const saves = (calls: Call[], path: string) => calls.filter((c) => c.path === path && c.method !== "GET" && c.body);
/** SHOT_DIR=<dir> keeps a picture of each screen at the Photo shape step, for looking at. */
async function shot(page: Page, name: string) {
  if (!process.env.SHOT_DIR) return;
  // What a person sees while using the step: scrolled to it, the pinned
  // preview (phone) or the preview column (desktop) beside it.
  await shapeStep(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}
const pressed = async (page: Page, label: "Original" | "Circle") => segment(page, label).getAttribute("aria-pressed");

// ── The matrix ──────────────────────────────────────────────────────────────

const RUNS: Array<[string, number]> = [["Chromium", 390], ["Chromium", 1280], ["WebKit", 390], ["WebKit", 1280]];

for (const [engine, width] of RUNS) {
  describe(`${engine} · ${width}px`, () => {
    it("Edit card, Pro: switch to Photo First, choose Circle and a colour, save, open again, back to Original", async () => {
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: CARD, photoUrl: HEADSHOT, isPro: true, initialTab: "design" });
      await pickTemplate(page, "Photo First");
      await expect(shapeStep(page).locator("p").first().textContent()).resolves.toBe("Photo shape");
      expect(await pressed(page, "Original")).toBe("true");
      // A full photo covers the panel, so there is no colour to pick yet.
      expect(await swatchCount(page)).toBe(0);
      await expectFullPhoto(page);
      expect(await layoutProblems(page)).toEqual([]);

      await tap(page, "Circle");
      expect(await pressed(page, "Circle")).toBe("true");
      expect(await swatchCount(page)).toBe(PANEL.length);
      await expectCircle(page);
      await pick(page, NAVY);
      await expectCircle(page, PANEL[NAVY]);
      expect(await swatch(page, NAVY).getAttribute("aria-pressed")).toBe("true");
      expect(await layoutProblems(page)).toEqual([]);
      await shot(page, `edit-pro-circle-${engine}-${width}`);

      await clickSave(page, "Save changes");
      const body = saves(calls, "/api/cards/c1").at(-1)?.body;
      const sent = body?.customization as Record<string, unknown>;
      expect(body?.template).toBe("photo-first");
      expect(sent.photoShape).toBe("circle");
      expect(sent.surfaceColor).toBe(PANEL[NAVY]);
      expect(errors).toEqual([]);
      await page.context().close();

      // Opened again: exactly as saved. Then back to Original, which clears it.
      const again = await rig(engine, width);
      await mount(again.page, "edit", { card: { ...CARD, template: "photo-first", customization: { ...CARD.customization, ...sent } }, photoUrl: HEADSHOT, isPro: true, initialTab: "design" });
      expect(await pressed(again.page, "Circle")).toBe("true");
      expect(await swatch(again.page, NAVY).getAttribute("aria-pressed")).toBe("true");
      await expectCircle(again.page, PANEL[NAVY]);
      await tap(again.page, "Original");
      expect(await swatchCount(again.page)).toBe(0);
      await expectFullPhoto(again.page);
      expect(await layoutProblems(again.page)).toEqual([]);
      await clickSave(again.page, "Save changes");
      const back = saves(again.calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown>;
      expect(back.photoShape).toBeNull();
      expect(again.errors).toEqual([]);
      await again.page.context().close();
    }, 120_000);

    it("Edit card, Free: Circle and a swatch save straight through; a free-hand colour is named at Save and Save without them keeps the circle", async () => {
      const first = await rig(engine, width);
      const card = { ...CARD, template: "photo-first" };
      await mount(first.page, "edit", { card, photoUrl: HEADSHOT, isPro: false, initialTab: "design" });
      await tap(first.page, "Circle");
      await pick(first.page, WHITE);
      await expectCircle(first.page, PANEL[WHITE]);
      // White panel: the name turns to ink rather than vanishing.
      for (const p of await previews(first.page)) expect(p.nameColor).toBe("rgb(17, 24, 39)");
      await clickSave(first.page, "Save changes");
      const kept = saves(first.calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown>;
      expect(kept?.photoShape).toBe("circle");
      expect(kept?.surfaceColor).toBe(PANEL[WHITE]);
      expect(first.errors).toEqual([]);
      await first.page.context().close();

      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: { ...card, customization: { ...card.customization, ...kept } }, photoUrl: HEADSHOT, isPro: false, initialTab: "design" });
      const before = saves(calls, "/api/cards/c1").length;
      await pickAnyColor(page, "#123457");
      await expectCircle(page, "#123457");
      await clickSave(page, "Save changes");
      await expect.poll(() => page.getByText("Your own colors").first().isVisible()).toBe(true);
      expect(saves(calls, "/api/cards/c1").length).toBe(before);
      await clickSave(page, "Save without them");
      const sent = saves(calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown>;
      expect(sent.photoShape).toBe("circle");
      // Snapped to a colour Free can keep: a swatch, or a Look's own panel.
      expect(freeSafeValues(META["photo-first"], "surface")).toContain(sent.surfaceColor);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);

    it("Edit card, Office member: locked, the office's circle shows and nothing can be changed; unlocked, the member picks and saves", async () => {
      const officeLook = { ...CARD, template: "photo-first", customization: { ...CARD.customization, photoShape: "circle", surfaceColor: PANEL[GREEN] } };
      const locked = await rig(engine, width);
      await mount(locked.page, "edit", { card: officeLook, photoUrl: HEADSHOT, isPro: true, initialTab: "design", org: { ...ORG, lockDesign: true } });
      expect(await shapeStep(locked.page).count()).toBe(0);
      await expectCircle(locked.page, PANEL[GREEN]);
      expect(locked.errors).toEqual([]);
      await locked.page.context().close();

      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: { ...CARD, template: "photo-first", company: "Northwind" }, photoUrl: HEADSHOT, isPro: true, initialTab: "design", org: { ...ORG, lockDesign: false } });
      await tap(page, "Circle");
      await pick(page, GREEN);
      await expectCircle(page, PANEL[GREEN]);
      expect(await layoutProblems(page)).toEqual([]);
      await clickSave(page, "Save changes");
      const sent = saves(calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown>;
      expect(sent.photoShape).toBe("circle");
      expect(sent.surfaceColor).toBe(PANEL[GREEN]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);

    it("Office admin, Branding: the team look takes Circle and its colour, saves, and opens again as picked", async () => {
      const office = { brand_company: "Northwind", brand_website: "northwind.com", brand_template: "photo-first", brand_phone: "(555) 111-2222", brand_design: {} };
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "branding", { office });
      await expect(shapeStep(page).locator("p").first().textContent()).resolves.toBe("Photo shape");
      // Branding designs for a whole team, some with photos and some without,
      // so the panel colour is always on offer here.
      expect(await swatchCount(page)).toBe(PANEL.length);
      expect(await layoutProblems(page)).toEqual([]);
      await tap(page, "Circle");
      await pick(page, GREEN);
      await expectCircle(page, PANEL[GREEN]);
      expect(await layoutProblems(page)).toEqual([]);
      await shot(page, `branding-circle-${engine}-${width}`);
      await clickSave(page, "Save & apply to team cards");
      const design = saves(calls, "/api/office/brand").at(-1)?.body?.design as Record<string, unknown>;
      expect(design.photoShape).toBe("circle");
      expect(design.surfaceColor).toBe(PANEL[GREEN]);
      expect(errors).toEqual([]);
      await page.context().close();

      const again = await rig(engine, width);
      await mount(again.page, "branding", { office: { ...office, brand_design: design } });
      expect(await pressed(again.page, "Circle")).toBe("true");
      expect(await swatch(again.page, GREEN).getAttribute("aria-pressed")).toBe("true");
      await expectCircle(again.page, PANEL[GREEN]);
      expect(again.errors).toEqual([]);
      await again.page.context().close();
    }, 120_000);

    it("Add a card, guest from a homepage builder: the circle and colour picked there arrive picked, and keep working", async () => {
      const prefill = {
        product: "card", step: 1, name: "Dana Ellis", title: "Principal Broker", company: "Northbeam Group", phone: "(415) 555-0192",
        template: "photo-first", photoShape: "circle", surfaceColor: PANEL[NAVY],
      };
      const { page, errors } = await rig(engine, width, { prefill });
      await mount(page, "wizard", { isPro: false, guest: true });
      await toCardDesign(page);
      expect(await pressed(page, "Circle")).toBe("true");
      expect(await swatch(page, NAVY).getAttribute("aria-pressed")).toBe("true");
      await expectCircle(page, PANEL[NAVY]);
      expect(await layoutProblems(page)).toEqual([]);
      await pick(page, GREEN);
      await expectCircle(page, PANEL[GREEN]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);

    it("Add a card, Pro: the new card is created with the circle and its colour", async () => {
      const prefill = {
        product: "card", step: 1, name: "Dana Ellis", title: "Principal Broker", company: "Northbeam Group", phone: "(415) 555-0192",
        template: "photo-first", bio: "Principal broker helping Bay Area families buy and sell.", headshotUrl: HEADSHOT,
      };
      const { page, calls, errors } = await rig(engine, width, { prefill, signedIn: true });
      await mount(page, "wizard", { isPro: true });
      await toCardDesign(page);
      expect(await pressed(page, "Original")).toBe("true");
      await tap(page, "Circle");
      await pick(page, NAVY);
      await expectCircle(page, PANEL[NAVY]);
      expect(await layoutProblems(page)).toEqual([]);
      await shot(page, `builder-circle-${engine}-${width}`);
      await clickSave(page, "Next: Socials");
      await clickSave(page, "Next: Social design");
      await clickSave(page, "Create card");
      await expect.poll(() => saves(calls, "/api/cards").length, { timeout: 20_000 }).toBeGreaterThan(0);
      const created = saves(calls, "/api/cards").at(-1)?.body;
      const cust = created?.customization as Record<string, unknown> | undefined;
      expect(created?.template).toBe("photo-first");
      expect(cust?.photoShape).toBe("circle");
      expect(cust?.surfaceColor).toBe(PANEL[NAVY]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);

    it("light theme: the circle, its colour and the ink name show as picked", async () => {
      const { page, errors } = await rig(engine, width, { theme: "light" });
      await mount(page, "edit", { card: { ...CARD, template: "photo-first" }, photoUrl: HEADSHOT, isPro: true, initialTab: "design" });
      await tap(page, "Circle");
      await pick(page, WHITE);
      await expectCircle(page, PANEL[WHITE]);
      for (const p of await previews(page)) expect(p.nameColor).toBe("rgb(17, 24, 39)");
      await shot(page, `light-white-${engine}-${width}`);
      await pick(page, NAVY);
      await expectCircle(page, PANEL[NAVY]);
      for (const p of await previews(page)) expect(p.nameColor).toBe("rgb(255, 255, 255)");
      expect(await layoutProblems(page)).toEqual([]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);
  });
}
