import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser } from "playwright";
import { appCss } from "./harness";

// ── The admin console's safety rails, driven (audit round 3) ────────────────
//
// F-ADMIN-01: the Users list's plan dropdown asks first. Cancel sends nothing;
// OK sends the change; a refusal from the server is shown, not swallowed.

const ORIGIN = "https://sc.test";
let css: string;
let bundle: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "adminsafety-"));
  writeFileSync(join(tmp, "nav-stub.tsx"), `
    export function useRouter() { return { push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return "/admin/users"; }
    export function useSearchParams() { return new URLSearchParams(); }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import UsersClient from "@/app/admin/users/UsersClient";
    createRoot(document.getElementById("root")!).render(
      h("main", { className: "sc-app min-h-screen bg-gray-950 px-4 py-6" },
        h(UsersClient))
    );
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://x"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"k"' },
    alias: { "next/navigation": join(tmp, "nav-stub.tsx"), "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function open(engine: string, opts: { setPlanStatus?: number } = {}) {
  const ctx = await browsers[engine].newContext({ viewport: { width: 390, height: 860 } });
  const page = await ctx.newPage();
  const setPlanCalls: unknown[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") {
      return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body class="sc-app"><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>` });
    }
    if (url.pathname === "/api/admin/users") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ users: [{
        id: "u1", username: "maya", primary_username: "maya", name: "Maya Rep", email: "maya@example.com", plan: "pro", plan_expires_at: null,
        signup_source: null, company: null, title: null, created_at: "2026-10-01T00:00:00Z", card_count: 1, lead_count: 0, view_count: 0,
      }] }) });
    }
    if (url.pathname === "/api/admin/set-plan") {
      setPlanCalls.push(JSON.parse(route.request().postData() || "null"));
      return opts.setPlanStatus && opts.setPlanStatus !== 200
        ? route.fulfill({ status: opts.setPlanStatus, contentType: "application/json", body: JSON.stringify({ error: "This account pays for Office through Stripe." }) })
        : route.fulfill({ status: 200, contentType: "application/json", body: '{"success":true}' });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`${ORIGIN}/`);
  return { page, setPlanCalls };
}

describe.each(["Chromium", "WebKit"])("%s", (engine) => {
  it("the plan dropdown asks first: Cancel sends nothing, OK sends it", async () => {
    const { page, setPlanCalls } = await open(engine);
    const select = page.locator("select").filter({ has: page.locator('option[value="enterprise"]') }).first();
    await select.waitFor();
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); void d.dismiss(); });
    await select.selectOption("free");
    await page.waitForTimeout(400);
    expect(asked).toContain("Move maya@example.com from Pro to Free?");
    expect(setPlanCalls).toEqual([]);

    page.once("dialog", (d) => void d.accept());
    await select.selectOption("free");
    await expect.poll(() => setPlanCalls.length, { timeout: 5_000 }).toBe(1);
    expect(setPlanCalls[0]).toEqual({ userId: "u1", plan: "free" });
    await page.context().close();
  });

  it("a refusal from the server is shown, not swallowed", async () => {
    const { page } = await open(engine, { setPlanStatus: 409 });
    const select = page.locator("select").filter({ has: page.locator('option[value="enterprise"]') }).first();
    await select.waitFor();
    page.once("dialog", (d) => void d.accept());
    await select.selectOption("enterprise");
    await page.getByRole("alert").filter({ hasText: "pays for Office through Stripe" }).waitFor();
    await page.context().close();
  });
});
