import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";
import { LOOK_FAMILIES, looksInFamily } from "@/lib/swiftlink-looks";

// Social design → Look: Solid, Gradient and Glass all start CLOSED and open
// when tapped (owner, 2026-09-29: "make sure everything opens on the screen
// cleanly"). This drives the REAL SwiftLinkStyleControls, hydrated in headless
// Chromium with the app's compiled Tailwind, and TAPS the groups — the static
// render tests can see what is shown on arrival but can't click.
//
// Measured at phone and computer widths, in both ways the panel scrolls in the
// product: the whole PAGE (Edit card, the new-card wizard) and a scrolling
// POP-UP (the website's builder, components/site/MiniBuilderModal).
//
// "Cleanly" means, for every tap:
//   • the row you tapped stays where your finger is — switching from an open
//     Solid to Glass collapses ten looks above Glass, which used to throw the
//     row you tapped up the screen;
//   • the looks you opened end up on screen, not below the fold;
//   • every look sits inside the panel, none overlapping, none clipped.

let browser: Browser;
let bundle: string;
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "look-picker-"));
  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement } from "react";
    export default function Link(props: any) {
      const { href, children, scroll, ...rest } = props;
      return createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children);
    }
  `);
  writeFileSync(join(tmp, "plangate-stub.tsx"), `
    export function PlanGate({ children }: any) { return children; }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h, useState } from "react";
    import { SwiftLinkStyleControls } from "@/components/SwiftLinkDesign";

    // Observe (never change) the reveal: record where the tapped row is at the
    // moment the picker starts its smooth scroll to show the opened looks —
    // the instant a "jump" would show. The picker's reveal is the only
    // scrollBy called with an options object; the instant keep-in-place
    // correction uses plain numbers and is what this checks the result of.
    const w = window as any;
    const rec = () => { if (w.__trackRow && w.__atReveal == null) w.__atReveal = w.__trackRow.getBoundingClientRect().top; };
    const winBy = window.scrollBy.bind(window);
    w.scrollBy = (a: any, b?: any) => { if (typeof a === "object") { rec(); return winBy(a); } return winBy(a, b); };
    const elBy = Element.prototype.scrollBy;
    Element.prototype.scrollBy = function (this: Element, a?: any, b?: any) {
      if (typeof a === "object") { rec(); return elBy.call(this, a); }
      return elBy.call(this, a, b);
    };

    function Harness({ locked }: { locked: boolean }) {
      const [value, setValue] = useState<any>({});
      return h(SwiftLinkStyleControls, {
        value,
        onChange: (patch: any) => setValue((v: any) => ({ ...v, ...patch })),
        locked,
        canUpload: false,
      });
    }

    (window as any).mount = ({ mode, locked, chrome }: { mode: "page" | "modal"; locked: boolean; chrome: boolean }) => {
      const root = document.getElementById("root")!;
      // Content above the panel, so the Look section sits mid-screen the way
      // it does under the Page header section in the real editors. A full-
      // screen backdrop sits behind the pop-up, as in the new-card wizard.
      // chrome: the pinned things the product really has — the website
      // builder's live preview stuck over the top of its pop-up on a phone,
      // and the tab bar along the bottom of the page (Office branding).
      const stickyTop = chrome ? '<div class="sticky top-0 z-20" style="height:220px;background:#0a0b10"></div>' : "";
      const tabBar = chrome ? '<nav class="fixed bottom-0 left-0 right-0 z-40" style="height:72px;background:#111"></nav>' : "";
      if (mode === "modal") {
        root.innerHTML = '<div class="fixed inset-0" style="background:rgba(3,7,18,.97)"></div><div id="scroller" class="fixed inset-0 overflow-y-auto">' + stickyTop + '<div style="height:360px"></div><div id="panel" style="width:var(--w);margin:0 auto"></div><div style="height:200px"></div></div>';
      } else {
        root.innerHTML = '<div style="height:360px"></div><div id="panel" style="width:var(--w);margin:0 auto"></div><div style="height:200px"></div>' + tabBar;
      }
      createRoot(document.getElementById("panel")!).render(h(Harness, { locked }));
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
    alias: {
      "next/link": join(tmp, "link-stub.tsx"),
      "@/components/PlanGate": join(tmp, "plangate-stub.tsx"),
      "@": resolve("src"),
    },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

type Mode = "page" | "modal";

async function mount(width: number, height: number, mode: Mode, opts: { locked?: boolean; chrome?: boolean } = {}): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });
  // The editors' panel column: the full phone width less its gutters, or the
  // ~400px design column on a computer.
  const panelW = width < 700 ? width - 32 : 400;
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>:root{--w:${panelW}px} body{margin:0;background:#030712}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`,
  );
  await page.evaluate((o) => (window as unknown as { mount: (x: unknown) => void }).mount(o), { mode, locked: !!opts.locked, chrome: !!opts.chrome });
  await page.waitForSelector("button[aria-expanded]");
  expect(await page.evaluate(() => window.innerWidth)).toBe(width);
  return page;
}

/** The visible band: below any pinned preview, above any tab bar. */
function band(page: Page) {
  return page.evaluate(() => {
    const scroller = document.getElementById("scroller");
    const sticky = scroller?.querySelector(".sticky") as HTMLElement | null;
    const bar = document.querySelector("nav.fixed") as HTMLElement | null;
    return {
      top: sticky ? sticky.getBoundingClientRect().bottom : 0,
      bottom: bar ? bar.getBoundingClientRect().top : (scroller ? scroller.clientHeight : window.innerHeight),
    };
  });
}

/** Scroll the Look section so its FIRST row sits at `y` on screen. */
async function placeLookAt(page: Page, y: number) {
  await page.evaluate((target) => {
    const row = document.querySelectorAll("button[aria-expanded]")[0] as HTMLElement;
    const scroller = document.getElementById("scroller");
    const delta = row.getBoundingClientRect().top - target;
    if (scroller) scroller.scrollTop += delta; else window.scrollBy(0, delta);
  }, y);
  await page.waitForTimeout(50);
}

/** Tap family `i` and report where things landed once any scrolling settles. */
async function tap(page: Page, i: number) {
  // A person can only tap a row they can see: when an open group above has
  // pushed this row off screen, scroll it into the visible band first, the
  // way someone would.
  const b = await band(page);
  await page.evaluate(({ idx, top, bottom }) => {
    const row = document.querySelectorAll("button[aria-expanded]")[idx] as HTMLElement;
    const r = row.getBoundingClientRect();
    if (r.top >= top && r.bottom <= bottom) return;
    const scroller = document.getElementById("scroller");
    const delta = r.top - (top + 40);
    if (scroller) scroller.scrollTop += delta; else window.scrollBy(0, delta);
  }, { idx: i, top: b.top, bottom: b.bottom });
  const before = await page.evaluate((idx) => {
    const row = document.querySelectorAll("button[aria-expanded]")[idx] as HTMLElement;
    const w = window as unknown as { __trackRow: HTMLElement; __atReveal: number | null };
    w.__trackRow = row;
    w.__atReveal = null;
    return row.getBoundingClientRect().top;
  }, i);
  // A real pointer tap at the row's centre, not element.click().
  const box = await page.locator("button[aria-expanded]").nth(i).boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  // Where the row was once the tap had been handled, before any reveal
  // scroll: at the reveal's start when there is one (opening), otherwise on
  // the next frame (closing never scrolls).
  const justAfter = await page.evaluate((idx) => {
    return new Promise<number>((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const w = window as unknown as { __atReveal: number | null };
      const row = document.querySelectorAll("button[aria-expanded]")[idx] as HTMLElement;
      res(w.__atReveal ?? row.getBoundingClientRect().top);
    })));
  }, i);
  // Let a smooth reveal finish: wait until the scroll position has stopped
  // changing, not a fixed time — under load a fixed wait caught it mid-glide.
  await page.evaluate(() => new Promise<void>((res) => {
    const sc = document.getElementById("scroller");
    const pos = () => (sc ? sc.scrollTop : window.scrollY);
    let last = pos(), still = 0, frames = 0;
    const tick = () => {
      const p = pos();
      still = p === last ? still + 1 : 0;
      last = p;
      if (still >= 8 || ++frames > 240) return res();
      requestAnimationFrame(tick);
    };
    setTimeout(() => requestAnimationFrame(tick), 60);
  }));
  const after = await page.evaluate((idx) => {
    const rows = [...document.querySelectorAll("button[aria-expanded]")] as HTMLElement[];
    const row = rows[idx];
    const group = row.parentElement as HTMLElement;
    const panel = row.closest(".rounded-xl") as HTMLElement;
    const pr = panel.getBoundingClientRect();
    const swatches = [...group.querySelectorAll("button[aria-pressed]")] as HTMLElement[];
    const boxes = swatches.map((s) => s.getBoundingClientRect());
    let overlaps = 0;
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a], B = boxes[b];
      if (A.left < B.right - 0.5 && B.left < A.right - 0.5 && A.top < B.bottom - 0.5 && B.top < A.bottom - 0.5) overlaps++;
    }
    const gr = group.getBoundingClientRect();
    return {
      open: rows.filter((r) => r.getAttribute("aria-expanded") === "true").length,
      thisOpen: row.getAttribute("aria-expanded") === "true",
      groupTop: gr.top,
      groupBottom: gr.bottom,
      swatches: swatches.length,
      outsidePanel: boxes.filter((b) => b.left < pr.left - 0.5 || b.right > pr.right + 0.5).length,
      tiny: boxes.filter((b) => b.width < 60 || b.height < 30).length,
      clippedText: swatches.filter((s) => [...s.querySelectorAll("span,p")].some((t) => (t as HTMLElement).scrollWidth > (t as HTMLElement).clientWidth + 1 && getComputedStyle(t).overflow === "visible")).length,
      overlaps,
      hOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  }, i);
  return { before, justAfter, band: await band(page), ...after };
}

type Tapped = Awaited<ReturnType<typeof tap>>;

/** The opened looks are on screen, clear of anything pinned. */
function expectOnScreen(r: Tapped, name: string) {
  const { top, bottom } = r.band;
  // Never under a pinned preview / header.
  expect(r.groupTop, `${name}: the group slid under something pinned at the top`).toBeGreaterThanOrEqual(top - 1);
  if (r.groupBottom - r.groupTop <= bottom - top - 16) {
    // Fits: the whole group is shown, above any tab bar.
    expect(r.groupBottom, `${name}: looks left below the fold or under the tab bar`).toBeLessThanOrEqual(bottom + 1);
  } else {
    // Taller than the screen: it is raised as far as it can go, so as many
    // looks as possible show.
    expect(r.groupTop, `${name}: a tall group was not raised to the top`).toBeLessThanOrEqual(top + 10);
  }
}

const FAM = LOOK_FAMILIES.map((f) => f.id);
const SIZES: [string, number, number][] = [["phone 390", 390, 844], ["phone 320", 320, 568], ["computer", 1280, 800]];
const SETUPS: [string, Mode, boolean][] = [
  ["page scroll — Edit card", "page", false],
  ["pop-up scroll — the new-card wizard / website builder", "modal", false],
  ["page with a tab bar along the bottom — Office branding", "page", true],
  ["pop-up with a live preview pinned on top — website builder on a phone", "modal", true],
];

for (const [setup, mode, chrome] of SETUPS) {
  describe(`Look groups open cleanly (${setup})`, () => {
    for (const [label, w, hgt] of SIZES) {
      // A 220px pinned preview leaves a 568px phone too little room to test
      // anything meaningful, and the builder's pinned preview is phone-only.
      if (chrome && mode === "modal" && (hgt < 700 || w > 700)) continue;
      it(`${label}: every group opens in place, on screen, and tidy`, async () => {
        const page = await mount(w, hgt, mode, { chrome });
        try {
          const b = await band(page);
          for (let i = 0; i < FAM.length; i++) {
            // Put the Look section in the lower half of the visible area — the
            // case where opening could drop the looks below the fold.
            await placeLookAt(page, Math.round(b.top + (b.bottom - b.top) * 0.55));
            const r = await tap(page, i);
            const name = FAM[i];
            expect(r.thisOpen, `${name} did not open`).toBe(true);
            expect(r.open, `${name}: more than one group open`).toBe(1);
            expect(r.swatches, name).toBe(looksInFamily(name).length);
            // Opening never moves the row under your finger.
            expect(Math.abs(r.justAfter - r.before), `${name}: the tapped row jumped`).toBeLessThan(2);
            expectOnScreen(r, name);
            expect(r.outsidePanel, `${name}: a look spills out of the panel`).toBe(0);
            expect(r.overlaps, `${name}: looks overlap`).toBe(0);
            expect(r.tiny, `${name}: a look is squashed`).toBe(0);
            expect(r.clippedText, `${name}: a look's name is cut off`).toBe(0);
            expect(r.hOverflow, `${name}: the page scrolls sideways`).toBe(false);
            // Close it again, and nothing is left open.
            const c = await tap(page, i);
            expect(c.thisOpen, `${name} did not close`).toBe(false);
            expect(c.open).toBe(0);
            expect(Math.abs(c.justAfter - c.before), `${name}: closing moved the row`).toBeLessThan(2);
          }
        } finally { await page.close(); }
      }, 120_000);

      it(`${label}: switching from an open group keeps the tapped row under your finger`, async () => {
        const page = await mount(w, hgt, mode, { chrome });
        try {
          const b = await band(page);
          // Solid open (the biggest group), then tap each group BELOW it.
          for (const next of [1, 2]) {
            await placeLookAt(page, b.top + 40);
            await tap(page, 0);
            const r = await tap(page, next);
            expect(r.thisOpen, `${FAM[next]} did not open`).toBe(true);
            expect(r.open, "the previous group stayed open").toBe(1);
            expect(Math.abs(r.justAfter - r.before), `${FAM[next]}: the row jumped when ${FAM[0]} closed above it`).toBeLessThan(2);
            expectOnScreen(r, FAM[next]);
            // Leave everything closed for the next round.
            await tap(page, next);
          }
        } finally { await page.close(); }
      }, 120_000);
    }
  });
}

describe("picking a look", () => {
  it("selects it, keeps its group open, and names it on the row", async () => {
    const page = await mount(390, 844, "page");
    try {
      await placeLookAt(page, 200);
      await tap(page, 2); // Glass
      const target = looksInFamily("glass")[1];
      await page.locator("button[aria-pressed]").nth(1).click();
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("button[aria-expanded]")] as HTMLElement[];
        const pressed = [...document.querySelectorAll('button[aria-pressed="true"]')] as HTMLElement[];
        return { glassOpen: rows[2].getAttribute("aria-expanded"), rowText: rows[2].innerText.toLowerCase(), pressed: pressed.length };
      });
      expect(r.glassOpen).toBe("true");
      expect(r.pressed).toBe(1);
      expect(r.rowText).toContain(target.name.toLowerCase());
    } finally { await page.close(); }
  }, 90_000);

  it("on Free, the Pro groups still open cleanly to be seen", async () => {
    const page = await mount(390, 844, "page", { locked: true });
    try {
      for (const i of [1, 2]) {
        await placeLookAt(page, 460);
        const r = await tap(page, i);
        expect(r.thisOpen).toBe(true);
        expect(Math.abs(r.justAfter - r.before)).toBeLessThan(2);
        expect(r.swatches).toBe(looksInFamily(FAM[i]).length);
        expect(r.outsidePanel).toBe(0);
        await tap(page, i);
      }
    } finally { await page.close(); }
  }, 90_000);
});
