import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// THE DELETE-ACCOUNT PROMOTION, DRIVEN AND MEASURED.
//
// Owner, 2026-09-30: before the final step where they type DELETE, a free
// account gets "30 days of Pro on us"; Pro gets its own promotion; once per
// person; "the UI has to be perfect". The real ManageAccount, in Chromium with
// the app's real Tailwind, walked step by step the way a person does — at
// phone and desktop width, light and dark, and inside the iPhone app.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";

type Elig = { grant: boolean; grantDays?: number; discount: boolean; downgrade: boolean };
const FREE_ELIG: Elig = { grant: true, grantDays: 30, discount: false, downgrade: false };
const PRO_ELIG: Elig = { grant: false, discount: true, downgrade: true };
const facts = { contacts: 12, views: 40, cards: 1, cardUrl: "swiftcard.me/dana-acme", since: null, isOfficeOwner: false };

let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "delete-promo-"));
  // No Supabase in here: an account with a password, and sign-in that works.
  writeFileSync(join(tmp, "supabase-stub.ts"), `
    export function createBrowserClient() {
      return { auth: {
        getUser: async () => ({ data: { user: { email: "dana@example.com", identities: [{ provider: "email" }] } } }),
        signInWithPassword: async () => ({ error: null }),
        signOut: async () => ({ error: null }),
      } };
    }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import ManageAccount from "@/components/ManageAccount";
    (window as any).mount = (plan: string) => {
      createRoot(document.getElementById("root")!).render(
        h("main", { className: "sc-app min-h-screen bg-gray-950 p-4" },
          h(ManageAccount, { isPro: plan !== "free", plan, email: "dana@example.com" })),
      );
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://x.supabase.co"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"anon"' },
    alias: { "@": resolve("src"), "@supabase/ssr": join(tmp, "supabase-stub.ts") },
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

type Opts = { width?: number; theme?: "light" | "dark"; native?: boolean; elig: Elig; source?: string | null; plan?: string; getDelayMs?: number };

async function open(o: Opts): Promise<{ page: Page; posts: Record<string, unknown>[] }> {
  const ctx = await browser.newContext({ viewport: { width: o.width ?? 390, height: 844 } });
  const page = await ctx.newPage();
  const posts: Record<string, unknown>[] = [];
  await page.route(`${ORIGIN}/api/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${ORIGIN}/api/account/retention`, async (r) => {
    if (r.request().method() === "GET") {
      if (o.getDelayMs) await new Promise((res) => setTimeout(res, o.getDelayMs));
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plan: o.plan === "free" || !o.plan ? "free" : "pro", source: o.source ?? null, eligibility: o.elig, facts }) });
    }
    const body = JSON.parse(r.request().postData() || "{}");
    posts.push(body);
    const until = new Date(Date.now() + 30 * 86400000).toISOString();
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body.action === "grant" ? { ok: true, days: 30, until } : { ok: true }) });
  });
  await page.route(`${ORIGIN}/`, (r) => r.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html${o.theme === "light" ? ' data-sc-theme="light"' : ""}><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
           <body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`,
  }));
  if (o.native) await page.addInitScript(() => { (window as unknown as { webkit: unknown }).webkit = { messageHandlers: { bridge: {} } }; });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((p) => (window as unknown as { mount: (x: string) => void }).mount(p), o.plan ?? "free");
  await page.getByRole("button", { name: "Account ownership and deletion" }).click();
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  return { page, posts };
}

/** Screenshots for a human look, only when asked for (SHOT_DIR=…). */
async function shot(page: Page, name: string) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: join(process.env.SHOT_DIR, name) });
}

const modal = (page: Page) => page.locator("div.max-w-sm").first();
const label = (page: Page) => modal(page).locator("p.uppercase").first();

/** Walk from "why" to the step after "Here's what goes". */
async function walkToPromotion(page: Page) {
  await page.getByRole("button", { name: "Continue", exact: true }).waitFor();
  await page.locator('input[type="radio"]').first().check();
  await page.getByRole("button", { name: "Continue", exact: true }).click(); // why → detail
  await page.getByRole("button", { name: "Continue", exact: true }).click(); // detail → keep
  await page.getByRole("button", { name: /No thanks, keep deleting|Continue with deletion/ }).click(); // keep → loss
  await page.getByText("Here's what goes").waitFor();
  await page.getByRole("button", { name: "Continue", exact: true }).click(); // loss → offer
}

/** Nothing sticks out, nothing is cut off, and both buttons can be reached. */
async function layoutOf(page: Page) {
  return page.evaluate(() => {
    const m = document.querySelector("div.max-w-sm") as HTMLElement;
    const r = m.getBoundingClientRect();
    const buttons = [...m.querySelectorAll("button")].map((b) => {
      const br = b.getBoundingClientRect();
      return { text: (b.textContent ?? "").trim(), w: br.width, h: br.height, inside: br.left >= r.left - 0.5 && br.right <= r.right + 0.5 };
    });
    const clipped = [...m.querySelectorAll("p, li, span, button")].filter((el) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1).map((el) => (el.textContent ?? "").slice(0, 40));
    return {
      pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
      modalLeft: r.left, modalRight: r.right, viewport: window.innerWidth,
      buttons, clipped,
    };
  });
}

describe("Free: 30 days of Pro on us, the last thing before DELETE", () => {
  for (const width of [390, 1280]) {
    for (const theme of ["light", "dark"] as const) {
      it(`${width}px, ${theme}: step 5 of 6, fits, and the promise is complete`, async () => {
        const { page } = await open({ width, theme, elig: FREE_ELIG });
        try {
          await walkToPromotion(page);
          await page.getByText("Try Pro free for 30 days — on us").waitFor();
          expect(await label(page).innerText()).toMatch(/step 5 of 6/i);
          const text = await modal(page).innerText();
          expect(text).toMatch(/Pro · on us/i);
          for (const b of ["Unlimited cards and links", "Every contact unlocked", "The AI card scanner"]) expect(text).toContain(b);
          expect(text).toMatch(/No card needed\. Nothing to cancel\. Ends on its own on [A-Z][a-z]{2} \d{1,2}\./);
          expect(text).toMatch(/Normally \$\d+\.\d{2}\/month/);
          // The end date is read as one thing — never "Oct" / "30" on two lines.
          const dateLines = await modal(page).locator("span.whitespace-nowrap").evaluate((s) =>
            new Set([...s.getClientRects()].map((r) => Math.round(r.top))).size);
          expect(dateLines).toBe(1);
          const l = await layoutOf(page);
          expect(l.pageOverflowX).toBe(false);
          expect(l.modalLeft).toBeGreaterThanOrEqual(0);
          expect(l.modalRight).toBeLessThanOrEqual(l.viewport);
          expect(l.clipped, "text cut off inside the card").toEqual([]);
          for (const b of l.buttons) {
            expect(b.inside, `${b.text} sticks out of the dialog`).toBe(true);
            expect(b.h, `${b.text} is too small to tap`).toBeGreaterThanOrEqual(32);
          }
          // The primary button's white label is really white on blue in both themes.
          const color = await page.getByRole("button", { name: "Start my free 30 days" }).evaluate((b) => getComputedStyle(b).color);
          expect(color).toBe("rgb(255, 255, 255)");
          await shot(page, `free-${width}-${theme}.png`);
        } finally { await page.context().close(); }
      });
    }
  }

  it("taking it ends the flow with the real end date, and says nothing about deleting", async () => {
    const { page, posts } = await open({ elig: FREE_ELIG, theme: "light" });
    try {
      await walkToPromotion(page);
      await page.getByRole("button", { name: "Start my free 30 days" }).click();
      await page.getByText(/^Pro is on until [A-Z][a-z]+ \d{1,2}$/).waitFor();
      expect(posts.map((p) => p.action)).toEqual(["survey", "grant"]);
      expect(await modal(page).innerText()).toMatch(/you won't be charged until/);
      expect(await page.getByText("Type DELETE to confirm").count()).toBe(0);
    } finally { await page.context().close(); }
  });

  it("declining carries straight on to Type DELETE", async () => {
    const { page } = await open({ elig: FREE_ELIG });
    try {
      await walkToPromotion(page);
      await page.getByRole("button", { name: "No thanks, continue to delete" }).click();
      await page.getByText("Type DELETE to confirm").waitFor();
      expect(await label(page).innerText()).toMatch(/step 6 of 6/i);
    } finally { await page.context().close(); }
  });

  it("inside the iPhone app: the gift, with no price anywhere", async () => {
    const { page } = await open({ elig: FREE_ELIG, native: true, theme: "light" });
    try {
      await walkToPromotion(page);
      await page.getByText("Try Pro free for 30 days — on us").waitFor();
      expect(await modal(page).innerText()).not.toMatch(/\$/);
      await page.getByRole("button", { name: "Start my free 30 days" }).click();
      await page.getByText(/^Pro is on until/).waitFor();
      expect(await modal(page).innerText(), "subscribe pitch inside the app").not.toMatch(/Subscribe|charged/);
    } finally { await page.context().close(); }
  });

  it("not eligible: five steps, no promotion, straight to DELETE", async () => {
    const { page } = await open({ elig: { grant: false, discount: false, downgrade: false } });
    try {
      await walkToPromotion(page);
      await page.getByText("Type DELETE to confirm").waitFor();
      expect(await label(page).innerText()).toMatch(/step 5 of 5/i);
    } finally { await page.context().close(); }
  });

  it("a slow answer can't skip the promotion or change the step count", async () => {
    const { page } = await open({ elig: FREE_ELIG, getDelayMs: 1200 });
    try {
      const btn = page.getByRole("button", { name: "One moment…" });
      await btn.waitFor();
      expect(await btn.isDisabled()).toBe(true);
      expect((await label(page).innerText()).trim()).toBe("");
      await page.getByRole("button", { name: "Continue", exact: true }).waitFor();
      expect(await label(page).innerText()).toMatch(/step 1 of 6/i);
    } finally { await page.context().close(); }
  });
});

describe("Pro: 50% off, last before DELETE — and never inside the app", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`390px, ${theme}: the discount card fits and names the monthly price`, async () => {
      const { page, posts } = await open({ elig: PRO_ELIG, plan: "pro", source: "stripe", theme });
      try {
        await walkToPromotion(page);
        await page.getByText("Stay for 50% off your next 3 months").waitFor();
        expect(await label(page).innerText()).toMatch(/step 5 of 6/i);
        const text = await modal(page).innerText();
        expect(text).toMatch(/50% off your \$\d+\.\d{2}\/month plan for 3 months/);
        const l = await layoutOf(page);
        expect(l.pageOverflowX).toBe(false);
        expect(l.clipped).toEqual([]);
        await shot(page, `pro-390-${theme}.png`);
        await page.getByRole("button", { name: "Apply 50% off" }).click();
        await page.getByText("Discount applied").waitFor();
        expect(posts.map((p) => p.action)).toEqual(["survey", "discount"]);
      } finally { await page.context().close(); }
    });
  }

  it("inside the iPhone app there is no discount step at all", async () => {
    const { page } = await open({ elig: PRO_ELIG, plan: "pro", source: "stripe", native: true });
    try {
      await walkToPromotion(page);
      await page.getByText("Type DELETE to confirm").waitFor();
      expect(await label(page).innerText()).toMatch(/step 5 of 5/i);
    } finally { await page.context().close(); }
  });

  it("free Pro with nothing billing it is told it ends by itself — and gets no promotion", async () => {
    const { page } = await open({ elig: { grant: false, discount: false, downgrade: false }, plan: "pro", source: "grant" });
    try {
      await page.getByRole("button", { name: "Continue", exact: true }).waitFor();
      await page.locator('input[type="radio"]').first().check();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByText("Your free Pro ends on its own").waitFor();
      expect(await modal(page).innerText()).not.toMatch(/subscription/i);
    } finally { await page.context().close(); }
  });
});
