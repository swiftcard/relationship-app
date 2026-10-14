import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// ── Logo shape, a numbered design step, in the REAL editors ─────────────────
//
// Owner, 2026-10-14: the logo's Original / Circle choice moved out of
// "Logo & headshot" into the design steps, beside Photo shape — "very cleanly,
// … works perfectly on every device". So this drives the three real screens a
// card is designed on (Edit card, the new-card builder, Office Branding) in
// Chromium and WebKit at a phone and a desktop width: the step is where it
// should be, the old toggle is gone, Circle lands on the live preview, it
// saves, and it opens again as picked. The rig is the one
// title-company-editors.interactive.test.ts uses.

const ORIGIN = "https://sc.test";
let bundle: string;
let css: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "logoshape-"));
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
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#1d4ed8"/><text x="20" y="78" font-size="52" fill="#fff">NB</text></svg>`;
const LOGO = `${ORIGIN}/logo.svg`;
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
    if (url.origin === ORIGIN && url.pathname === "/logo.svg") {
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: LOGO_SVG });
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
const seg = (page: Page, label: "Original" | "Circle") =>
  step(page, "logo-shape").locator(`[role=group][aria-label="Logo shape"] button:has-text("${label}")`);

/** The labels of the numbered design steps, in order. */
const stepLabels = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll("ol[aria-label] > li[data-design-step]")].map((li) => (li.querySelector("p")?.textContent || "").trim()),
);

/** border-radius of every visible logo on the live preview (thumbnails left out). */
const previewLogoRadii = (page: Page) => page.evaluate(() => {
  const isThumb = (el: Element) => {
    for (let p = el.closest(".sc-card")?.parentElement, n = 0; p && n < 6; p = p.parentElement, n++) {
      if ([...p.children].some((c) => c.tagName === "BUTTON" && c.hasAttribute("aria-pressed") && c.classList.contains("inset-0"))) return true;
    }
    return false;
  };
  return [...document.querySelectorAll<HTMLImageElement>('.sc-card img[alt="logo"]')]
    .filter((img) => !isThumb(img))
    .filter((img) => { const r = img.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((img) => getComputedStyle(img).borderTopLeftRadius);
});

/** The step sits inside the screen, its two buttons side by side, nothing spilling. */
const stepLayout = (page: Page) => page.evaluate(() => {
  const problems: string[] = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
  const li = document.querySelector<HTMLElement>('[data-design-step="logo-shape"]');
  if (!li) return ["step missing"];
  const box = li.getBoundingClientRect();
  if (box.left < -0.5 || box.right > vw + 0.5) problems.push("step runs off screen");
  const btns = [...li.querySelectorAll<HTMLElement>("button")].map((b) => b.getBoundingClientRect());
  if (btns.length !== 2) problems.push(`expected 2 buttons, found ${btns.length}`);
  for (const r of btns) {
    if (r.left < box.left - 0.5 || r.right > box.right + 0.5) problems.push("a button spills out of the step");
    // The shared Segmented: ~36px with a mouse, 44px on touch (sc-tap).
    if (r.height < 34) problems.push(`a button is only ${Math.round(r.height)}px tall`);
  }
  if (btns.length === 2 && Math.abs(btns[0].top - btns[1].top) > 1) problems.push("Original and Circle are not on one row");
  return problems;
});

/** Is a "Logo shape" toggle anywhere outside the design steps? */
const strayToggle = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll("[role=group]")].filter((g) => /logo shape/i.test(g.getAttribute("aria-label") || "") && !g.closest("[data-design-step]")).length,
);

async function tap(page: Page, label: "Original" | "Circle") {
  await seg(page, label).scrollIntoViewIfNeeded();
  await seg(page, label).click();
  await page.waitForTimeout(200);
}

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
  await page.locator("ol[aria-label] > li[data-design-step]").first().waitFor();
}

const saves = (calls: Call[], path: string) => calls.filter((c) => c.path === path && c.method !== "GET" && c.body);
const pressed = async (page: Page, label: "Original" | "Circle") => (await seg(page, label).getAttribute("aria-pressed")) === "true";

// ── The matrix ──────────────────────────────────────────────────────────────

const RUNS: Array<[string, number]> = [["Chromium", 390], ["Chromium", 1280], ["WebKit", 390], ["WebKit", 1280]];

for (const [engine, width] of RUNS) {
  describe(`${engine} · ${width}px`, () => {
    it("Edit card: Logo shape is a design step, Circle reaches the preview, saves, and opens again", async () => {
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "edit", { card: CARD, logoUrl: LOGO, isPro: true, initialTab: "design" });
      const labels = await stepLabels(page);
      const at = labels.indexOf("Logo shape");
      expect(at, labels.join(" · ")).toBeGreaterThan(-1);
      // With the shapes, before the colours.
      expect(at).toBeGreaterThan(labels.indexOf("Photo or video"));
      expect(at).toBeLessThan(labels.indexOf("Name color"));
      expect(await strayToggle(page)).toBe(0);
      expect(await page.getByText("Logo shape on the card").count()).toBe(0);
      expect(await stepLayout(page)).toEqual([]);
      expect(await pressed(page, "Original")).toBe(true);
      expect((await previewLogoRadii(page)).every((r) => r !== "50%")).toBe(true);

      await tap(page, "Circle");
      expect(await pressed(page, "Circle")).toBe(true);
      const radii = await previewLogoRadii(page);
      expect(radii.length, "no logo on the live preview").toBeGreaterThan(0);
      expect([...new Set(radii)]).toEqual(["50%"]);
      expect(await step(page, "logo-shape").getByText("Your full logo inside a clean circle").count()).toBe(1);

      await clickSave(page, "Save changes");
      const sent = saves(calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown> | undefined;
      expect(sent?.logoShape).toBe("circle");
      expect(errors).toEqual([]);
      await page.context().close();

      // Open it again: Circle is still picked, and Original clears it.
      const again = await rig(engine, width);
      await mount(again.page, "edit", { card: { ...CARD, customization: { ...CARD.customization, logoShape: "circle" } }, logoUrl: LOGO, isPro: true, initialTab: "design" });
      expect(await pressed(again.page, "Circle")).toBe(true);
      expect([...new Set(await previewLogoRadii(again.page))]).toEqual(["50%"]);
      await tap(again.page, "Original");
      expect((await previewLogoRadii(again.page)).every((r) => r !== "50%")).toBe(true);
      await clickSave(again.page, "Save changes");
      const cleared = saves(again.calls, "/api/cards/c1").at(-1)?.body?.customization as Record<string, unknown> | undefined;
      expect(cleared?.logoShape).toBe(null);
      expect(again.errors).toEqual([]);
      await again.page.context().close();
    }, 120_000);

    it("Edit card, Photo First on Free: Logo shape sits right under Photo shape; no logo, no step", async () => {
      const { page, errors } = await rig(engine, width);
      await mount(page, "edit", { card: { ...CARD, template: "photo-first" }, logoUrl: LOGO, isPro: false, initialTab: "design" });
      const labels = await stepLabels(page);
      expect(labels.indexOf("Photo shape"), labels.join(" · ")).toBeGreaterThan(-1);
      expect(labels.indexOf("Logo shape"), labels.join(" · ")).toBe(labels.indexOf("Photo shape") + 1);
      expect(await stepLayout(page)).toEqual([]);
      expect(errors).toEqual([]);
      await page.context().close();

      const bare = await rig(engine, width);
      await mount(bare.page, "edit", { card: CARD, isPro: true, initialTab: "design" });
      await step(bare.page, "text").waitFor();
      expect(await step(bare.page, "logo-shape").count()).toBe(0);
      expect(await strayToggle(bare.page)).toBe(0);
      expect(bare.errors).toEqual([]);
      await bare.page.context().close();
    }, 120_000);

    it("Edit card, Office member: the logo is the office's, so there is no Logo shape step", async () => {
      const { page, errors } = await rig(engine, width);
      await mount(page, "edit", { card: CARD, isPro: true, initialTab: "design", org: { ...ORG, logoUrl: LOGO, lockDesign: false } });
      await step(page, "text").waitFor();
      expect(await step(page, "logo-shape").count()).toBe(0);
      expect(await strayToggle(page)).toBe(0);
      expect(errors).toEqual([]);
      await page.context().close();
    }, 90_000);

    it("Add a card: the step appears with the logo, Circle reaches the preview and the new card", async () => {
      const prefill = {
        product: "card", step: 1, name: "Dana Ellis", title: "Principal Broker", company: "Northbeam Group", phone: "(415) 555-0192",
        template: "modern-bold", bio: "Principal broker helping Bay Area families buy and sell.", logoUrl: LOGO,
      };
      const { page, calls, errors } = await rig(engine, width, { prefill, signedIn: true });
      await mount(page, "wizard", { isPro: true });
      await toCardDesign(page);
      expect(await strayToggle(page)).toBe(0);
      expect(await stepLayout(page)).toEqual([]);
      await tap(page, "Circle");
      expect([...new Set(await previewLogoRadii(page))]).toEqual(["50%"]);
      await clickSave(page, "Next: Socials");
      await clickSave(page, "Next: Social design");
      await clickSave(page, "Create card");
      await expect.poll(() => saves(calls, "/api/cards").length, { timeout: 20_000 }).toBeGreaterThan(0);
      const created = saves(calls, "/api/cards").at(-1)?.body?.customization as Record<string, unknown> | undefined;
      expect(created?.logoShape).toBe("circle");
      expect(errors).toEqual([]);
      await page.context().close();
    }, 120_000);

    it("Office admin, Branding: Logo shape is in Card appearance, not under the logo, and saves with the team look", async () => {
      const office = { brand_company: "Northwind", brand_website: "northwind.com", brand_template: "classic-pro", brand_phone: "(555) 111-2222", brand_design: {}, brand_logo_url: LOGO };
      const { page, calls, errors } = await rig(engine, width);
      await mount(page, "branding", { office });
      expect(await strayToggle(page)).toBe(0);
      expect(await stepLayout(page)).toEqual([]);
      await tap(page, "Circle");
      expect([...new Set(await previewLogoRadii(page))]).toEqual(["50%"]);
      await clickSave(page, "Save & apply to team cards");
      const design = saves(calls, "/api/office/brand").at(-1)?.body?.design as Record<string, unknown>;
      expect(design.logoShape).toBe("circle");
      expect(errors).toEqual([]);
      await page.context().close();
    }, 90_000);
  });
}
