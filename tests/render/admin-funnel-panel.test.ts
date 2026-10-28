import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { launchBrowser, appCss } from "./harness";

// ── "The journey" panel on /admin/analytics ─────────────────────────────────
//
// The funnel is the one panel on that page that can see people who have not
// signed up, so it is the one the owner will read first and act on. Two things
// have to be true of it and neither can be checked by reading the source:
//
//  1. It fits. The step labels are the longest strings on the page and the bar
//     row is label + bar + percentage on one line, at admin widths that go down
//     to a phone. A row that wraps or a bar that pushes the percentage off the
//     edge makes the numbers unreadable exactly where they matter.
//  2. The bars are proportional. A funnel whose bars do not shrink is not a
//     funnel — it is a list — and it would hide the drop-off it exists to show.
//
// Rendered from the real component through the app's real CSS, then measured.

// A realistic shape: heavy at the top, thin at the bottom, one zero step.
const FUNNEL = {
  available: true,
  d30: {
    page_viewed: 1284,
    card_creation_started: 412,
    card_creation_completed: 173,
    plan_selected: 151,
    upgrade_prompt_viewed: 96,
    upgrade_started: 34,
    checkout_started: 12,
    checkout_completed: 0,
  },
  d7: { page_viewed: 300 },
  internal30: 57,
  topCtas: [["create_your_card", 210], ["upgrade_to_pro", 34]] as [string, number][],
  lockedFeatures: [["colors-fonts", 51], ["swift-links-cap", 27]] as [string, number][],
};

async function renderPanel(browser: Browser, width: number) {
  // Imported inside so the JSX transform runs under the render config.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const mod = await import("@/app/admin/analytics/AnalyticsClient");
  const FunnelPanel = (mod as unknown as { FunnelPanel: React.FC<Record<string, unknown>> }).FunnelPanel;
  const css = await appCss();
  const markup = renderToStaticMarkup(
    createElement(FunnelPanel, { funnel: FUNNEL, signups: { d30: 168, d7: 40 } }),
  );
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 1400 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:16px;background:#0b0f16}</style></head>
     <body class="sc-app"><div style="width:${width - 32}px">${markup}</div></body></html>`,
    { waitUntil: "load" },
  );
  await page.waitForTimeout(150);
  return page;
}

describe("the funnel panel", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  for (const width of [390, 1280]) {
    it(`fits at ${width}px with nothing clipped or overflowing`, async () => {
      const page = await renderPanel(browser, width);
      try {
        const bad = await page.evaluate(() => {
          const root = document.body.firstElementChild as HTMLElement;
          const limit = root.getBoundingClientRect().right + 1;
          const out: string[] = [];
          root.querySelectorAll("*").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > limit) out.push(`${el.tagName}.${el.className}`.slice(0, 80));
          });
          return { overflow: out, scrollsSideways: document.documentElement.scrollWidth > window.innerWidth };
        });
        expect(bad.overflow, `elements spill past the panel at ${width}px`).toEqual([]);
        expect(bad.scrollsSideways, `the page scrolls sideways at ${width}px`).toBe(false);
      } finally { await page.close(); }
    });
  }

  // Measured at BOTH widths on purpose. Checking only the desktop width is
  // what let the phone layout ship with every bar the same length: a fixed
  // label column left about 80px for the bar, so the drop-off was invisible
  // and the count inside the bar clipped to one digit.
  for (const width of [390, 1280]) {
  it(`draws bars in proportion at ${width}px, so the drop-off is visible`, async () => {
    const page = await renderPanel(browser, width);
    try {
      const widths = await page.evaluate(() =>
        [...document.querySelectorAll("div[style*='linear-gradient(90deg']")].map((el) => el.getBoundingClientRect().width),
      );
      expect(widths.length, "no funnel bars rendered").toBeGreaterThanOrEqual(7);
      // Monotonically narrowing: each step can only be as wide as the one above.
      for (let i = 1; i < widths.length; i++) {
        expect(widths[i], `step ${i} is wider than the step above it`).toBeLessThanOrEqual(widths[i - 1] + 0.5);
      }
      // And the fall is real, not cosmetic: the top bar is 1284 against a
      // bottom of 0, so anything less than a dramatic difference means the bar
      // track is too narrow to express the numbers.
      expect(widths[0], `bars are not proportional at ${width}px`).toBeGreaterThan(widths[widths.length - 2] * 4);
    } finally { await page.close(); }
  });
  }

  it("never clips a step's own count", async () => {
    // The count used to live INSIDE the bar, where a small step's number was
    // wider than the bar drawn for it — "412" rendered as "2".
    const page = await renderPanel(browser, 390);
    try {
      const text = await page.evaluate(() => document.body.innerText);
      for (const n of ["1,284", "412", "173", "168", "34", "12"]) {
        expect(text, `the count ${n} is missing or clipped on a phone`).toContain(n);
      }
    } finally { await page.close(); }
  });

  it("shows every step's name and its own drop-off percentage", async () => {
    const page = await renderPanel(browser, 1280);
    try {
      const text = await page.evaluate(() => document.body.innerText);
      for (const label of ["Visited the website", "Started building a card", "Created an account", "Clicked upgrade", "Paid"]) {
        expect(text, `"${label}" is missing from the panel`).toContain(label);
      }
      // Percentages are what the owner reads to find the leak.
      expect(text).toMatch(/\d+%/);
      // Our own traffic is disclosed rather than silently dropped.
      expect(text).toContain("57");
    } finally { await page.close(); }
  });

  it("says what to do when the table has not been migrated", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const mod = await import("@/app/admin/analytics/AnalyticsClient");
    const FunnelPanel = (mod as unknown as { FunnelPanel: React.FC<Record<string, unknown>> }).FunnelPanel;
    const markup = renderToStaticMarkup(
      createElement(FunnelPanel, { funnel: { ...FUNNEL, available: false }, signups: { d30: 0, d7: 0 } }),
    );
    expect(markup).toContain("product-events.sql");
  });
});
