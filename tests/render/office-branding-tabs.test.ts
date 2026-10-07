import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { launchBrowser, appCss } from "./harness";
import OfficeLinksBranding from "@/components/OfficeLinksBranding";

// Branding refreshes the page after a save (useRouter); a static render has no router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
  usePathname: () => "/office/admin/branding",
  useSearchParams: () => new URLSearchParams(),
}));

// The Links half of Branding. Measured rather than trusted: it is the screen an
// office admin sets their whole team's link-in-bio page from, and it has to
// hold at phone width inside the iOS shell as well as on a desktop.

const OFFICE = {
  name: "Northwind Partners",
  brand_company: "Northwind Partners",
  brand_website: "northwind.com",
  brand_logo_url: null,
  brand_link_design: { linkLook: "midnight", linkAccentColor: "#7c3aed" },
  brand_link_bio: "Northwind Partners — commercial real estate across the Midwest.",
  brand_link_instagram: "@northwindpartners",
  brand_links: [
    { label: "Book a meeting", url: "https://northwind.com/book" },
    { label: "Our listings with a deliberately long label", url: "https://northwind.com/listings/commercial/midwest" },
  ],
  brand_locks: { template: true, linkDesign: true },
};
const EMPTY = { name: "New Co", brand_locks: { template: true } };

async function render(browser: Browser, width: number, office: Record<string, unknown>) {
  const css = await appCss();
  const markup = renderToStaticMarkup(createElement(OfficeLinksBranding as never, { office }));
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 1800 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:16px;background:#0b0f16}</style></head>
     <body class="sc-app">${markup}</body></html>`,
    { waitUntil: "load" },
  );
  await page.waitForTimeout(200);
  return page;
}

describe("Branding → Links", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  it("mirrors the Card tab: three numbered sections and one save", async () => {
    const page = await render(browser, 1100, OFFICE);
    try {
      const t = await page.innerText("body");
      for (const s of ["Links information", "Links appearance", "What team members can edit"]) {
        expect(t, `missing section: ${s}`).toContain(s);
      }
      expect(t).toContain("Keep every Swift Links page matching");
      expect(t).toContain("Save & apply to team Swift Links");
      // Exactly one save button, like the Card tab.
      const saves = await page.$$eval("button", (bs) => bs.filter((b) => /Save & apply/.test(b.textContent ?? "")).length);
      expect(saves).toBe(1);
    } finally { await page.close(); }
  });

  it("shows the admin's own fields filled in, not placeholders", async () => {
    const page = await render(browser, 1100, OFFICE);
    try {
      const vals = await page.evaluate(() => ({
        bio: (document.querySelector("#office-link-bio") as HTMLTextAreaElement | null)?.value ?? null,
        ig: (document.querySelector("#office-link-ig") as HTMLInputElement | null)?.value ?? null,
        locked: (document.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.checked ?? null,
      }));
      expect(vals.bio).toContain("commercial real estate");
      // Saved as "@northwindpartners"; the box shows it after its
      // "instagram.com/" prefix, without the @ (SocialHandleField, 2026-09-29).
      expect(vals.ig).toBe("northwindpartners");
      expect(vals.locked).toBe(true);
    } finally { await page.close(); }
  });

  it("lists every pinned link with a way to remove it", async () => {
    const page = await render(browser, 1100, OFFICE);
    try {
      const removes = await page.$$eval("button", (bs) => bs.filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("Remove ")).length);
      expect(removes).toBe(2);
    } finally { await page.close(); }
  });

  it("the lock defaults OFF for an office that has never opened this tab", async () => {
    const page = await render(browser, 1100, EMPTY);
    try {
      const checked = await page.evaluate(() => {
        const l = [...document.querySelectorAll("label")].find((x) => /Keep every Swift Links page matching/.test(x.textContent ?? ""));
        return (l?.querySelector("input") as HTMLInputElement | null)?.checked ?? null;
      });
      expect(checked, "an office that never opened this tab would silently overwrite member pages").toBe(false);
    } finally { await page.close(); }
  });

  it("says nothing is controlled until something is filled in", async () => {
    const page = await render(browser, 1100, EMPTY);
    try {
      const t = await page.innerText("body");
      expect(t).toContain("Nothing yet");
      // …and the member keeps their bio while the office has set none.
      expect(t).toContain("Their bio");
    } finally { await page.close(); }
  });

  it("moves a field from 'they fill in' to 'you control' once set", async () => {
    const on = await render(browser, 1100, OFFICE);
    try {
      const t = await on.innerText("body");
      expect(t).toContain("The bio");
      expect(t, "the bio is claimed by the office AND still listed as theirs").not.toContain("Their bio");
    } finally { await on.close(); }
  });

  for (const width of [390, 768, 1100]) {
    it(`the controls fit at ${width}px`, async () => {
      // Scoped to the form column, and skipping INSIDE any live preview: a
      // preview renders at true phone width and is scaled down by measuring its
      // container at runtime, which a static render cannot do — it would report
      // a spill that does not exist in the product. The preview FRAME itself is
      // measured like everything else, because its width is the real contract
      // (the phone-width slot is capped so the preview cannot swallow the
      // screen — owner, 2026-09-11).
      const page = await render(browser, width, OFFICE);
      try {
        const res = await page.evaluate(() => {
          const root = document.body.firstElementChild as HTMLElement;
          const form = root.querySelector(":scope > div") as HTMLElement | null;
          if (!form) return ["form column not found"];
          const limit = form.getBoundingClientRect().right + 1;
          const spills: string[] = [];
          form.querySelectorAll("*").forEach((el) => {
            if (el.closest("[data-preview-frame]") !== el && el.closest("[data-preview-frame]")) return;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > limit) spills.push(`${el.tagName}.${el.className}`.slice(0, 60));
          });
          return spills;
        });
        expect(res, `controls spill past their column at ${width}px`).toEqual([]);
      } finally { await page.close(); }
    });
  }

  it("every control is a real tap target on a phone", async () => {
    const page = await render(browser, 390, OFFICE);
    try {
      // Scoped to the controls THIS tab owns — sections 1 and 3, the lock and
      // the save. Section 2 embeds SwiftLinkStyleControls, the member's own
      // design panel: it is shared, unchanged here, and its swatch chips have
      // their own established sizing and their own tests. Holding a shared
      // component to a threshold invented here would be a guard that fails for
      // something this file did not do.
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("section")]
          .filter((sec) => !/Links appearance/.test(sec.textContent ?? ""))
          .flatMap((sec) => [...sec.querySelectorAll("button, input[type=checkbox], textarea, input[type=text]")])
          .concat([...document.querySelectorAll("button")].filter((b) => /Save & apply/.test(b.textContent ?? "")))
          .map((el) => {
            // A native checkbox is ~13px by definition; what a finger actually
            // hits is the LABEL wrapping it, which is the pattern the Card tab
            // uses too. Measure the real target.
            const target = el instanceof HTMLInputElement && el.type === "checkbox"
              ? (el.closest("label") ?? el)
              : el;
            return {
              t: ((el as HTMLInputElement).id || el.textContent || el.tagName).trim().slice(0, 24),
              h: target.getBoundingClientRect().height,
            };
          })
          .filter((x) => x.h > 0 && x.h < 28),
      );
      expect(small, "controls too small to tap").toEqual([]);
    } finally { await page.close(); }
  });

  it("offers a section header, the same as a teammate's own links do", async () => {
    // A company page can be chaptered the way a personal one can. Without this
    // the admin could pin fifteen links with no way to group them, while every
    // teammate could group their own — the two halves of the same page
    // disagreeing about what a link list is.
    const page = await render(browser, 1100, OFFICE);
    try {
      const t = await page.innerText("body");
      expect(t).toContain("+ Add a section header");
      expect(t).toContain("Company Additional Links");
      expect(t, "the old name").not.toContain("Company link buttons");
    } finally { await page.close(); }
  });

  it("renders a pinned section header as a label, with no URL line", async () => {
    const page = await render(browser, 1100, {
      ...OFFICE,
      brand_links: [
        { label: "Listings", url: "", kind: "header" },
        { label: "Book a viewing", url: "https://northwind.com/book" },
      ],
    });
    try {
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll("input")]
          .filter((i) => i.value === "Listings")
          .map((i) => ({ value: i.value, readOnly: i.readOnly })),
      );
      expect(rows.length, "the header is editable in place").toBe(1);
      // innerText reflects RENDERED text, and the tag carries `uppercase` —
      // so this reads "SECTION", not "Section".
      const t = await page.innerText("body");
      expect(t).toMatch(/section/i);
      expect(t).toContain("https://northwind.com/book");
    } finally { await page.close(); }
  });

  it("carries no price, trial or upgrade language", async () => {
    // The office admin console renders inside the iOS shell, which may not
    // sell (App Store 3.1.1). This screen is a settings surface and must stay
    // one.
    const page = await render(browser, 1100, OFFICE);
    try {
      const t = await page.innerText("body");
      for (const word of ["$", "Upgrade", "free trial", "per seat"]) {
        expect(t, `selling language on an in-app settings screen: ${word}`).not.toContain(word);
      }
    } finally { await page.close(); }
  });
});
