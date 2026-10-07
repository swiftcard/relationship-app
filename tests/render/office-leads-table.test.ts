import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { launchBrowser, appCss } from "./harness";
import LeadsTable from "@/app/office/admin/leads/LeadsTable";

// The Leads tab is where an office owner spends their time, and it now carries
// three things it did not: an exact total, an export, and Load more. All three
// live above or below a table that already had to fit a phone.

const mk = (i: number) => ({
  id: `l${i}`,
  name: ["Priya Ramanathan", "Tom Beck", "Dana Lee", "Sam Okafor"][i % 4],
  email: `averyverylongcontactaddress${i}@subdomain.example.com`,
  phone: "+1 555 0100",
  status: i % 3 === 0 ? "touch" : null,
  created_at: new Date(Date.now() - i * 36e5).toISOString(),
  card_owner: `member-${i % 3}`,
  capturedBy: ["Dana Admin", "Member 1", "Former team member"][i % 3],
  tags: null,
  // Derived server-side from the contact's follow-up sequence — the column
  // that replaced the CRM status nothing could set (lib/lead-followup.ts).
  // Cycled so the widest badge ("No follow-up") is measured alongside the rest.
  followUp: (["none", "running", "paused", "done"] as const)[i % 4],
});

async function render(browser: Browser, width: number, props: Record<string, unknown>) {
  const css = await appCss();
  const markup = renderToStaticMarkup(createElement(LeadsTable as never, props));
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 1200 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:16px;background:#0b0f16}</style></head>
     <body class="sc-app">${markup}</body></html>`,
    { waitUntil: "load" },
  );
  await page.waitForTimeout(150);
  return page;
}

const FULL = { leads: Array.from({ length: 8 }, (_, i) => mk(i)), total: 1240, hasMore: true };

describe("the office Leads table", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  for (const width of [390, 768, 1280]) {
    it(`fits at ${width}px with long names and addresses`, async () => {
      const page = await render(browser, width, FULL);
      try {
        const res = await page.evaluate(() => {
          const limit = window.innerWidth + 1;
          const spills: string[] = [];
          document.querySelectorAll("body *").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (r.right > limit || r.left < -1)) spills.push(`${el.tagName}.${el.className}`.slice(0, 60));
          });
          return { spills, sideways: document.documentElement.scrollWidth > window.innerWidth };
        });
        expect(res.spills, `content spills outside the viewport at ${width}px`).toEqual([]);
        expect(res.sideways, `the page scrolls sideways at ${width}px`).toBe(false);
      } finally { await page.close(); }
    });
  }

  it("states how much of the whole is on screen, and offers all of it", async () => {
    const page = await render(browser, 1280, FULL);
    try {
      const text = await page.innerText("body");
      expect(text).toContain("Showing 8 of 1,240 contacts");
      expect(text).toContain("Export all as CSV");
      expect(text).toContain("Load more — 1,232 to go");
    } finally { await page.close(); }
  });

  it("says 'All N contacts' once nothing is left to fetch", async () => {
    const leads = Array.from({ length: 4 }, (_, i) => mk(i));
    const page = await render(browser, 1280, { leads, total: 4, hasMore: false });
    try {
      const text = await page.innerText("body");
      expect(text).toContain("All 4 contacts");
      expect(text).not.toContain("Load more");
    } finally { await page.close(); }
  });

  it("keeps the export reachable with one contact and with none", async () => {
    const one = await render(browser, 390, { leads: [mk(0)], total: 1, hasMore: false });
    try {
      expect(await one.innerText("body")).toContain("All 1 contact");
    } finally { await one.close(); }

    const none = await render(browser, 390, { leads: [], total: 0, hasMore: false });
    try {
      const text = await none.innerText("body");
      // No total bar, no export, no Load more — just the empty state, so a
      // brand-new office is not handed a download of nothing.
      expect(text).toContain("No contacts yet");
      expect(text).not.toContain("Export all as CSV");
      expect(text).not.toContain("Load more");
    } finally { await none.close(); }
  });

  it("gives Load more and Export real tap targets on a phone", async () => {
    const page = await render(browser, 390, FULL);
    try {
      const sizes = await page.evaluate(() =>
        [...document.querySelectorAll("a,button")]
          .filter((el) => /Load more|Export all/.test(el.textContent ?? ""))
          .map((el) => ({ t: (el.textContent ?? "").trim().slice(0, 20), h: el.getBoundingClientRect().height })),
      );
      expect(sizes.length, "the two new controls must both render").toBe(2);
      for (const s of sizes) expect(s.h, `"${s.t}" is only ${Math.round(s.h)}px tall`).toBeGreaterThanOrEqual(30);
    } finally { await page.close(); }
  });
});
