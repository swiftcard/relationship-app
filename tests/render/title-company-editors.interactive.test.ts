import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";
import { META } from "@/lib/template-style-presets";

// ── Title color and Company color, used in the REAL editors ─────────────────
//
// Owner, 2026-10-09: the job title and the company name each get their own
// colour, and it has to work "everywhere… in all account types and account
// plans… no overlapping, no glitches or bugs when editing or adding a card".
//
// So this bundles the three real screens a card is designed on — Edit card,
// the new-card builder and the Office admin's Branding page — and uses them
// the way a person does, in Chromium and in WebKit (the iPhone app and Safari),
// at a phone width and a desktop width: pick a colour, watch the preview, save,
// open it again. Pro, Free (swatch and free-hand), an Office member with the
// design locked and unlocked, the Office admin, a guest arriving from a
// homepage builder, and the light theme that forces some card text colours.

const ORIGIN = "https://sc.test";
let bundle: string;
let css: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "titlecompany-"));
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
    // Each screen inside the page frame it really has: the pinned phone
    // preview bleeds into the page's side padding (-mx-5 inside px-5), so
    // without the frame it would spill 20px past the screen.
    const FRAMES: any = {
      edit: (c: any) => h("main", { className: "sc-app min-h-screen bg-gray-950 px-5 py-10" }, h("div", { className: "max-w-4xl mx-auto" }, c)),
      wizard: (c: any) => c, // renders its own <main className="… px-5 py-10">
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

const TITLE = "Principal Broker";
const COMPANY = "Northbeam Group";
const CARD = {
  id: "c1", username: "dana-ellis", name: "Dana Ellis", title: TITLE, company: COMPANY,
  email: "dana@northbeam.com", phone: "(415) 555-0192", website: "northbeam.com",
  linkedin: "", instagram: "", twitter: "", tiktok: "",
  template: "classic-pro",
  customization: { bio: "Principal broker helping Bay Area families buy and sell." } as Record<string, unknown>,
};
const ORG = {
  company: "Northwind", website: null, logoUrl: null, phone: null, fax: null, address: null,
  officeLinks: null, linkBio: null, linkInstagram: null, lockLinkDesign: false,
};

async function rig(engine: string, width: number, opts: { theme?: "light"; prefill?: Record<string, unknown>; signedIn?: boolean } = {}): Promise<Rig> {
  const ctx = await browsers[engine].newContext({
    viewport: { width, height: 900 },
    // Touch emulation where the engine supports it, so the phone run is a phone.
    ...(engine === "Chromium" && width < 600 ? { hasTouch: true, isMobile: true } : {}),
  });
  // A signed-in browser carries a Supabase session cookie; the builder reads
  // its presence (lib/guest-draft isAuthenticated) to create instead of gating.
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
    // Images, fonts, Supabase: answered empty, never the internet.
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

const step = (page: Page, key: string) => page.locator(`[data-design-step="${key}"]`);
const swatch = (page: Page, key: string, i: number) => step(page, key).locator('button[aria-label="Color preset"]').nth(i);

async function pick(page: Page, key: string, i: number) {
  await swatch(page, key, i).scrollIntoViewIfNeeded();
  await swatch(page, key, i).click();
  await page.waitForTimeout(150);
}

/** "any color": a real input event, the way the native picker reports a pick. */
async function pickAnyColor(page: Page, key: string, hex: string) {
  await step(page, key).locator('input[type="color"]').evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, hex);
  await page.waitForTimeout(150);
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

/** The colour of every VISIBLE line on the live preview that reads exactly `text`.
 *  Template-gallery thumbnails are left out: each is drawn in its own
 *  template's colours, with its select button (absolute inset-0, aria-pressed)
 *  laid over it as a sibling. (The phone's pinned preview is itself INSIDE a
 *  button — tap for full size — so "inside a button" cannot be the test.) */
const lineColors = (page: Page, text: string) => page.evaluate((t) => {
  const out: string[] = [];
  const isThumb = (el: Element) => {
    for (let p = el.closest(".sc-card")?.parentElement, n = 0; p && n < 6; p = p.parentElement, n++) {
      if ([...p.children].some((c) => c.tagName === "BUTTON" && c.hasAttribute("aria-pressed") && c.classList.contains("inset-0"))) return true;
    }
    return false;
  };
  document.querySelectorAll<HTMLElement>(".sc-card *").forEach((el) => {
    if ((el.textContent || "").trim() !== t) return;
    if ([...el.children].some((c) => (c.textContent || "").trim() === t)) return;
    if (isThumb(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") return;
    out.push(getComputedStyle(el).color);
  });
  return out;
}, text);

async function expectLine(page: Page, text: string, color: string) {
  const colors = await lineColors(page, text);
  expect(colors.length, `"${text}" is not on the preview`).toBeGreaterThan(0);
  expect([...new Set(colors)], `"${text}" colour on the preview`).toEqual([color]);
}

/** The labels of the numbered design steps, in order. */
const stepLabels = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll("ol[aria-label] > li[data-design-step]")].map((li) => (li.querySelector("p")?.textContent || "").trim()),
);

/**
 * Nothing in the colour steps overlaps, spills or sits off screen: every swatch,
 * "any color" and Default inside its own step and inside the viewport, no two
 * controls on top of each other, the step label clear of its controls.
 */
const layoutProblems = (page: Page) => page.evaluate(() => {
  const problems: string[] = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
  for (const key of ["text", "title", "company", "accent", "info"]) {
    const li = document.querySelector<HTMLElement>(`[data-design-step="${key}"]`);
    if (!li) { problems.push(`${key}: step missing`); continue; }
    const box = li.getBoundingClientRect();
    if (box.right > vw + 0.5 || box.left < -0.5) problems.push(`${key}: step runs off screen (${Math.round(box.left)}–${Math.round(box.right)} of ${vw})`);
    const label = li.querySelector("p")!.getBoundingClientRect();
    const controls = [...li.querySelectorAll<HTMLElement>("button, input[type='color']")].map((el) => ({ el, r: el.getBoundingClientRect() }));
    for (const { el, r } of controls) {
      const name = el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName;
      if (r.right > box.right + 0.5 || r.left < box.left - 0.5 || r.bottom > box.bottom + 0.5) problems.push(`${key}: "${name}" spills out of its step`);
      if (r.right > vw + 0.5) problems.push(`${key}: "${name}" is off screen`);
      if (r.top < label.bottom - 0.5 && r.bottom > label.top + 0.5 && r.left < label.right && r.right > label.left) problems.push(`${key}: "${name}" covers the step label`);
    }
    const tappables = controls.filter(({ el }) => el.tagName === "BUTTON");
    for (let i = 0; i < tappables.length; i++) {
      for (let j = i + 1; j < tappables.length; j++) {
        const a = tappables[i].r, b = tappables[j].r;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) problems.push(`${key}: controls ${i} and ${j} overlap`);
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

/** Step 1 of the builder → Card design, the way a person gets there. */
async function toCardDesign(page: Page) {
  const nickname = page.locator("#wizard-nickname");
  if (await nickname.isVisible().catch(() => false)) await nickname.fill("Work card");
  await clickSave(page, "Next: Card design");
  await step(page, "title").waitFor();
}

const saves = (calls: Call[], path: string) => calls.filter((c) => c.path === path && c.method !== "GET" && c.body);

// ── The matrix ──────────────────────────────────────────────────────────────

const RUNS: Array<[string, number]> = [["Chromium", 390], ["Chromium", 1280], ["WebKit", 390], ["WebKit", 1280]];
const CP = META["classic-pro"];

for (const [engine, width] of RUNS) {
  describe(`${engine} · ${width}px`, () => {
    it("Edit card, Pro: each line takes its own colour, saves, and opens again as picked", async () => {
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: CARD, isPro: true, initialTab: "design" });
      const labels = await stepLabels(page);
      const at = labels.indexOf("Name color");
      expect(labels.slice(at, at + 3)).toEqual(["Name color", "Title color", "Company color"]);
      expect(await layoutProblems(page)).toEqual([]);

      const companyBefore = await lineColors(page, COMPANY);
      await pick(page, "title", 3);
      await expectLine(page, TITLE, rgb(CP.title.presets[3]));
      expect(await lineColors(page, COMPANY), "picking a title colour moved the company").toEqual(companyBefore);

      await pick(page, "company", 2);
      await expectLine(page, COMPANY, rgb(CP.company.presets[2]));
      await expectLine(page, TITLE, rgb(CP.title.presets[3]));
      expect(await swatch(page, "title", 3).getAttribute("aria-pressed")).toBe("true");
      expect(await swatch(page, "company", 2).getAttribute("aria-pressed")).toBe("true");

      await clickSave(page, "Save changes");
      const sent = saves(calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown> | undefined;
      expect(sent?.titleColor).toBe(CP.title.presets[3]);
      expect(sent?.companyColor).toBe(CP.company.presets[2]);
      expect(errors).toEqual([]);
      await page.context().close();

      // Open it again: the saved card comes back exactly as picked.
      const again = await rig(engine, width);
      await mount(again.page, "edit", { card: { ...CARD, customization: { ...CARD.customization, ...sent } }, isPro: true, initialTab: "design" });
      expect(await swatch(again.page, "title", 3).getAttribute("aria-pressed")).toBe("true");
      expect(await swatch(again.page, "company", 2).getAttribute("aria-pressed")).toBe("true");
      await expectLine(again.page, TITLE, rgb(CP.title.presets[3]));
      await expectLine(again.page, COMPANY, rgb(CP.company.presets[2]));
      expect(again.errors).toEqual([]);
      await again.page.context().close();
    }, 90_000);

    it("Edit card, Free: a swatch saves as it is; a free-hand colour is named at Save, and Save without them keeps a free one", async () => {
      const first = await rig(engine, width);
      await mount(first.page, "edit", { card: CARD, isPro: false, initialTab: "design" });
      await pick(first.page, "title", 1);
      await expectLine(first.page, TITLE, rgb(CP.title.presets[1]));
      await clickSave(first.page, "Save changes");
      // A swatch is every plan: no dialog, straight through.
      const kept = saves(first.calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown>;
      expect(kept?.titleColor).toBe(CP.title.presets[1]);
      expect(first.errors).toEqual([]);
      await first.page.context().close();

      // Saving goes on to the dashboard, so the next edit is a fresh visit.
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: { ...CARD, customization: { ...CARD.customization, ...kept } }, isPro: false, initialTab: "design" });
      const before = saves(calls, "/api/cards/c1").length;
      await pickAnyColor(page, "company", "#123457");
      await expectLine(page, COMPANY, rgb("#123457"));
      await clickSave(page, "Save changes");
      // Held at Save, with the reason named — nothing written yet.
      await expect.poll(() => page.getByText("Your own colors").first().isVisible()).toBe(true);
      expect(saves(calls, "/api/cards/c1").length).toBe(before);
      await clickSave(page, "Save without them");
      const sent = saves(calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown>;
      expect(CP.company.presets).toContain(sent.companyColor);
      expect(sent.titleColor).toBe(CP.title.presets[1]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 90_000);

    it("Edit card, Office member: the office's lock hides them; unlocked, the member picks and saves", async () => {
      const locked = await rig(engine, width);
      await mount(locked.page, "edit", { card: CARD, isPro: true, initialTab: "design", org: { ...ORG, lockDesign: true } });
      expect(await step(locked.page, "title").count()).toBe(0);
      expect(await step(locked.page, "company").count()).toBe(0);
      expect(locked.errors).toEqual([]);
      await locked.page.context().close();

      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: { ...CARD, company: "Northwind" }, isPro: true, initialTab: "design", org: { ...ORG, lockDesign: false } });
      expect(await layoutProblems(page)).toEqual([]);
      await pick(page, "title", 4);
      await pick(page, "company", 1);
      await expectLine(page, TITLE, rgb(CP.title.presets[4]));
      await expectLine(page, "Northwind", rgb(CP.company.presets[1]));
      await clickSave(page, "Save changes");
      const sent = saves(calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown>;
      expect(sent.titleColor).toBe(CP.title.presets[4]);
      expect(sent.companyColor).toBe(CP.company.presets[1]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 90_000);

    it("Office admin, Branding: the team look takes both, saves, and opens again as picked", async () => {
      const LM = META["luxury-minimal"];
      const office = { brand_company: "Northwind", brand_website: "northwind.com", brand_template: "luxury-minimal", brand_phone: "(555) 111-2222", brand_design: {} };
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "branding", { office });
      expect(await layoutProblems(page)).toEqual([]);
      // Luxury Minimal used to paint both lines with one gold accent.
      await expectLine(page, "Sales Manager", rgb(LM.title.fallback));
      await expectLine(page, "Northwind", rgb(LM.company.fallback));
      await pick(page, "title", 2);
      await expectLine(page, "Sales Manager", rgb(LM.title.presets[2]));
      await expectLine(page, "Northwind", rgb(LM.company.fallback));
      await pick(page, "company", 4);
      await expectLine(page, "Northwind", rgb(LM.company.presets[4]));
      await clickSave(page, "Save & apply to team cards");
      const design = saves(calls, "/api/office/brand").at(-1)?.body?.design as Record<string, unknown>;
      expect(design.titleColor).toBe(LM.title.presets[2]);
      expect(design.companyColor).toBe(LM.company.presets[4]);
      expect(errors).toEqual([]);
      await page.context().close();

      const again = await rig(engine, width);
      await mount(again.page, "branding", { office: { ...office, brand_design: design } });
      expect(await swatch(again.page, "title", 2).getAttribute("aria-pressed")).toBe("true");
      expect(await swatch(again.page, "company", 4).getAttribute("aria-pressed")).toBe("true");
      await expectLine(again.page, "Sales Manager", rgb(LM.title.presets[2]));
      await again.page.context().close();
    }, 90_000);

    it("Add a card, guest from a homepage builder: the colours picked there arrive picked, and keep working", async () => {
      const MB = META["modern-bold"];
      const prefill = {
        product: "card", step: 1, name: "Dana Ellis", title: TITLE, company: COMPANY, phone: "(415) 555-0192",
        template: "modern-bold", titleColor: MB.title.presets[4], companyColor: MB.company.presets[4],
      };
      const { page, errors } = await rig(engine, width, { prefill });
      await mount(page, "wizard", { isPro: false, guest: true });
      await toCardDesign(page);
      expect(await swatch(page, "title", 4).getAttribute("aria-pressed")).toBe("true");
      expect(await swatch(page, "company", 4).getAttribute("aria-pressed")).toBe("true");
      await expectLine(page, TITLE, rgb(MB.title.presets[4]));
      await expectLine(page, COMPANY, rgb(MB.company.presets[4]));
      expect(await layoutProblems(page)).toEqual([]);
      await pick(page, "title", 1);
      await expectLine(page, TITLE, rgb(MB.title.presets[1]));
      await expectLine(page, COMPANY, rgb(MB.company.presets[4]));
      expect(errors).toEqual([]);
      await page.context().close();
    }, 90_000);

    it("Add a card, Pro: the new card is created with both colours", async () => {
      const LB = META["local-business"];
      const prefill = {
        product: "card", step: 1, name: "Dana Ellis", title: TITLE, company: COMPANY, phone: "(415) 555-0192",
        template: "local-business", bio: "Principal broker helping Bay Area families buy and sell.",
      };
      const { page, calls, errors } = await rig(engine, width, { prefill, signedIn: true });
      await mount(page, "wizard", { isPro: true });
      await toCardDesign(page);
      await pick(page, "title", 3);
      await pick(page, "company", 2);
      await expectLine(page, TITLE, rgb(LB.title.presets[3]));
      await expectLine(page, COMPANY, rgb(LB.company.presets[2]));
      await clickSave(page, "Next: Socials");
      await clickSave(page, "Next: Social design");
      await clickSave(page, "Create card");
      // Creating first finishes its own checks; the card is written after.
      await expect.poll(() => saves(calls, "/api/cards").length, { timeout: 20_000 }).toBeGreaterThan(0);
      const created = saves(calls, "/api/cards").at(-1)?.body?.customization as Record<string, unknown> | undefined;
      expect(created?.titleColor).toBe(LB.title.presets[3]);
      expect(created?.companyColor).toBe(LB.company.presets[2]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 90_000);

    it("light theme: the picked colours are the ones painted, not the theme's", async () => {
      // The light theme forces some card text classes with !important; a picked
      // colour drops the class, so the inline colour is what shows.
      const { page, errors } = await rig(engine, width, { theme: "light" });
      await mount(page, "edit", { card: CARD, isPro: true, initialTab: "design" });
      await pick(page, "title", 3);
      await pick(page, "company", 3);
      await expectLine(page, TITLE, rgb(CP.title.presets[3]));
      await expectLine(page, COMPANY, rgb(CP.company.presets[3]));
      expect(await layoutProblems(page)).toEqual([]);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 90_000);
  });
}
