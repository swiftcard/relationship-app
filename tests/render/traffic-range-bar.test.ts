import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright";
import { appCss, launchBrowser } from "./harness";

// The dashboard's views box on a PHONE (owner, 2026-09-29): no "Traffic"
// heading, and the Today / Week / Month / Locations bar runs the full width of
// the box from its left edge, four equal tabs. The COMPUTER keeps the heading
// with the bar at its right.
//
// The dashboard is behind login, so it is laid out here with the app's REAL
// compiled Tailwind, and the class strings are READ OUT OF THE PAGE SOURCE —
// this measures what ships. "Locations" carries a lock icon on Free, the widest
// tab, so that is the one measured.

const DASH = join(process.cwd(), "src/app/dashboard/page.tsx");

/** The source of the views box only, so a class fragment can't match elsewhere. */
function scopedSrc(): string {
  const s = readFileSync(DASH, "utf8");
  const i = s.indexOf('data-tour="traffic"');
  if (i < 0) throw new Error('No data-tour="traffic" box in dashboard/page.tsx');
  return s.slice(i, i + 4000);
}

function classNameContaining(fragment: string): string {
  const re = new RegExp(`className="([^"]*${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*)"`);
  const m = scopedSrc().match(re);
  if (!m) throw new Error(`No className containing "${fragment}" in the views box`);
  return m[1];
}

/** The range tab's class: a template literal — its static part, plus the active/idle half. */
function tabClass(active: boolean): string {
  const m = scopedSrc().match(/className=\{`([^`$]*rounded-md[^`$]*)\$\{viewsRange === r\.id \? "([^"]+)" : "([^"]+)"\}`\}/);
  if (!m) throw new Error("No range-tab className in the views box");
  return `${m[1]} ${active ? m[2] : m[3]}`;
}

let browser: Browser;
beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
afterAll(async () => { await browser?.close(); });

async function measure(width: number) {
  const css = await appCss();
  const boxCls = classNameContaining("bg-gray-900 border border-gray-800/80 rounded-2xl p-5 mb-5");
  const headerCls = classNameContaining("flex items-center justify-between mb-4");
  const titleCls = classNameContaining("text-white font-semibold text-sm");
  const barCls = classNameContaining("bg-gray-800 rounded-lg p-0.5");
  // The Free lock beside "Locations", with its real classes. A flex svg with no
  // shrink-0 squeezed to a dot in a quarter-width tab — which a label-overflow
  // check alone reported as fine, so its own width is measured below.
  const lockCls = scopedSrc().match(/r\.id === "locations" && !isPro && \([\s\S]*?<svg viewBox="0 0 20 20" fill="currentColor" className="([^"]+)"/)?.[1];
  if (!lockCls) throw new Error("No lock icon on the Locations tab");
  const lock = `<svg id="lock" viewBox="0 0 20 20" fill="currentColor" class="${lockCls}"><path d="M5 9h10v8H5z"/></svg>`;
  const tabs = ["Today", "Week", "Month", "Locations"]
    .map((t, i) => `<a id="tab${i}" href="#" class="${tabClass(i === 0)}">${t}${t === "Locations" ? lock : ""}</a>`)
    .join("");

  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 900 });
  try {
    // 16px page gutter, the dashboard's own at phone width.
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
       <style>body{margin:0;padding:0 16px;background:#030712}</style></head>
       <body class="sc-app">
         <div id="box" class="${boxCls}">
           <div id="header" class="${headerCls}">
             <p id="title" class="${titleCls}">Traffic</p>
             <div id="bar" class="${barCls}">${tabs}</div>
           </div>
         </div>
       </body></html>`,
    );
    return await page.evaluate(() => {
      const r = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { x: b.x, right: b.right, top: b.top, width: b.width, height: b.height, display: getComputedStyle(el).display };
      };
      const box = document.getElementById("box")!;
      const bs = getComputedStyle(box);
      const tabs = [0, 1, 2, 3].map((i) => {
        const el = document.getElementById(`tab${i}`)!;
        return { ...r(el), overflows: el.scrollWidth > el.clientWidth + 0.5 };
      });
      return {
        innerWidth: window.innerWidth,
        contentLeft: box.getBoundingClientRect().left + parseFloat(bs.borderLeftWidth) + parseFloat(bs.paddingLeft),
        contentRight: box.getBoundingClientRect().right - parseFloat(bs.borderRightWidth) - parseFloat(bs.paddingRight),
        title: r(document.getElementById("title")!),
        bar: r(document.getElementById("bar")!),
        lock: r(document.getElementById("lock")!),
        tabs,
      };
    });
  } finally {
    await page.close();
  }
}

describe("phone: no Traffic heading, the range bar spans the box evenly", () => {
  it.each([320, 360, 375, 390, 430])("at %ipx", async (w) => {
    const m = await measure(w);
    expect(m.innerWidth).toBe(w);
    expect(m.title.display, "the Traffic heading still shows on a phone").toBe("none");
    // Starts at the box's left edge and runs to its right edge.
    expect(Math.abs(m.bar.x - m.contentLeft)).toBeLessThan(1);
    expect(Math.abs(m.bar.right - m.contentRight)).toBeLessThan(1);
    // Four EQUAL tabs, on one row, none spilling its label.
    const w0 = m.tabs[0].width;
    for (const t of m.tabs) {
      expect(Math.abs(t.width - w0)).toBeLessThan(1);
      expect(Math.abs(t.top - m.tabs[0].top)).toBeLessThan(1);
      expect(t.overflows, "a tab's label is cut off").toBe(false);
      expect(t.height).toBeLessThan(40);
    }
    // The lock is either its full size, inside its tab — or, below 360px only,
    // deliberately hidden. Never squeezed.
    if (w < 360) {
      expect(m.lock.display).toBe("none");
    } else {
      expect(m.lock.width, "the Locations lock is squeezed").toBeGreaterThanOrEqual(9.5);
      expect(m.lock.right).toBeLessThanOrEqual(m.tabs[3].right);
    }
  });
});

describe("computer: unchanged — heading on the left, bar on the right", () => {
  it("at 1280px", async () => {
    const m = await measure(1280);
    expect(m.title.display).not.toBe("none");
    expect(Math.abs(m.title.x - m.contentLeft)).toBeLessThan(1);
    // Hugs its content at the right, not stretched across the box.
    expect(Math.abs(m.bar.right - m.contentRight)).toBeLessThan(1);
    expect(m.bar.width).toBeLessThan((m.contentRight - m.contentLeft) / 2);
    // Tabs sized to their labels (Locations wider than Week).
    expect(m.tabs[3].width).toBeGreaterThan(m.tabs[1].width);
    // The lock at its original desktop size.
    expect(Math.round(m.lock.width)).toBe(12);
  });
});
