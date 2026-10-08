import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { appCss, launchBrowser } from "./harness";
import { storeOsBoot } from "@/lib/store-os";

// RENDER TEST — the one-store-per-device rule, in a real browser.
//
// tests/store-os.test.ts proves the boot snippet tags <html data-sc-os>
// correctly for every user agent, and tests/app-store-badge.test.ts pins the
// CSS string. Neither can see whether the badges are actually VISIBLE: that
// needs the compiled stylesheet, the snippet run by a browser engine, and
// getComputedStyle. This loads exactly what a page ships — the snippet in
// <head>, the app's real CSS, the StoreBadges markup — under each device's
// user agent and touch-point count, and counts the badges that paint.
//
// Also measures the "Get the app" badge against the App Store one: they must
// be the same height at both sizes, or the header/hero row jumps by a pixel
// depending on which computer is looking at it.

// The badge module reads the store URLs at import time (self-activating
// contract), so they are set before it is imported.
process.env.NEXT_PUBLIC_APP_STORE_URL = "https://apps.apple.com/app/id6798875872";
process.env.NEXT_PUBLIC_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=me.swiftcard.app";

// `os` is the data-sc-os value the snippet must write; `sees` the one badge
// that paints. Both are asserted, because two os values map to the same badge
// (ios and mac → apple) and a case that passes either way proves nothing.
type Device = { name: string; ua: string; touch: number; os: "ios" | "android" | "mac" | "other"; sees: "apple" | "play" | "get" };

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

const DEVICES: Device[] = [
  { name: "Pixel 7", ua: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36", touch: 5, os: "android", sees: "play" },
  { name: "Android tablet", ua: "Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", touch: 10, os: "android", sees: "play" },
  { name: "Instagram in-app on Android", ua: "Mozilla/5.0 (Linux; Android 13; SM-S908B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 Instagram 310.0.0.42.100 Android", touch: 5, os: "android", sees: "play" },
  { name: "Android in desktop-site mode", ua: LINUX_UA, touch: 5, os: "android", sees: "play" },
  { name: "iPhone 13", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", touch: 5, os: "ios", sees: "apple" },
  { name: "Instagram in-app on iPhone", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.0.28.90 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 598640424)", touch: 5, os: "ios", sees: "apple" },
  { name: "iPad posing as a Mac", ua: MAC_UA, touch: 5, os: "ios", sees: "apple" },
  { name: "Mac", ua: MAC_UA, touch: 0, os: "mac", sees: "apple" },
  { name: "Windows (Chrome)", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", touch: 0, os: "other", sees: "get" },
  { name: "Windows touchscreen (Edge)", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0", touch: 10, os: "other", sees: "get" },
  { name: "Linux desktop", ua: LINUX_UA, touch: 0, os: "other", sees: "get" },
  { name: "Chromebook", ua: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", touch: 10, os: "other", sees: "get" },
];

const CLASS: Record<Device["sees"], string> = { apple: "sc-store-apple", play: "sc-store-play", get: "sc-store-get" };

let browser: Browser;
let css: string;
let rowSm: string;
let rowLg: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement: h } = await import("react");
  const { StoreBadges } = await import("@/components/AppStoreBadge");
  rowSm = renderToStaticMarkup(h(StoreBadges, { size: "sm" }));
  rowLg = renderToStaticMarkup(h(StoreBadges, { size: "lg" }));
  // The markup must carry all three, or the test below proves nothing.
  for (const row of [rowSm, rowLg]) for (const c of Object.values(CLASS)) expect(row).toContain(c);
}, 120_000);
afterAll(async () => { await browser?.close(); });

type Painted = { visible: string[]; os: string | null; heights: Record<string, number> };

/** A page as the site ships it: the boot snippet in <head>, then the CSS, then the badges. */
async function paint(device: Device | null, withScript = true): Promise<Painted> {
  const page = await browser.newPage(device ? { userAgent: device.ua, viewport: { width: 1280, height: 800 } } : { viewport: { width: 1280, height: 800 } });
  try {
    // The device's touch-point count, stubbed in the page itself ahead of the
    // boot snippet — the one hardware fact the user agent doesn't carry (and
    // what tells an iPad from a Mac, or a desktop-mode Android from Linux).
    const touch = device ? `<script>Object.defineProperty(navigator,"maxTouchPoints",{get:function(){return ${device.touch}},configurable:true});</script>` : "";
    const boot = withScript ? `<script>${storeOsBoot({ apple: true, play: true })}</script>` : "";
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8">${touch}${boot}<style>${css}</style>
       <style>body{margin:0;padding:24px;background:#0A0B10}.row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:24px}</style>
       </head><body>
         <div id="sm" class="row">${rowSm}</div>
         <div id="lg" class="row">${rowLg}</div>
       </body></html>`,
    );
    return await page.evaluate(() => {
      const all = [...document.querySelectorAll<HTMLElement>("#sm .sc-appstore-badge")];
      const visible = all
        .filter((el) => getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0)
        .map((el) => ["sc-store-apple", "sc-store-play", "sc-store-get"].find((c) => el.classList.contains(c)) ?? "?");
      const heights: Record<string, number> = {};
      for (const size of ["sm", "lg"]) {
        for (const el of document.querySelectorAll<HTMLElement>(`#${size} .sc-appstore-badge`)) {
          const cls = ["sc-store-apple", "sc-store-play", "sc-store-get"].find((c) => el.classList.contains(c)) ?? "?";
          // Measure every badge, hidden ones included: force them on for the
          // tape measure only, then restore.
          const prev = el.style.display;
          el.style.setProperty("display", "inline-flex", "important");
          heights[`${size}:${cls}`] = el.getBoundingClientRect().height;
          el.style.display = prev;
        }
      }
      return { visible, os: document.documentElement.getAttribute("data-sc-os"), heights };
    });
  } finally {
    await page.close();
  }
}

describe("every device paints exactly one store badge", () => {
  it.each(DEVICES)("$name sees only $sees", async (device) => {
    const out = await paint(device);
    expect(out.os, "the boot snippet must have tagged <html> before the badges painted").toBe(device.os);
    expect(out.visible, `${device.name} painted ${out.visible.join(", ") || "nothing"}`).toEqual([CLASS[device.sees]]);
  }, 60_000);

  it("with no script at all (JavaScript off) the App Store badge alone shows — today's look, so nothing can flash", async () => {
    const out = await paint(null, false);
    expect(out.os).toBeNull();
    expect(out.visible).toEqual(["sc-store-apple"]);
  }, 60_000);
});

describe("the Get-the-app badge is the Apple badge's height, so no row moves between devices", () => {
  it("all three badges are the same height at sm (the header) and at lg (the phone hero)", async () => {
    const { heights } = await paint(DEVICES[0]);
    for (const size of ["sm", "lg"] as const) {
      const apple = heights[`${size}:sc-store-apple`];
      const play = heights[`${size}:sc-store-play`];
      const get = heights[`${size}:sc-store-get`];
      expect(apple, `${size} apple`).toBeGreaterThan(0);
      // Not a hard-coded pixel count — the fonts that ship decide that, and the
      // header's badge measures 41 with its hairline border — but the three in
      // one row must agree, or the row jumps depending on who is looking.
      expect(Math.abs(play - apple), `${size}: play ${play} vs apple ${apple}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(get - apple), `${size}: get ${get} vs apple ${apple}`).toBeLessThanOrEqual(0.5);
    }
    // And lg really is the taller one built for the hero's 50px button.
    expect(heights["lg:sc-store-apple"]).toBeGreaterThan(heights["sm:sc-store-apple"] + 6);
  }, 60_000);
});
