import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// ── The admin console's safety rails, driven (audit round 3) ────────────────
//
// SEC-06: the two-step screen. First visit: a QR to scan, then a code; a wrong
// code says so; the right one reloads into the console. Later visits: just the
// code. Supabase's MFA API is a fake here (it's Supabase's job to check TOTP);
// what's tested is that this screen drives it correctly in both engines.
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
  // A stand-in for @supabase/ssr's browser client: window.__mfa holds the
  // factors, and records what the screen asked for.
  writeFileSync(join(tmp, "supabase-stub.ts"), `
    type W = { __mfa: { verified: boolean; enrolled: number; unenrolled: number; good: string; calls: string[] } };
    const w = window as unknown as W;
    export function createBrowserClient() {
      const m = w.__mfa;
      return { auth: { mfa: {
        listFactors: async () => {
          m.calls.push("list");
          const totp = m.verified ? [{ id: "f_ok", status: "verified", factor_type: "totp" }] : [];
          const all = [...totp, ...(m.verified ? [] : [{ id: "f_stale", status: "unverified", factor_type: "totp" }])];
          return { data: { totp, all }, error: null };
        },
        unenroll: async () => { m.unenrolled++; return { error: null }; },
        enroll: async () => { m.enrolled++; return { data: { id: "f_new", totp: { qr_code: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>", secret: "SECRETKEY", uri: "otpauth://x" } }, error: null }; },
        challengeAndVerify: async ({ factorId, code }: { factorId: string; code: string }) => {
          m.calls.push("verify:" + factorId + ":" + code);
          // The page reloads on success, which resets this stub: log it to the test server too.
          void fetch("/__mfa-log?" + encodeURIComponent("verify:" + factorId + ":" + code));
          return code === m.good ? { data: {}, error: null } : { data: null, error: { message: "Invalid TOTP code entered" } };
        },
      } } };
    }
  `);
  writeFileSync(join(tmp, "nav-stub.tsx"), `
    export function useRouter() { return { push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return "/admin/users"; }
    export function useSearchParams() { return new URLSearchParams(); }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import AdminTwoStep from "@/app/admin/AdminTwoStep";
    import UsersClient from "@/app/admin/users/UsersClient";
    const view = location.hash.slice(1);
    createRoot(document.getElementById("root")!).render(
      h("main", { className: "sc-app min-h-screen bg-gray-950 px-4 py-6" },
        view === "users" ? h(UsersClient) : h(AdminTwoStep, { email: "owner@swiftcard.me" }))
    );
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://x"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"k"' },
    alias: { "@supabase/ssr": join(tmp, "supabase-stub.ts"), "next/navigation": join(tmp, "nav-stub.tsx"), "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

type Mfa = { verified: boolean; enrolled: number; unenrolled: number; good: string; calls: string[] };

async function open(engine: string, view: "twostep" | "users", opts: { verified?: boolean; setPlanStatus?: number } = {}) {
  const ctx = await browsers[engine].newContext({ viewport: { width: 390, height: 860 } });
  const page = await ctx.newPage();
  let loads = 0;
  const setPlanCalls: unknown[] = [];
  const verifyLog: string[] = [];
  await page.addInitScript((verified) => {
    (window as unknown as { __mfa: Mfa }).__mfa = { verified, enrolled: 0, unenrolled: 0, good: "123456", calls: [] };
  }, !!opts.verified);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") {
      loads++;
      return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body class="sc-app"><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>` });
    }
    if (url.pathname === "/__mfa-log") {
      verifyLog.push(decodeURIComponent(url.search.slice(1)));
      return route.fulfill({ status: 204, body: "" });
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
  await page.goto(`${ORIGIN}/#${view}`);
  const mfa = () => page.evaluate(() => (window as unknown as { __mfa: Mfa }).__mfa);
  return { page, loads: () => loads, mfa, setPlanCalls, verifyLog };
}

async function typeCode(page: Page, code: string) {
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: /Turn on two-step sign-in|Continue/ }).click();
}

describe.each(["Chromium", "WebKit"])("%s", (engine) => {
  it("first visit: a QR to scan; a stale half-finished setup is cleared; a wrong code is refused; the right one reloads in", async () => {
    const { page, loads, mfa, verifyLog } = await open(engine, "twostep");
    await page.getByAltText(/QR code to add SwiftCard/).waitFor();
    await page.getByText("SECRETKEY").waitFor();
    expect((await mfa()).unenrolled).toBe(1);
    expect((await mfa()).enrolled).toBe(1);

    await typeCode(page, "000000");
    await page.getByRole("alert").filter({ hasText: "didn't match" }).waitFor();
    expect(loads()).toBe(1);

    await typeCode(page, "123 456");
    await expect.poll(loads, { timeout: 10_000 }).toBe(2);
    expect(verifyLog).toContain("verify:f_new:123456");
    await page.context().close();
  });

  it("later visits: just the code, no new setup", async () => {
    const { page, loads, mfa, verifyLog } = await open(engine, "twostep", { verified: true });
    await page.getByRole("button", { name: "Continue" }).waitFor();
    expect(await page.getByAltText(/QR code/).count()).toBe(0);
    expect((await mfa()).enrolled).toBe(0);
    await typeCode(page, "123456");
    await expect.poll(loads, { timeout: 10_000 }).toBe(2);
    expect(verifyLog).toContain("verify:f_ok:123456");
    await page.context().close();
  });

  it("the plan dropdown asks first: Cancel sends nothing, OK sends it", async () => {
    const { page, setPlanCalls } = await open(engine, "users");
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
    const { page } = await open(engine, "users", { setPlanStatus: 409 });
    const select = page.locator("select").filter({ has: page.locator('option[value="enterprise"]') }).first();
    await select.waitFor();
    page.once("dialog", (d) => void d.accept());
    await select.selectOption("enterprise");
    await page.getByRole("alert").filter({ hasText: "pays for Office through Stripe" }).waitFor();
    await page.context().close();
  });
});
