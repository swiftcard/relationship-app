import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── "Additional links": drag to reorder, tap to edit (owner, 2026-11-06) ────
//
// "They can hold on to a section header and put it above a link or they can
// move one link under another link just by dragging it around", "they should
// be able to click on it if they want to edit it… and then they just press
// Re-add", and "Add a Section Header" belongs ABOVE "Button text" and "Web
// address". A source scan cannot see a drag land or a row overflow a phone, so
// this mounts the real LinkListEditor + AddLinkForm in Chromium and drives
// them: with a mouse, with a real touch (CDP touch events, so touch-action is
// exercised the way a phone exercises it) and with the keyboard.

let browser: Browser;
let bundle: string;
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "link-list-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h, useState } from "react";
    import FormSection from "@/components/ui/FormSection";
    import LinkListEditor from "@/components/LinkListEditor";
    import AddLinkForm from "@/components/AddLinkForm";

    function Step({ initial, variant, locked }: any) {
      const [links, setLinks] = useState<any[]>(initial);
      const [draft, setDraft] = useState({ label: "", url: "" });
      (window as any).__links = links;
      return h(FormSection, { id: "links", title: "Additional links", note: "Buttons on your page that open any website." },
        h(LinkListEditor, { links, onChange: setLinks, variant, canAddHeader: true, isLocked: locked ? (l: any) => l.office === true : undefined }),
        h(AddLinkForm, { value: draft, onChange: setDraft, variant: variant === "site" ? "site" : "app", onAdd: () => { setLinks((p) => [...p, { label: draft.label, url: draft.url }]); setDraft({ label: "", url: "" }); } }),
      );
    }
    (window as any).mount = (props: any) => createRoot(document.getElementById("root")!).render(h(Step, props));
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
    logLevel: "error",
  });
  bundle = out.outputFiles[0].text;
  if (!bundle || bundle.length < 1000) throw new Error("bundle is empty — the esbuild step failed");
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const COMPANY = { label: "Company booking", url: "https://northwind.com/book", office: true };
const BOOK = { label: "Book a meeting", url: "https://calendly.com/alex", size: "featured" };
const WATCH = { label: "Watch", url: "", kind: "header" };
const YT = { label: "My YouTube", url: "https://youtube.com/@alex" };
const SHOP = { label: "Shop now", url: "https://alex.shop" };

type Opts = { initial?: unknown[]; variant?: "app" | "panel" | "site"; locked?: boolean; theme?: "dark" | "light"; touch?: boolean; height?: number };

async function mount(width: number, col: number, o: Opts = {}): Promise<Page> {
  const css = await appCss();
  const theme = o.theme ?? "dark";
  const page = await browser.newPage(o.touch ? { hasTouch: true, isMobile: true, viewport: { width, height: o.height ?? 1400 } } : undefined);
  if (!o.touch) await page.setViewportSize({ width, height: o.height ?? 1400 });
  const bg = o.variant === "site" ? "#0B0C10" : theme === "dark" ? "#030712" : "#FAF7F2";
  await page.setContent(
    `<!doctype html><html data-sc-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>
     <style>body{margin:0;padding:20px 0;background:${bg}}#root{width:${col}px;margin:0 auto}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`,
  );
  await page.evaluate((p) => (window as unknown as { mount: (x: unknown) => void }).mount(p), {
    initial: o.initial ?? [COMPANY, BOOK, WATCH, YT, SHOP],
    variant: o.variant ?? "app",
    locked: o.locked ?? true,
  });
  await page.waitForSelector("[data-link-list]");
  return page;
}

const order = (page: Page) => page.evaluate(() => ((window as unknown as { __links: { label: string }[] }).__links).map((l) => l.label));
const links = (page: Page) => page.evaluate(() => (window as unknown as { __links: Record<string, unknown>[] }).__links);

/** The centre of row n's grip, and of row m. */
async function gripAt(page: Page, n: number) {
  const box = await page.locator("[data-link-list] li").nth(n).locator("button[aria-label^='Move']").boundingBox();
  if (!box) throw new Error(`row ${n} has no grip`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function rowCentre(page: Page, n: number) {
  const box = await page.locator("[data-link-list] li").nth(n).boundingBox();
  if (!box) throw new Error(`no row ${n}`);
  return { y: box.y + box.height / 2, top: box.y, bottom: box.y + box.height };
}

const phoneCol = (w: number) => w - 40;
const DESKTOP_COL = 532;

describe("drag a row by its grip", () => {
  it("mouse: a section header goes above a link", async () => {
    const page = await mount(1280, DESKTOP_COL);
    try {
      expect(await order(page)).toEqual(["Company booking", "Book a meeting", "Watch", "My YouTube", "Shop now"]);
      const g = await gripAt(page, 2);
      const target = await rowCentre(page, 1);
      await page.mouse.move(g.x, g.y);
      await page.mouse.down();
      await page.mouse.move(g.x, g.y - 10, { steps: 3 });
      await page.mouse.move(g.x, target.top + 4, { steps: 8 });
      // Mid-drag: nothing saved yet, and the passed row has stepped aside.
      expect(await order(page)).toEqual(["Company booking", "Book a meeting", "Watch", "My YouTube", "Shop now"]);
      const stepped = await page.locator("[data-link-list] li").nth(1).evaluate((el) => (el as HTMLElement).style.transform);
      expect(stepped).toMatch(/translateY\(\d/);
      await page.mouse.up();
      expect(await order(page)).toEqual(["Company booking", "Watch", "Book a meeting", "My YouTube", "Shop now"]);
      // After the drop nothing is left lifted or shifted.
      const leftover = await page.$$eval("[data-link-list] li", (els) => els.map((e) => (e as HTMLElement).style.transform).filter(Boolean));
      expect(leftover).toEqual([]);
    } finally { await page.close(); }
  });

  it("mouse: one link goes under another, and the row keeps its look (size) with it", async () => {
    const page = await mount(1280, DESKTOP_COL);
    try {
      const g = await gripAt(page, 1);
      const target = await rowCentre(page, 3);
      await page.mouse.move(g.x, g.y);
      await page.mouse.down();
      await page.mouse.move(g.x, target.bottom - 4, { steps: 10 });
      await page.mouse.up();
      expect(await order(page)).toEqual(["Company booking", "Watch", "My YouTube", "Book a meeting", "Shop now"]);
      expect((await links(page))[3]).toMatchObject({ label: "Book a meeting", size: "featured" });
    } finally { await page.close(); }
  });

  it("nothing can be dragged above a company row, and a company row has no grip", async () => {
    const page = await mount(1280, DESKTOP_COL);
    try {
      expect(await page.locator("[data-link-list] li").nth(0).locator("button[aria-label^='Move']").count()).toBe(0);
      expect(await page.locator("[data-link-list] li").nth(0).locator("button").count()).toBe(0);
      expect(await page.locator("[data-link-list] li").nth(0).innerText()).toMatch(/company/i);
      const g = await gripAt(page, 4);
      await page.mouse.move(g.x, g.y);
      await page.mouse.down();
      await page.mouse.move(g.x, 0, { steps: 12 });
      await page.mouse.up();
      expect(await order(page)).toEqual(["Company booking", "Shop now", "Book a meeting", "Watch", "My YouTube"]);
    } finally { await page.close(); }
  });

  it("Escape mid-drag puts the row back", async () => {
    const page = await mount(1280, DESKTOP_COL);
    try {
      const g = await gripAt(page, 3);
      await page.mouse.move(g.x, g.y);
      await page.mouse.down();
      await page.mouse.move(g.x, g.y - 120, { steps: 8 });
      await page.keyboard.press("Escape");
      await page.mouse.up();
      expect(await order(page)).toEqual(["Company booking", "Book a meeting", "Watch", "My YouTube", "Shop now"]);
    } finally { await page.close(); }
  });

  it("touch: pressing the grip and sliding moves the row, it does not scroll the page", async () => {
    const page = await mount(390, phoneCol(390), { touch: true, height: 800 });
    try {
      const cdp = await page.context().newCDPSession(page);
      const g = await gripAt(page, 2);
      const target = await rowCentre(page, 1);
      const scrollBefore = await page.evaluate(() => window.scrollY);
      // The grip must really be touch-action: none. globals.css gives every
      // button `manipulation` outside any layer, which beats a Tailwind class;
      // with it the browser pans the page and cancels the drag one move in.
      expect(await page.locator("[data-link-list] li").nth(2).locator("button[aria-label^='Move']").evaluate((b) => getComputedStyle(b).touchAction)).toBe("none");
      const touch = (type: string, y: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: g.x, y }] });
      await touch("touchStart", g.y);
      for (let k = 1; k <= 8; k++) await touch("touchMove", g.y - ((g.y - (target.top + 4)) * k) / 8);
      await touch("touchEnd", target.top + 4);
      expect(await order(page)).toEqual(["Company booking", "Watch", "Book a meeting", "My YouTube", "Shop now"]);
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    } finally { await page.close(); }
  });

  it("touch: sliding a finger on a row itself (not the grip) scrolls, and moves nothing", async () => {
    const page = await mount(390, phoneCol(390), { touch: true, height: 420, initial: [BOOK, WATCH, YT, SHOP, { label: "A", url: "https://a.com" }, { label: "B", url: "https://b.com" }, { label: "C", url: "https://c.com" }] });
    try {
      const cdp = await page.context().newCDPSession(page);
      const box = (await page.locator("[data-link-list] li").nth(2).locator("button[aria-label^='Edit']").boundingBox())!;
      const x = box.x + box.width / 2;
      const y0 = box.y + box.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
      for (let k = 1; k <= 8; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 - k * 15 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      expect(await order(page)).toEqual(["Book a meeting", "Watch", "My YouTube", "Shop now", "A", "B", "C"]);
      expect(await page.evaluate(() => window.scrollY), "the page scrolled under the finger").toBeGreaterThan(0);
    } finally { await page.close(); }
  });

  it("keyboard: a focused grip moves one step per arrow and keeps the focus", async () => {
    const page = await mount(1280, DESKTOP_COL);
    try {
      await page.locator("[data-link-list] li").nth(3).locator("button[aria-label^='Move']").focus();
      await page.keyboard.press("ArrowUp");
      expect(await order(page)).toEqual(["Company booking", "Book a meeting", "My YouTube", "Watch", "Shop now"]);
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowUp");
      // Stops under the company row.
      expect(await order(page)).toEqual(["Company booking", "My YouTube", "Book a meeting", "Watch", "Shop now"]);
      expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Move My YouTube");
      await page.keyboard.press("ArrowDown");
      expect(await order(page)).toEqual(["Company booking", "Book a meeting", "My YouTube", "Watch", "Shop now"]);
      expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Move My YouTube");
      expect(await page.locator("[aria-live]").innerText()).toMatch(/Moved My YouTube to position 3 of 5/);
    } finally { await page.close(); }
  });
});

describe("tap a link to edit it", () => {
  it("opens in place with both boxes filled; Save link changes it and it keeps its spot", async () => {
    const page = await mount(390, phoneCol(390));
    try {
      await page.click("button[aria-label='Edit My YouTube']");
      const label = page.getByLabel("Button text").first();
      // The edit boxes are inside the row, not the add form's.
      const inRow = await page.locator("[data-link-list] li").nth(3).locator("input").count();
      expect(inRow).toBe(2);
      expect(await page.evaluate(() => (document.activeElement as HTMLInputElement)?.value)).toBe("My YouTube");
      expect(await label.inputValue()).toBe("My YouTube");
      await page.locator("[data-link-list] li").nth(3).locator("input").nth(0).fill("Watch my channel");
      await page.locator("[data-link-list] li").nth(3).locator("input").nth(1).fill("youtube.com/@alexhomes");
      // While one is open, the other rows can't be dragged or opened.
      expect(await page.locator("button[aria-label='Edit Shop now']").isDisabled()).toBe(true);
      expect(await page.locator("button[aria-label='Move Shop now']").getAttribute("aria-disabled")).toBe("true");
      await page.click("[data-link-list] button:has-text('Save link')");
      expect(await order(page)).toEqual(["Company booking", "Book a meeting", "Watch", "Watch my channel", "Shop now"]);
      expect((await links(page))[3]).toMatchObject({ label: "Watch my channel", url: "https://youtube.com/@alexhomes" });
      expect(await page.locator("[data-link-list] li").nth(3).locator("input").count()).toBe(0);
    } finally { await page.close(); }
  });

  it("Cancel leaves the link exactly as it was; Enter saves; Escape cancels", async () => {
    const page = await mount(390, phoneCol(390));
    try {
      const row = page.locator("[data-link-list] li").nth(1);
      await page.click("button[aria-label='Edit Book a meeting']");
      await row.locator("input").nth(0).fill("Something else");
      await page.click("[data-link-list] button:has-text('Cancel')");
      expect((await links(page))[1]).toMatchObject({ label: "Book a meeting", url: "https://calendly.com/alex" });

      await page.click("button[aria-label='Edit Book a meeting']");
      await row.locator("input").nth(0).fill("Escape me");
      await page.keyboard.press("Escape");
      expect((await links(page))[1]).toMatchObject({ label: "Book a meeting" });

      await page.click("button[aria-label='Edit Book a meeting']");
      await row.locator("input").nth(0).fill("Book a call");
      await page.keyboard.press("Enter");
      expect((await links(page))[1]).toMatchObject({ label: "Book a call", url: "https://calendly.com/alex", size: "featured" });
    } finally { await page.close(); }
  });

  it("Save link stays off while a box is empty", async () => {
    const page = await mount(390, phoneCol(390));
    try {
      await page.click("button[aria-label='Edit Shop now']");
      const row = page.locator("[data-link-list] li").nth(4);
      await row.locator("input").nth(1).fill("");
      expect(await row.locator("button:has-text('Save link')").isDisabled()).toBe(true);
      await page.keyboard.press("Enter");
      expect((await links(page))[4]).toMatchObject({ url: "https://alex.shop" });
    } finally { await page.close(); }
  });

  it("a company link cannot be opened", async () => {
    const page = await mount(390, phoneCol(390));
    try {
      expect(await page.locator("button[aria-label='Edit Company booking']").count()).toBe(0);
      expect(await page.locator("button[aria-label='Remove Company booking']").count()).toBe(0);
    } finally { await page.close(); }
  });
});

describe("section headers", () => {
  it('"+ Add a section header" sits under the list and ABOVE "Button text" / "Web address"', async () => {
    const page = await mount(390, phoneCol(390));
    try {
      const btn = (await page.locator("button:has-text('+ Add a section header')").boundingBox())!;
      const list = (await page.locator("[data-link-list] ul").boundingBox())!;
      const form = (await page.locator("[data-add-link]").boundingBox())!;
      expect(btn.y).toBeGreaterThan(list.y + list.height - 1);
      expect(btn.y + btn.height).toBeLessThanOrEqual(form.y + 1);
    } finally { await page.close(); }
  });

  it("adds one at the end, with the cursor in its title; typing saves it as you go", async () => {
    const page = await mount(390, phoneCol(390));
    try {
      await page.click("button:has-text('+ Add a section header')");
      expect((await links(page)).length).toBe(6);
      expect(await page.evaluate(() => (document.activeElement as HTMLInputElement)?.placeholder)).toMatch(/Section title/);
      await page.keyboard.type("Listings");
      expect((await links(page))[5]).toMatchObject({ label: "Listings", kind: "header" });
      // Still focused after each keystroke (the row keeps its identity).
      expect(await page.evaluate(() => (document.activeElement as HTMLInputElement)?.value)).toBe("Listings");
    } finally { await page.close(); }
  });

  it("works on an empty list, so a header can open the first section", async () => {
    const page = await mount(390, phoneCol(390), { initial: [] });
    try {
      expect(await page.locator("[data-link-list] ul").count()).toBe(0);
      await page.click("button:has-text('+ Add a section header')");
      expect(await page.locator("[data-link-list] li").count()).toBe(1);
      expect(await page.evaluate(() => (document.activeElement as HTMLInputElement)?.placeholder)).toMatch(/Section title/);
    } finally { await page.close(); }
  });
});

describe("fits and is tappable at every width", () => {
  const WIDTHS: Array<[string, number, number]> = [
    ["phone 320", 320, phoneCol(320)],
    ["phone 390", 390, phoneCol(390)],
    ["computer", 1280, DESKTOP_COL],
  ];
  for (const [name, width, col] of WIDTHS) {
    for (const variant of ["app", "panel", "site"] as const) {
      for (const theme of (variant === "site" ? ["dark"] : ["dark", "light"]) as Array<"dark" | "light">) {
        it(`${name}, ${variant}, ${theme}: nothing escapes, every control is a real tap target`, async () => {
          const page = await mount(width, col, { variant, theme, initial: [COMPANY, { ...BOOK, label: "Book a meeting with me for a free home valuation this week", url: "https://calendly.com/alex-morgan-homes/30-minute-free-valuation" }, WATCH, YT] });
          try {
            // With an edit open too: the panel is the widest thing in a row.
            await page.click("button[aria-label^='Edit Book a meeting']");
            const m = await page.$eval("[data-link-list]", (root) => {
              // The section box is the column: "+ Add a section header" hangs
              // its hover pad 6px into the section's padding on purpose, so
              // its words line up with the rows above it.
              const r = root.closest("section")!.getBoundingClientRect();
              const spills: string[] = [];
              root.querySelectorAll("*").forEach((el) => {
                if (el.closest(".sr-only")) return;
                const b = el.getBoundingClientRect();
                if (b.width > 0 && (b.right > r.right + 0.5 || b.left < r.left - 0.5)) spills.push(`${el.tagName}.${String((el as HTMLElement).className).slice(0, 40)}`);
              });
              // …and everything in a row stays inside that row.
              root.querySelectorAll("li").forEach((li) => {
                const lr = li.getBoundingClientRect();
                li.querySelectorAll("*").forEach((el) => {
                  const b = el.getBoundingClientRect();
                  if (b.width > 0 && (b.right > lr.right + 0.5 || b.left < lr.left - 0.5)) spills.push(`row ${el.tagName}.${String((el as HTMLElement).className).slice(0, 40)}`);
                });
              });
              const small = Array.from(root.querySelectorAll("button, input")).map((el) => ({ t: el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName, h: el.getBoundingClientRect().height })).filter((x) => x.h > 0 && x.h < 28);
              const grips = Array.from(root.querySelectorAll("button[aria-label^='Move']")).map((el) => el.getBoundingClientRect());
              return { spills, small, gripMin: Math.min(...grips.map((g) => Math.min(g.width, g.height))) };
            });
            expect(m.spills, "something runs out of the list").toEqual([]);
            expect(m.small, "controls too small to tap").toEqual([]);
            expect(m.gripMin, "the grip is a thumb-sized target").toBeGreaterThanOrEqual(40);
            const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(docOverflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
            if (process.env.SHOT_DIR) await page.locator("#root").screenshot({ path: `${process.env.SHOT_DIR}/links-${name.replace(/\s/g, "")}-${variant}-${theme}.png` });
          } finally { await page.close(); }
        });
      }
    }
  }
});
