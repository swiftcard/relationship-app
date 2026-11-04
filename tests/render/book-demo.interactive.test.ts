import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";
import { zonedParts, zonedWallTimeToUtc } from "@/lib/tz-days";

// ─────────────────────────────────────────────────────────────────────────────
// BOOK A DEMO, AS A VISITOR SEES IT — the Office card's button and the popup.
//
// Owner, 2026-11-03: "make sure that the button and the UI (everything that
// pops up) fit cleanly and perfectly and are in a good place that doesn't ruin
// that pricing plan." So this mounts the three real plan cards the way
// /pricing lays them out, with the real BookDemoButton under "Get Office", and
// MEASURES: the button matches "Get Office" and stays inside the card, the
// cards stay one height, nothing spills sideways on a 390px phone, and the
// popup fits the window with its button always on screen, at both widths.
// Then it walks the popup: details, a time, "that time was just booked",
// another time, booked; and Esc hands focus back to the button.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";
const NY = "America/New_York";
let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "book-demo-"));
  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement as h } from "react";
    export default function Link({ href, children, scroll, prefetch, ...rest }: any) { return h("a", { href, ...rest }, children); }
  `);
  writeFileSync(join(tmp, "dynamic-stub.tsx"), `
    import { lazy, Suspense, createElement } from "react";
    export default function dynamic(load: () => Promise<any>) {
      const L = lazy(() => load().then((m) => ({ default: m.default ?? m })));
      return (props: any) => createElement(Suspense, { fallback: null }, createElement(L, props));
    }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import {
      FreePlanCard, ProPlanCard, ProWebPrice, OfficePlanCard, OfficeWebPrice, OfficeSeatPicker, officeTotalLabel,
      PLAN_GRID_CLASS, FREE_CTA_CLASS, PRO_CTA_CLASS, OFFICE_CTA_CLASS, PRO_FINE_PRINT_CLASS,
    } from "@/components/PlanTierCards";
    import BookDemoButton from "@/components/demo/BookDemoButton";
    (window as any).mount = (phone: boolean) => {
      createRoot(document.getElementById("root")!).render(
        h("div", { className: "bg-white text-slate-900 min-h-screen" },
          h("main", { className: "hp overflow-clip pt-10" },
            h("section", { className: "max-w-6xl mx-auto w-full px-5 sm:px-6 pb-14 " + PLAN_GRID_CLASS },
              h(FreePlanCard, { offTab: phone, cta: h("a", { href: "#", className: FREE_CTA_CLASS, "data-cta": "free" }, "Get started free →") }),
              h(ProPlanCard, { offTab: phone, price: h(ProWebPrice, { annual: false, trial: true }) },
                h("div", null,
                  h("button", { className: PRO_CTA_CLASS, "data-cta": "pro" }, "Try Pro free →"),
                  h("p", { className: PRO_FINE_PRINT_CLASS }, "Free for new customers · card required · renews automatically"))),
              h(OfficePlanCard, { price: h(OfficeWebPrice, { annual: false, seats: 10 }), seatPicker: h(OfficeSeatPicker, { seats: 10, onSeats: () => {} }) },
                h("div", null,
                  h("button", { className: OFFICE_CTA_CLASS, "data-cta": "office" }, "Get Office · " + officeTotalLabel(false, 10) + " →"),
                  h(BookDemoButton, { seats: 10 })))))));
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src"), "next/link": join(tmp, "link-stub.tsx"), "next/dynamic": join(tmp, "dynamic-stub.tsx") },
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

/** Open demo times on the next three weekdays: 10:00, 10:30 and 3:00 PM New York. */
function fakeSlots(): string[] {
  const out: string[] = [];
  const now = new Date();
  const p = zonedParts(now, NY);
  for (let i = 1; out.length < 9 && i < 14; i++) {
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + i));
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const [h, m] of [[10, 0], [10, 30], [15, 0]]) {
      out.push(zonedWallTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, m, NY).toISOString());
    }
  }
  return out;
}

type Opened = { page: Page; bookings: unknown[] };

async function open(o: { width: number; height: number; firstBooking?: "slot_taken" | "ok" }): Promise<Opened> {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, timezoneId: NY });
  const page = await ctx.newPage();
  const bookings: unknown[] = [];
  const slots = fakeSlots();
  await page.route(`${ORIGIN}/api/demo/slots`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ slots, durationMin: 30, businessTimeZone: NY }) }));
  await page.route(`${ORIGIN}/api/demo/book`, async (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    bookings.push(body);
    if (bookings.length === 1 && o.firstBooking === "slot_taken") {
      return r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "slot_taken" }) });
    }
    const end = new Date(new Date(body.start).getTime() + 30 * 60_000).toISOString();
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, booking: { id: body.id, start: body.start, end, meetUrl: "https://meet.google.com/abc-defg-hij", email: body.email, calendarInvite: true } }) });
  });
  await page.route(`${ORIGIN}/`, (r) => r.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
           <body><div id="root"></div><script>${bundle}</script></body></html>`,
  }));
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((phone) => (window as unknown as { mount: (p: boolean) => void }).mount(phone), o.width < 768);
  await page.getByRole("link", { name: "Book a demo" }).waitFor();
  return { page, bookings };
}

/** DEMO_SHOTS=<dir> saves a picture of each screen, to look at by eye. */
async function shot(page: Page, name: string) {
  const dir = process.env.DEMO_SHOTS;
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) });
}

type Box = { x: number; y: number; width: number; height: number };
const box = async (page: Page, selector: string): Promise<Box> => {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return b;
};
const inside = (inner: Box, outer: Box, pad = 0.5) =>
  inner.x >= outer.x - pad && inner.y >= outer.y - pad && inner.x + inner.width <= outer.x + outer.width + pad && inner.y + inner.height <= outer.y + outer.height + pad;

describe("the Book a demo button on the Office card", () => {
  for (const [w, h] of [[1280, 900], [390, 844]] as const) {
    it(`${w}px: it sits under Get Office, the same size, inside the card, and nothing spills sideways`, async () => {
      const { page } = await open({ width: w, height: h });
      const office = await box(page, '[data-cta="office"]');
      const demo = await box(page, 'a[href="/demo"]');
      const card = await page.locator('[data-cta="office"]').evaluate((el) => {
        const c = el.closest(".rounded-\\[28px\\]")!.getBoundingClientRect();
        return { x: c.x, y: c.y, width: c.width, height: c.height };
      });
      expect(Math.abs(demo.height - office.height), "same height as Get Office").toBeLessThanOrEqual(1);
      expect(Math.abs(demo.width - office.width), "same width as Get Office").toBeLessThanOrEqual(1);
      expect(Math.abs(demo.x - office.x)).toBeLessThanOrEqual(1);
      expect(demo.y - (office.y + office.height), "a small gap under Get Office").toBeGreaterThanOrEqual(8);
      expect(demo.y - (office.y + office.height)).toBeLessThanOrEqual(12);
      expect(inside(demo, card), "inside the Office card").toBe(true);
      const label = await page.getByRole("link", { name: "Book a demo" }).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, text: (el.textContent || "").trim() }));
      expect(label.text).toBe("Book a demo");
      expect(label.sw).toBeLessThanOrEqual(label.cw);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await page.locator('[data-cta="office"]').scrollIntoViewIfNeeded();
      await shot(page, `${w}-0-card`);
      await page.context().close();
    });
  }

  it("1280px: the three cards stay one height and the buttons sit at the bottom of each", async () => {
    const { page } = await open({ width: 1280, height: 900 });
    const cards = await page.locator("section > div.rounded-\\[28px\\]").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; }));
    expect(cards).toHaveLength(3);
    // Pro sits 24px higher by design (md:-mt-6); Free and Office share a top and a bottom.
    expect(Math.abs(cards[0].bottom - cards[2].bottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(cards[1].bottom - cards[2].bottom)).toBeLessThanOrEqual(1);
    const demo = await box(page, 'a[href="/demo"]');
    const officeCard = cards[2];
    // The demo button is the last thing in the card: card padding below it, nothing else.
    expect(officeCard.bottom - (demo.y + demo.height)).toBeGreaterThan(20);
    expect(officeCard.bottom - (demo.y + demo.height)).toBeLessThan(40);
    await page.context().close();
  });
});

describe("the popup", () => {
  for (const [w, h] of [[1280, 720], [390, 664]] as const) {
    it(`${w}×${h}: it fits the window, the button is always on screen, nothing spills`, async () => {
      const { page } = await open({ width: w, height: h });
      await page.getByRole("link", { name: "Book a demo" }).click();
      const dialog = page.getByRole("dialog", { name: "Book your Office demo" });
      await dialog.waitFor();
      await page.waitForTimeout(300); // the fade
      const d = await dialog.boundingBox();
      expect(d).not.toBeNull();
      if (w < 640) {
        expect(Math.round(d!.x)).toBe(0);
        expect(Math.round(d!.width)).toBe(w);
        expect(Math.round(d!.height)).toBe(h);
      } else {
        expect(d!.width).toBeLessThanOrEqual(600);
        expect(d!.y).toBeGreaterThanOrEqual(23);
        expect(d!.y + d!.height).toBeLessThanOrEqual(h - 23);
        expect(Math.abs(d!.x + d!.width / 2 - w / 2)).toBeLessThanOrEqual(1);
      }
      const cont = await page.getByRole("button", { name: "Continue" }).boundingBox();
      expect(cont!.y + cont!.height, "Continue is on screen without scrolling").toBeLessThanOrEqual(h);
      const spill = await dialog.evaluate((el) => [...el.querySelectorAll("*")].filter((n) => {
        const r = n.getBoundingClientRect();
        const p = el.getBoundingClientRect();
        return r.width > 0 && (r.right > p.right + 0.5 || r.left < p.left - 0.5) && !(n as HTMLElement).closest('[aria-hidden="true"]');
      }).length);
      expect(spill, "nothing wider than the popup").toBe(0);

      // Team size starts on the seat picker's 10 users.
      expect(await page.getByRole("radio", { name: "6–15" }).getAttribute("aria-checked")).toBe("true");
      await shot(page, `${w}-1-details`);

      // Required fields say what's missing, with words, not just red.
      await page.getByRole("button", { name: "Continue" }).click();
      await expect.poll(() => page.getByText("Enter your name.").isVisible()).toBe(true);

      await page.fill("#demo-name", "Alex Morgan");
      await page.fill("#demo-company", "Morgan Realty");
      await page.fill("#demo-email", "alex@example.com");
      await page.fill("#demo-phone", "(555) 123-4567");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { name: "Pick a time" }).waitFor();
      const times = page.getByRole("group", { name: "Open times" }).getByRole("button");
      await times.first().waitFor();
      const clipped = await times.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 0.5).length);
      expect(clipped, "no time label is cut off").toBe(0);
      // Nothing picked yet: the button says "Pick a time" and waits.
      expect(await page.getByRole("button", { name: /^Continue · / }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "Pick a time" }).isDisabled()).toBe(true);
      await shot(page, `${w}-2-time`);
      await times.first().click();
      const go = page.getByRole("button", { name: /^Continue · 10:00 AM$/ });
      const gb = await go.boundingBox();
      expect(gb!.y + gb!.height).toBeLessThanOrEqual(h);
      await go.click();
      await page.getByRole("heading", { name: "Check and confirm" }).waitFor();
      const confirmBtn = await page.getByRole("button", { name: "Confirm demo" }).boundingBox();
      expect(confirmBtn!.y + confirmBtn!.height).toBeLessThanOrEqual(h);
      await shot(page, `${w}-3-confirm`);
      await page.context().close();
    });
  }

  it("walks to a booking: a time just taken sends you back with a message, then it books", async () => {
    const { page, bookings } = await open({ width: 1280, height: 800, firstBooking: "slot_taken" });
    await page.getByRole("link", { name: "Book a demo" }).click();
    await page.getByRole("dialog").waitFor();
    await page.fill("#demo-name", "Alex Morgan");
    await page.fill("#demo-company", "Morgan Realty");
    await page.fill("#demo-email", "Alex@Example.com");
    await page.fill("#demo-phone", "(555) 123-4567");
    await page.fill("#demo-notes", "Lead routing for 12 agents");
    await page.getByRole("button", { name: "Continue" }).click();
    const times = page.getByRole("group", { name: "Open times" }).getByRole("button");
    await times.first().click();
    await page.getByRole("button", { name: /^Continue · / }).click();
    await page.getByRole("heading", { name: "Check and confirm" }).waitFor();
    await expect.poll(() => page.getByText("Morgan Realty").first().isVisible()).toBe(true);
    await page.getByRole("button", { name: "Confirm demo" }).click();

    // Someone else got it first.
    await page.getByRole("heading", { name: "Pick a time" }).waitFor();
    await expect.poll(() => page.getByRole("alert").textContent()).toContain("just booked by someone else");

    await times.nth(1).click();
    await page.getByRole("button", { name: /^Continue · 10:30 AM$/ }).click();
    await page.getByRole("button", { name: "Confirm demo" }).click();
    await page.getByRole("heading", { name: "You're booked!" }).waitFor();
    await expect.poll(() => page.getByText("meet.google.com/abc-defg-hij").isVisible()).toBe(true);
    await shot(page, "1280-4-done");

    expect(bookings).toHaveLength(2);
    const b = bookings[1] as Record<string, unknown>;
    expect(b.name).toBe("Alex Morgan");
    expect(b.teamSize).toBe("6–15");
    expect(b.timezone).toBe(NY);
    expect(b.website).toBe("");
    expect(b.smsOptIn).toBe(true);
    expect(b.source).toBe("pricing");
    // The same booking id both times: a retried Confirm is one booking.
    expect((bookings[0] as Record<string, unknown>).id).toBe(b.id);

    await page.getByRole("button", { name: "Done" }).click();
    await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
    await page.context().close();
  });

  it("Esc closes it, focus goes back to the button, and what was typed is still there", async () => {
    const { page } = await open({ width: 1280, height: 800 });
    const link = page.getByRole("link", { name: "Book a demo" });
    await link.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    await page.fill("#demo-name", "Sam Lee");
    await page.keyboard.press("Escape");
    await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim())).toBe("Book a demo");
    await link.click();
    await page.getByRole("dialog").waitFor();
    await expect.poll(() => page.inputValue("#demo-name")).toBe("Sam Lee");
    // Tab never leaves the popup.
    for (let i = 0; i < 30; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await page.context().close();
  });
});
