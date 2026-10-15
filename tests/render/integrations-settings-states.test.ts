import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Browser, Page } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, Suspense } from "react";
import { launchBrowser, appCss } from "./harness";

// ── Every state of "Send contacts to your CRM", at phone and desktop width ──
//
// These cards grew a delivery line ("Last contact sent …" / "N waiting"), a
// Send test contact button, a Disconnect that stays reachable after a plan
// ends, and two kinds of problem badge. All of that sits in rows beside a
// logo and a button on a 390px phone. A source scan cannot see whether it
// fits or whether the right control is there in the right state; this renders
// the real components with the app's real CSS and looks.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/settings/flows",
}));

import IntegrationsSettings from "@/components/IntegrationsSettings";
import ZapierSettings from "@/components/ZapierSettings";
import CrmEventSettings from "@/components/CrmEventSettings";

const HOUR_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const CARDS = [
  { id: "11111111-1111-4111-8111-111111111111", username: "work", name: "Maya Work", label: "Work" },
  { id: "22222222-2222-4222-8222-222222222222", username: "side", name: "Maya Side", label: "Side" },
];

type Props = Parameters<typeof IntegrationsSettings>[0];
const ALL_CONNECTED: Props = {
  googleConnected: true, hubspotConnected: true, pipedriveConnected: true, highlevelConnected: true, salesforceConnected: true,
  isPro: true,
  cards: CARDS,
  health: {
    salesforce: { lastSyncedAt: HOUR_AGO, waiting: 0 },
    highlevel: { lastSyncedAt: null, waiting: 3 },
    pipedrive: { lastSyncedAt: null, waiting: 0 },
    hubspot: { lastSyncedAt: HOUR_AGO, waiting: 0 },
    google: { lastSyncedAt: HOUR_AGO, waiting: 1 },
  },
};

let browser: Browser;
beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
afterAll(async () => { await browser?.close(); });

async function show(markup: string, width: number): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 1600 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:16px;background:#F7F3EE}</style></head>
     <body class="sc-app"><main style="max-width:42rem;margin:0 auto">${markup}</main></body></html>`,
    { waitUntil: "load" },
  );
  return page;
}

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(createElement(Suspense, null, el));

async function expectFits(page: Page, width: number) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
  for (const b of await page.$$("button, a")) {
    const box = await b.boundingBox();
    if (!box || box.width === 0) continue;
    const label = (await b.textContent())?.trim();
    expect(box.x, `"${label}" starts off screen`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `"${label}" runs off screen`).toBeLessThanOrEqual(width);
  }
}

const visibleText = (page: Page) => page.evaluate(() => document.body.innerText);

for (const width of [390, 1280]) {
  describe(`at ${width}px`, () => {
    it("connected and healthy: every CRM says whether contacts are arriving, and offers a test", async () => {
      const page = await show(html(createElement(IntegrationsSettings, ALL_CONNECTED)), width);
      try {
        const text = await visibleText(page);
        expect(text.match(/Send test contact/g)?.length).toBe(5);
        expect(text).toContain("Last contact sent 2 hours ago");
        expect(text).toContain("3 contacts waiting to send");
        expect(text).toContain("1 contact waiting to send");
        expect(text).toContain("No contacts sent yet");
        expect(text.match(/Disconnect/g)?.length).toBe(5);
        await expectFits(page, width);
      } finally { await page.close(); }
    });

    it("a dead token says Reconnect; a refused contact says Needs attention — not \"reconnect a working connection\"", async () => {
      const page = await show(html(createElement(IntegrationsSettings, {
        ...ALL_CONNECTED,
        salesforceSyncError: "Salesforce signed SwiftCard out — reconnect Salesforce to keep contacts flowing.",
        hubspotSyncError: "HubSpot didn't accept the last contact (400): Property values were not valid. Your connection is fine — new contacts still go through.",
      })), width);
      try {
        const text = await visibleText(page);
        expect(text).toContain("Reconnect needed");
        expect(text).toContain("Needs attention");
        expect(text).toContain("Property values were not valid");
        // Reconnect is offered ONLY where signing in again is the fix: the
        // Salesforce card has it, the HubSpot one (a refused contact) doesn't.
        const reconnects = await page.$$eval("a, button", (els) => els.filter((e) => e.textContent?.trim() === "Reconnect").length);
        expect(reconnects).toBe(1);
        expect(text.match(/Disconnect/g)?.length, "Disconnect stays on every connected card").toBe(5);
        await expectFits(page, width);
      } finally { await page.close(); }
    });

    it("plan ended with CRMs still connected: Disconnect is THERE, nothing is sent, no upgrade wall in its place", async () => {
      const page = await show(html(createElement(IntegrationsSettings, {
        googleConnected: true, hubspotConnected: true, pipedriveConnected: false, highlevelConnected: false, salesforceConnected: false,
        isPro: false, cards: CARDS,
      })), width);
      try {
        const text = await visibleText(page);
        expect(text.match(/Disconnect/g)?.length, "each connected card keeps its Disconnect").toBe(2);
        expect(text.match(/Paused — contacts aren't being sent/g)?.length).toBe(2);
        // A paused connection doesn't wear a green "Connected".
        expect(text).not.toContain("Connected");
        // Two "Paused" badges plus the two notices.
        expect(text.match(/Paused/g)?.length).toBe(4);
        expect(text).not.toContain("Send test contact");
        await expectFits(page, width);
      } finally { await page.close(); }
    });

    it("an Office member is told where their contacts already go", async () => {
      const page = await show(html(createElement(IntegrationsSettings, {
        googleConnected: false, hubspotConnected: false, pipedriveConnected: false, highlevelConnected: false,
        isPro: true, teamCrmNames: ["GoHighLevel", "Zapier"],
      })), width);
      try {
        expect(await visibleText(page)).toContain("Your team already sends contacts to GoHighLevel and Zapier");
        await expectFits(page, width);
      } finally { await page.close(); }
    });

    it("Zapier: a switched-off Zap is said out loud, and the webhook can be removed", async () => {
      const page = await show(html(createElement(ZapierSettings, {
        initialUrl: "https://hooks.zapier.com/hooks/catch/1/abc/",
        isPro: true,
        cards: CARDS,
        lastError: "Zapier says this Zap is turned off or was deleted — turn it on in Zapier, or paste the new webhook URL.",
        lastSentAt: HOUR_AGO,
      })), width);
      try {
        const text = await visibleText(page);
        expect(text).toContain("Zapier says this Zap is turned off");
        expect(text).toContain("Last contact sent 2 hours ago");
        expect(text).toContain("Remove");
        await expectFits(page, width);
      } finally { await page.close(); }
    });

    it("Zapier after the plan ends: the saved webhook can still be removed", async () => {
      const page = await show(html(createElement(ZapierSettings, { initialUrl: "https://hooks.zapier.com/hooks/catch/1/abc/", isPro: false })), width);
      try {
        const text = await visibleText(page);
        expect(text).toContain("Remove");
        expect(text).toContain("Paused — contacts aren't being sent to this webhook");
        await expectFits(page, width);
      } finally { await page.close(); }
    });

    it("event switches left ON after the plan ends can still be switched OFF", async () => {
      const page = await show(html(createElement(CrmEventSettings, { initialNotifications: true, initialViews: false, zapierConnected: true, isPro: false })), width);
      try {
        const states = await page.$$eval('[role="switch"]', (els) => els.map((e) => ({ on: e.getAttribute("aria-checked"), disabled: (e as HTMLButtonElement).disabled })));
        expect(states).toEqual([{ on: "true", disabled: false }, { on: "false", disabled: true }]);
        await expectFits(page, width);
      } finally { await page.close(); }
    });
  });
}
