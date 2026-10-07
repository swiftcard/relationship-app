import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { webkit, type Browser, type Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// INTERACTION + LAYOUT test for the Links page switch (Swift Links | Swift
// Signature, owner 2026-10-07). Bundles the REAL LinksPageTabs with the REAL
// SwiftLinkLivePreview and EmailSignatureBox, hydrates them in headless
// Chromium with the app's compiled Tailwind, and measures / clicks them at
// phone and desktop width, in the light theme (the default) and dark.
//
// Served from a real origin (page.route), not setContent: the switch keeps its
// side in location.hash, which about:blank does not have. HTTPS, because the
// clipboard API only exists in a secure context — as on swiftcard.me.

let browser: Browser;
let bundle: string;
let tmp: string;
const ORIGIN = "https://links.test";

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "linkstabs-"));

  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import LinksPageTabs, { SIGNATURE_STALE_EVENT } from "@/components/LinksPageTabs";
    import SwiftLinkLivePreview from "@/components/SwiftLinkLivePreview";
    import EmailSignatureBox from "@/components/EmailSignatureBox";
    import { SAMPLE_DATA } from "@/components/card-templates/types";

    const links = h("div", null,
      h("div", { "data-tour": "swift-links", className: "mb-4" },
        h("h2", { className: "text-base font-semibold text-white" }, "Your link-in-bio page"),
        h("p", { className: "text-gray-500 text-sm mt-1" }, "A separate link from your card.")),
      h("div", { className: "bg-gray-900 border border-gray-800/80 rounded-2xl p-5" },
        h("div", { id: "mini", className: "relative w-full max-w-[220px] sm:max-w-[240px] mx-auto mb-4 max-h-[340px] sm:max-h-[380px] overflow-hidden rounded-[30px]" },
          h(SwiftLinkLivePreview, {
            name: SAMPLE_DATA.name, handle: "alexmorgan", company: SAMPLE_DATA.company, title: SAMPLE_DATA.title,
            bio: "Bay Area homes, from first tour to closing day.",
            socials: { instagram: SAMPLE_DATA.instagram, linkedin: SAMPLE_DATA.linkedin, website: SAMPLE_DATA.website },
            links: [{ label: "Book a viewing", url: "https://coastlinehomes.com" }, { label: "Current listings", url: "https://coastlinehomes.com" }],
            paid: true,
          })),
        h("div", { className: "mt-2 grid grid-cols-2 gap-2" },
          h("a", { href: "#", className: "block text-center text-xs font-semibold text-gray-400 bg-gray-800 border border-gray-700 rounded-full py-2" }, "Open Swift Links →"),
          h("a", { href: "#", className: "block text-center text-xs font-semibold text-gray-400 bg-gray-800 border border-gray-700 rounded-full py-2" }, "Edit my links"))));

    const signature = h("div", null,
      h("div", { "data-tour": "email-signature", className: "mb-4" },
        h("h2", { className: "text-base font-semibold text-white" }, "Your card in every email")),
      h(EmailSignatureBox, {
        cardData: { ...SAMPLE_DATA }, template: "classic-pro", name: SAMPLE_DATA.name, company: SAMPLE_DATA.company ?? "",
        cardUrl: "https://swiftcard.me/alexmorgan?source=email_signature", username: "alexmorgan",
        storageUrl: "${ORIGIN}/sig/alexmorgan.png", ogUrl: "",
      }));

    (window as any).SIGNATURE_STALE_EVENT = SIGNATURE_STALE_EVENT;
    createRoot(document.getElementById("root")!).render(h("div", { className: "max-w-md mx-auto" }, h(LinksPageTabs, { links, signature })));
  `);

  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_APP_URL": '"https://swiftcard.me"',
      "process.env.__NEXT_ROUTER_BASEPATH": '""',
    },
    alias: { "@": resolve("src") },
    logLevel: "silent",
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function mount(width: number, opts: { theme?: "light" | "dark"; hash?: string } = {}): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 900 });
  const theme = opts.theme ?? "light";
  const html = `<!doctype html><html data-sc-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
     <style>body{margin:0;padding:16px 20px}</style></head>
     <body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`;
  await page.route(`${ORIGIN}/**`, (route) => {
    const u = route.request().url();
    if (u.includes("/sig/")) return route.fulfill({ status: 404, body: "" });       // never captured yet
    if (u.includes("/api/")) return route.fulfill({ status: 200, body: "{}" });
    return route.fulfill({ status: 200, contentType: "text/html", body: html });
  });
  await page.goto(`${ORIGIN}/share${opts.hash ?? ""}`);
  await page.waitForSelector('[role="tab"]');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.innerWidth)).toBe(width);
  return page;
}

// A real (1×1) PNG for the hosted signature image.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/**
 * The Swift Signature side as a person meets it, in a context that can be
 * reused for a second visit (same localStorage) and whose clipboard can be read
 * back. `hosted`: whether a signature image is already in storage. `upload`:
 * whether capturing a new one succeeds. Uploads make the hosted image exist,
 * as they do in production.
 */
async function mountSignature(opts: { hosted: boolean; upload?: "ok" | "fail"; width?: number; engine?: Browser }) {
  const css = await appCss();
  const ctx = await (opts.engine ?? browser).newContext({ viewport: { width: opts.width ?? 390, height: 900 } });
  // Chromium needs the grant; WebKit has no such permission (it fails the next
  // newPage) and allows writes inside a tap on its own, as on an iPhone.
  if (!opts.engine) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  const html = `<!doctype html><html data-sc-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
     <style>body{margin:0;padding:16px 20px}</style></head>
     <body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`;
  const state = { hosted: opts.hosted, posts: 0 };
  await ctx.route(`${ORIGIN}/**`, (route) => {
    const req = route.request();
    const u = req.url();
    if (u.includes("/sig/")) return state.hosted
      ? route.fulfill({ status: 200, contentType: "image/png", body: PNG })
      : route.fulfill({ status: 404, body: "" });
    if (u.includes("/api/card-signature")) {
      state.posts++;
      if (opts.upload === "fail") return route.fulfill({ status: 500, body: "{}" });
      state.hosted = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (u.includes("/api/")) return route.fulfill({ status: 200, body: "{}" });
    return route.fulfill({ status: 200, contentType: "text/html", body: html });
  });
  const page = await ctx.newPage();
  const open = async () => {
    await page.goto(`${ORIGIN}/share#signature`);
    await page.waitForSelector('[role="tab"]');
  };
  await open();
  return { ctx, page, state, open };
}

const copyButton = (page: Page) => page.locator("#links-panel-signature button").filter({ hasText: /Copy signature|Copied|Couldn.t copy|Generating|Copying/ }).first();
const readClipboardHtml = (page: Page) =>
  page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    for (const it of items) if (it.types.includes("text/html")) return (await it.getType("text/html")).text();
    return "";
  });

const shown = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement | null;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).display !== "none" && r.width > 0 && r.height > 0;
  }, sel);

describe("Links page: Swift Links | Swift Signature switch", () => {
  for (const width of [390, 1280]) {
    for (const theme of ["light", "dark"] as const) {
      it(`fits, reads and starts on Swift Links at ${width}px (${theme})`, async () => {
        const page = await mount(width, { theme });
        try {
          const m = await page.evaluate(() => {
            const tabs = [...document.querySelectorAll('[role="tab"]')] as HTMLElement[];
            const list = document.querySelector('[role="tablist"]') as HTMLElement;
            const label = (t: HTMLElement) => t.querySelector("span.truncate") as HTMLElement;
            const bg = (el: Element) => getComputedStyle(el).backgroundColor;
            return {
              overflow: document.documentElement.scrollWidth - window.innerWidth,
              widths: tabs.map((t) => Math.round(t.getBoundingClientRect().width)),
              heights: tabs.map((t) => Math.round(t.getBoundingClientRect().height)),
              clipped: tabs.filter((t) => label(t).scrollWidth > label(t).clientWidth + 1).map((t) => t.textContent),
              selected: tabs.map((t) => t.getAttribute("aria-selected")),
              activeBg: bg(tabs[0]),
              inactiveColor: getComputedStyle(tabs[1]).color,
              listBg: bg(list),
            };
          });
          expect(m.overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
          expect(Math.abs(m.widths[0] - m.widths[1]), `tabs are not two equal halves: ${m.widths}`).toBeLessThanOrEqual(1);
          expect(Math.min(...m.heights), "tabs too small to tap").toBeGreaterThanOrEqual(36);
          expect(m.clipped, "a tab label is cut off").toEqual([]);
          expect(m.selected).toEqual(["true", "false"]);
          // blue-600 — Tailwind v4 computes it in oklch.
          expect(m.activeBg, "the selected side is not the blue pill").toMatch(/^oklch\(0\.546 0\.245 262\.881\)$|^rgb\(37, 99, 235\)$/);
          expect(m.inactiveColor, "the unselected label is invisible on its background").not.toBe(m.listBg);
          expect(await shown(page, "#links-panel-links")).toBe(true);
          expect(await shown(page, "#links-panel-signature")).toBe(false);
          // The mini phone is a real, visible preview — not a collapsed slot.
          const mini = await page.evaluate(() => {
            const r = document.getElementById("mini")!.getBoundingClientRect();
            return { w: r.width, h: r.height };
          });
          expect(mini.w).toBeGreaterThan(200);
          expect(mini.h).toBeGreaterThan(250);
        } finally { await page.close(); }
      });
    }
  }

  it("a tap switches sides and keeps it in the URL without a history entry", async () => {
    const page = await mount(390);
    try {
      const before = await page.evaluate(() => history.length);
      await page.click("#links-tab-signature");
      expect(await shown(page, "#links-panel-signature")).toBe(true);
      expect(await shown(page, "#links-panel-links")).toBe(false);
      expect(await page.evaluate(() => location.hash)).toBe("#signature");
      expect(await page.evaluate(() => history.length)).toBe(before);
      expect(await page.getAttribute("#links-tab-signature", "aria-selected")).toBe("true");
    } finally { await page.close(); }
  });

  it("arrow keys move between sides", async () => {
    const page = await mount(1280);
    try {
      await page.focus("#links-tab-links");
      await page.keyboard.press("ArrowRight");
      expect(await page.getAttribute("#links-tab-signature", "aria-selected")).toBe("true");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("links-tab-signature");
      await page.keyboard.press("ArrowLeft");
      expect(await page.getAttribute("#links-tab-links", "aria-selected")).toBe("true");
    } finally { await page.close(); }
  });

  it("/share#signature opens on the Swift Signature side", async () => {
    const page = await mount(390, { hash: "#signature" });
    try {
      expect(await shown(page, "#links-panel-signature")).toBe(true);
      expect(await page.locator('button:has-text("Copy signature")').isVisible()).toBe(true);
    } finally { await page.close(); }
  });

  it("the guided tour can switch sides through the hash", async () => {
    const page = await mount(390);
    try {
      // What GuidedTour does for a step with `section` (replaceState + hashchange).
      await page.evaluate(() => { history.replaceState(null, "", "#signature"); window.dispatchEvent(new Event("hashchange")); });
      expect(await shown(page, '[data-tour="email-signature"]')).toBe(true);
      await page.evaluate(() => { history.replaceState(null, "", "#links"); window.dispatchEvent(new Event("hashchange")); });
      expect(await shown(page, '[data-tour="swift-links"]')).toBe(true);
    } finally { await page.close(); }
  });

  it("the mini phone comes back at full size after switching away and back", async () => {
    const page = await mount(390);
    try {
      await page.click("#links-tab-signature");
      await page.waitForTimeout(150);
      await page.click("#links-tab-links");
      await page.waitForTimeout(300);
      const h = await page.evaluate(() => document.getElementById("mini")!.getBoundingClientRect().height);
      expect(h).toBeGreaterThan(250);
    } finally { await page.close(); }
  });

  it("the signature capture card keeps its real size while its side is hidden", async () => {
    // It opens on Swift Links, so the signature side is display:none. The
    // offscreen card it captures from must not be inside it — at zero layout
    // the capture used to fall back to a 460×460 square.
    const page = await mount(390);
    try {
      expect(await shown(page, "#links-panel-signature")).toBe(false);
      await page.waitForFunction(() => {
        const host = [...document.body.children].find((el) => el.hasAttribute("inert")) as HTMLElement | undefined;
        const card = host?.firstElementChild as HTMLElement | undefined;
        return !!card && card.offsetHeight > 150;
      }, null, { timeout: 15_000 });
      const size = await page.evaluate(() => {
        const host = [...document.body.children].find((el) => el.hasAttribute("inert")) as HTMLElement;
        const card = host.firstElementChild as HTMLElement;
        return { w: card.offsetWidth, h: card.offsetHeight, inPanel: !!host.closest('[role="tabpanel"]') };
      });
      expect(size.inPanel).toBe(false);
      expect(size.w).toBe(460);
      expect(size.h).toBeLessThan(400); // a card, not the 460×460 fallback square
    } finally { await page.close(); }
  });

  it("a stale signature puts a dot on the Swift Signature tab", async () => {
    const page = await mount(390);
    try {
      expect(await page.locator("#links-tab-signature >> text=(needs updating)").count()).toBe(0);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent((window as unknown as { SIGNATURE_STALE_EVENT: string }).SIGNATURE_STALE_EVENT, { detail: true })));
      expect(await page.locator("#links-tab-signature >> text=(needs updating)").count()).toBe(1);
      const clipped = await page.evaluate(() => {
        const l = document.querySelector("#links-tab-signature span.truncate") as HTMLElement;
        return l.scrollWidth > l.clientWidth + 1;
      });
      expect(clipped, "the dot pushed the label into an ellipsis at phone width").toBe(false);
    } finally { await page.close(); }
  });
});

// The Swift Signature side's one job: a Copy button that is simply ready.
// (Owner, 2026-10-07: it sat on "Generating your card…" with Copy greyed out —
// the preview image was lazy-loaded while hidden until loaded, so it never
// loaded at all.)
describe("Swift Signature: Copy is ready and copies on the first tap", () => {
  it("the preview appears and Copy is tappable straight away when a signature exists", async () => {
    const { ctx, page } = await mountSignature({ hosted: true });
    try {
      const btn = copyButton(page);
      await expect.poll(() => btn.isEnabled(), { timeout: 2000 }).toBe(true);
      expect((await btn.innerText()).trim()).toBe("Copy signature");
      await page.waitForFunction(() => {
        const img = document.querySelector('#links-panel-signature img[alt="Your card"]') as HTMLImageElement | null;
        return !!img && img.complete && img.naturalWidth > 0 && getComputedStyle(img).display !== "none";
      }, null, { timeout: 4000 });
      expect(await page.locator("#links-panel-signature >> text=Generating your card").count()).toBe(0);
    } finally { await ctx.close(); }
  });

  it("the preview also loads while the page opens on Swift Links, ready for the switch", async () => {
    const { ctx, page } = await mountSignature({ hosted: true });
    try {
      await page.goto(`${ORIGIN}/share`);
      await page.waitForSelector('[role="tab"]');
      await page.waitForTimeout(1200);
      await page.click("#links-tab-signature");
      // No wait-and-see: the image was fetched in the background.
      const ready = await page.evaluate(() => {
        const img = document.querySelector('#links-panel-signature img[alt="Your card"]') as HTMLImageElement | null;
        return !!img && img.complete && img.naturalWidth > 0;
      });
      expect(ready, "the hidden side never fetched its preview").toBe(true);
    } finally { await ctx.close(); }
  });

  it("one tap copies the signature — the right HTML, with the card image and link", async () => {
    const { ctx, page, state } = await mountSignature({ hosted: true });
    try {
      const btn = copyButton(page);
      await expect.poll(() => btn.isEnabled(), { timeout: 2000 }).toBe(true);
      await btn.click();
      await expect.poll(async () => (await btn.innerText()).trim(), { timeout: 20_000 }).toBe("Copied ✓ Now paste it in your email");
      const html = await readClipboardHtml(page);
      expect(html).toContain(`${ORIGIN}/sig/alexmorgan.png?`);
      expect(html).toContain('alt="Alex Morgan — business card"');
      expect(html).toContain("https://swiftcard.me/alexmorgan?source=email_signature");
      expect(html).toContain("Contact me");
      // A first visit on this device captured once (content unknown here), never twice.
      expect(state.posts).toBeLessThanOrEqual(1);
    } finally { await ctx.close(); }
  });

  it("the next visit on the same device copies instantly, with no new capture", async () => {
    const { ctx, page, state, open } = await mountSignature({ hosted: true });
    try {
      // First visit: let the background capture finish and record this content.
      await expect.poll(() => state.posts, { timeout: 20_000 }).toBe(1);
      await page.waitForTimeout(500);
      await open();
      const before = state.posts;
      const btn = copyButton(page);
      await expect.poll(() => btn.isEnabled(), { timeout: 2000 }).toBe(true);
      const t0 = Date.now();
      await btn.click();
      await expect.poll(async () => (await btn.innerText()).trim(), { timeout: 3000 }).toBe("Copied ✓ Now paste it in your email");
      expect(Date.now() - t0, "copy waited on a capture it didn't need").toBeLessThan(2000);
      await page.waitForTimeout(2500);
      expect(state.posts, "an unchanged card was captured again").toBe(before);
      expect(await readClipboardHtml(page)).toContain(`${ORIGIN}/sig/alexmorgan.png?`);
    } finally { await ctx.close(); }
  });

  it("never captured before: one tap generates the card and copies it", async () => {
    const { ctx, page, state } = await mountSignature({ hosted: false });
    try {
      const btn = copyButton(page);
      expect(await btn.isEnabled(), "Copy is greyed out before the first capture").toBe(true);
      await btn.click();
      await expect.poll(async () => (await btn.innerText()).trim(), { timeout: 20_000 }).toBe("Copied ✓ Now paste it in your email");
      expect(state.posts).toBe(1);
      expect(await readClipboardHtml(page)).toContain(`${ORIGIN}/sig/alexmorgan.png?`);
      // …and the preview now shows the card it generated.
      await page.waitForFunction(() => {
        const img = document.querySelector('#links-panel-signature img[alt="Your card"]') as HTMLImageElement | null;
        return !!img && img.complete && img.naturalWidth > 0;
      }, null, { timeout: 5000 });
    } finally { await ctx.close(); }
  });

  it("a failed capture never strands the button", async () => {
    const { ctx, page } = await mountSignature({ hosted: false, upload: "fail" });
    try {
      const btn = copyButton(page);
      await btn.click();
      await expect.poll(async () => (await btn.innerText()).trim(), { timeout: 20_000 }).toBe("Couldn't copy — tap to try again");
      expect(await btn.isEnabled()).toBe(true);
      expect(await page.locator("#links-panel-signature >> text=Couldn't generate your card").count()).toBe(1);
    } finally { await ctx.close(); }
  });
});

// The same, in WebKit — the engine of the iPhone app and Safari, which only
// allows a clipboard write during the tap itself and needs three capture
// passes. The first tap must work there too.
describe("Swift Signature in WebKit (the iPhone app's engine)", () => {
  let wk: Browser;
  beforeAll(async () => { wk = await webkit.launch(); }, 120_000);
  afterAll(async () => { await wk?.close(); });

  it("the preview appears and Copy is ready straight away", async () => {
    const { ctx, page } = await mountSignature({ hosted: true, engine: wk });
    try {
      const btn = copyButton(page);
      await expect.poll(() => btn.isEnabled(), { timeout: 2000 }).toBe(true);
      await page.waitForFunction(() => {
        const img = document.querySelector('#links-panel-signature img[alt="Your card"]') as HTMLImageElement | null;
        return !!img && img.complete && img.naturalWidth > 0 && getComputedStyle(img).display !== "none";
      }, null, { timeout: 4000 });
    } finally { await ctx.close(); }
  });

  it("the first tap copies, even when the card has to be generated in that tap", async () => {
    const { ctx, page, state } = await mountSignature({ hosted: false, engine: wk });
    try {
      const btn = copyButton(page);
      await btn.click();
      await expect.poll(async () => (await btn.innerText()).trim(), { timeout: 30_000 }).toBe("Copied ✓ Now paste it in your email");
      expect(state.posts).toBe(1);
    } finally { await ctx.close(); }
  });

  it("a returning visit copies at once", async () => {
    const { ctx, page, state, open } = await mountSignature({ hosted: true, engine: wk });
    try {
      await expect.poll(() => state.posts, { timeout: 30_000 }).toBe(1);
      await page.waitForTimeout(500);
      await open();
      const before = state.posts;
      const btn = copyButton(page);
      await btn.click();
      await expect.poll(async () => (await btn.innerText()).trim(), { timeout: 3000 }).toBe("Copied ✓ Now paste it in your email");
      await page.waitForTimeout(2500);
      expect(state.posts).toBe(before);
    } finally { await ctx.close(); }
  });
});
