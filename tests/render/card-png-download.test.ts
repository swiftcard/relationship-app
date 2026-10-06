import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type BrowserType } from "playwright";
import { appCss } from "./harness";

// "Download card (PNG)" must be the WHOLE card: headshot, logo, name, details.
//
// Owner, 2026-10-06: "When I download the card PNG, the card is missing a lot
// of details … the logo, my headshot." html-to-image draws through an SVG
// <foreignObject>, and WebKit (every iPhone, the app included) paints it before
// its images decode: the first raster came back with an empty logo slot and an
// empty photo panel, while Chromium was fine. So this runs the REAL capture
// (lib/card-png) on the REAL Your Card preview, with the headshot and logo
// served cross-origin like Supabase storage, in BOTH engines — and measures
// that every picture actually has ink in the PNG.

let bundle: string;
let tmp: string;

beforeAll(async () => {
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "cardpng-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import CardPreviewDownload from "@/components/CardPreviewDownload";
    import { SAMPLE_DATA } from "@/components/card-templates/types";
    import { CardCaptureProvider, useCardCapture } from "@/components/CardCaptureContext";
    import { captureCardPng } from "@/lib/card-png";

    function Grab() {
      const c = useCardCapture();
      // Capture, then report how much detail sits where each picture is.
      (window as any).check = async () => {
        const el = c!.cardRef.current!;
        const blob = await captureCardPng(el, c!.name);
        const img = await createImageBitmap(blob);
        const cv = document.createElement("canvas");
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const origin = el.getBoundingClientRect();
        const k = img.width / origin.width;
        const spread = Array.from(el.querySelectorAll("img")).map((im) => {
          const r = im.getBoundingClientRect();
          const x = Math.floor((r.left - origin.left) * k), y = Math.floor((r.top - origin.top) * k);
          const w = Math.max(1, Math.floor(r.width * k)), hh = Math.max(1, Math.floor(r.height * k));
          const d = ctx.getImageData(x, y, w, hh).data;
          let sum = 0, sq = 0, n = 0;
          for (let i = 0; i < d.length; i += 16) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; sq += l * l; n++; }
          const mean = sum / n;
          return Math.sqrt(Math.max(0, sq / n - mean * mean));
        });
        return { w: img.width, h: img.height, images: spread.length, spread };
      };
      return null;
    }

    (window as any).mount = (template: string) => createRoot(document.getElementById("root")!).render(
      h(CardCaptureProvider, null,
        h("div", { style: { width: 420 } },
          h(CardPreviewDownload, {
            data: { ...SAMPLE_DATA, photoUrl: "https://cdn.test/photo.jpg", logoUrl: "https://cdn.test/logo.png" },
            template, username: "alex", previewUrl: "https://swiftcard.me/alex",
          })),
        h(Grab)));
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const ENGINES: Array<[string, BrowserType]> = [["chromium", chromium], ["webkit", webkit]];
// Photo First carries the headshot panel; Classic Pro and Logo First the logo.
const TEMPLATES = ["photo-first", "classic-pro", "logo-first"];

for (const [engine, type] of ENGINES) {
  describe(`card PNG in ${engine}`, () => {
    for (const template of TEMPLATES) {
      it(`${template}: every picture is in the very first download`, async () => {
        const css = await appCss();
        const browser = await type.launch();
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          // Cross-origin images with CORS, like Supabase storage.
          await page.route("https://cdn.test/**", (route) => {
            const photo = route.request().url().endsWith("photo.jpg");
            route.fulfill({
              status: 200,
              headers: { "access-control-allow-origin": "*", "content-type": photo ? "image/jpeg" : "image/png" },
              body: readFileSync(photo ? "public/showcase/dana.jpg" : "public/brand-icon.png"),
            });
          });
          // A real origin, so same-origin fallbacks resolve like on swiftcard.me.
          await page.route("https://app.test/**", (route) => route.fulfill({
            status: 200,
            headers: { "content-type": "text/html" },
            body: `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
              <body class="sc-app" style="margin:0;padding:16px;background:#030712"><div id="root"></div><script>${bundle}</script></body></html>`,
          }));
          await page.goto("https://app.test/dashboard");
          await page.evaluate((t) => (window as unknown as { mount: (t: string) => void }).mount(t), template);
          await page.waitForFunction(() => document.querySelectorAll("img").length > 0 && Array.from(document.querySelectorAll("img")).every((i) => i.complete), null, { timeout: 30_000 });

          const r = await page.evaluate(() => (window as unknown as { check: () => Promise<{ w: number; h: number; images: number; spread: number[] }> }).check());
          expect(r.w, "not a 3× card").toBeGreaterThan(1200);
          expect(r.w / r.h).toBeGreaterThan(1.3);
          expect(r.images, "the template rendered no picture to check").toBeGreaterThan(0);
          // An unpainted slot is a flat fill (spread ≈ 0–3); a real photo or
          // logo is far busier.
          for (const s of r.spread) expect(s, "a picture is missing from the PNG").toBeGreaterThan(12);
        } finally {
          await browser.close();
        }
      }, 120_000);
    }
  });
}
