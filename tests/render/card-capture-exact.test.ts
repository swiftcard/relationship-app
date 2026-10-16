import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type BrowserType } from "playwright";
import { appCss } from "./harness";

// The Swift Signature — and every other picture of a card — must BE the card.
//
// Owner, 2026-10-07: "it literally has to be a copy and paste of that card …
// on one the logo's a little bigger and there's more spacing between stuff."
// html-to-image rounds every font size down and takes 0.1px more off
// (lib/capture-exact), so the picture's text was 4–8% smaller than the card's
// while every box stayed put. Measured here the only way it can be: render the
// real template, take a true screenshot of it, capture it the way the product
// does, and compare the two pixel by pixel, in Chromium and in WebKit (every
// iPhone). The stock capture is checked too, so this test proves it can see
// the difference it guards.

let bundle: string;
let tmp: string;

beforeAll(async () => {
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "capture-exact-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import { flushSync } from "react-dom";
    import ClassicPro from "@/components/card-templates/ClassicPro";
    import ModernBold from "@/components/card-templates/ModernBold";
    import PhotoFirst from "@/components/card-templates/PhotoFirst";
    import LocalBusiness from "@/components/card-templates/LocalBusiness";
    import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
    import LogoFirst from "@/components/card-templates/LogoFirst";
    import CustomCard from "@/components/card-templates/CustomCard";
    import { withoutSocials } from "@/components/card-templates/types";
    import { toPngExact } from "@/lib/capture-exact";
    import { toPng } from "html-to-image";
    import { BASE, LOGOS, HEADSHOT } from "${resolve("tests/render/card-fixtures").split("\\").join("/")}";

    const T: Record<string, any> = {
      "classic-pro": ClassicPro, "modern-bold": ModernBold, "photo-first": PhotoFirst,
      "local-business": LocalBusiness, "luxury-minimal": LuxuryMinimal, "logo-first": LogoFirst, custom: CustomCard,
    };
    // An ordinary full card: a labelled phone, email, website, address, logo, photo.
    const DATA = {
      ...BASE, email: "alex@coastlinerealty.com", website: "coastlinehomes.com",
      address: "1200 Ocean Ave, Suite 400\\nSan Francisco, CA 94122",
      logoUrl: LOGOS.square, photoUrl: HEADSHOT,
      customization: { phones: [{ number: "(415) 555-0188", label: "mobile", showOnCard: true }] },
    };
    let root: any = null;
    (window as any).mount = (t: string) => {
      root?.unmount();
      root = createRoot(document.getElementById("root")!);
      // Exactly as EmailSignatureBox renders the card it captures.
      flushSync(() => root.render(h("div", { id: "card", style: { width: 460, background: "#FAF7F2" } },
        h(T[t], { data: t === "custom" ? DATA : withoutSocials(DATA as any) }))));
    };
    (window as any).capture = async (exact: boolean) => {
      const el = document.getElementById("card")!;
      await Promise.all(Array.from(el.querySelectorAll("img")).map((i) => i.decode().catch(() => {})));
      await document.fonts.ready;
      const w = el.offsetWidth, hh = el.offsetHeight, S = 2;
      const opts = { width: w * S, height: hh * S, pixelRatio: 1, cacheBust: false, backgroundColor: "#FAF7F2",
        style: { transform: "scale(" + S + ")", transformOrigin: "top left" } };
      const shoot = () => (exact ? toPngExact(el, opts) : toPng(el, opts));
      await shoot(); // WebKit paints the first foreignObject before its fonts/images
      return shoot();
    };
    // Share of pixels that differ visibly between the screenshot and a capture.
    (window as any).diff = async (a: string, b: string) => {
      const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ia.naturalWidth, ib.naturalWidth), hh = Math.min(ia.naturalHeight, ib.naturalHeight);
      const px = (img: HTMLImageElement) => { const c = document.createElement("canvas"); c.width = w; c.height = hh; const x = c.getContext("2d")!; x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, hh).data; };
      const da = px(ia), db = px(ib);
      let off = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])) > 64) off++;
      }
      return { share: off / (w * hh), sizes: [ia.naturalWidth, ia.naturalHeight, ib.naturalWidth, ib.naturalHeight] };
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
    alias: { "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const ENGINES: Array<[string, BrowserType]> = [["chromium", chromium], ["webkit", webkit]];
const TEMPLATES = ["classic-pro", "modern-bold", "photo-first", "local-business", "luxury-minimal", "logo-first", "custom"];

for (const [engine, type] of ENGINES) {
  describe(`card picture in ${engine}`, () => {
    for (const template of TEMPLATES) {
      it(`${template}: the picture is the card`, async () => {
        const css = await appCss();
        const browser = await type.launch();
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
          await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
            <body style="margin:0;padding:16px;background:#FAF7F2"><div id="root"></div><script>${bundle}</script></body></html>`);
          await page.evaluate((t) => (window as unknown as { mount: (t: string) => void }).mount(t), template);
          await page.evaluate(async () => {
            await Promise.all(Array.from(document.querySelectorAll("img")).map((i) => i.decode().catch(() => {})));
            await document.fonts.ready;
          });
          const shot = "data:image/png;base64," + (await page.locator("#card").screenshot()).toString("base64");
          type W = { capture: (exact: boolean) => Promise<string>; diff: (a: string, b: string) => Promise<{ share: number; sizes: number[] }> };
          const exact = await page.evaluate((s) => (window as unknown as W).capture(true).then((c) => (window as unknown as W).diff(s, c)), shot);
          const stock = await page.evaluate((s) => (window as unknown as W).capture(false).then((c) => (window as unknown as W).diff(s, c)), shot);
          expect(exact.sizes[0], "the picture is not the card's size").toBe(exact.sizes[2]);
          expect(exact.sizes[1], "the picture is not the card's size").toBe(exact.sizes[3]);
          // Measured 2026-10-07: the exact picture differs from the screenshot
          // only in glyph-edge antialiasing — ≤0.6% of pixels in Chromium,
          // ≤1.9% in WebKit. The stock capture's shrunken text: 4–5% on every
          // standard template (≈1% on Custom's default layout, whose rows are
          // fixed sizes that floor less).
          expect(exact.share, "the picture doesn't match the card").toBeLessThan(0.025);
          // Proof this test can see the bug it guards. If it ever fails, the
          // library has stopped shrinking fonts and lib/capture-exact can go.
          expect(stock.share, "stock html-to-image now matches the card").toBeGreaterThan(exact.share * 1.8);
        } finally {
          await browser.close();
        }
      }, 120_000);
    }
  });
}
