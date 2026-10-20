import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// The photo crop must be the only thing on screen while it is open (owner,
// 2026-10-19). In the homepage builders it opened INSIDE the builder modal
// (fixed, z-95, its own stacking context), so the builder's pinned live
// preview covered half the photo and the builder's "Continue" button showed
// through next to "Apply". Esc also cancelled the crop and closed the whole
// builder. The same cropper serves the card builder, the card editor, the
// profile form and Office branding (ImageUpload → CropperLazy).
//
// Reproduced here with the shape that broke it: a z-95 modal with a transform
// (a containing block for fixed children), holding a sticky z-40 "live
// preview" and a "Continue" button, with the cropper opened inside it.

const PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#9a8f7a"/></svg>');

let bundle: string;
let tmp: string;

beforeAll(async () => {
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "crop-"));
  writeFileSync(
    join(tmp, "entry.tsx"),
    `
    import { createRoot } from "react-dom/client";
    import { createElement as h, useState } from "react";
    import CropModal from "@/components/CropperLazy";
    (window as any).builderClosed = false;
    (window as any).cancelled = 0;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") (window as any).builderClosed = true; });
    function Builder() {
      const [open, setOpen] = useState(true);
      return h("div", { style: { position: "fixed", inset: 0, zIndex: 95, transform: "translateZ(0)", display: "flex" } },
        h("div", { style: { flex: 1, padding: 20 } },
          open && h(CropModal, { src: ${JSON.stringify(PHOTO)}, title: "Adjust profile photo", aspect: 1, circular: true, busy: false, error: "",
            onApply: () => setOpen(false), onCancel: () => { (window as any).cancelled++; setOpen(false); } }),
          h("button", { id: "continue", style: { position: "absolute", bottom: 40, left: 40, width: 300, height: 48 } }, "Continue")),
        h("div", { id: "preview", style: { position: "sticky", top: 0, zIndex: 40, width: "50%", height: "100%", background: "#111" } }, "LIVE PREVIEW"));
    }
    createRoot(document.getElementById("root")!).render(h(Builder));
  `,
  );
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
    banner: { js: 'var process={env:{NODE_ENV:"production"}};' },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function mount(browser: Browser, width: number, height: number): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>body{margin:0}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`,
  );
  await page.waitForSelector('img[alt="Crop preview"]');
  return page;
}

const engines = [["chromium", chromium], ["webkit", webkit]] as const;

describe.each(engines)("the photo crop sits above everything (%s)", (_name, engine) => {
  let browser: Browser;
  beforeAll(async () => { browser = await engine.launch(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  for (const [width, height] of [[1280, 900], [390, 844]] as const) {
    it(`at ${width}px the crop covers the builder, its preview and its Continue button`, async () => {
      const page = await mount(browser, width, height);
      const s = await page.evaluate(() => {
        const modal = document.querySelector('[aria-modal="true"]') as HTMLElement;
        const pts = [[0.5, 0.5], [0.85, 0.5], [0.15, 0.3], [0.5, 0.92]];
        const covered = pts.map(([x, y]) => modal.contains(document.elementFromPoint(innerWidth * x, innerHeight * y)));
        const c = document.getElementById("continue")!.getBoundingClientRect();
        const atContinue = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
        const r = modal.getBoundingClientRect();
        return {
          atBody: modal.parentElement === document.body,
          covered,
          continueHidden: modal.contains(atContinue),
          full: Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight,
          buttons: Array.from(modal.querySelectorAll("button")).map((b) => b.textContent?.trim()),
        };
      });
      expect(s.atBody, "the crop must render at <body>, outside whatever opened it").toBe(true);
      expect(s.full).toBe(true);
      expect(s.covered, "something drew over the crop").toEqual([true, true, true, true]);
      expect(s.continueHidden, 'the builder\'s "Continue" shows through the crop').toBe(true);
      expect(s.buttons).toEqual(["Cancel", "Apply"]);
      await page.close();
    });
  }

  it("Esc cancels the crop and leaves the builder open", async () => {
    const page = await mount(browser, 1280, 900);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('img[alt="Crop preview"]'));
    const r = await page.evaluate(() => ({ closed: (window as never as { builderClosed: boolean }).builderClosed, cancelled: (window as never as { cancelled: number }).cancelled }));
    expect(r.cancelled).toBe(1);
    expect(r.closed, "Esc also closed the builder behind the crop").toBe(false);
    await page.close();
  });
});
