import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, BrowserContext } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// "ADD MY CURRENT LOCATION" ON A REAL FORM, WITH A REAL PERMISSION ANSWER.
//
// Feature 4 (owner, 2026-10-18). The card page's "Share your info" form is
// mounted in Chromium with the app's compiled Tailwind; the phone's answer is
// Playwright's own geolocation permission. What a visitor experiences is what
// is asserted: nothing is asked until they tap, "allow" puts the exact point
// in the request, "no" says so and the form still sends — without one — and
// the switch fits a 320px phone.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";
let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "share-location-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import LeadCaptureForm from "@/components/LeadCaptureForm";
    (window as any).mount = () => createRoot(document.getElementById("root")!).render(h(LeadCaptureForm, { cardOwner: "demo", source: "qr_code" }));
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

async function open(ctx: BrowserContext) {
  const page = await ctx.newPage();
  const posted: Record<string, unknown>[] = [];
  await page.route(`${ORIGIN}/api/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${ORIGIN}/api/leads`, async (r) => {
    posted.push(JSON.parse(r.request().postData() ?? "{}"));
    await r.fulfill({ status: 200, contentType: "application/json", body: '{"success":true}' });
  });
  await page.route(`${ORIGIN}/`, (r) => r.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
           <style>body{margin:0;padding:16px;background:#F7F4EF}</style></head>
           <body><div id="root" style="max-width:384px"></div><script>${bundle}</script></body></html>`,
  }));
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => (window as unknown as { mount: () => void }).mount());
  const toggle = page.getByRole("switch");
  await toggle.waitFor();
  return { page, posted, toggle };
}

async function fillAndSend(page: import("playwright").Page) {
  await page.fill("#sc-lead-name", "Priya Shah");
  await page.fill("#sc-lead-phone", "5550102000");
  await page.getByRole("button", { name: "Share My Info" }).click();
  await page.waitForTimeout(400);
}

describe("the visitor allows it", () => {
  it("nothing asked on load; the tap asks; the exact point rides with the details", async () => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: [],
      geolocation: { latitude: 40.7484405, longitude: -73.9856644, accuracy: 12 },
    });
    try {
      const { page, posted, toggle } = await open(ctx);
      expect(await toggle.getAttribute("aria-checked")).toBe("false");
      expect(await toggle.innerText()).toContain("Add my current location");
      await ctx.grantPermissions(["geolocation"], { origin: ORIGIN });
      await toggle.click();
      await page.getByText("Location added").waitFor();
      expect(await toggle.getAttribute("aria-checked")).toBe("true");
      expect(await toggle.innerText()).toContain("Within about 12 m");
      await fillAndSend(page);
      expect(posted).toHaveLength(1);
      expect(posted[0].shared_location).toEqual({ lat: 40.748441, lng: -73.985664, accuracy: 12 });
      expect(posted[0].name).toBe("Priya Shah");
    } finally { await ctx.close(); }
  });

  it("turning it back off sends nothing", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 40.7, longitude: -73.9, accuracy: 20 } });
    try {
      await ctx.grantPermissions(["geolocation"], { origin: ORIGIN });
      const { page, posted, toggle } = await open(ctx);
      await toggle.click();
      await page.getByText("Location added").waitFor();
      await toggle.click();
      expect(await toggle.getAttribute("aria-checked")).toBe("false");
      await fillAndSend(page);
      expect(posted[0]).not.toHaveProperty("shared_location");
    } finally { await ctx.close(); }
  });
});

describe("the visitor's phone says no", () => {
  it("says so in a sentence, and the form still sends — without a location", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const { page, posted, toggle } = await open(ctx);
      await toggle.click();
      await page.getByText(/Location not added|Couldn't get your location/).waitFor();
      expect(await toggle.getAttribute("aria-checked")).toBe("false");
      await fillAndSend(page);
      expect(posted).toHaveLength(1);
      expect(posted[0]).not.toHaveProperty("shared_location");
    } finally { await ctx.close(); }
  });
});

describe("it fits", () => {
  it("320px: the switch and its words stay inside the form", async () => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 700 } });
    try {
      const { page, toggle } = await open(ctx);
      const g = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        form: document.querySelector("form")!.getBoundingClientRect().toJSON(),
        sw: document.querySelector('[role="switch"]')!.getBoundingClientRect().toJSON(),
      }));
      expect(g.overflow).toBeLessThanOrEqual(0);
      expect(g.sw.left).toBeGreaterThanOrEqual(g.form.left - 0.5);
      expect(g.sw.right).toBeLessThanOrEqual(g.form.right + 0.5);
      // A comfortable tap target.
      expect(g.sw.height).toBeGreaterThanOrEqual(44);
      expect(await toggle.isVisible()).toBe(true);
    } finally { await ctx.close(); }
  });
});
