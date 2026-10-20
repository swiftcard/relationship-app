import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { launchBrowser, appCss } from "./harness";
import OfficeBranding from "@/components/OfficeBranding";

// Branding refreshes the page after a save (useRouter); a static render has no router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
  usePathname: () => "/office/admin/branding",
  useSearchParams: () => new URLSearchParams(),
}));

// The CARD half of Branding, and the tab bar that now sits above both halves.
// (The Links half has its own file: office-branding-tabs.test.ts.)
//
// The "who controls what" lists here are claims a compliance-minded buyer reads
// closely, so they are measured in a real render rather than trusted.

const office = (locks: Record<string, boolean>) => ({
  id: "o1", name: "Northwind Partners", seats: 15,
  brand_company: "Northwind Partners", brand_website: "northwind.com",
  brand_logo_url: null, brand_template: "classic-pro", brand_design: null,
  brand_phone: null, brand_fax: null, brand_address: null,
  brand_locks: locks,
});

async function render(browser: Browser, width: number, locks: Record<string, boolean>) {
  const css = await appCss();
  const markup = renderToStaticMarkup(createElement(OfficeBranding as never, { office: office(locks) }));
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 1600 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:16px;background:#0b0f16}</style></head>
     <body class="sc-app">${markup}</body></html>`,
    { waitUntil: "load" },
  );
  await page.waitForTimeout(150);
  return page;
}

describe("the Branding page", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  it("offers both halves of the brand as tabs, opening on Card", async () => {
    const page = await render(browser, 1100, { template: true });
    try {
      const tabs = await page.$$eval('[role="tab"]', (els) => els.map((e) => (e.textContent ?? "").trim()));
      expect(tabs).toEqual(["Card", "Links"]);
      const selected = await page.$$eval('[role="tab"]', (els) =>
        els.filter((e) => e.getAttribute("aria-selected") === "true").map((e) => (e.textContent ?? "").trim()));
      // Card opens, because that is what this page has always been.
      expect(selected).toEqual(["Card"]);
    } finally { await page.close(); }
  });

  it("shows the card lock and reflects its saved state", async () => {
    const page = await render(browser, 1100, { template: true });
    try {
      const state = await page.evaluate(() =>
        [...document.querySelectorAll("label")]
          .filter((l) => /Keep every card matching/.test(l.textContent ?? ""))
          .map((l) => (l.querySelector("input") as HTMLInputElement | null)?.checked ?? null));
      expect(state).toEqual([true]);
    } finally { await page.close(); }
  });

  it("no longer carries the retired links lock", async () => {
    // "Only you can add link buttons" was an all-or-nothing freeze, replaced by
    // the Links tab's pinned-and-additive model. Leaving the checkbox behind
    // would have been a control an admin could tick, save, see "Applied ✓" —
    // and have nothing happen, because the API stopped reading it.
    const page = await render(browser, 1100, { template: true, links: true });
    try {
      expect(await page.innerText("body")).not.toContain("Only you can add link buttons");
    } finally { await page.close(); }
  });

  it("does not overstate what the office controls", async () => {
    // The old list named only name/photo/title/phone/email and said
    // "everything else is what you set here", which would tell a compliance
    // buyer that socials were company-controlled. They are not.
    const page = await render(browser, 1100, { template: true });
    try {
      const t = await page.innerText("body");
      expect(t).toContain("Their social profiles");
      expect(t).not.toMatch(/everything else is what you set here/);
    } finally { await page.close(); }
  });

  it("lists only CARD fields, and points at the Links tab for the rest", async () => {
    // "Their bio" sat in this list and was always wrong — no card template
    // renders bio, it is a Swift Links field — and the Links tab can now take
    // it, so the line promised the member a field their admin may already have
    // claimed one tab over.
    const page = await render(browser, 1100, { template: true });
    try {
      const t = await page.innerText("body");
      expect(t, "bio is a Swift Links field, not a card one").not.toContain("Their bio");
      // The pointer is what keeps "Their social profiles" honest, since an
      // office that pins Instagram on the Links tab takes that one social.
      // Asserted with its spaces intact: JSX drops the whitespace around a
      // newline beside an element, which silently welds "the" to "Links".
      expect(t.replace(/\s+/g, " ")).toContain(
        "Their Swift Links page (bio, Instagram and pinned link buttons) is set on the Links tab.",
      );
    } finally { await page.close(); }
  });

  for (const width of [390, 1100]) {
    it(`the card controls fit at ${width}px`, async () => {
      // Scoped to the FORM column: the aside holds a live card preview that
      // CardScaler shrinks by measuring its container at runtime, which a
      // static render cannot do — it would report a spill that does not exist.
      const page = await render(browser, width, { template: true });
      try {
        const spills = await page.evaluate(() => {
          const grid = document.querySelector(".lg\\:grid") as HTMLElement | null;
          // The phone-pinned preview (sc-pinned-preview) leads the grid now; like the
          // aside, it holds a runtime-scaled card, so it is skipped too.
          const form = grid?.querySelector(":scope > div:not(.sc-pinned-preview)") as HTMLElement | null;
          if (!form) return ["form column not found"];
          const limit = form.getBoundingClientRect().right + 1;
          const out: string[] = [];
          form.querySelectorAll("*").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > limit) out.push(`${el.tagName}.${el.className}`.slice(0, 60));
          });
          return out;
        });
        expect(spills, `card controls spill past their column at ${width}px`).toEqual([]);
      } finally { await page.close(); }
    });
  }

  it("the tabs are real tap targets on a phone", async () => {
    const page = await render(browser, 390, { template: true });
    try {
      const sizes = await page.$$eval('[role="tab"]', (els) => els.map((e) => e.getBoundingClientRect().height));
      expect(sizes.length).toBe(2);
      for (const h of sizes) expect(h).toBeGreaterThanOrEqual(28);
    } finally { await page.close(); }
  });
});
