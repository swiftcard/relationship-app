import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type BrowserType } from "playwright";
import { renderToString } from "react-dom/server";
import { createElement as h } from "react";
import sharp from "sharp";
import { appCss } from "./harness";
import CardActionLinks from "@/components/CardActionLinks";
import SwiftLinkButtons from "@/components/SwiftLinkButtons";

// ── Every additional link shows its real logo and its real preview ──────────
//
// Owner, 2026-10-07: "make sure the little icon that shows on each additional
// link shows the correct preview or logo … if a user decides not to put a
// cover image or video on that additional link, you have to make sure that the
// link's default preview is working perfectly and that it works every time."
//
// The live bug this reproduces: the card page's marks are server-rendered, the
// logo arrives BEFORE the page's JavaScript, its load event fires before React
// is listening, and the logo sat downloaded at opacity 0 behind its monogram —
// on every row, in WebKit (measured on swiftcard.me before the fix). So here
// the server markup is painted first, every image is answered instantly, and
// hydration is held back until they have all loaded.
//
// Then the fallbacks, each served for real:
//   • a site with no logo → /api/link-icon 404 → monogram / link glyph, never
//     a broken image or an empty white circle;
//   • a preview picture its host refuses (403) → loaded through /api/img-proxy;
//   • a preview picture that is gone everywhere → the Look's designed tile.

const PROPS = {
  card: [
    { label: "Book a viewing", url: "https://good.test/book" },
    { label: "Our new site", url: "https://none.test/" },
  ],
  links: [
    { label: "Good logo row", url: "https://good.test/a", size: "compact" },
    { label: "No logo row", url: "https://none.test/b", size: "compact" },
    { label: "Blocked picture", url: "https://blocked.test/listing", size: "featured" },
    { label: "Dead picture", url: "https://dead.test/x", size: "grid" },
    { label: "Good picture", url: "https://good.test/page", size: "grid" },
  ],
};

let bundle: string;
let tmp: string;
let png64: Buffer;
let pngWide: Buffer;

function fixture(p: typeof PROPS) {
  return h("div", null,
    h("div", { id: "card-box", style: { width: 360 } }, h(CardActionLinks, { links: p.card })),
    h("div", { id: "links-box", style: { width: 360 } }, h(SwiftLinkButtons, { links: p.links as never, paid: true })),
  );
}

beforeAll(async () => {
  png64 = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#1d4ed8" } }).png().toBuffer();
  pngWide = await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#b91c1c" } }).png().toBuffer();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "linkicons-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { hydrateRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import CardActionLinks from "@/components/CardActionLinks";
    import SwiftLinkButtons from "@/components/SwiftLinkButtons";
    const p = ${JSON.stringify(PROPS)};
    hydrateRoot(document.getElementById("root")!, h("div", null,
      h("div", { id: "card-box", style: { width: 360 } }, h(CardActionLinks, { links: p.card })),
      h("div", { id: "links-box", style: { width: 360 } }, h(SwiftLinkButtons, { links: p.links, paid: true })),
    ));
    (window as any).__hydrated = true;
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_APP_URL": '"https://app.test"' },
    alias: { "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

async function run(type: BrowserType) {
  let browser: Browser;
  try { browser = await type.launch(); } catch { return null; } // engine not installed here
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 1200 } });
    const ssr = renderToString(fixture(PROPS));
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${await appCss()}</style></head>
      <body style="margin:0;padding:12px;background:#f4f1ec"><div id="root">${ssr}</div>
      <script type="text/plain" id="bundle">${bundle.replace(/<\/script/gi, "<\\/script")}</script>
      <script>
        // Hydrate only once every server-rendered image has settled — the
        // order the live page hit on a phone.
        function go(){ var s=document.createElement("script"); s.textContent=document.getElementById("bundle").textContent; document.body.appendChild(s); }
        window.addEventListener("load", function(){ setTimeout(go, 300); });
      </script></body></html>`;

    await page.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      const host = u.searchParams.get("host");
      const target = u.searchParams.get("url") || "";
      if (u.hostname === "app.test" && u.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
      if (u.pathname === "/api/link-icon") {
        return host === "good.test" ? route.fulfill({ contentType: "image/png", body: png64 }) : route.fulfill({ status: 404, body: "" });
      }
      if (u.pathname === "/api/link-preview") {
        const image = target.includes("blocked.test") ? "https://cdn.blocked.test/og.png"
          : target.includes("dead.test") ? "https://cdn.dead.test/og.png"
          : target.includes("good.test/page") ? "https://cdn.good.test/og.png" : null;
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ image, favicon: null, title: null }) });
      }
      if (u.pathname === "/api/img-proxy") {
        return target.includes("dead.test") ? route.fulfill({ status: 404, body: "" }) : route.fulfill({ contentType: "image/png", body: pngWide });
      }
      if (u.hostname === "cdn.good.test") return route.fulfill({ contentType: "image/png", body: pngWide });
      if (u.hostname === "cdn.blocked.test") return route.fulfill({ status: 403, body: "hotlink" });
      if (u.hostname === "cdn.dead.test") return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 204, body: "" }); // tracking beacons etc.
    });

    await page.goto("https://app.test/");
    await page.waitForFunction(() => (window as never as { __hydrated?: boolean }).__hydrated === true, null, { timeout: 30_000 });
    await page.waitForTimeout(1500);

    return await page.evaluate(() => {
      const visible = (el: Element | null) => !!el && getComputedStyle(el).opacity !== "0" && getComputedStyle(el).visibility !== "hidden";
      const rowOf = (box: string, label: string) =>
        [...document.querySelectorAll(`#${box} a, #${box} button`)].find((a) => a.textContent?.includes(label)) ?? null;

      const cardMark = (label: string) => {
        const row = rowOf("card-box", label)!;
        const img = row.querySelector("img");
        const mono = row.querySelector("span[aria-hidden]");
        return { logo: !!img && visible(img) && img.naturalWidth > 0, monogram: visible(mono) };
      };
      const linkRow = (label: string) => {
        const row = rowOf("links-box", label)!;
        const img = row.querySelector("img");
        return { logo: !!img && visible(img) && img.naturalWidth > 0, glyph: !!row.querySelector("svg path[d^='M13.19']") };
      };
      const tile = (label: string) => {
        const row = rowOf("links-box", label)!;
        const pic = row.querySelector("img.object-cover") as HTMLImageElement | null;
        return { src: pic?.getAttribute("src") ?? null, loaded: !!pic && pic.naturalWidth > 0 };
      };
      // No image anywhere on the page may be visible AND broken.
      const broken = [...document.querySelectorAll("img")]
        .filter((i) => i.complete && i.naturalWidth === 0 && visible(i))
        .map((i) => i.getAttribute("src"));

      return {
        cardGood: cardMark("Book a viewing"),
        cardNone: cardMark("Our new site"),
        rowGood: linkRow("Good logo row"),
        rowNone: linkRow("No logo row"),
        blocked: tile("Blocked picture"),
        dead: tile("Dead picture"),
        good: tile("Good picture"),
        broken,
      };
    });
  } finally {
    await browser.close();
  }
}

for (const [name, type] of [["Chromium", chromium], ["WebKit", webkit]] as const) {
  describe(`additional links in ${name}`, () => {
    it("show the real logo, the real preview, and a designed fallback — never a broken image", async () => {
      const r = await run(type);
      if (!r) return; // WebKit is optional on machines that only installed Chromium
      // The card page's Swift Links box: the logo that loaded before hydration
      // is SHOWN, and a site with no logo keeps its monogram.
      expect(r.cardGood).toEqual({ logo: true, monogram: false });
      expect(r.cardNone).toEqual({ logo: false, monogram: true });
      // The Swift Links page's rows: same rule, with the link glyph as fallback.
      expect(r.rowGood).toEqual({ logo: true, glyph: false });
      expect(r.rowNone).toEqual({ logo: false, glyph: true });
      // Tiles: a refused picture comes through the proxy; a picture that is
      // gone everywhere leaves the designed tile; a good one shows as-is.
      expect(r.blocked.src).toMatch(/^\/api\/img-proxy\?url=https%3A%2F%2Fcdn\.blocked\.test/);
      expect(r.blocked.loaded).toBe(true);
      expect(r.dead).toEqual({ src: null, loaded: false });
      expect(r.good).toEqual({ src: "https://cdn.good.test/og.png", loaded: true });
      expect(r.broken).toEqual([]);
    });
  });
}
