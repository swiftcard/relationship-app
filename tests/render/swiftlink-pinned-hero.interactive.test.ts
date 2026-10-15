import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// The pinned header photo + Photo match (owner, 2026-10-15, after link.me):
// on the real Swift Links page the cover photo stays at the top of the screen
// while the page slides up over it, dissolving into the page colour, and the
// page colour is read off the photo.
//
// Measured in a real Chromium AND WebKit (iPhone Safari is the page's main
// audience) with the hydrated component, because every part of this is
// invisible to a source scan: whether sticky actually sticks (an
// overflow:hidden ancestor silently turns it off — the mini header never once
// showed on a live page because of exactly that), whether the content paints
// ABOVE the pinned photo, and whether every button is still the thing under
// the finger at every scroll position.

const TWO_TONE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="360" fill="#7bb4f0"/><rect y="360" width="600" height="240" fill="#6e4628"/></svg>',
  );

const LINKS = Array.from({ length: 9 }, (_, i) => ({
  emoji: "", label: `Link number ${i + 1}`, url: `https://example.com/${i}`, size: "compact" as const,
}));

let bundle: string;
let tmp: string;

beforeAll(async () => {
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "pin-"));
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

type Mount = { embedded?: boolean; photoTone?: string | null; look?: string; heroStyle?: string; photoUrl?: string | null; width?: number };

async function mount(browser: Browser, opts: Mount): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
  await page.setViewportSize({ width: opts.width ?? 390, height: 844 });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>body{margin:0}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`;
  await page.route("https://swiftcard.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  await page.goto("https://swiftcard.me/links/alex-morgan");
  await page.evaluate((o) => {
    const props: Record<string, unknown> = {
      embedded: !!o.embedded,
      photoUrl: o.photoUrl === undefined ? "PHOTO" : o.photoUrl,
      links: o.links,
      pageStyle: { look: o.look, heroStyle: o.heroStyle },
    };
    if ("photoTone" in o) props.photoTone = o.photoTone;
    (window as never as { mount: (p: unknown) => void }).mount(props);
  }, { ...opts, links: LINKS, photoUrl: opts.photoUrl === undefined ? TWO_TONE : opts.photoUrl });
  await page.waitForSelector("h1");
  return page;
}

async function scrollTo(page: Page, y: number) {
  await page.evaluate((v) => window.scrollTo(0, v), y);
  // One frame for the scroll handler's rAF, one for paint.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const heroState = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-sl-hero]") as HTMLElement;
    return { top: el.getBoundingClientRect().top, opacity: Number(getComputedStyle(el).opacity), position: getComputedStyle(el).position };
  });

/** Is the element itself (or its child) what a tap at its centre lands on? */
const tappable = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
    // Below the 68px name bar, which (with the corner badge) owns the top.
    const onScreen = els.filter((e) => { const r = e.getBoundingClientRect(); return r.top > 72 && r.bottom < window.innerHeight - 4; });
    if (!onScreen.length) return null;
    return onScreen.every((e) => {
      const r = e.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === e || e.contains(hit));
    });
  }, selector);

const engines = [["chromium", chromium], ["webkit", webkit]] as const;

describe.each(engines)("Swift Links pinned header photo (%s)", (_name, engine) => {
  let browser: Browser;
  beforeAll(async () => { browser = await engine.launch(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  it("the photo stays pinned at the top and dissolves as the page scrolls over it", async () => {
    const page = await mount(browser, { photoTone: "#6E4628" });
    let s = await heroState(page);
    expect(s.position).toBe("sticky");
    expect(s.top).toBe(0);
    expect(s.opacity).toBe(1);

    await scrollTo(page, 70);
    s = await heroState(page);
    expect(Math.abs(s.top), "the photo scrolled away instead of staying pinned").toBeLessThan(1);
    expect(s.opacity).toBeGreaterThan(0.4);
    expect(s.opacity).toBeLessThan(0.75);

    await scrollTo(page, 400);
    s = await heroState(page);
    expect(Math.abs(s.top)).toBeLessThan(1);
    expect(s.opacity).toBe(0);

    // Back to the top: fully there again.
    await scrollTo(page, 0);
    expect((await heroState(page)).opacity).toBe(1);
    await page.close();
  });

  it("the mini header sticks to the top once the photo is gone", async () => {
    const page = await mount(browser, { photoTone: "#6E4628" });
    await scrollTo(page, 600);
    const bar = () => page.evaluate(() => {
      const name = Array.from(document.querySelectorAll("span")).find((e) => e.textContent === "Alex Morgan" && e.className.includes("truncate"))!;
      const barEl = name.parentElement!;
      return { top: barEl.getBoundingClientRect().top, opacity: Number(getComputedStyle(barEl).opacity) };
    });
    // Its own 300ms fade — polled, not a fixed wait: a slow CI runner caught
    // it at 0.69 after 400ms (2026-10-15) with nothing wrong on the page.
    await expect.poll(async () => (await bar()).opacity, { timeout: 3000 }).toBe(1);
    expect(Math.abs((await bar()).top), "the mini header scrolled away").toBeLessThan(1);
    await page.close();
  });

  it("every button and link is still what a tap lands on, at every scroll position", async () => {
    const page = await mount(browser, { photoTone: "#6E4628" });
    for (const y of [0, 40, 90, 140, 200, 320, 500]) {
      await scrollTo(page, y);
      for (const sel of ["main button", "main a[href]"]) {
        const ok = await tappable(page, sel);
        if (ok !== null) expect(ok, `${sel} covered at scroll ${y}`).toBe(true);
      }
    }
    await page.close();
  });

  it("Photo match paints the page in the photo's colour", async () => {
    const page = await mount(browser, { photoTone: "#6E4628" });
    const sheet = await page.evaluate(() => getComputedStyle(document.querySelector(".sc-sl-sheet")!).backgroundColor);
    // #6E4628 is a dark brown: kept as-is, with white text over it.
    expect(sheet).toBe("rgb(110, 70, 40)");
    const name = await page.evaluate(() => getComputedStyle(document.querySelector("h1")!).color);
    expect(name).toBe("rgb(255, 255, 255)");
    await page.close();
  });

  it("the editor preview reads the photo's colour in the browser", async () => {
    // No photoTone given (the previews): the component reads the photo itself.
    const page = await mount(browser, { embedded: true });
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector(".sc-sl-sheet")!).backgroundColor !== "rgb(250, 250, 247)",
      undefined,
      { timeout: 8000 },
    );
    const sheet = await page.evaluate(() => getComputedStyle(document.querySelector(".sc-sl-sheet")!).backgroundColor);
    const [r, g, b] = sheet.match(/\d+/g)!.map(Number);
    // The bottom band of the photo is brown — the page is brown, not white.
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r).toBeLessThan(160);
    await page.close();
  });

  it("no photo to match: the page is exactly Paper, as before", async () => {
    const page = await mount(browser, { photoUrl: null, photoTone: null });
    const sheet = await page.evaluate(() => getComputedStyle(document.querySelector(".sc-sl-sheet")!).backgroundColor);
    expect(sheet).toBe("rgb(250, 250, 247)");
    await page.close();
  });

  it("a Look the owner picked wins over the photo", async () => {
    const page = await mount(browser, { look: "onyx", photoTone: "#6E4628" });
    const sheet = await page.evaluate(() => getComputedStyle(document.querySelector(".sc-sl-sheet")!).backgroundColor);
    expect(sheet).toBe("rgb(25, 26, 26)");
    await page.close();
  });

  it("the preview never pins (there is no page scroll in it)", async () => {
    const page = await mount(browser, { embedded: true, photoTone: null });
    expect((await heroState(page)).position).toBe("relative");
    await page.close();
  });

  it("the short banner pins too; the compact circle has no photo to pin", async () => {
    const banner = await mount(browser, { heroStyle: "banner", photoTone: null });
    await scrollTo(banner, 60);
    const b = await heroState(banner);
    expect(b.position).toBe("sticky");
    expect(Math.abs(b.top)).toBeLessThan(1);
    expect(b.opacity).toBeLessThan(1);
    await banner.close();
    const avatar = await mount(browser, { heroStyle: "avatar", photoTone: null });
    expect(await avatar.evaluate(() => document.querySelector("[data-sl-hero]"))).toBeNull();
    await avatar.close();
  });

  it("the lightning-bolt badge stays in the top-left corner at every scroll position", async () => {
    // Owner, 2026-10-15: "that little box on the top-left corner … should
    // always stay on the top left, even when someone scrolls."
    const page = await mount(browser, { photoTone: "#6E4628" });
    const badge = () => page.evaluate(() => {
      const el = document.querySelector('[aria-label="What is Swift Links?"]') as HTMLElement;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { x: r.left, y: r.top, onTop: !!hit && (hit === el || el.contains(hit)) };
    });
    const rest = await badge();
    expect(rest.x).toBeLessThan(20);
    expect(rest.y).toBeLessThan(20);
    for (const y of [60, 200, 600, 1200]) {
      await scrollTo(page, y);
      await page.waitForTimeout(350); // the mini header's own fade
      const b = await badge();
      expect(Math.abs(b.x - rest.x), `moved sideways at ${y}`).toBeLessThan(1);
      expect(Math.abs(b.y - rest.y), `scrolled away at ${y}`).toBeLessThan(1);
      expect(b.onTop, `covered at ${y}`).toBe(true);
    }
    // …and once the name bar is showing, the bar's photo sits beside the
    // badge, never under it.
    const overlap = await page.evaluate(() => {
      const b = (document.querySelector('[aria-label="What is Swift Links?"]') as HTMLElement).getBoundingClientRect();
      const name = Array.from(document.querySelectorAll("span")).find((e) => e.textContent === "Alex Morgan" && e.className.includes("truncate"))!;
      const avatar = (name.previousElementSibling as HTMLElement).getBoundingClientRect();
      return avatar.left < b.right;
    });
    expect(overlap).toBe(false);
    await page.close();
  });

  it("a glass look's blur eases in, so it never draws a line across the photo", async () => {
    for (const look of ["frost", "aura"]) {
      const page = await mount(browser, { look, photoTone: null });
      const r = await page.evaluate(() => {
        const layer = document.querySelector("[data-sl-glass]") as HTMLElement | null;
        const hero = document.querySelector("[data-sl-hero]") as HTMLElement;
        const ls = layer ? getComputedStyle(layer) : null;
        const hs = getComputedStyle(hero);
        return {
          blur: ls ? (ls.backdropFilter || (ls as unknown as Record<string, string>).webkitBackdropFilter || "") : "",
          mask: ls ? (ls.maskImage || (ls as unknown as Record<string, string>).webkitMaskImage || "") : "",
          heroMask: hs.maskImage || (hs as unknown as Record<string, string>).webkitMaskImage || "",
        };
      });
      expect(r.blur, look).toContain("blur");
      expect(r.mask, look).toContain("gradient");
      // Aura too: the photo dissolves into its blurred backdrop instead of
      // stopping under a 42% overlay on a hard line.
      expect(r.heroMask, look).toContain("gradient");
      await page.close();
    }
  });

  it("desktop: the photo only starts fading once it reaches the top", async () => {
    const page = await mount(browser, { photoTone: "#6E4628", width: 1280 });
    await scrollTo(page, 20); // the card sits 32px down the page
    expect((await heroState(page)).opacity).toBe(1);
    await scrollTo(page, 120);
    const s = await heroState(page);
    expect(Math.abs(s.top)).toBeLessThan(1);
    expect(s.opacity).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.close();
  });
});
