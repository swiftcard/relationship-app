import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright";
import { appCss, launchBrowser } from "./harness";

// The dashboard is behind login and needs a database, so it can't be crawled.
// This lays out the My Cards box with the app's REAL compiled Tailwind and
// measures the "Add card" control — the claim being tested is a visual one
// ("smaller, top right"), which no source scan can check.
//
// The class strings are READ OUT OF THE PAGE SOURCE rather than copied here, so
// this measures what actually ships. If someone edits the button's classes, this
// test measures the edited ones; if they delete it, the extraction fails loudly.
//
// There is now ONE pill serving both widths. Desktop used to carry a separate
// bare text link in this slot; the assertions that pinned that arrangement are
// gone, replaced by ones that pin the pill rendering at BOTH widths with no
// duplicate control.

const DASH = join(process.cwd(), "src/app/dashboard/page.tsx");

/**
 * The dashboard source, from the My Cards box onwards.
 *
 * SCOPED, not the whole file. Every fragment below is a Tailwind class string,
 * and Tailwind class strings repeat — the page's top-right icon cluster is also
 * a "flex items-center gap-2 shrink-0". When that cluster gained a -mr-1.5
 * (2026-09-09, after sign-out moved out of the header) it started matching
 * first, and this test measured the NAV's wrapper as if it were the My Cards
 * actions: every "flush with the right edge" assertion went red by exactly the
 * 6px of that nudge, pointing at a box nobody had touched.
 *
 * Anchoring on the box's own data-tour marker means a fragment can only ever
 * match inside the thing being measured.
 */
function scopedSrc(): string {
  const s = readFileSync(DASH, "utf8");
  const i = s.indexOf('data-tour="my-cards"');
  if (i < 0) throw new Error('No data-tour="my-cards" box in dashboard/page.tsx');
  return s.slice(i);
}

/** Pull a className string out of the My Cards box by a distinctive fragment. */
function classNameContaining(fragment: string): string {
  const s = scopedSrc();
  const re = new RegExp(`className="([^"]*${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*)"`);
  const m = s.match(re);
  if (!m) throw new Error(`No className containing "${fragment}" in the My Cards box`);
  return m[1];
}

const MOBILE = 375;
const DESKTOP = 1280;

let browser: Browser;
beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
afterAll(async () => { await browser?.close(); });

/**
 * Render the My Cards box at a given viewport width and measure.
 * Box, header-row, caption and row classes all come from source, so the button
 * is measured inside the real container against the real siblings it must
 * share a line with.
 */
async function measure(width: number, longTitle = false) {
  const css = await appCss();
  const boxCls = classNameContaining("bg-gray-900 border border-gray-800/80 rounded-2xl p-5 mb-5");
  const headerCls = classNameContaining("flex items-center justify-between gap-3 mb-3");
  // The box now holds TWO controls: "View live" (neutral) then "Add card"
  // (blue), inside a shrink-0 wrapper. The old locator — the first className
  // containing "shrink-0 inline-flex items-center" — would now match View live,
  // which sits first in source, and every "rightmost / flush with the edge"
  // assertion below would be measuring the wrong button. Each is located by the
  // colour that distinguishes it instead.
  const viewBtnCls = classNameContaining("border-gray-700 text-gray-300 text-[0.6875rem]");
  const addBtnCls = classNameContaining("text-blue-400 text-[0.6875rem]");
  const actionsCls = classNameContaining("flex items-center gap-2 shrink-0");
  const captionCls = classNameContaining("hidden sm:block text-gray-600 text-xs mt-0.5");
  const rowCls =
    "flex items-center gap-3 rounded-xl px-4 py-3 transition-all border flex-1 min-w-full sm:min-w-[200px] bg-gray-800/60 border-gray-700/60";
  const title = longTitle ? "My Cards With An Absurdly Long Heading That Should Truncate" : "My Cards";

  const page = await browser.newPage({ viewportSize: { width, height: 900 } });
  // setViewportSize EXPLICITLY. The constructor option alone did not take here
  // — window.innerWidth stayed at Playwright's 1280 default, so a "mobile" run
  // was silently measuring desktop and every sm: assertion was inverted. This
  // is the whole reason the test can be trusted, so it is asserted below too.
  await page.setViewportSize({ width, height: 900 });
  try {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
       <style>body{margin:0;padding:0;background:#030712}</style></head>
       <body class="sc-app">
         <div id="box" class="${boxCls}">
           <div id="header" class="${headerCls}">
             <div id="titleWrap" class="min-w-0">
               <p id="title" class="text-white font-semibold text-sm">${title}</p>
               <p id="caption" class="${captionCls}">Check a card to view everything about it. Only one card can be selected at a time.</p>
             </div>
             <div id="actions" class="${actionsCls}">
               <a id="viewBtn" href="#" class="${viewBtnCls}">
                 <svg viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3 sm:w-3.5 sm:h-3.5"><path d="M10 4v12M4 10h12"/></svg>
                 <span class="lg:hidden">View Live Link</span>
                 <span class="hidden lg:inline">View live</span>
               </a>
               <a id="addBtn" href="#" class="${addBtnCls}">
                 <svg viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3 sm:w-3.5 sm:h-3.5"><path d="M10 4v12M4 10h12"/></svg>
                 Add card
               </a>
             </div>
           </div>
           <div id="rows" class="flex flex-wrap gap-2">
             <div id="row" class="${rowCls}"><span class="text-white text-sm">Work card</span></div>
           </div>
         </div>
       </body></html>`,
    );

    return await page.evaluate(() => {
      const r = (id: string) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          x: b.x, right: b.right, top: b.top, bottom: b.bottom,
          width: b.width, height: b.height,
          centerY: b.y + b.height / 2,
          display: cs.display,
          borderRadius: cs.borderTopLeftRadius,
        };
      };
      const box = document.getElementById("box")!;
      const bs = getComputedStyle(box);
      return {
        // Reported so every assertion can confirm it ran at the width it
        // thinks it did — see the setViewportSize note above.
        innerWidth: window.innerWidth,
        box: {
          ...r("box")!,
          padLeft: parseFloat(bs.paddingLeft),
          padRight: parseFloat(bs.paddingRight),
          // getBoundingClientRect returns the BORDER-box width, and this panel
          // has a 1px border.
          borderLeft: parseFloat(bs.borderLeftWidth),
          borderRight: parseFloat(bs.borderRightWidth),
        },
        header: r("header"),
        title: r("title"),
        caption: r("caption"),
        addBtn: r("addBtn"),
        viewBtn: r("viewBtn"),
        actions: r("actions"),
        row: r("row"),
      };
    });
  } finally {
    await page.close();
  }
}

describe("mobile: the Add card button is a small control in the top-right", () => {
  it("actually renders at a phone width", async () => {
    // Guard on the guard: an earlier version of this suite silently ran every
    // "mobile" case at 1280px, which inverted every sm: assertion.
    const m = await measure(MOBILE);
    expect(m.innerWidth).toBe(MOBILE);
  });

  it("sits on the SAME line as the My Cards title", async () => {
    const m = await measure(MOBILE);
    expect(m.addBtn, "the mobile Add card button is missing").not.toBeNull();
    // Same row = vertically centred against the title, not stacked below it.
    expect(Math.abs(m.addBtn!.centerY - m.title!.centerY)).toBeLessThan(2);
    expect(m.addBtn!.top).toBeLessThan(m.row!.top);
  });

  it("is flush with the box's right padding edge", async () => {
    const m = await measure(MOBILE);
    const boxRight = m.box.right - m.box.padRight - m.box.borderRight;
    expect(Math.abs(m.addBtn!.right - boxRight)).toBeLessThan(1);
  });

  it("is genuinely SMALL — a fraction of the box, not full width", async () => {
    const m = await measure(MOBILE);
    const inner = m.box.width - m.box.padLeft - m.box.padRight - m.box.borderLeft - m.box.borderRight;
    // It used to be exactly `inner` wide. A third of the box is the ceiling.
    expect(m.addBtn!.width).toBeLessThan(inner / 3);
    expect(m.addBtn!.width, "shrunk to nothing / label lost").toBeGreaterThan(60);
    expect(m.addBtn!.height).toBeLessThan(m.row!.height);
  });

  it("stays a tappable height despite being small", async () => {
    const m = await measure(MOBILE);
    expect(m.addBtn!.height).toBeGreaterThanOrEqual(26);
  });

  it("never overflows the box", async () => {
    const m = await measure(MOBILE);
    const boxRight = m.box.x + m.box.width - m.box.padRight;
    expect(m.addBtn!.right).toBeLessThanOrEqual(boxRight + 1);
  });

  it("a very long card-box title cannot squash or displace it", async () => {
    // shrink-0 + min-w-0 on the title wrapper: the TITLE gives way, not the
    // button. Without shrink-0 a flex item is free to compress to its content.
    const normal = await measure(MOBILE);
    const long = await measure(MOBILE, true);
    expect(Math.abs(long.addBtn!.width - normal.addBtn!.width)).toBeLessThan(1);
    expect(long.addBtn!.height).toBe(normal.addBtn!.height);
    const boxRight = long.box.right - long.box.padRight - long.box.borderRight;
    expect(long.addBtn!.right).toBeLessThanOrEqual(boxRight + 1);
  });

  it("does not overlap the title", async () => {
    const m = await measure(MOBILE, true);
    expect(m.title!.right).toBeLessThanOrEqual(m.addBtn!.x + 1);
  });

  // "View Live Link" on a phone (owner, 2026-09-29) is the longer label, so it
  // is the one that could wrap or crowd the title on a narrow phone.
  it.each([320, 360, 375, 390, 430])("at %ipx 'View Live Link' stays on one line beside Add card", async (w) => {
    const m = await measure(w, true);
    expect(m.viewBtn, "View Live Link is missing").not.toBeNull();
    // One line: the same height as Add card, centred on the same row.
    expect(m.viewBtn!.height).toBe(m.addBtn!.height);
    expect(Math.abs(m.viewBtn!.centerY - m.addBtn!.centerY)).toBeLessThan(1);
    // Beside it, not on top of it, and the title gives way to both.
    expect(m.viewBtn!.right).toBeLessThanOrEqual(m.addBtn!.x);
    expect(m.title!.right).toBeLessThanOrEqual(m.viewBtn!.x + 1);
    expect(m.title!.width, "the title was squeezed to nothing").toBeGreaterThan(40);
  });

});

describe("mobile: the explanatory captions are gone", () => {
  it("the My Cards caption does not render", async () => {
    const m = await measure(MOBILE);
    expect(m.caption!.display).toBe("none");
  });

  it("which is what lets the header be a single line", async () => {
    // The point of removing it: title and button share one row. If the caption
    // came back the header would grow and the button would no longer be
    // "top right" of a compact header.
    const m = await measure(MOBILE);
    expect(m.header!.height).toBeLessThan(40);
  });
});

describe("desktop gets the SAME pill, in the same slot", () => {
  it("renders — it is not a mobile-only control any more", async () => {
    const m = await measure(DESKTOP);
    expect(m.innerWidth).toBe(DESKTOP);
    expect(m.addBtn!.display).not.toBe("none");
    expect(m.addBtn!.width).toBeGreaterThan(60);
  });

  it("is a real button, not a bare text link", async () => {
    // The thing the owner asked for. A text link has no rounding; the pill's
    // border-radius is what makes it read as a control.
    const m = await measure(DESKTOP);
    expect(parseFloat(m.addBtn!.borderRadius)).toBeGreaterThan(4);
  });

  it("is centred in the header, flush with the box's right padding edge", async () => {
    // NOT aligned to the title's line, as on mobile: desktop keeps the caption,
    // so the title wrapper is two lines tall and `items-center` centres the pill
    // against the pair. Aligning it to the title alone would push it up off
    // centre. The old desktop text link sat exactly here too.
    const m = await measure(DESKTOP);
    expect(Math.abs(m.addBtn!.centerY - m.header!.centerY)).toBeLessThan(2);
    expect(m.addBtn!.top).toBeGreaterThanOrEqual(m.header!.top - 1);
    expect(m.addBtn!.bottom).toBeLessThanOrEqual(m.header!.bottom + 1);
    const boxRight = m.box.right - m.box.padRight - m.box.borderRight;
    expect(Math.abs(m.addBtn!.right - boxRight)).toBeLessThan(1);
  });

  it("is no smaller than the phone's, and still not full width", async () => {
    const desktop = await measure(DESKTOP);
    const mobile = await measure(MOBILE);
    expect(desktop.addBtn!.height).toBeGreaterThanOrEqual(mobile.addBtn!.height);
    const inner = desktop.box.width - desktop.box.padLeft - desktop.box.padRight
      - desktop.box.borderLeft - desktop.box.borderRight;
    expect(desktop.addBtn!.width).toBeLessThan(inner / 3);
  });

  it("does not overlap the caption or the title", async () => {
    const m = await measure(DESKTOP, true);
    expect(m.title!.right).toBeLessThanOrEqual(m.addBtn!.x + 1);
    expect(m.caption!.right).toBeLessThanOrEqual(m.addBtn!.x + 1);
  });

  it("still shows BOTH captions", async () => {
    // These were hidden on mobile only. Losing them on desktop would be a
    // silent copy regression this suite is the last line of defence against.
    const m = await measure(DESKTOP);
    expect(m.caption!.display).toBe("block");
    expect(m.caption!.height).toBeGreaterThan(0);
  });

  it("the box keeps its size and padding", async () => {
    const m = await measure(DESKTOP);
    // p-5 = 20px, unchanged by this work.
    expect(m.box.padLeft).toBe(20);
    expect(m.box.padRight).toBe(20);
  });
});
