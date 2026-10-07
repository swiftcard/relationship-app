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

// ── The contact drawer (owner, 2026-10-07) ───────────────────────────────────
// A row opens one contact: when and how they were added, whose they are, and
// the history between that teammate and them. Rendered open, as a ?contact=
// link arrives from the server, with the longest things a phone has to hold:
// an unbroken address, a long link name, and a message full of URL.
const DETAIL = {
  id: "l0",
  name: "Priya Ramanathan-Venkataraman",
  email: "averyverylongcontactaddress0@subdomain.example.com",
  phone: "+1 555 0100",
  company: "Ramanathan & Associates International Realty Group",
  location: "San Francisco, CA",
  createdAt: new Date(Date.now() - 3 * 864e5).toISOString(),
  source: "qr_code",
  arrivalSource: null,
  message: "Great meeting you at the expo — send me the listing please",
  owner: { name: "Dana Admin", userId: "u-dana", isFormer: false, isOfficeOwner: false },
  followUp: "running" as const,
  upcomingSteps: [{ channel: "email" as const, sendsAt: new Date(Date.now() + 5 * 864e5).toISOString(), paused: false }],
  history: { shown: true, hiddenBecause: null, from: null, until: null },
  events: [
    { id: "e1", event_type: "viewed_card", source: "qr_code", created_at: new Date(Date.now() - 3 * 864e5 - 6e4).toISOString(), surface: "card" },
    { id: "e2", event_type: "downloaded_vcard", source: "qr_code", created_at: new Date(Date.now() - 3 * 864e5 + 6e4).toISOString() },
    { id: "e3", event_type: "clicked_link", source: null, created_at: new Date(Date.now() - 2 * 864e5).toISOString(), target_label: "Schedule a private showing this weekend" },
  ],
  messages: [
    { id: "m1", direction: "out" as const, channel: "email", body: "Hi Priya — here is the listing: https://www.example.com/listings/2026/very-long-path/that-never-breaks-on-its-own", status: "delivered", created_at: new Date(Date.now() - 2 * 864e5).toISOString() },
    { id: "m2", direction: "in" as const, channel: "sms", body: "Thanks! Can we see it Saturday?", status: "received", created_at: new Date(Date.now() - 864e5).toISOString() },
  ],
};

describe("the contact drawer", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  for (const width of [390, 1280]) {
    it(`shows when, how, whose and the history, and fits at ${width}px`, async () => {
      const page = await render(browser, width, { ...FULL, initialContactId: "l0", initialContact: DETAIL });
      try {
        const res = await page.evaluate(() => {
          const aside = document.querySelector("aside")!;
          const limit = window.innerWidth + 1;
          const spills: string[] = [];
          aside.querySelectorAll("*").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (r.right > limit || r.left < -1)) spills.push(`${el.tagName}.${el.className}`.slice(0, 60));
          });
          const close = document.querySelector('a[aria-label="Close"]') as HTMLElement | null;
          const cr = close?.getBoundingClientRect();
          return {
            spills,
            text: aside.innerText,
            closeHref: close?.getAttribute("href"),
            closeVisible: !!cr && cr.width > 0 && cr.top >= 0 && cr.right <= window.innerWidth,
          };
        });
        expect(res.spills, `the drawer spills at ${width}px`).toEqual([]);
        expect(res.closeVisible, "the close control must be on screen").toBe(true);
        // A link, so it works before hydration — back to the plain list.
        expect(res.closeHref).toBe("/office/admin/leads");
        // Section labels are uppercased by CSS, which innerText reports.
        expect(res.text).toMatch(/Belongs to/i);
        expect(res.text).toContain("Dana Admin");
        expect(res.text).toMatch(/How they were added/i);
        expect(res.text).toContain("Shared their info on Dana's card");
        expect(res.text).toContain("Via QR code scan");
        expect(res.text).toContain("Priya downloaded Dana's contact card");
        expect(res.text).toContain("Priya tapped Dana's Schedule a private showing this weekend link");
        expect(res.text).toContain("Delivered");
        expect(res.text).toContain("Thanks! Can we see it Saturday?");
        expect(res.text).toContain("private notes on this contact are never shown");
        expect(res.text).not.toMatch(/\blead(s)?\b/i);
      } finally { await page.close(); }
    });
  }

  it("rows are links to the contact, so they work before the page hydrates", async () => {
    const page = await render(browser, 1280, FULL);
    try {
      const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "").filter((h) => h.includes("contact=")),
      );
      expect(hrefs).toContain("/office/admin/leads?contact=l0");
      expect(hrefs.length).toBe(FULL.leads.length);
    } finally { await page.close(); }
  });
});
