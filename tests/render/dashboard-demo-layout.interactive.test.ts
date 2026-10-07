import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// THE HOMEPAGE'S DASHBOARD DEMO MATCHES THE REAL DASHBOARD.
//
// Owner, 2026-09-29: Quick Contacts left the dashboard; Traffic sits beside the
// Your Card / Share panel; Call / Text / Email are on every Contacts row. The
// marketing replica (components/site/DashboardDemo, on the homepage and the
// product pages) must show the same — one change, every surface. The REAL
// component, in Chromium with the app's Tailwind.
// ─────────────────────────────────────────────────────────────────────────────

let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "dashboard-demo-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import DashboardDemo from "@/components/site/DashboardDemo";
    createRoot(document.getElementById("root")!).render(h("div", { style: { maxWidth: 1080, margin: "0 auto" } }, h(DashboardDemo)));
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
    <body style="margin:0;padding:24px;background:#f5f5f4"><div id="root"></div><script>${bundle}</script></body></html>`);
  await page.getByText("Show QR", { exact: true }).waitFor();
  await page.waitForTimeout(500);
  return page;
}

describe("the homepage dashboard demo", () => {
  it("dashboard tab: no Quick Contacts, Traffic beside the card panel", async () => {
    const page = await open();
    try {
      await page.screenshot({ path: "node_modules/.cache/dashboard-demo-dashboard.png", fullPage: true });
      const text = await page.evaluate(() => document.body.textContent ?? "");
      for (const gone of ["Quick Contacts", "View all in Contacts", "Total leads"]) expect(text).not.toContain(gone);
      // The 2026-09-29/30 redesign: no "Traffic" heading, no "Your Card"
      // heading or caption, My Cards on top, Show QR leading the Share box.
      for (const gone of ["Your Card", "Exactly what people get", "Download card as image", "vs last week"]) expect(text).not.toContain(gone);
      expect(await page.locator("p", { hasText: /^Traffic$/ }).count()).toBe(0);
      // Just the card in its box, as on the real dashboard: no Download under
      // it (owner, 2026-10-07) — the picture is saved from Other ways to share.
      expect(await page.locator("[data-demo=\"your-card\"]").evaluate((el) => el.textContent?.trim() ?? "")).not.toContain("Download");
      for (const here of ["My Cards", "View Live Link", "Add card", "Show QR", "Share link", "Other ways to share", "At an event? Tag today's contacts", "Unique viewers", "Repeat views", "Link taps"]) expect(text).toContain(here);
      const boxes = await page.evaluate(() => {
        const r = (el: Element | null) => el?.getBoundingClientRect();
        const traffic = [...document.querySelectorAll("button")].find((b) => b.textContent === "Week")!.closest(".rounded-2xl")!;
        const yourCard = document.querySelector("[data-demo=\"your-card\"]")!;
        return { traffic: r(traffic)!, yourCard: r(yourCard)! };
      });
      // Side by side: Traffic on the left, the card panel to its right, top-aligned.
      expect(boxes.traffic.right).toBeLessThanOrEqual(boxes.yourCard.left);
      expect(Math.abs(boxes.traffic.top - boxes.yourCard.top)).toBeLessThanOrEqual(2);
    } finally { await page.close(); }
  });

  it("contacts tab: every row has its Call / Text / Email circles, never a link", async () => {
    const page = await open();
    try {
      await page.getByRole("button", { name: "Contacts", exact: true }).click();
      await page.getByText("Sarah Chen").first().waitFor();
      await page.screenshot({ path: "node_modules/.cache/dashboard-demo-contacts.png", fullPage: true });
      const labels = await page.evaluate(() => [...document.querySelectorAll('[aria-label^="Call "], [aria-label^="Text "], [aria-label^="Email "]')].map((e) => [e.tagName, e.getAttribute("aria-label")]));
      expect(labels.map((l) => l[1])).toEqual([
        "Call Sarah Chen", "Text Sarah Chen", "Email Sarah Chen",
        "Call Marcus Webb", "Text Marcus Webb", "Email Marcus Webb",
        "Email Elena Diaz",
        "Call Tom Farrell", "Text Tom Farrell",
      ]);
      // Fictional people: spans, not tel:/mailto: links.
      expect(labels.every((l) => l[0] === "SPAN")).toBe(true);
      // No contact statuses (removed 2026-08-11) and no made-up actions.
      const text = await page.evaluate(() => document.body.textContent ?? "");
      for (const gone of ["New Contact", "Dissolved", "Reply", "Add note"]) expect(text).not.toContain(gone);
    } finally { await page.close(); }
  });
});
