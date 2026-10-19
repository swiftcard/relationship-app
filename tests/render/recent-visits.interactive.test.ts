import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";
import { buildRecentVisits, type VisitEventRow } from "@/lib/recent-visits";

// ─────────────────────────────────────────────────────────────────────────────
// "RECENT VISITS" UNDER THE TRAFFIC CHART (owner, 2026-10-18) — measured.
//
// The rows come from the REAL server builder (lib/recent-visits) fed with real
// production User-Agents, then the REAL component renders them in Chromium with
// the app's compiled Tailwind, inside the views box's own padding, at the
// widths people use. What is asserted is what a person sees: nothing runs off
// the side, a long name gives way before the time does, Free sees blur and no
// detail in the page at all, the iPhone app shows no "Upgrade", and "Show more"
// opens the rest.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";
const T = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const IG = "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/24A446 Instagram 451.0.0.37.60 (iPhone19,3; iOS 27_0_1; en_US; en; scale=3.00; 1320x2868; IABMV/1; 1088109557) Safari/604.1";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0";

const events: VisitEventRow[] = [];
// Seven visits, so "Show more" has two to reveal. The first is the longest
// row the product can draw: a long contact name, a long place, a tap label.
events.push({ id: "tap", created_at: T(1), event_type: "clicked_link", surface: "card", visitor_id: "visitor-0000", target: "calendly.com", target_label: "Book a strategy call" });
events.push({ id: "save", created_at: T(1.5), event_type: "downloaded_vcard", surface: "card", visitor_id: "visitor-0000" });
for (let i = 0; i < 7; i++) {
  events.push({
    id: `v${i}`, created_at: T(2 + i * 40), event_type: "viewed_card", surface: i % 2 ? "links" : "card",
    visitor_id: `visitor-000${i}`, source: i === 3 ? "qr_code" : "direct_link",
    device_info: i % 2 ? WIN : IG, referrer_url: i % 2 ? "https://lnkd.in/x" : "https://l.instagram.com/",
    location: i === 0 ? "Rancho Santa Margarita, CA" : "Brooklyn, NY", geo_accuracy: "city_approx", duration_s: 95 + i,
    lead_id: i === 0 ? "lead-long" : null, lead_confidence: i === 0 ? "form" : null,
    network_org: i === 0 ? "Memorial Sloan Kettering Cancer Center" : null,
  });
}
const leads = [{ id: "lead-long", name: "Christopher Fairweather-Blenkinsop", tags: [] }];
const history = events.filter((e) => e.event_type === "viewed_card").map((e) => ({ visitor_id: e.visitor_id, surface: e.surface, created_at: e.created_at }));
const rows = (paid: boolean) =>
  buildRecentVisits({ events, history, leads, paid, limit: 25 }).map((v, i) => ({ ...v, when: i ? `Oct ${10 + i}, 11:0${i} AM` : "12:59 PM" }));

let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "recent-visits-"));
  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement as h } from "react";
    export default function Link(p: any) { const { href, prefetch, scroll, ...rest } = p; return h("a", { href, ...rest }); }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import RecentVisits from "@/components/dashboard/RecentVisits";
    (window as any).mount = (visits: any[], paid: boolean) => {
      createRoot(document.getElementById("root")!).render(h(RecentVisits, { visits, paid }));
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src"), "next/link": join(tmp, "link-stub.tsx") },
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

/** The list inside the views box (its real classes), at `width`. */
async function open(paid: boolean, width: number, native = false): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.route(`${ORIGIN}/`, (r) => r.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
           <style>body{margin:0;padding:0 16px}</style></head>
           <body class="sc-app bg-gray-950"><div style="max-width:620px">
             <div id="box" class="bg-gray-900 border border-gray-800/80 rounded-2xl p-5 min-w-0"><div id="root"></div></div>
           </div><script>${bundle}</script></body></html>`,
  }));
  if (native) await page.addInitScript(() => { (window as unknown as { webkit: unknown }).webkit = { messageHandlers: { bridge: {} } }; });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(([v, p]) => (window as unknown as { mount: (x: unknown, p: boolean) => void }).mount(v, p as boolean), [rows(paid), paid] as const);
  await page.locator('[data-testid="recent-visits"]').waitFor();
  await page.waitForTimeout(150);
  return page;
}

/** Every visible row: does anything stick out of it, and do the name and time collide? */
function geometry(page: Page) {
  return page.evaluate(() => {
    const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    // checkVisibility, not offsetParent: a closed <details> hides its rows with
    // content-visibility, which offsetParent does not see.
    const lis = [...document.querySelectorAll('[data-testid="recent-visits"] li')].filter((li) => li.checkVisibility());
    const rowsOut = lis.map((li) => {
      const r = li.getBoundingClientRect();
      const kids = [...li.querySelectorAll("p")].map((p) => p.getBoundingClientRect());
      const [name, time] = [...li.querySelectorAll(":scope > div > p")].map((p) => p.getBoundingClientRect());
      return {
        sticksOut: kids.some((k) => k.left < r.left - 0.5 || k.right > r.right + 0.5),
        nameTimeOverlap: !!name && !!time && name.right > time.left + 0.5,
        timeWrapped: !!time && time.height > 20,
      };
    });
    return { docOverflow, count: lis.length, rowsOut };
  });
}

describe("Pro: every detail, and it fits at every width", () => {
  for (const width of [320, 390, 1280]) {
    it(`${width}px — no row runs off the side, and a long name gives way before the time`, async () => {
      const page = await open(true, width);
      try {
        const g = await geometry(page);
        expect(g.docOverflow).toBeLessThanOrEqual(0);
        expect(g.count).toBe(5);
        for (const r of g.rowsOut) {
          expect(r.sticksOut).toBe(false);
          expect(r.nameTimeOverlap).toBe(false);
          expect(r.timeWrapped).toBe(false);
        }
        const text = await page.locator('[data-testid="recent-visits"]').innerText();
        expect(text).toContain("iPhone 18 Pro Max · iOS 27 · Instagram · 1m 35s");
        expect(text).toContain("On the Memorial Sloan Kettering Cancer Center network");
        expect(text).toContain("Saved your contact");
        expect(text).toContain("Tapped Book a strategy call");
        expect(text).toContain("Windows PC · Edge · from LinkedIn");
        expect(text).not.toContain("Upgrade");
      } finally { await page.context().close(); }
    });
  }

  it("Show more opens the rest", async () => {
    const page = await open(true, 390);
    try {
      await page.getByText("Show more (2)").click();
      expect((await geometry(page)).count).toBe(7);
      expect(await page.getByText("Show fewer").isVisible()).toBe(true);
    } finally { await page.context().close(); }
  });
});

describe("Free: the visit is there, the details never reach the page", () => {
  it("blurred, with nothing to read underneath, and one upsell line on the web", async () => {
    const page = await open(false, 390);
    try {
      const raw = await page.locator('[data-testid="recent-visits"]').evaluate((el) => el.textContent ?? "");
      for (const secret of ["Memorial Sloan", "iPhone", "Instagram", "Windows", "Brooklyn", "Rancho", "LinkedIn", "1m 35s", "Book a strategy call"]) {
        expect(raw, `"${secret}" reached a Free account's page`).not.toContain(secret);
      }
      const blurred = await page.locator('[data-testid="recent-visits"] [class*="blur-"]').allTextContents();
      expect(blurred.length).toBeGreaterThanOrEqual(5);
      for (const b of blurred) expect(b).toMatch(/^[█ ·]+$/);
      expect(raw).toContain("1st visit");
      expect(await page.getByText("Upgrade to Pro →").isVisible()).toBe(true);
      const g = await geometry(page);
      expect(g.docOverflow).toBeLessThanOrEqual(0);
      for (const r of g.rowsOut) expect(r.sticksOut).toBe(false);
    } finally { await page.context().close(); }
  });

  it("inside the iPhone app: no upgrade link, no price — the inert PRO badge", async () => {
    const page = await open(false, 390, true);
    try {
      const text = await page.locator('[data-testid="recent-visits"]').innerText();
      expect(text).not.toMatch(/Upgrade|\$|price/i);
      expect(text).toContain("PRO");
      expect(text).toContain("Visit details are only available on the Pro plan");
      expect(await page.locator('[data-testid="recent-visits"] a').count()).toBe(0);
    } finally { await page.context().close(); }
  });
});
