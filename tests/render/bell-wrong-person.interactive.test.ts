import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// "WRONG PERSON?" LIVES IN THE BELL.
//
// It was on the dashboard's Notifications list, which went with Quick
// Contacts (owner, 2026-09-29) — the owner chose to move it, not lose it. The
// REAL NotificationBell in Chromium, the API answered from here:
//   • offered only on "X is back" rows that name a known contact (lead_id)
//   • asks first; Cancel changes nothing
//   • Confirm removes the row and POSTs /api/leads/<id>/wrong-person
//     { notificationId }, without opening the contact
//   • a failed request puts the row back
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const RETURNED = { id: "n-back", type: "contact_returned", title: "Priya is back", body: "Priya re-opened your card.", read: false, created_at: ago(60_000), card_owner: "demo", lead_id: "lead-priya" };
const RETURNED_BLURRED = { id: "n-blur", type: "contact_returned", title: "A contact is back", body: "Someone re-opened your card.", read: false, created_at: ago(120_000), card_owner: "demo", lead_id: null };
const NEW_LEAD = { id: "n-new", type: "new_lead", title: "New contact: Sam", body: null, read: false, created_at: ago(180_000), card_owner: "demo", lead_id: "lead-sam" };

let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "bell-wrong-person-"));
  writeFileSync(join(tmp, "nav-stub.ts"), `
    export function useRouter() { return { push: (u: string) => { (window as any).__nav.push(u); }, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export const usePathname = () => "/dashboard";
    export const useSearchParams = () => new URLSearchParams();
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import NotificationBell from "@/components/NotificationBell";
    (window as any).__nav = [];
    (window as any).mount = (notifs: any[]) => {
      createRoot(document.getElementById("root")!).render(
        h("nav", { className: "sc-app flex justify-end p-2" }, h(NotificationBell, { initialNotifications: notifs, cardLabels: {} })),
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

async function rig(wrongPersonStatus = 200): Promise<{ page: Page; posts: { url: string; body: string }[] }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const server = [RETURNED, RETURNED_BLURRED, NEW_LEAD];
  const posts: { url: string; body: string }[] = [];
  await page.route(`${ORIGIN}/api/notifications`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(server) }));
  await page.route(`${ORIGIN}/api/leads/*/wrong-person`, (r) => {
    posts.push({ url: r.request().url(), body: r.request().postData() ?? "" });
    if (wrongPersonStatus === 200) server.splice(server.findIndex((n) => n.id === "n-back"), 1);
    return r.fulfill({ status: wrongPersonStatus, contentType: "application/json", body: "{}" });
  });
  await page.route(`${ORIGIN}/api/push/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"show":false}' }));
  await page.route(`${ORIGIN}/`, (r) => r.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
           <body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`,
  }));
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((n) => (window as unknown as { mount: (x: unknown) => void }).mount(n), [RETURNED, RETURNED_BLURRED, NEW_LEAD]);
  await page.click('nav button[aria-label="Notifications"]');
  await page.getByText("Priya is back").waitFor();
  return { page, posts };
}

const dialog = '[role="dialog"][aria-label="Notifications"]';

describe("Wrong person? in the bell", () => {
  it("is offered only on a returning contact the account knows (a lead_id), and asks first", async () => {
    const { page, posts } = await rig();
    try {
      expect(await page.locator(`${dialog} >> text=Wrong person?`).count()).toBe(1);
      await page.click(`${dialog} >> text=Wrong person?`);
      await page.getByText("Not them? We'll stop recognising that device.").waitFor();
      await page.click(`${dialog} >> button:has-text("Cancel")`);
      expect(await page.locator(`${dialog} >> text=Wrong person?`).count()).toBe(1);
      expect(await page.getByText("Priya is back").count()).toBe(1);
      expect(posts).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __nav: string[] }).__nav), "the ask opened the contact").toEqual([]);
    } finally { await page.context().close(); }
  });

  it("Confirm removes the row and tells the server which notification — without opening the contact", async () => {
    const { page, posts } = await rig();
    try {
      await page.click(`${dialog} >> text=Wrong person?`);
      await page.click(`${dialog} >> button:has-text("Confirm")`);
      await page.waitForFunction(() => !document.body.textContent?.includes("Priya is back"), null, { timeout: 3000 });
      expect(posts).toHaveLength(1);
      expect(posts[0].url).toBe(`${ORIGIN}/api/leads/lead-priya/wrong-person`);
      expect(JSON.parse(posts[0].body)).toEqual({ notificationId: "n-back" });
      expect(await page.evaluate(() => (window as unknown as { __nav: string[] }).__nav)).toEqual([]);
      // The other rows are untouched.
      expect(await page.getByText("A contact is back").count()).toBe(1);
      expect(await page.getByText("New contact: Sam").count()).toBe(1);
    } finally { await page.context().close(); }
  });

  it("a failed request puts the row back and says so; reopening the bell starts clean", async () => {
    const { page, posts } = await rig(500);
    try {
      await page.click(`${dialog} >> text=Wrong person?`);
      await page.click(`${dialog} >> button:has-text("Confirm")`);
      await page.getByText("Couldn't do that just now — try again.").waitFor({ timeout: 3000 });
      expect(posts).toHaveLength(1);
      expect(await page.getByText("Priya is back").count()).toBe(1);
      // Leave a Confirm half-open, close the bell, reopen it: no stale error,
      // no half-finished Confirm.
      await page.click(`${dialog} >> text=Wrong person?`);
      await page.getByText("Not them? We'll stop recognising that device.").waitFor();
      await page.click(`${dialog} button[aria-label="Close"]`);
      await page.click('nav button[aria-label="Notifications"]');
      await page.getByText("Priya is back").waitFor();
      expect(await page.getByText("Couldn't do that just now — try again.").count()).toBe(0);
      expect(await page.getByText("Not them? We'll stop recognising that device.").count()).toBe(0);
    } finally { await page.context().close(); }
  });

  it("no 'View all notifications' footer — the bell is the list", async () => {
    const { page } = await rig();
    try {
      expect(await page.locator(`${dialog} >> text=View all notifications`).count()).toBe(0);
    } finally { await page.context().close(); }
  });
});
