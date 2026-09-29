import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// CALL · TEXT · EMAIL ON EVERY CONTACTS ROW.
//
// Owner, 2026-09-29: Quick Contacts left the dashboard; its three round buttons
// (Call green, Text blue, Email purple) now sit on every contact of the
// Contacts page — "fit very cleanly, don't take up too much space, work
// properly". The REAL ContactsClient, hydrated in Chromium with the app's
// Tailwind, at phone and computer widths, in both themes. Measured:
//   • the right buttons, with the right links, and none for missing data
//   • the row never overflows and the name keeps real room
//   • clicking or pressing Enter/Space on a button never also opens the contact
//   • each colour reads at ≥ 3:1 against the row (light theme included)
// Links are not followed (tel:/sms:/mailto: leave the page): a capture-phase
// listener records the link and cancels only the navigation — the click still
// reaches React, which is what decides whether the row opens.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";

const base = {
  company: null, company_description: null, location: null, notes: null, source: "card", visitor_id: null,
  status: "new", tags: [], follow_up_date: null, card_owner: "demo-sales", where_met: null, convo_details: null, message: null,
};
const LEADS = [
  { ...base, id: "l-both", name: "Jordan Rivera", email: "jordan.rivera@example.com", phone: "(415) 555-0148", created_at: "2026-09-28T15:00:00Z", company: "Northbeam Studio Architects" },
  { ...base, id: "l-phone", name: "Sam Phoneonly", email: "", phone: "+1 212-555-0199", created_at: "2026-09-27T15:00:00Z" },
  { ...base, id: "l-email", name: "Erin Emailonly", email: "erin@example.com", phone: null, created_at: "2026-09-26T15:00:00Z" },
  { ...base, id: "l-none", name: "Nadia Nothing", email: "", phone: null, created_at: "2026-09-25T15:00:00Z" },
  // An extension must not be glued onto the number ("555-0100 x12" was dialed
  // as 555010012); a value with no digit at all is not a number.
  { ...base, id: "l-ext", name: "Omar Extension", email: "", phone: "(415) 555-0100 ext. 12", created_at: "2026-09-24T15:00:00Z" },
  { ...base, id: "l-plus", name: "Pat Plusonly", email: "", phone: "+", created_at: "2026-09-23T15:00:00Z" },
];

let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "contact-row-actions-"));
  writeFileSync(join(tmp, "nav-stub.ts"), `
    export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} });
    export const usePathname = () => "/contacts";
    export const useSearchParams = () => new URLSearchParams();
  `);
  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement } from "react";
    export default function Link(props: any) {
      const { href, children, prefetch, scroll, replace, ...rest } = props;
      return createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children);
    }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import ContactsClient from "@/components/ContactsClient";
    (window as any).mount = (leads: any[]) => {
      createRoot(document.getElementById("root")!).render(
        h("main", { className: "sc-app bg-gray-950 min-h-screen" },
          h(ContactsClient, { leads, primaryUsername: "demo-sales", userCards: [{ username: "demo-sales", name: "Demo Sales" }] })),
      );
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src"), "next/navigation": join(tmp, "nav-stub.ts"), "next/link": join(tmp, "link-stub.tsx") },
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\", NEXT_PUBLIC_SUPABASE_URL: \"https://x.supabase.co\", NEXT_PUBLIC_SUPABASE_ANON_KEY: \"k\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

async function open(width: number, light: boolean): Promise<Page> {
  const touch = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  // Every API answers empty — the rows under test need none of it.
  await page.route(`${ORIGIN}/api/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route(`${ORIGIN}/contacts*`, (r) => r.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html${light ? ' data-sc-theme="light"' : ""}><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
           <body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`,
  }));
  await page.goto(`${ORIGIN}/contacts`);
  await page.evaluate(() => {
    // Record, and cancel, any tel:/sms:/mailto: navigation. Capture phase: the
    // buttons stop the click bubbling (that is the point), so a bubbling
    // listener here would never hear it.
    (window as unknown as { __links: string[] }).__links = [];
    window.addEventListener("click", (e) => {
      const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (a && /^(tel|sms|mailto):/.test(a.getAttribute("href") ?? "")) {
        (window as unknown as { __links: string[] }).__links.push(a.getAttribute("href")!);
        e.preventDefault();
      }
    }, true);
  });
  await page.evaluate((leads) => (window as unknown as { mount: (l: unknown) => void }).mount(leads), LEADS);
  await page.getByText("Jordan Rivera").first().waitFor();
  await page.waitForTimeout(150);
  return page;
}

/** The list row for a contact (a plain container; its avatar + text are the button). */
const row = (p: Page, name: string) => p.locator("[data-contact-row]", { hasText: name }).first();
const detailOpen = (p: Page) => p.locator('[data-tour="contact-detail"]').count();

const PHONES = [320, 375, 393];
const COMPUTERS = [1024, 1280];

describe.each([...PHONES, ...COMPUTERS].flatMap((w) => [[w, false], [w, true]] as [number, boolean][]))(
  "%ipx, light theme: %s",
  (width, light) => {
    it("the right buttons, the right links, and nothing that doesn't fit", async () => {
      const page = await open(width, light);
      try {
        if (width === 393 || width === 1280) await page.screenshot({ path: `node_modules/.cache/contact-rows-${width}${light ? "-light" : ""}.png` });
        const facts = await page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>("[data-contact-row]")].filter((r) => r.querySelector("p"));
          return rows.map((r) => {
            const name = r.querySelector("p.text-sm") as HTMLElement;
            const actions = [...r.querySelectorAll<HTMLAnchorElement>("[data-contact-actions] a")];
            const rr = r.getBoundingClientRect();
            return {
              name: name.textContent,
              // The room the name column has (it truncates inside it).
              nameWidth: (name.closest(".flex-1") as HTMLElement).getBoundingClientRect().width,
              links: actions.map((a) => [a.getAttribute("aria-label"), a.getAttribute("href")]),
              sizes: actions.map((a) => Math.round(a.getBoundingClientRect().width)),
              overflow: r.scrollWidth - r.clientWidth,
              outside: actions.some((a) => a.getBoundingClientRect().right > rr.right + 0.5),
            };
          });
        });
        const by = Object.fromEntries(facts.map((f) => [f.name, f]));
        expect(by["Jordan Rivera"].links).toEqual([
          ["Call Jordan Rivera", "tel:4155550148"],
          ["Text Jordan Rivera", "sms:4155550148"],
          ["Email Jordan Rivera", "mailto:jordan.rivera@example.com"],
        ]);
        expect(by["Sam Phoneonly"].links).toEqual([["Call Sam Phoneonly", "tel:+12125550199"], ["Text Sam Phoneonly", "sms:+12125550199"]]);
        expect(by["Erin Emailonly"].links).toEqual([["Email Erin Emailonly", "mailto:erin@example.com"]]);
        expect(by["Nadia Nothing"].links).toEqual([]);
        expect(by["Omar Extension"].links).toEqual([["Call Omar Extension", "tel:4155550100,12"], ["Text Omar Extension", "sms:4155550100"]]);
        expect(by["Pat Plusonly"].links).toEqual([]);
        for (const f of facts) {
          expect(f.overflow, `${f.name} row overflows`).toBeLessThanOrEqual(0);
          expect(f.outside, `${f.name} buttons spill out of the row`).toBe(false);
          for (const s of f.sizes) expect(s).toBe(width < 360 ? 32 : 36);
        }
        // The name keeps real room next to three buttons.
        expect(by["Jordan Rivera"].nameWidth, "name squeezed").toBeGreaterThanOrEqual(width < 360 ? 70 : 100);
      } finally { await page.context().close(); }
    });

    it("each colour reads against the row", async () => {
      const page = await open(width, light);
      try {
        const ratios = await page.evaluate(() => {
          // Any CSS colour (Tailwind v4 writes oklch) → sRGB, via a 1px canvas.
          const cv = document.createElement("canvas"); cv.width = cv.height = 1;
          const cx = cv.getContext("2d")!;
          const paint = (c: string) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return [...cx.getImageData(0, 0, 1, 1).data]; };
          const rgb = (c: string) => paint(c).slice(0, 3);
          const lum = ([r, g, b]: number[]) => {
            const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          };
          const opaqueBg = (el: HTMLElement | null) => {
            while (el) {
              const c = getComputedStyle(el).backgroundColor;
              if (paint(c)[3] > 128) return c;
              el = el.parentElement;
            }
            return getComputedStyle(document.body).backgroundColor;
          };
          const r = [...document.querySelectorAll<HTMLElement>("[data-contact-row]")].find((x) => x.textContent?.includes("Jordan Rivera"))!;
          return [...r.querySelectorAll<HTMLAnchorElement>("[data-contact-actions] a")].map((a) => {
            const L1 = lum(rgb(getComputedStyle(a).color)), L2 = lum(rgb(opaqueBg(a)));
            return [`${a.getAttribute("aria-label")} ${getComputedStyle(a).color} on ${opaqueBg(a)}`, (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)] as [string, number];
          });
        });
        for (const [label, ratio] of ratios) expect(ratio, `${label} (${light ? "light" : "dark"})`).toBeGreaterThanOrEqual(3);
      } finally { await page.context().close(); }
    });
  },
);

describe.each([375, 1280])("using the buttons (%ipx)", (width) => {
  it("a click on Call, Text or Email follows the link and never opens the contact", async () => {
    const page = await open(width, false);
    try {
      for (const label of ["Call Jordan Rivera", "Text Jordan Rivera", "Email Jordan Rivera"]) {
        await page.getByRole("link", { name: label }).click();
      }
      expect(await page.evaluate(() => (window as unknown as { __links: string[] }).__links)).toEqual([
        "tel:4155550148", "sms:4155550148", "mailto:jordan.rivera@example.com",
      ]);
      expect(await detailOpen(page), "a button tap opened the contact").toBe(0);
      // The row itself still opens it.
      await row(page, "Jordan Rivera").locator("p.text-sm").click();
      await page.locator('[data-tour="contact-detail"]').first().waitFor({ timeout: 3000 });
    } finally { await page.context().close(); }
  });

  it("Enter or Space on a button never opens the contact; Enter on the contact's own button does", async () => {
    const page = await open(width, false);
    try {
      const call = page.getByRole("link", { name: "Call Jordan Rivera" });
      await call.focus();
      await page.keyboard.press("Space");
      await page.keyboard.press("Enter");
      expect(await detailOpen(page), "a key on a button opened the contact").toBe(0);
      // The read toggle is a button inside the row too — same rule.
      await row(page, "Jordan Rivera").getByRole("button", { name: /Mark as (un)?read/ }).focus();
      await page.keyboard.press("Enter");
      expect(await detailOpen(page), "Enter on the read toggle opened the contact").toBe(0);
      // The row is not a button (it would wrap other controls); the avatar +
      // text are — the one keyboard and screen-reader way to open the contact.
      expect(await row(page, "Jordan Rivera").getAttribute("role")).toBeNull();
      await row(page, "Jordan Rivera").locator("button").first().focus();
      await page.keyboard.press("Enter");
      await page.locator('[data-tour="contact-detail"]').first().waitFor({ timeout: 3000 });
    } finally { await page.context().close(); }
  });
});
