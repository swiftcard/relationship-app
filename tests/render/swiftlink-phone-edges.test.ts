import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser } from "playwright";
import { appCss } from "./harness";

// Swift Links on a phone fills the screen edge to edge (owner, 2026-11-12:
// "there is a little white line of space on the left and right sides of the
// Swiftlinks page. It's only like that on the iPhone").
//
// On a phone the page is drawn 8% smaller (`zoom: 0.92` on the sheet), and the
// zoom shrinks the sheet's 430px cap with it: the page stopped at 395.6px, so
// on every phone wider than that (iPhone 16 Pro 402, Plus / Pro Max 428-440)
// a strip of the canvas showed down both sides. Measured in a real WebKit and
// Chromium at every current phone width, with the hydrated component.

const PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#1f2937"/></svg>');

const LINKS = Array.from({ length: 4 }, (_, i) => ({ emoji: "", label: `Link ${i + 1}`, url: `https://example.com/${i}`, size: "compact" as const }));

let bundle: string;
let tmp: string;

beforeAll(async () => {
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "edges-"));
  writeFileSync(
    join(tmp, "entry.tsx"),
    `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import SwiftLinkProfile from "@/components/SwiftLinkProfile";
    window.fetch = (async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })) as any;
    (window as any).mount = (props: any) => {
      createRoot(document.getElementById("root")!).render(h(SwiftLinkProfile, {
        name: "Alex Morgan", username: "alex-morgan", logoUrl: null,
        subtitle: "Broker  ·  Morgan Realty", bio: "Helping you find home.",
        verified: false, socials: [], appUrl: "https://swiftcard.me", ...props,
      }));
    };
  `,
  );
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_APP_URL": '"https://swiftcard.me"' },
    alias: { "@": resolve("src") },
    banner: { js: 'var process={env:{NODE_ENV:"production"}};' },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function edges(browser: Browser, width: number, heroStyle: string) {
  const css = await appCss();
  const page = await browser.newPage();
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
  await page.setViewportSize({ width, height: 900 });
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><style>body{margin:0}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`;
  await page.route("https://swiftcard.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  await page.goto("https://swiftcard.me/links/alex-morgan");
  await page.evaluate(({ hs, photo, links }) => (window as never as { mount: (p: unknown) => void }).mount({
    embedded: false, photoUrl: photo, links, pageStyle: { heroStyle: hs },
  }), { hs: heroStyle, photo: PHOTO, links: LINKS });
  await page.waitForSelector("h1");
  const r = await page.evaluate(() => {
    const s = document.querySelector(".sc-sl-sheet") as HTMLElement;
    const b = s.getBoundingClientRect();
    return { left: b.left, right: b.right, vw: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth };
  });
  await page.close();
  return r;
}

const PHONES = [360, 375, 390, 393, 402, 412, 414, 420, 428, 430, 440];

describe.each([["webkit", webkit], ["chromium", chromium]] as const)("Swift Links fills a phone edge to edge (%s)", (_n, engine) => {
  let browser: Browser;
  beforeAll(async () => { browser = await engine.launch(); }, 60_000);
  afterAll(async () => { await browser?.close(); });

  for (const heroStyle of ["cover", "avatar"]) {
    it(`${heroStyle} header: no strip down either side at any phone width`, async () => {
      const bad: string[] = [];
      for (const w of PHONES) {
        const r = await edges(browser, w, heroStyle);
        // Half a pixel of slack for the zoom's sub-pixel rounding.
        if (r.left > 0.5 || r.right < r.vw - 0.5) bad.push(`${w}px: sheet spans ${r.left.toFixed(1)} → ${r.right.toFixed(1)} of ${r.vw}`);
        if (r.scrollW > r.vw) bad.push(`${w}px: page scrolls sideways (${r.scrollW} > ${r.vw})`);
      }
      expect(bad, bad.join("\n")).toEqual([]);
    }, 180_000);
  }
});
