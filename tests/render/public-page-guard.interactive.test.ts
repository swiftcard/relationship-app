import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// A PUBLIC CARD / SWIFT LINKS PAGE IS NEVER A SCREEN IN THE IPHONE APP.
//
// Owner, 2026-09-29: "We don't want links ever opening in that app. That
// glitch cannot happen." NativeAppBridge's last line of defence: if the app's
// webview lands on a page carrying <meta name="sc-public-page">, it hides it,
// hands it to the default browser and returns to /dashboard.
//
// The marker is page METADATA, which Next streams into the body after the page
// resolves — so it can arrive after the bridge has mounted. This mounts the
// REAL bridge as the app (webkit bridge stubbed) and adds the marker LATE, the
// way production delivers it.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";
let browser: Browser;
let bundle = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "public-page-guard-"));
  // Capacitor plugins the bridge imports lazily — inert here.
  for (const [name, src] of Object.entries({
    "cap-app.ts": "export const App = { addListener: async () => ({ remove() {} }) };",
    "cap-push.ts": "export const PushNotifications = { addListener: async () => ({ remove() {} }), checkPermissions: async () => ({ receive: 'denied' }), register: async () => {} };",
    "cap-splash.ts": "export const SplashScreen = { hide: async () => {} };",
    "cap-browser.ts": "export const Browser = { close: async () => {}, open: async () => {} };",
  })) writeFileSync(join(tmp, name), src);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import NativeAppBridge from "@/components/NativeAppBridge";
    createRoot(document.getElementById("root")!).render(h(NativeAppBridge));
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: {
      "@": resolve("src"),
      "@capacitor/app": join(tmp, "cap-app.ts"),
      "@capacitor/push-notifications": join(tmp, "cap-push.ts"),
      "@capacitor/splash-screen": join(tmp, "cap-splash.ts"),
      "@capacitor/browser": join(tmp, "cap-browser.ts"),
    },
    banner: { js: "var process = { env: { NODE_ENV: \"production\", NEXT_PUBLIC_SUPABASE_URL: \"https://x.supabase.co\", NEXT_PUBLIC_SUPABASE_ANON_KEY: \"k\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

type Rig = { page: Page; opened: string[]; dashboardHits: () => number };

async function rig(path: string, opts: { markerAt: "head" | "late" | "none"; native?: boolean; iframe?: boolean } ): Promise<Rig> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const opened: string[] = [];
  let dash = 0;
  await page.exposeFunction("__opened", (u: string) => { opened.push(u); });
  if (opts.native !== false) {
    await ctx.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
      // The default-browser plugin (ios/App/App/ExternalPurchase.swift).
      w.Capacitor = { Plugins: { ExternalPurchase: { open: async ({ url }: { url: string }) => { (w.__opened as (u: string) => void)(url); return { opened: true }; } } } };
    });
  }
  await page.route(`${ORIGIN}/api/**`, (r) => r.fulfill({ status: 401, body: "{}" }));
  await page.route(`${ORIGIN}/dashboard*`, (r) => { dash++; return r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>dash</title><p>dashboard</p>" }); });
  const meta = '<meta name="sc-public-page" content="card">';
  const pageHtml = `<!doctype html><html><head>${opts.markerAt === "head" ? meta : ""}</head><body><div id="root"></div>
    <p>Alex Morgan's public card</p><script>${bundle}</script>
    ${opts.markerAt === "late" ? `<script>setTimeout(() => { const d = document.createElement("div"); d.innerHTML = '${meta}'; document.body.appendChild(d); }, 600);</script>` : ""}
    </body></html>`;
  await page.route(`${ORIGIN}/card-page*`, (r) => r.fulfill({ status: 200, contentType: "text/html", body: pageHtml }));
  await page.route(`${ORIGIN}/host`, (r) => r.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><iframe src="/card-page${path}" style="width:390px;height:600px"></iframe>` }));
  await page.goto(opts.iframe ? `${ORIGIN}/host` : `${ORIGIN}/card-page${path}`);
  return { page, opened, dashboardHits: () => dash };
}

const settle = (p: Page, ms = 1800) => p.waitForTimeout(ms);

describe("the iPhone app never shows a public card page", () => {
  it("marker already there: handed to Safari (via www) and the app returns to the dashboard", async () => {
    const r = await rig("?source=qr", { markerAt: "head" });
    try {
      await r.page.waitForURL(`${ORIGIN}/dashboard`, { timeout: 5000 });
      expect(r.opened).toEqual([`https://www.swiftcard.me/card-page?source=qr`]);
    } finally { await r.page.context().close(); }
  });

  it("marker streamed in LATE (after the bridge mounted): still caught", async () => {
    const r = await rig("", { markerAt: "late" });
    try {
      await r.page.waitForURL(`${ORIGIN}/dashboard`, { timeout: 5000 });
      expect(r.opened).toEqual([`https://www.swiftcard.me/card-page`]);
    } finally { await r.page.context().close(); }
  });

  it("the page is hidden the moment it is caught — it never shows as an app screen", async () => {
    const r = await rig("", { markerAt: "late" });
    try {
      // Freeze the navigation so the hidden state can be observed.
      await r.page.route(`${ORIGIN}/dashboard*`, () => { /* hold */ });
      await r.page.waitForFunction(() => document.documentElement.style.visibility === "hidden", null, { timeout: 5000 });
    } finally { await r.page.context().close(); }
  });

  it("leaves ordinary app pages, ?embed renders, iframes and the website alone", async () => {
    for (const [label, path, opts] of [
      ["no marker", "", { markerAt: "none" }],
      ["?embed=1", "?embed=1", { markerAt: "head" }],
      ["inside an iframe (in-app previews)", "", { markerAt: "head", iframe: true }],
      ["the website (not the app)", "", { markerAt: "head", native: false }],
    ] as const) {
      const r = await rig(path, opts);
      try {
        await settle(r.page);
        expect(r.opened, label).toEqual([]);
        expect(r.dashboardHits(), label).toBe(0);
      } finally { await r.page.context().close(); }
    }
  });
});
