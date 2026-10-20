import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── THE HOMEPAGE MINI-BUILDER, MEASURED ON A PHONE ───────────────────────────
//
// A REAL production bug, found 2026-09-15 by driving swiftcard.me at 390px: the
// "Build your Swift Links page" panel measured 418px wide inside a 390px screen, so the
// step subtitle, both inputs and the Continue button were clipped off the right
// edge. It had been live.
//
// The cause is subtle enough that it will come back if nothing watches it. The
// modal panel is a FLEX ITEM and its columns are GRID ITEMS; both default to
// `min-width: auto`, so neither will shrink below its content's min-content
// width. A `truncate` sets `white-space: nowrap`, whose min-content is the WHOLE
// string — so one long unbreakable link (swiftcard.me/links/AlexMorgan-Morgan…)
// set the width of the entire modal. `min-w-0` down that chain is what lets
// `w-full` actually mean w-full.
//
// The modal portals to document.body and returns null when `document` is
// undefined, so renderToStaticMarkup produces NOTHING and a server-rendered
// version of this test would pass while measuring an empty page. It has to be
// mounted for real — same discipline as the other .interactive tests.

let browser: Browser;
let bundle: string;
let tmp: string;

// Long enough to overflow a phone if anything in the chain forgets min-w-0.
const LONG_HANDLE = "swiftcard.me/links/AlexanderMontgomery-MontgomeryCapitalPartners";

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "mbf-"));

  writeFileSync(
    join(tmp, "entry.tsx"),
    `
    import { createRoot } from "react-dom/client";
    import { createElement as h, useState } from "react";
    import MiniBuilderModal from "@/components/site/MiniBuilderModal";

    // The real first step of the SwiftLink builder: a truncating link row is
    // exactly the shape that blew the layout out.
    function LinkRow() {
      return h("div", { className: "flex items-center gap-2 min-w-0 rounded-xl px-3.5 py-2.5", style: { background: "#15171F" } },
        h("span", { className: "text-white/40 text-[0.75rem] shrink-0" }, "Your link"),
        h("span", { className: "min-w-0 text-white font-semibold text-sm truncate" }, ${JSON.stringify(LONG_HANDLE)}),
      );
    }

    function Harness() {
      const [step, setStep] = useState(0);
      return h(MiniBuilderModal, {
        open: true,
        onClose: () => {},
        eyebrow: "Build your Swift Links page",
        step, setStep,
        steps: [{
          title: "Name your Swift Links page",
          subtitle: "Your link is built from your name and business. This is the page that lives in your bio.",
          content: h(LinkRow),
        }],
        // Faithful to the real previews, which are all w-[260px] max-w-full /
        // w-full — a fixed 260 with no max-width is a fixture bug, not a
        // product one, and it fails at 320px for the wrong reason.
        preview: h("div", { style: { width: 260, maxWidth: "100%", height: 380, background: "#222", borderRadius: 18 } }),
        previewCaption: "Lives in your Instagram, TikTok, or email bio.",
        onLaunch: () => {},
      });
    }

    (window as any).mount = () => {
      createRoot(document.getElementById("root")!).render(h(Harness));
    };
  `,
  );

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
    },
    alias: { "@": resolve("src") },
    banner: { js: 'var process={env:{NODE_ENV:"production"}};' },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function mount(width: number): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
  await page.setViewportSize({ width, height: 900 });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;background:#0b0f16}</style></head>
     <body><div id="root"></div><script>${bundle}</script></body></html>`;
  await page.route("https://swiftcard.me/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
  );
  await page.goto("https://swiftcard.me/");
  await page.evaluate(() => (window as never as { mount: () => void }).mount());
  // The modal is portaled, so wait for its own content rather than #root.
  await page.waitForSelector("text=Name your Swift Links page");
  return page;
}

// 320 is the narrowest phone we support; 390 is the iPhone the owner tests on.
const WIDTHS = [320, 360, 390, 430];

describe("the homepage mini-builder fits the phone", () => {
  for (const width of WIDTHS) {
    it(`renders nothing past the right edge at ${width}px`, async () => {
      const page = await mount(width);
      try {
        // Guard the harness itself: an empty page would pass every check below.
        const painted = await page.evaluate(() => {
          const t = document.body.innerText;
          // Title AND the nav row: proves the whole panel painted, not a shell.
          return t.includes("Name your Swift Links page") && /Make it live|Continue/.test(t);
        });
        expect(painted, "the modal did not mount — this test would be vacuous").toBe(true);

        const offenders = await page.evaluate((w) => {
          const bad: { cls: string; left: number; right: number; text: string }[] = [];
          for (const el of Array.from(document.querySelectorAll("body *"))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            // Decorative glare/glow layers are deliberately drawn outside their
            // clipping parent: they cannot be seen and cannot be scrolled to.
            const cls = String((el as HTMLElement).className || "");
            if (/rd-glow|rd-ll-shine|rd-claim-glare|sc-shine/.test(cls)) continue;
            if (r.right > w + 1 || r.left < -1) {
              bad.push({
                cls: cls.slice(0, 50),
                left: Math.round(r.left),
                right: Math.round(r.right),
                text: (el.textContent || "").trim().slice(0, 30),
              });
            }
          }
          return bad;
        }, width);
        expect(offenders, `clipped at ${width}px: ${JSON.stringify(offenders.slice(0, 4))}`).toEqual([]);
      } finally { await page.close(); }
    });
  }

  it("never makes the page scroll sideways", async () => {
    const page = await mount(390);
    try {
      const { scrollW, innerW } = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      }));
      expect(scrollW, "the modal is forcing horizontal page scroll").toBeLessThanOrEqual(innerW + 1);
    } finally { await page.close(); }
  });

  it("ellipsizes a long link instead of widening the modal", async () => {
    // The precise failure: the link's min-content became the modal's width.
    const page = await mount(390);
    try {
      const m = await page.evaluate((handle) => {
        const el = Array.from(document.querySelectorAll("span")).find((s) => s.textContent === handle);
        if (!el) return null;
        return { boxWidth: Math.round(el.getBoundingClientRect().width), scrollWidth: el.scrollWidth };
      }, LONG_HANDLE);
      expect(m, "the long link row is missing from the render").not.toBeNull();
      // Laid out narrower than its own text — i.e. actually ellipsized.
      expect(m!.boxWidth).toBeLessThan(m!.scrollWidth);
      expect(m!.boxWidth).toBeLessThan(390);
    } finally { await page.close(); }
  });
});
