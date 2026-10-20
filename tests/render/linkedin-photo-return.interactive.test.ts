import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// ── Connect with LinkedIn from the headshot step, both legs, in a browser ───
//
// Owner, 2026-10-19: from "Get Started", "See how your card looks" or "See how
// your SwiftLinks look", Connect with LinkedIn must sign in to LinkedIn, come
// back to the same page and the same place (never the top of the website),
// open the headshot to crop, and Apply — for a guest, Free, Pro, an Office
// admin and an Office member, on a phone and a computer.
//
// LinkedIn itself is the one thing not run here: the test captures the hop to
// /api/integrations/linkedin/connect (what the page asked for, and what it
// saved first), then opens the URL the callback sends people back to — the
// same ?li_photo= / ?integration=linkedin&status= the real callback writes —
// and checks what the person sees. The real builders are bundled as they ship
// (the same rig as photo-shape-editors.interactive.test.ts).

const ORIGIN = "https://sc.test";
const SUPA = "https://example.supabase.co";
const LI_PHOTO = `${SUPA}/storage/v1/object/public/card-uploads/guest-linkedin/li.png`;
const UPLOADED = `${SUPA}/storage/v1/object/public/card-uploads/u/cropped.jpg`;
let bundle: string;
let css: string;
let png: Buffer;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "lireturn-"));
  // useSearchParams reads the page's real query, as Next's does on a load.
  writeFileSync(join(tmp, "nav-stub.tsx"), `
    const sp = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    export function useRouter() { return { push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return typeof window === "undefined" ? "/" : window.location.pathname; }
    export function useSearchParams() { return sp; }
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
    import CardMiniBuilder from "@/components/site/CardMiniBuilder";
    import SwiftLinkMiniBuilder from "@/components/site/SwiftLinkMiniBuilder";
    import SignatureMiniBuilder from "@/components/site/SignatureMiniBuilder";
    import { LazyTemplateGallery } from "@/components/site/HomeLazy";
    import NewCardWizard from "@/app/cards/new/NewCardWizard";
    const SCREENS: any = {
      card: CardMiniBuilder, swiftlink: SwiftLinkMiniBuilder, signature: SignatureMiniBuilder,
      gallery: LazyTemplateGallery, wizard: NewCardWizard,
    };
    (window as any).mount = (screen: string, props: any) => {
      // The homepage's builders sit far down a long page; the spacer puts them
      // there, so "brought back to the top" is something this can see.
      const tall = screen !== "wizard";
      createRoot(document.getElementById("root")!).render(
        h("main", { className: "sc-app" }, tall ? h("div", { style: { height: 3000 } }) : null, h(SCREENS[screen], props)),
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
      "process.env.NEXT_PUBLIC_SUPABASE_URL": `"${SUPA}"`,
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"anon"',
      "process.env.NEXT_PUBLIC_APP_URL": `"${ORIGIN}"`,
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
  if (!bundle || bundle.length < 1000) throw new Error("builder bundle is empty — the esbuild step failed");
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
  // The "LinkedIn photo" our storage serves: a real PNG with its own pixels.
  const p = await browsers.Chromium.newPage();
  const dataUrl = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 300; c.height = 400;
    const g = c.getContext("2d")!;
    g.fillStyle = "#cbd5e1"; g.fillRect(0, 0, 300, 400);
    g.fillStyle = "#f1c27d"; g.beginPath(); g.arc(150, 150, 70, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#1e3a8a"; g.fillRect(60, 240, 180, 160);
    return c.toDataURL("image/png");
  });
  await p.close();
  png = Buffer.from(dataUrl.split(",")[1], "base64");
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

// ── The rig ─────────────────────────────────────────────────────────────────

type Rig = { page: Page; api: string[]; connects: URL[]; popups: number; errors: string[]; logs: string[] };

async function rig(engine: string, width: number): Promise<Rig> {
  const ctx = await browsers[engine].newContext({
    viewport: { width, height: 860 },
    ...(engine === "Chromium" && width < 600 ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await ctx.newPage();
  const r: Rig = { page, api: [], connects: [], popups: 0, errors: [], logs: [] };
  page.on("pageerror", (e) => r.errors.push(e.message.split("\n")[0]));
  page.on("console", (m) => r.logs.push(`[${m.type()}] ${m.text()}`));
  page.on("requestfailed", (q) => r.logs.push(`[requestfailed] ${q.url().slice(0, 120)} ${q.failure()?.errorText ?? ""}`));
  page.on("popup", () => { r.popups++; });
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.href.startsWith(LI_PHOTO)) {
      return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: png });
    }
    if (url.pathname === "/api/integrations/linkedin/connect") {
      r.connects.push(url);
      return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>LinkedIn</title>LinkedIn sign-in" });
    }
    if (url.origin === ORIGIN && url.pathname.startsWith("/api/")) {
      r.api.push(`${req.method()} ${url.pathname}`);
      if (url.pathname === "/api/photo-suggest") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [] }) });
      if (url.pathname === "/api/integrations/linkedin") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connected: false }) });
      if (url.pathname === "/api/upload") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: UPLOADED }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, available: true }) });
    }
    if (url.origin === ORIGIN) {
      return route.fulfill({
        status: 200, contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
          <style>body{margin:0;background:#0b0f16}</style></head>
          <body class="sc-app"><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>`,
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  return { ...r, page };
}

async function open(r: Rig, path: string, screen: string, props: Record<string, unknown>, seed?: Record<string, unknown>) {
  if (seed) {
    await r.page.goto(`${ORIGIN}/__seed`);
    await r.page.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }, seed);
  }
  await r.page.goto(`${ORIGIN}${path}`);
  await r.page.evaluate(([s, p]) => (window as unknown as { mount: (s: string, p: unknown) => void }).mount(s as string, p), [screen, props] as const);
  await r.page.waitForTimeout(1200);
}

const cropper = (page: Page) => page.getByText("Adjust profile photo", { exact: true });

/** The crop tool is open on the LinkedIn photo; Apply it and wait for it to close. */
async function applyCrop(page: Page, logs: string[] = []) {
  try {
    await cropOpenAndApply(page);
  } catch (e) {
    // LI_DEBUG_DIR=<dir> keeps what the browser showed and said, for a local run.
    const dir = process.env.LI_DEBUG_DIR;
    if (dir) {
      const name = `${Date.now()}-${(page.context().browser()?.browserType().name() ?? "x")}`;
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: false }).catch(() => {});
      const imgs = await page.locator("img").evaluateAll((all) => all.map((i) => {
        const m = i as HTMLImageElement;
        return `[img] ${m.src.slice(0, 60)} complete=${m.complete} natural=${m.naturalWidth}x${m.naturalHeight} shown=${m.width}x${m.height}`;
      })).catch(() => []);
      writeFileSync(join(dir, `${name}.txt`), [page.url(), ...imgs, ...logs].join("\n"));
    }
    throw e;
  }
}

async function cropOpenAndApply(page: Page) {
  await expect.poll(() => cropper(page).isVisible(), { timeout: 8000 }).toBe(true);
  // The picture really loaded IN the cropper — not a broken image. WebKit used
  // to open it on an undecodable copy (a "?" box), which this caught.
  await expect.poll(() => page.locator('[role="dialog"] img').evaluateAll((imgs) =>
    imgs.some((i) => (i as HTMLImageElement).naturalWidth === 300)), { timeout: 8000 }).toBe(true);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(() => cropper(page).count(), { timeout: 8000 }).toBe(0);
}

const params = (page: Page) => new URL(page.url()).searchParams;
const stored = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), key);
const back = (product: string, extra = `li_photo=${encodeURIComponent(LI_PHOTO)}&integration=linkedin&status=photo`) => `/?builder=${product}&${extra}`;

const ENGINES: [string, number][] = [["Chromium", 1280], ["Chromium", 390], ["WebKit", 390]];

// ── The homepage builders ───────────────────────────────────────────────────

const BUILDERS = [
  { product: "card", trigger: "See how your card looks", photoStep: "Add your photo & logo", stepOf: "Step 3 of 4", forward: 2 },
  { product: "swiftlink", trigger: "See how your Swift Links page would look", photoStep: "Name your Swift Links page", stepOf: "Step 1 of 3", forward: 0 },
  { product: "signature", trigger: "See how your Swift Signature would look", photoStep: "Add your photo & logo", stepOf: "Step 3 of", forward: 2 },
];

describe.each(ENGINES)("homepage builders — %s %ipx", (engine, width) => {
  for (const b of BUILDERS) {
    it(`${b.product}: Connect LinkedIn saves the sketch and leaves in this tab for the photo import`, async () => {
      const r = await rig(engine, width);
      await open(r, "/", b.product, { linkedinEnabled: true });
      await r.page.getByRole("button", { name: b.trigger }).click();
      await r.page.getByPlaceholder("Alex Morgan").first().fill("Ada Lovelace");
      for (let i = 0; i < b.forward; i++) await r.page.getByRole("button", { name: "Continue" }).click();
      await expect.poll(() => r.page.getByText(b.photoStep).first().isVisible()).toBe(true);
      await r.page.getByRole("button", { name: "Suggest my profile picture" }).click();
      await r.page.getByRole("link", { name: "Connect LinkedIn", exact: true }).click();
      await expect.poll(() => r.connects.length, { timeout: 8000 }).toBe(1);
      const c = r.connects[0];
      expect(c.searchParams.get("guest")).toBe("1");
      expect(c.searchParams.get("next")).toBe(`/?builder=${b.product}`);
      expect(r.popups).toBe(0);
      expect((await stored(r.page, "swiftcard_prefill"))?.name).toBe("Ada Lovelace");
      expect(r.errors).toEqual([]);
      await r.page.context().close();
    });

    it(`${b.product}: back from LinkedIn — reopens on the photo step with the sketch, crops, applies`, async () => {
      const r = await rig(engine, width);
      // The card builder is mounted the way the homepage ships it: inside the
      // lazily-built gallery, thousands of pixels below the fold.
      const screen = b.product === "card" ? "gallery" : b.product;
      await open(r, back(b.product), screen, { linkedinEnabled: true }, { swiftcard_prefill: { product: b.product, name: "Ada Lovelace", template: "classic-pro" } });
      expect(await r.page.getByText(b.stepOf).first().isVisible()).toBe(true);
      expect(await r.page.getByText(b.photoStep).first().isVisible()).toBe(true);
      await applyCrop(r.page, r.logs);
      // The cropped photo is the headshot now, and the visitor's sketch is all there.
      await expect.poll(async () => (await stored(r.page, "swiftcard_prefill"))?.headshotUrl?.slice(0, 15), { timeout: 5000 }).toBe("data:image/jpeg");
      expect((await stored(r.page, "swiftcard_prefill"))?.name).toBe("Ada Lovelace");
      // The page behind was brought to the builder, not left at the top.
      expect(await r.page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
      // The return's own parameters are gone, so a refresh can't replay it.
      expect(params(r.page).has("li_photo")).toBe(false);
      expect(params(r.page).has("builder")).toBe(false);
      expect(r.errors).toEqual([]);
      await r.page.context().close();
    });
  }

  it("card: a LinkedIn profile with no photo says so, on the photo step", async () => {
    const r = await rig(engine, width);
    await open(r, back("card", "integration=linkedin&status=nophoto"), "gallery", { linkedinEnabled: true }, { swiftcard_prefill: { product: "card", name: "Ada Lovelace", template: "classic-pro" } });
    expect(await r.page.getByText("Step 3 of 4").first().isVisible()).toBe(true);
    await expect.poll(() => r.page.getByText("doesn't have a photo to import", { exact: false }).isVisible()).toBe(true);
    expect(await cropper(r.page).count()).toBe(0);
    await r.page.context().close();
  });

  it("card: declining on LinkedIn's screen comes back to the photo step and says to try again", async () => {
    const r = await rig(engine, width);
    await open(r, back("card", "integration=linkedin&status=error"), "gallery", { linkedinEnabled: true }, { swiftcard_prefill: { product: "card", name: "Ada Lovelace", template: "classic-pro" } });
    expect(await r.page.getByText("Step 3 of 4").first().isVisible()).toBe(true);
    await expect.poll(() => r.page.getByText("LinkedIn didn't finish connecting", { exact: false }).isVisible()).toBe(true);
    await r.page.context().close();
  });
});

// ── The card wizard (/cards/new): every account type ────────────────────────

const ORG = {
  company: "Northwind", website: "northwind.com", logoUrl: null, phone: null, fax: null, address: null,
  officeLinks: null, linkBio: null, linkInstagram: null, lockLinkDesign: false,
};
const draft = (name: string, company: string) => ({
  id: "d1", kind: "card", step: 2, updatedAt: Date.now(), images: {},
  payload: { name, company, title: "Engineer", label: "", customization: {} },
});

const ACCOUNTS = [
  { who: "a guest (Get Started)", path: "/cards/new", props: { guest: true, isPro: false }, key: "swiftcard_guest_draft", upload: false },
  { who: "a Free account", path: "/cards/new?add=1", props: { isPro: false, draftOwner: "u-free" }, key: "swiftcard_card_draft:u-free", upload: true },
  { who: "a Pro account / Office admin", path: "/cards/new?add=1", props: { isPro: true, draftOwner: "u-pro" }, key: "swiftcard_card_draft:u-pro", upload: true },
  { who: "an Office member", path: "/cards/new?add=1", props: { isPro: true, draftOwner: "u-member", org: ORG }, key: "swiftcard_card_hop:u-member", upload: true },
];

describe.each(ENGINES)("the card wizard — %s %ipx", (engine, width) => {
  for (const a of ACCOUNTS) {
    it(`${a.who}: Connect LinkedIn leaves in THIS tab (no popup) with the card saved first`, async () => {
      const r = await rig(engine, width);
      // Coming back from an attempt that didn't finish puts every account type
      // on the headshot step with their card (an Office member's is only ever
      // held for this hop); Retry then Connect is the second try.
      const sep = a.path.includes("?") ? "&" : "?";
      await open(r, `${a.path}${sep}integration=linkedin&status=error`, "wizard", { ...a.props, linkedinEnabled: true }, { [a.key]: draft("Dana Ellis", "Acme") });
      await expect.poll(() => r.page.getByText("LinkedIn didn't finish connecting", { exact: false }).isVisible()).toBe(true);
      await r.page.getByRole("button", { name: "Retry", exact: true }).click();
      await r.page.getByRole("link", { name: "Connect LinkedIn", exact: true }).click();
      await expect.poll(() => r.connects.length, { timeout: 8000 }).toBe(1);
      expect(r.connects[0].searchParams.get("guest")).toBe("1");
      expect(r.connects[0].searchParams.get("next")).toBe(a.path);
      expect(r.popups).toBe(0);
      expect((await stored(r.page, a.key))?.payload?.name).toBe("Dana Ellis");
      expect((await stored(r.page, a.key))?.step).toBe(2);
      await r.page.context().close();
    });

    it(`${a.who}: back from LinkedIn — same step, same card, photo in the crop tool, Apply keeps it`, async () => {
      const r = await rig(engine, width);
      const sep = a.path.includes("?") ? "&" : "?";
      await open(r, `${a.path}${sep}li_photo=${encodeURIComponent(LI_PHOTO)}&integration=linkedin&status=photo`, "wizard",
        { ...a.props, linkedinEnabled: true }, { [a.key]: draft("Dana Ellis", "Acme") });
      // No "Continue your card?" question in the way: this is the same visit.
      expect(await r.page.getByText("Start a new card").count()).toBe(0);
      await applyCrop(r.page, r.logs);
      if (a.upload) expect(r.api).toContain("POST /api/upload");
      await expect.poll(async () => (await stored(r.page, a.key))?.images?.photo?.slice(0, 15), { timeout: 5000 })
        .toBe(a.upload ? UPLOADED.slice(0, 15) : "data:image/jpeg");
      const kept = await stored(r.page, a.key);
      expect(kept?.step).toBe(2);
      expect(kept?.payload?.name).toBe("Dana Ellis");
      // An Office member's company is the office's, whatever the held card said.
      expect(kept?.payload?.company).toBe(a.props.org ? "Northwind" : "Acme");
      // Brought to the headshot, on screen.
      expect(await r.page.locator('img[alt="Upload your headshot"]').first().isVisible()).toBe(true);
      expect(params(r.page).has("li_photo")).toBe(false);
      expect(r.errors).toEqual([]);
      await r.page.context().close();
    });
  }

  it("an Office member's held card is NOT brought back on an ordinary visit, and is dropped", async () => {
    const r = await rig(engine, width);
    await open(r, "/cards/new?add=1", "wizard", { isPro: true, draftOwner: "u-member", org: ORG, linkedinEnabled: true },
      { "swiftcard_card_hop:u-member": draft("Dana Ellis", "Acme") });
    expect(await r.page.locator("#wizard-name").inputValue()).toBe("");
    expect(await r.page.getByText("Start a new card").count()).toBe(0);
    await r.page.waitForTimeout(600);
    const held = await stored(r.page, "swiftcard_card_hop:u-member");
    expect(held?.payload?.name ?? "").toBe("");
    expect(held?.step ?? 1).toBe(1);
    await r.page.context().close();
  });
});
