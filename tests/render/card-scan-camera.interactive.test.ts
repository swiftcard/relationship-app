import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// THE SCANNER CAMERA, DRIVEN.
//
// Owner, 2026-10-06: "Scan a business card" shows a business-card outline on
// the camera. A far-away card is not clean — it has to fit the borders; when it
// fits (or fits enough) the borders turn green so the person knows to take it.
// Owner's pick: green + steady → it snaps by itself; the shutter always works.
//
// The real AddContactModal + CardScanCamera, hydrated in Chromium with the
// app's Tailwind. The camera is a fake: getUserMedia returns a canvas stream
// that draws a pale card with text on a dark table, at a size the test sets —
// placed using the same frame geometry the component uses. Measured:
//   • far card → "Move closer", frame NOT green, nothing sent
//   • card filling the frame → green → snaps on its own → the form fills
//   • what is sent is the card crop (JPEG, ≤1400px), not the whole camera frame
//   • shutter on screen, not covered, no sideways scroll, phone and computer
//   • Free never opens the camera; a blocked camera offers "Choose a photo instead"
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";

let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "card-scan-camera-"));
  writeFileSync(join(tmp, "nav-stub.ts"), `
    export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} });
    export const usePathname = () => "/contacts";
    export const useSearchParams = () => new URLSearchParams();
  `);
  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement } from "react";
    export default function Link(props: any) {
      const { href, children, prefetch, scroll, replace, ...rest } = props;
      return createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children);
    }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import AddContactModal from "@/components/AddContactModal";
    import { guideRect, coverMap } from "@/lib/card-frame-detect";
    (window as any).geo = { guideRect, coverMap };
    (window as any).mount = (canScan: boolean) => {
      createRoot(document.getElementById("root")!).render(
        h("main", { className: "sc-app bg-gray-950 min-h-screen p-4" },
          h(AddContactModal, { variant: "scan", canScan, cardOwner: "demo", onAdded() {} })),
      );
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src"), "next/navigation": join(tmp, "nav-stub.ts"), "next/link": join(tmp, "link-stub.tsx") },
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\", NEXT_PUBLIC_SUPABASE_URL: \"https://x.supabase.co\", NEXT_PUBLIC_SUPABASE_ANON_KEY: \"k\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

/** Installed before the app: a fake back camera that draws whatever window.__scene says. */
function fakeCamera(cam: { w: number; h: number; deny?: boolean }) {
  const w = window as unknown as {
    __scene: { scale: number }; __viewW?: number; __viewH?: number;
    geo: { guideRect: (w: number, h: number) => { x: number; y: number; w: number; h: number }; coverMap: (...a: unknown[]) => { sx: number; sy: number; sw: number; sh: number } | null };
  };
  w.__scene = { scale: 0.5 };
  const md = navigator.mediaDevices ?? ({} as MediaDevices);
  Object.defineProperty(navigator, "mediaDevices", { value: md, configurable: true });
  md.getUserMedia = async () => {
    if (cam.deny) throw new DOMException("denied", "NotAllowedError");
    const c = document.createElement("canvas");
    c.width = cam.w; c.height = cam.h;
    const ctx = c.getContext("2d")!;
    const draw = () => {
      ctx.fillStyle = "#3a3026"; // wood-dark table
      ctx.fillRect(0, 0, c.width, c.height);
      // Where the on-screen frame lands in camera pixels — then scale the card about its centre.
      const vw = innerWidth, vh = innerHeight;
      const g = w.geo.guideRect(vw, vh);
      const m = w.geo.coverMap(g, vw, vh, c.width, c.height, 1, 1, false);
      if (m) {
        const k = w.__scene.scale;
        const cw = m.sw * k, ch = m.sh * k;
        const x = m.sx + (m.sw - cw) / 2, y = m.sy + (m.sh - ch) / 2;
        ctx.fillStyle = "#f2efe6";
        ctx.beginPath(); ctx.roundRect(x, y, cw, ch, cw * 0.03); ctx.fill();
        ctx.fillStyle = "#1b2433";
        ctx.font = `bold ${ch * 0.12}px sans-serif`; ctx.fillText("Jordan Rivera", x + cw * 0.08, y + ch * 0.3);
        ctx.font = `${ch * 0.07}px sans-serif`;
        ctx.fillText("Northbeam Studio", x + cw * 0.08, y + ch * 0.45);
        ctx.fillText("jordan@example.com", x + cw * 0.08, y + ch * 0.72);
        ctx.fillText("(415) 555-0148", x + cw * 0.08, y + ch * 0.84);
      }
      requestAnimationFrame(draw);
    };
    draw();
    const stream = c.captureStream(30);
    const track = stream.getVideoTracks()[0];
    const real = track.getSettings.bind(track);
    track.getSettings = () => ({ ...real(), facingMode: "environment" });
    return stream;
  };
}

type Sent = { mediaType: string; bytes: number; width: number; height: number };

async function open(width: number, opts: { canScan?: boolean; deny?: boolean; light?: boolean } = {}): Promise<{ page: Page; sent: Sent[] }> {
  const phone = width < 768;
  const height = phone ? 844 : 800;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: phone, isMobile: phone });
  const page = await ctx.newPage();
  const sent: Sent[] = [];
  await page.route(`${ORIGIN}/api/scanner`, async (r) => {
    const body = r.request().postDataJSON() as { imageBase64: string; mediaType: string };
    const buf = Buffer.from(body.imageBase64, "base64");
    // JPEG SOF0/SOF2 → height, width.
    let wpx = 0, hpx = 0;
    for (let i = 2; i < buf.length - 9; ) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) { hpx = buf.readUInt16BE(i + 5); wpx = buf.readUInt16BE(i + 7); break; }
      i += 2 + len;
    }
    sent.push({ mediaType: body.mediaType, bytes: buf.length, width: wpx, height: hpx });
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "Jordan Rivera", email: "jordan@example.com", phone: "(415) 555-0148", company: "Northbeam Studio" }) });
  });
  await page.route(`${ORIGIN}/api/**`, (r) => r.fallback());
  await page.route(`${ORIGIN}/contacts*`, (r) => r.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html${opts.light ? ' data-sc-theme="light"' : ""}><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css}</style></head>
           <body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`,
  }));
  await page.addInitScript(fakeCamera, phone ? { w: 1080, h: 1920, deny: opts.deny } : { w: 1280, h: 720, deny: opts.deny });
  await page.goto(`${ORIGIN}/contacts`);
  await page.evaluate((c) => (window as unknown as { mount: (c: boolean) => void }).mount(c), opts.canScan ?? true);
  return { page, sent };
}

const setScale = (p: Page, scale: number) => p.evaluate((s) => { (window as unknown as { __scene: { scale: number } }).__scene.scale = s; }, scale);

describe.each([[390, false], [390, true], [1280, false]] as [number, boolean][])("%ipx, light theme: %s", (width, light) => {
  it("far card → Move closer; card filling the frame → green → snaps → form fills", async () => {
    const { page, sent } = await open(width, { light });
    try {
      await page.getByRole("button", { name: "Scan a card" }).click();
      const cam = page.locator("[data-card-scan-camera]");
      await cam.waitFor();

      // Far away: told to come closer, never green, nothing sent.
      await expect.poll(() => page.locator("[data-card-hint]").textContent(), { timeout: 8000 }).toBe("Move closer");
      await page.waitForTimeout(1200);
      expect(await page.locator("[data-card-frame]").getAttribute("data-card-frame")).not.toBe("fit");
      expect(sent).toHaveLength(0);

      // Layout: frame on screen, shutter visible and on top, no sideways scroll.
      const facts = await page.evaluate(() => {
        const f = document.querySelector("[data-card-frame]")!.getBoundingClientRect();
        const s = document.querySelector("[data-card-shutter]")!.getBoundingClientRect();
        const hit = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
        const hint = document.querySelector("[data-card-hint]") as HTMLElement;
        return {
          frame: { l: f.left, r: f.right, t: f.top, b: f.bottom, w: f.width },
          shutter: { t: s.top, b: s.bottom, w: s.width },
          shutterOnTop: !!hit && !!hit.closest("[data-card-shutter]"),
          overflow: document.documentElement.scrollWidth > innerWidth,
          hintColor: getComputedStyle(hint).color,
          vw: innerWidth, vh: innerHeight,
        };
      });
      expect(facts.frame.l).toBeGreaterThan(0);
      expect(facts.frame.r).toBeLessThan(facts.vw);
      expect(facts.frame.b).toBeLessThan(facts.shutter.t);
      expect(facts.shutter.b).toBeLessThanOrEqual(facts.vh);
      expect(facts.shutter.w).toBeGreaterThanOrEqual(64);
      expect(facts.shutterOnTop).toBe(true);
      expect(facts.overflow).toBe(false);
      expect(facts.hintColor).toBe("rgb(255, 255, 255)");
      if (width === 390) expect(facts.frame.w).toBeGreaterThan(300);
      await page.screenshot({ path: `node_modules/.cache/card-scan-far-${width}${light ? "-light" : ""}.png` });

      // Fill the frame: it turns green and takes the photo by itself.
      await setScale(page, 1);
      await expect.poll(() => page.locator("[data-card-frame]").getAttribute("data-card-frame").catch(() => "gone"), { timeout: 8000 })
        .toMatch(/fit|gone/);
      await cam.waitFor({ state: "detached", timeout: 8000 });
      await expect.poll(() => page.getByPlaceholder("Sarah Williams").inputValue(), { timeout: 8000 }).toBe("Jordan Rivera");
      expect(await page.getByPlaceholder("sarah@acme.com").inputValue()).toBe("jordan@example.com");

      // What went up is the card, cropped and small — not the whole camera frame.
      expect(sent).toHaveLength(1);
      expect(sent[0].mediaType).toBe("image/jpeg");
      expect(Math.max(sent[0].width, sent[0].height)).toBeLessThanOrEqual(1400);
      expect(sent[0].width / sent[0].height).toBeGreaterThan(1.5);
      expect(sent[0].width / sent[0].height).toBeLessThan(2.0);
      expect(sent[0].bytes).toBeLessThan(400_000);
      await page.screenshot({ path: `node_modules/.cache/card-scan-filled-${width}${light ? "-light" : ""}.png` });
    } finally {
      await page.context().close();
    }
  });
});

describe("shutter, Free, and a blocked camera", () => {
  it("the shutter takes the photo even when the frame isn't green", async () => {
    const { page, sent } = await open(390);
    try {
      await page.getByRole("button", { name: "Scan a card" }).click();
      await page.locator("[data-card-hint]", { hasText: "Move closer" }).waitFor({ timeout: 8000 });
      await page.locator("[data-card-shutter]").click();
      await page.locator("[data-card-scan-camera]").waitFor({ state: "detached" });
      await expect.poll(() => sent.length, { timeout: 8000 }).toBe(1);
    } finally {
      await page.context().close();
    }
  });

  it("Free: the scan button says Pro and never opens the camera", async () => {
    const { page } = await open(390, { canScan: false });
    try {
      await page.getByRole("button", { name: "Scan a card" }).click();
      await page.getByText("Scanning business cards is a Pro feature.").waitFor();
      expect(await page.locator("[data-card-scan-camera]").count()).toBe(0);
      expect(await page.evaluate(() => document.querySelectorAll("video").length)).toBe(0);
    } finally {
      await page.context().close();
    }
  });

  it("camera blocked → says so and offers Choose a photo instead", async () => {
    const { page } = await open(390, { deny: true });
    try {
      await page.getByRole("button", { name: "Scan a card" }).click();
      await page.getByText("Camera access was blocked.", { exact: false }).waitFor();
      const chooser = page.waitForEvent("filechooser", { timeout: 4000 });
      await page.getByRole("button", { name: "Choose a photo instead" }).click();
      await chooser;
      expect(await page.locator("[data-card-scan-camera]").count()).toBe(0);
    } finally {
      await page.context().close();
    }
  });

  it("closing the camera leaves the Add contact form open, and stops the camera", async () => {
    const { page } = await open(390);
    try {
      await page.getByRole("button", { name: "Scan a card" }).click();
      await page.locator("[data-card-hint]", { hasText: "Move closer" }).waitFor({ timeout: 8000 });
      const track = await page.evaluateHandle(() => (document.querySelector("video")!.srcObject as MediaStream).getVideoTracks()[0]);
      await page.getByRole("button", { name: "Close camera" }).click();
      await page.locator("[data-card-scan-camera]").waitFor({ state: "detached" });
      expect(await track.evaluate((t) => (t as MediaStreamTrack).readyState)).toBe("ended");
      await page.getByPlaceholder("Sarah Williams").waitFor();
    } finally {
      await page.context().close();
    }
  });
});
