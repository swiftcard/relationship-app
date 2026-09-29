import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";
import { cardEventNotice } from "@/lib/card-event-notify";
import { markName } from "@/lib/contact-privacy";
import { markPhrase, markPlace } from "@/lib/location-privacy";
import { redactForPlan } from "@/lib/notification-privacy";
import { hideForReader, ORDINARY_READER, type NotificationReader } from "@/lib/office-account-notifications";

// ─────────────────────────────────────────────────────────────────────────────
// THE BELL IS THE NOTIFICATION CENTRE — PER PLAN, END TO END.
//
// Quick Contacts and the dashboard's Notifications list are gone (2026-09-29),
// so the bell is the one place notifications are read. Owner: "make sure that
// for each account type and plan it shows the correct notifications … for the
// free account, if it says 'user viewed Swift Links in New York', the New York
// should be blurred", and the box opens centred on the page.
//
// Each account type's rows go through the REAL server pipeline — hideForReader
// then redactForPlan, the order both the dashboard's first render and
// /api/notifications use — built from the REAL composer (cardEventNotice), then
// into the REAL NotificationBell in Chromium. What is asserted is what a person
// sees: the words, the blur, what is missing, where a tap goes, where the box is.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const row = (id: string, n: { type: string; title: string; body?: string | null }, extra: Record<string, unknown> = {}, m = 1) =>
  ({ id, read: false, created_at: ago(m), card_owner: "demo", lead_id: null, body: null, ...n, ...extra });

const swift = cardEventNotice({ eventType: "viewed_card", surface: "links", location: "New York, NY", geoAccuracy: "city" })!;
const RAW = [
  // "Someone viewed your Swift Links near New York, NY." — the place is marked.
  row("n-swift", swift, {}, 1),
  // A KNOWN contact, by name, with a place: name AND place are Pro.
  row("n-back", {
    type: "contact_returned",
    title: `${markName("Priya")} is back`,
    body: `${markName("Priya")} re-opened your card${markPhrase(` near ${markPlace("Austin, TX")}`)}.`,
  }, { lead_id: "lead-priya" }, 2),
  // A row written before the marks existed: the place in plain text.
  row("n-legacy", { type: "card_viewed", title: "Someone viewed your card", body: "Someone viewed your card near Great Neck, NY." }, {}, 3),
  // A contact over the Free cap: the teaser, which becomes the plain fact on a paid plan.
  row("n-locked", { type: "new_lead", title: "New contact", body: "Someone shared their info — open to unlock." }, {}, 4),
  // Being on Free: shown on Free, never to a paying account.
  row("n-ended", { type: "pro_ended", title: "Your Pro plan has ended", body: "Subscribe to get it back." }, {}, 5),
  // Referral pitch: never on any Office account.
  row("n-ref", { type: "referral_progress", title: "One more signup to a free month", body: null }, {}, 6),
  // Personal billing: hidden from a TEAM MEMBER with no subscription of their own.
  row("n-pay", { type: "payment_failed", title: "Payment failed", body: "Update your card to keep Pro." }, {}, 7),
];

type Account = { name: string; reader: NotificationReader; paid: boolean };
const FREE: Account = { name: "Free", reader: ORDINARY_READER, paid: false };
const PRO: Account = { name: "Pro", reader: ORDINARY_READER, paid: true };
const OFFICE_ADMIN: Account = { name: "Office admin", reader: { officeAccount: true, teamMember: false, ownSubscription: false }, paid: true };
const OFFICE_MEMBER: Account = { name: "Office member", reader: { officeAccount: true, teamMember: true, ownSubscription: false }, paid: true };
const MEMBER_OWN_SUB: Account = { name: "Office member who still pays for their own Pro", reader: { officeAccount: true, teamMember: true, ownSubscription: true }, paid: true };

/** Exactly what the dashboard and /api/notifications hand this account. */
const served = (a: Account) => redactForPlan(hideForReader(RAW, a.reader), a.paid);

let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "bell-plans-"));
  writeFileSync(join(tmp, "nav-stub.ts"), `
    export function useRouter() { return { push: (u: string) => { (window as any).__nav.push(u); }, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export const usePathname = () => "/dashboard";
    export const useSearchParams = () => new URLSearchParams();
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import NotificationBell from "@/components/NotificationBell";
    import OfficeNotificationBell from "@/components/office/OfficeNotificationBell";
    (window as any).__nav = [];
    (window as any).mount = (notifs: any[], office: boolean) => {
      createRoot(document.getElementById("root")!).render(
        h("nav", { className: "sc-app flex justify-end p-2" },
          office ? h(OfficeNotificationBell, { initialNotifications: notifs }) : h(NotificationBell, { initialNotifications: notifs, cardLabels: { demo: "Demo" } })),
      );
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src"), "next/navigation": join(tmp, "nav-stub.ts") },
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

const dialog = '[role="dialog"][aria-label="Notifications"]';

/** Open the bell as `a`, at `width`; `native` = inside the iPhone app. */
async function open(a: Account, width = 390, native = false): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await ctx.newPage();
  const rows = served(a);
  // Playwright tries the most recently added route FIRST, so the catch-all
  // goes in before the specific one. The bell polls on mount: the server
  // answers with the same rows it would.
  await page.route(`${ORIGIN}/api/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"show":false}' }));
  await page.route(`${ORIGIN}/api/notifications`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) }));
  await page.route(`${ORIGIN}/`, (r) => r.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
           <body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`,
  }));
  if (native) await page.addInitScript(() => { (window as unknown as { webkit: unknown }).webkit = { messageHandlers: { bridge: {} } }; });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((n) => (window as unknown as { mount: (x: unknown, o: boolean) => void }).mount(n, false), rows);
  await page.click('nav button[aria-label="Notifications"]');
  await page.locator(dialog).waitFor();
  await page.waitForTimeout(400); // the mount poll lands
  return page;
}

/** Everything a person can read in the open box, and what is blurred. */
function read(page: Page) {
  return page.evaluate((sel) => {
    const d = document.querySelector(sel) as HTMLElement;
    const blurred = [...d.querySelectorAll('[class*="blur-"]')].map((b) => (b.textContent ?? "").trim());
    return {
      text: d.innerText,
      // Every character in the DOM, hidden or not — a blur over real text
      // would still be "in" the page, which is the leak the server prevents.
      raw: d.textContent ?? "",
      blurred,
      seeWho: d.querySelectorAll('a[href="/upgrade?from=notification"]').length,
      wrongPerson: [...d.querySelectorAll("button")].filter((b) => b.textContent === "Wrong person?").length,
    };
  }, dialog);
}

async function tapRow(page: Page, title: RegExp): Promise<string> {
  await page.locator(`${dialog} [role="button"]`).filter({ hasText: title }).first().click();
  const nav = await page.evaluate(() => (window as unknown as { __nav: string[] }).__nav);
  return nav[nav.length - 1] ?? "";
}

describe("Free: every place and every known name is blocked out, and blurred", () => {
  it("'viewed your Swift Links near New York' — New York never reaches the page, the place is blurred", async () => {
    const page = await open(FREE);
    try {
      const r = await read(page);
      expect(r.text).toMatch(/viewed your Swift Links/);
      for (const secret of ["New York", "Austin", "Great Neck", "Priya"]) {
        expect(r.raw, `"${secret}" reached a Free account's page`).not.toContain(secret);
      }
      // Every hidden thing is drawn as blurred blocks: two new-style places,
      // the legacy place, and the name in both title and body.
      expect(r.blurred.length).toBeGreaterThanOrEqual(5);
      for (const b of r.blurred) expect(b).toMatch(/^█+$/);
      // Each row with something hidden offers the way to see it.
      expect(r.seeWho).toBeGreaterThanOrEqual(3);
      // Free-state rows are for Free — shown here.
      expect(r.text).toContain("Your Pro plan has ended");
      expect(r.text).toContain("open to unlock");
      expect(r.text).toContain("One more signup to a free month");
      expect(r.text).toContain("Payment failed");
    } finally { await page.context().close(); }
  });

  it("a blurred name is not one tap away: the row opens the contact LIST, not the contact", async () => {
    const page = await open(FREE);
    try {
      const r = await read(page);
      expect(r.wrongPerson, "Wrong person? on a name the account can't see").toBe(0);
      expect(await tapRow(page, /is back/)).toBe("/contacts?card=demo");
    } finally { await page.context().close(); }
  });
});

describe("Pro: everything in the clear", () => {
  it("shows the places and the name, blurs nothing, and drops the Free-only rows", async () => {
    const page = await open(PRO);
    try {
      const r = await read(page);
      expect(r.text).toContain("near New York, NY");
      expect(r.text).toContain("Priya is back");
      expect(r.text).toContain("near Austin, TX");
      expect(r.text).toContain("near Great Neck, NY");
      expect(r.blurred).toEqual([]);
      expect(r.seeWho).toBe(0);
      expect(r.text, "an upgrade pitch to a paying account").not.toContain("Your Pro plan has ended");
      expect(r.text).not.toContain("open to unlock");
      expect(r.text).toContain("Someone shared their info with you.");
      // Not an Office account: referral and billing rows are still theirs.
      expect(r.text).toContain("One more signup to a free month");
      expect(r.text).toContain("Payment failed");
    } finally { await page.context().close(); }
  });

  it("a named contact opens THAT contact, and offers Wrong person?", async () => {
    const page = await open(PRO);
    try {
      expect((await read(page)).wrongPerson).toBe(1);
      expect(await tapRow(page, /Priya is back/)).toBe("/contacts?card=demo&lead=lead-priya");
    } finally { await page.context().close(); }
  });
});

describe("Office", () => {
  it("admin: like Pro, but no referral pitch", async () => {
    const page = await open(OFFICE_ADMIN);
    try {
      const r = await read(page);
      expect(r.text).toContain("near New York, NY");
      expect(r.text).toContain("Priya is back");
      expect(r.blurred).toEqual([]);
      expect(r.text).not.toContain("Your Pro plan has ended");
      expect(r.text, "referral pitch on an Office account").not.toContain("One more signup");
      // The admin pays for the office: billing rows stay.
      expect(r.text).toContain("Payment failed");
    } finally { await page.context().close(); }
  });

  it("member: no referral pitch, and no billing rows about a subscription they no longer have", async () => {
    const page = await open(OFFICE_MEMBER);
    try {
      const r = await read(page);
      expect(r.text).toContain("near New York, NY");
      expect(r.blurred).toEqual([]);
      expect(r.text).not.toContain("One more signup");
      expect(r.text, "billing row for a subscription the member no longer has").not.toContain("Payment failed");
      expect(r.text).not.toContain("Your Pro plan has ended");
    } finally { await page.context().close(); }
  });

  it("member who still pays for their own Pro keeps their billing rows", async () => {
    const page = await open(MEMBER_OWN_SUB);
    try {
      const r = await read(page);
      expect(r.text).toContain("Payment failed");
      expect(r.text).not.toContain("One more signup");
    } finally { await page.context().close(); }
  });
});

describe("inside the iPhone app", () => {
  it("Free: still blurred, but no upgrade link, and the Free-state row carries no purchase words", async () => {
    const page = await open(FREE, 390, true);
    try {
      const r = await read(page);
      expect(r.raw).not.toContain("New York");
      expect(r.blurred.length).toBeGreaterThanOrEqual(5);
      expect(r.seeWho, "an upgrade link inside the app (App Review 3.1.1)").toBe(0);
      expect(r.text).not.toMatch(/Subscribe/);
    } finally { await page.context().close(); }
  });
});

describe("the box is centred on the page", () => {
  it.each([320, 390, 430, 768, 1280])("at %ipx", async (w) => {
    const page = await open(PRO, w);
    try {
      const box = await page.evaluate((sel) => {
        const b = (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
        return { left: b.left, right: window.innerWidth - b.right, width: b.width, top: b.top };
      }, dialog);
      expect(Math.abs(box.left - box.right), `left ${box.left} vs right ${box.right}`).toBeLessThanOrEqual(1);
      expect(box.left).toBeGreaterThanOrEqual(11);
      expect(box.width).toBeLessThanOrEqual(360);
      expect(box.top).toBeGreaterThan(40); // below the nav bar
    } finally { await page.context().close(); }
  });

  it("the Office admin's team bell too", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 } });
    const page = await ctx.newPage();
    try {
      await page.route(`${ORIGIN}/api/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
      await page.route(`${ORIGIN}/`, (r) => r.fulfill({
        status: 200, contentType: "text/html",
        body: `<!doctype html><html><head><style>${css}</style></head><body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`,
      }));
      await page.goto(`${ORIGIN}/`);
      await page.evaluate(() => (window as unknown as { mount: (x: unknown, o: boolean) => void }).mount([], true));
      await page.locator("nav button").first().click();
      const box = await page.evaluate(() => {
        const b = (document.querySelector('[role="dialog"][aria-label="Team notifications"]') as HTMLElement).getBoundingClientRect();
        return { left: b.left, right: window.innerWidth - b.right };
      });
      expect(Math.abs(box.left - box.right)).toBeLessThanOrEqual(1);
    } finally { await ctx.close(); }
  });
});
