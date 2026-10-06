import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";
import { buildContactQr, contactPersonFromCardRow } from "@/lib/contact-qr";

// INTERACTION test for Show QR's "Card link | Contact · no signal" switch:
// the REAL QRCodeModal, bundled with esbuild, in headless Chromium with the
// app's compiled Tailwind, at phone and desktop widths. A source scan can't
// tell whether the switch sits clear of the code, whether tapping it closes
// the popup, which way it opens with no signal, or whether the code on screen
// actually scans to the right thing. This reads the code off the screen.

const URL = "https://swiftcard.me/alexmorgan?source=qr_code";
const CONTACT = buildContactQr(contactPersonFromCardRow({
  username: "alexmorgan", name: "Alex Morgan", title: "Realtor", company: "Coastline Realty",
  email: "alex@coastline.com", website: "coastline.com",
  customization: {
    phones: [{ number: "(415) 555-0188", label: "mobile" }, { number: "(415) 555-0199", label: "Office" }],
    address: { street: "1200 Ocean Ave", city: "San Francisco", state: "CA", zip: "94122" },
  },
}, "https://swiftcard.me")!);
const JSQR = readFileSync(resolve("node_modules/jsqr/dist/jsQR.js"), "utf8");

let browser: Browser;
let bundle: string;
let tmp: string;
let css: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "qrswitch-"));
  // next/dynamic needs the Next runtime; React.lazy is what it does here.
  writeFileSync(join(tmp, "dynamic-stub.tsx"), `
    import { lazy, Suspense, createElement } from "react";
    export default function dynamic(load: () => Promise<any>) {
      const L = lazy(() => load().then((m) => ({ default: m.default ?? m })));
      return (props: any) => createElement(Suspense, { fallback: null }, createElement(L, props));
    }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import QRCodeModal from "@/components/QRCodeModal";
    (window as any).mount = (contact: string) => {
      createRoot(document.getElementById("root")!).render(h("div", null,
        // The card on screen, whose QR colours the popup copies.
        h("div", { "data-qr": "1", "data-qr-bg": "#ffffff", "data-qr-fg": "#0d1b3e", style: { width: 1, height: 1 } }),
        h(QRCodeModal, { url: ${JSON.stringify(URL)}, firstName: "Alex", label: "Show QR", variant: "primary", contactPayload: contact }),
      ));
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src"), "next/dynamic": join(tmp, "dynamic-stub.tsx") },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function open(width: number, offline = false): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height: 844 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:16px;background:#030712}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`,
  );
  if (offline) await ctx.setOffline(true);
  await page.evaluate((c) => (window as unknown as { mount: (c: string) => void }).mount(c), CONTACT);
  await page.click('button:has-text("Show QR")');
  await page.waitForSelector('[role="dialog"] svg');
  return { ctx, page };
}

/** Read the code on screen the way a camera does. */
async function scan(page: Page): Promise<string | null> {
  const shot = (await page.locator('[role="dialog"] [data-qr]').screenshot()).toString("base64");
  await page.addScriptTag({ content: JSQR });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const pad = 40;
    const c = document.createElement("canvas");
    c.width = img.width + pad * 2;
    c.height = img.height + pad * 2;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, pad, pad);
    const d = g.getImageData(0, 0, c.width, c.height);
    type Fn = (data: Uint8ClampedArray, w: number, h: number) => { data: string } | null;
    const w = window as unknown as { jsQR: Fn | { default: Fn } };
    const fn = typeof w.jsQR === "function" ? w.jsQR : w.jsQR.default;
    return fn(d.data, c.width, c.height)?.data ?? null;
  }, shot);
}

const pressed = (page: Page, text: string) =>
  page.getAttribute(`[role="dialog"] button:has-text("${text}")`, "aria-pressed");

describe("Show QR: Card link | Contact · no signal", () => {
  for (const width of [390, 1280]) {
    it(`${width}px: opens on the card link, flips to the contact, and each one scans`, async () => {
      const { ctx, page } = await open(width);
      expect(await pressed(page, "Card link")).toBe("true");
      expect(await scan(page)).toBe(URL);

      await page.click('[role="dialog"] button:has-text("Contact · no signal")');
      // Tapping the switch must not close the popup.
      expect(await page.isVisible('[role="dialog"]')).toBe(true);
      expect(await pressed(page, "Contact · no signal")).toBe("true");
      await page.waitForTimeout(100);
      expect(await scan(page)).toBe(CONTACT);

      // The switch sits under the code, clear of it, inside the screen.
      const box = await page.evaluate(() => {
        const r = (el: Element | null) => el!.getBoundingClientRect();
        const tile = r(document.querySelector('[role="dialog"] [data-qr]'));
        const sw = r(document.querySelector('[role="dialog"] [role="group"]'));
        return { tileBottom: tile.bottom, swTop: sw.top, swLeft: sw.left, swRight: sw.right, vw: window.innerWidth, scroll: document.documentElement.scrollWidth };
      });
      expect(box.swTop).toBeGreaterThanOrEqual(box.tileBottom);
      expect(box.swLeft).toBeGreaterThanOrEqual(0);
      expect(box.swRight).toBeLessThanOrEqual(box.vw);
      expect(box.scroll).toBeLessThanOrEqual(box.vw);

      await page.click('[role="dialog"] button:has-text("Card link")');
      await page.waitForTimeout(100);
      expect(await scan(page)).toBe(URL);
      await ctx.close();
    }, 60_000);
  }

  it("with no signal on this phone it opens on the contact", async () => {
    const { ctx, page } = await open(390, true);
    expect(await pressed(page, "Contact · no signal")).toBe("true");
    expect(await scan(page)).toBe(CONTACT);
    await ctx.close();
  }, 60_000);
});
