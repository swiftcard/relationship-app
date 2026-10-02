import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// BILLING → CANCEL ON A PRO TRIAL, DRIVEN AND MEASURED.
//
// Owner, 2026-10-02: someone cancelling during the 14-day Pro trial is offered
// free Pro until a month from the day the trial started — the same offer the
// delete flow makes. The real BillingManager in Chromium with the app's real
// Tailwind, walked the way a person does: Manage → Switch to Free → reason →
// the offer → accept, at phone and desktop width, light and dark.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";
const DAY = 86_400_000;
const TRIAL_START = Date.now() - 7 * DAY;
const TRIAL_END = new Date(TRIAL_START + 14 * DAY).toISOString();
const UNTIL = new Date(TRIAL_START + 30 * DAY).toISOString();

const trialSub = (over: Record<string, unknown> = {}) => ({
  plan: "pro", planSource: "stripe", interval: "monthly", status: "trialing",
  seats: null, activeMembers: null, pendingInvites: null, ownerSeats: 1,
  scheduledSeats: null, scheduledSeatsAt: null, minSeats: 3,
  currentPeriodEnd: TRIAL_END, trialEnd: TRIAL_END, grantEndsAt: null,
  cancelAtPeriodEnd: false, renewalCents: 499, retentionUsed: false, discountOfferable: false,
  trialExtension: { until: UNTIL, currentEnd: TRIAL_END, extraDays: 16, chargeCents: 499, chargeInterval: "month" },
  paymentFailed: false, hasStripeSubscription: true, hasCustomer: true, personalSubOnly: false,
  ...over,
});

let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "billing-trial-"));
  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement as h } from "react";
    export default function Link(p: any) { const { href, children, ...rest } = p; return h("a", { href, ...rest }, children); }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import BillingManager from "@/components/BillingManager";
    (window as any).mount = () => {
      createRoot(document.getElementById("root")!).render(
        h("main", { className: "sc-app min-h-screen bg-gray-950 p-4" }, h(BillingManager)),
      );
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src"), "next/link": join(tmp, "link-stub.tsx") },
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

type Opts = { width?: number; theme?: "light" | "dark"; sub?: Record<string, unknown> };

async function open(o: Opts): Promise<{ page: Page; posts: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: o.width ?? 390, height: 844 } });
  const page = await ctx.newPage();
  const posts: string[] = [];
  let extended = false;
  await page.route(`${ORIGIN}/api/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${ORIGIN}/api/stripe/subscription`, (r) => r.fulfill({
    status: 200, contentType: "application/json",
    // After accepting, the live subscription reads the new trial end and no offer.
    body: JSON.stringify(extended ? trialSub({ trialEnd: UNTIL, currentPeriodEnd: UNTIL, trialExtension: null }) : trialSub(o.sub)),
  }));
  await page.route(`${ORIGIN}/api/stripe/subscription/extend-trial`, (r) => {
    posts.push("extend-trial");
    extended = true;
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, until: UNTIL, extraDays: 16 }) });
  });
  await page.route(`${ORIGIN}/api/stripe/subscription/cancel`, (r) => {
    posts.push("cancel");
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, cancelAt: TRIAL_END }) });
  });
  await page.route(`${ORIGIN}/`, (r) => r.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html${o.theme === "light" ? ' data-sc-theme="light"' : ""}><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
           <body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`,
  }));
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => (window as unknown as { mount: () => void }).mount());
  return { page, posts };
}

async function shot(page: Page, name: string) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: join(process.env.SHOT_DIR, name) });
}

/** Manage → Switch to Free → a reason → Continue. */
async function walkToOffer(page: Page, reason = "Just testing it out") {
  await page.getByRole("button", { name: "Manage subscription & payment" }).click();
  await page.getByRole("button", { name: /Switch to Free/ }).click();
  await page.getByRole("button", { name: reason, exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

const dialog = (page: Page) => page.locator("div.max-w-sm").last();

describe("Billing → cancel on a Pro trial: stretch it to a full month first", () => {
  for (const width of [390, 1280]) {
    for (const theme of ["light", "dark"] as const) {
      it(`${width}px, ${theme}: the offer appears, fits, and names the date and the charge`, async () => {
        const { page } = await open({ width, theme });
        try {
          await walkToOffer(page);
          await page.getByText(/^Keep your free trial going until [A-Z][a-z]+ \d{1,2}$/).waitFor();
          const text = await dialog(page).innerText();
          expect(text).toMatch(/Your trial ends [A-Z][a-z]+ \d{1,2}\. Stay, and we'll stretch it to a full month — 16 more days of Pro, free\./);
          expect(text).toMatch(/Then \$4\.99\/month from [A-Z][a-z]+ \d{1,2}/);
          expect(text).toMatch(/No thanks, continue canceling/);
          // No 50% card on a trial.
          expect(text).not.toMatch(/50%/);
          const l = await page.evaluate(() => {
            const m = [...document.querySelectorAll("div.max-w-sm")].pop() as HTMLElement;
            const r = m.getBoundingClientRect();
            return {
              overflowX: document.documentElement.scrollWidth > window.innerWidth,
              inside: r.left >= 0 && r.right <= window.innerWidth,
              clipped: [...m.querySelectorAll("p, span, button")].filter((el) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1).map((el) => (el.textContent ?? "").slice(0, 40)),
              small: [...m.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().height < 24 && (b.textContent ?? "").trim() !== "×").map((b) => b.textContent),
            };
          });
          expect(l.overflowX).toBe(false);
          expect(l.inside).toBe(true);
          expect(l.clipped).toEqual([]);
          expect(l.small).toEqual([]);
          const color = await page.getByRole("button", { name: /^Keep my trial until / }).evaluate((b) => getComputedStyle(b).color);
          expect(color).toBe("rgb(255, 255, 255)");
          await shot(page, `billing-trial-${width}-${theme}.png`);
        } finally { await page.context().close(); }
      });
    }
  }

  it("offered for every reason, not only price", async () => {
    for (const reason of ["Missing a feature I need", "Too expensive", "Other"]) {
      const { page } = await open({});
      try {
        await walkToOffer(page, reason);
        await page.getByRole("button", { name: /^Keep my trial until / }).waitFor();
      } finally { await page.context().close(); }
    }
  });

  it("accepting stretches the trial, says so, and cancels nothing", async () => {
    const { page, posts } = await open({ theme: "light" });
    try {
      await walkToOffer(page);
      await page.getByRole("button", { name: /^Keep my trial until / }).click();
      await page.getByText(/^Your trial now runs until [A-Z][a-z]+ \d{1,2}\. Your first charge moves to that day/).waitFor();
      expect(posts).toEqual(["extend-trial"]);
      // The status line now shows the new date.
      expect(await page.locator("main").innerText()).toMatch(/Pro trial · \d+ days left · first charge \$4\.99/);
    } finally { await page.context().close(); }
  });

  it("declining carries on to the cancel confirmation", async () => {
    const { page, posts } = await open({});
    try {
      await walkToOffer(page);
      await page.getByRole("button", { name: "No thanks, continue canceling" }).click();
      await page.getByRole("button", { name: "Downgrade to Free anyway" }).click();
      await page.getByText(/scheduled to end on/).waitFor();
      expect(posts).toEqual(["cancel"]);
    } finally { await page.context().close(); }
  });

  it("not eligible: straight to the cancel confirmation, no offer", async () => {
    const { page } = await open({ sub: { trialExtension: null } });
    try {
      await walkToOffer(page);
      await page.getByRole("button", { name: "Downgrade to Free anyway" }).waitFor();
      expect(await page.getByText(/Keep your free trial going/).count()).toBe(0);
    } finally { await page.context().close(); }
  });
});
