import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";
import { META, looksInFamily } from "@/lib/template-style-presets";

// ─────────────────────────────────────────────────────────────────────────────
// CARD DESIGN → LOOK: Original, then Solid / Gradient / Glass.
//
// Owner, 2026-10-14: make the card's Look step "the same exact thing" as
// Social design's — three rows that drop down to a set of designs each. This
// mounts the REAL TemplateStyleControls, hydrated in headless Chromium with the
// app's compiled Tailwind, and taps it the way a person would, at a phone and a
// computer width:
//   • rows arrive closed, Original is the pressed choice on an untouched card;
//   • a row opens to its tiles, every tile a miniature card painted with the
//     real material (Glass carries the Frosted layers);
//   • a tap applies the Look and lights its tile, and the closed row names it;
//   • opening a row while another is open keeps the tapped row in place;
//   • a Free Edit card tags the Glass row PRO and it still opens.
// ─────────────────────────────────────────────────────────────────────────────

let browser: Browser;
let bundle: string;
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "card-look-families-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h, useState } from "react";
    import TemplateStyleControls from "@/components/card-templates/TemplateStyleControls";

    // Observe (never change) the reveal: the picker's reveal is the only
    // scrollBy called with an options object — record where the tapped row is
    // at that instant, the moment a jump would show.
    const w = window as any;
    const rec = () => { if (w.__trackRow && w.__atReveal == null) w.__atReveal = w.__trackRow.getBoundingClientRect().top; };
    const winBy = window.scrollBy.bind(window);
    w.scrollBy = (a: any, b?: any) => { if (typeof a === "object") { rec(); return winBy(a); } return winBy(a, b); };

    function App({ template, proTags }: { template: string; proTags: boolean }) {
      const [v, setV] = useState<any>({});
      w.__value = v;
      return h(TemplateStyleControls, {
        value: v,
        onChange: (p: any) => setV((prev: any) => ({ ...prev, ...p })),
        template,
        locked: proTags,
        proTags,
        canUpload: false,
      });
    }
    w.mount = ({ template, proTags }: { template: string; proTags: boolean }) => {
      const root = document.getElementById("root")!;
      root.innerHTML = '<div style="height:300px"></div><div id="panel" style="width:var(--w);margin:0 auto"></div><div style="height:1400px"></div>';
      createRoot(document.getElementById("panel")!).render(h(App, { template, proTags }));
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function mount(width: number, template = "classic-pro", proTags = false): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 844 });
  const panelW = width < 700 ? width - 32 : 400;
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>:root{--w:${panelW}px} body{margin:0;background:#0b0f16}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`,
  );
  await page.evaluate((o) => (window as unknown as { mount: (x: unknown) => void }).mount(o), { template, proTags });
  await page.waitForSelector("button[aria-expanded]");
  return page;
}

const row = (page: Page, name: string) => page.locator("button[aria-expanded]", { hasText: name });

for (const width of [390, 1280]) {
  describe(`the card Look picker at ${width}px`, () => {
    it("arrives with three closed rows under Original, and Original pressed", async () => {
      const page = await mount(width);
      const rows = await page.$$eval("button[aria-expanded]", (els) =>
        els.map((e) => ({ text: (e.textContent || "").trim(), open: e.getAttribute("aria-expanded"), h: e.getBoundingClientRect().height })));
      // The Look step's three rows come first in the panel.
      expect(rows.length).toBeGreaterThanOrEqual(3);
      expect(rows.slice(0, 3).map((r) => r.open)).toEqual(["false", "false", "false"]);
      expect(rows[0].text).toMatch(/^Solid/);
      expect(rows[1].text).toMatch(/^Gradient/);
      expect(rows[2].text).toMatch(/^Glass/);
      for (const r of rows.slice(0, 3)) expect(r.h, r.text).toBeGreaterThanOrEqual(44);
      const original = page.locator("button[title=\"The template's own colors, font and finish\"]");
      expect(await original.getAttribute("aria-pressed")).toBe("true");
      // No tiles until a row is opened.
      expect(await page.locator("button[aria-pressed][title='Onyx']").count()).toBe(0);
      await page.close();
    });

    it("opens each row to its own looks, as miniature cards inside the panel", async () => {
      const page = await mount(width);
      for (const fam of ["Solid", "Gradient", "Glass"] as const) {
        await row(page, fam).click();
        await page.waitForTimeout(60);
        const id = fam.toLowerCase() as "solid" | "gradient" | "glass";
        const expected = looksInFamily(META["classic-pro"], id).map((l) => l.name);
        const tiles = await page.$$eval("#panel button[aria-pressed][title]", (els, panelSel) => {
          const panel = document.querySelector(panelSel)!.getBoundingClientRect();
          return els
            .filter((e) => e.querySelector("[data-ds='specimen']") && !e.getAttribute("title")!.startsWith("The template"))
            .map((e) => {
              const r = e.getBoundingClientRect();
              const card = e.querySelector<HTMLElement>("[data-ds='specimen']")!;
              const c = card.getBoundingClientRect();
              const caption = card.nextElementSibling as HTMLElement;
              return {
                title: e.getAttribute("title")!.split(" — ")[0],
                inside: r.left >= panel.left - 0.5 && r.right <= panel.right + 0.5,
                w: c.width, h: r.height, cardH: c.height,
                bg: getComputedStyle(card).backgroundImage,
                caption: caption.textContent,
                captionFits: caption.scrollWidth <= caption.clientWidth,
              };
            });
        }, "#panel");
        // Only the open row's tiles exist — one open at a time.
        expect(tiles.map((t) => t.title)).toEqual(expected);
        for (const t of tiles) {
          expect(t.inside, `${t.title} spills out of the panel`).toBe(true);
          expect(t.h, `${t.title} is not a tap target`).toBeGreaterThanOrEqual(44);
          // A card, not a chip: card-shaped, wider than tall.
          expect(t.w / t.cardH).toBeGreaterThan(1.6);
          // The look's whole name, never "Sea…".
          expect(t.caption).toBe(t.title);
          expect(t.captionFits, `${t.title} is cut short`).toBe(true);
          // Glass is the painted Frosted sheet over the wash — the material
          // must be on the tile, not just the colour.
          if (id === "glass") expect(t.bg, t.title).toMatch(/rgba\(255, 255, 255, 0\.3\)/);
        }
      }
      await page.close();
    });

    it("a tap applies the Look, lights its tile, and the closed row names it", async () => {
      const page = await mount(width);
      await row(page, "Glass").click();
      await page.click("button[title^='Arctic']");
      await page.waitForTimeout(60);
      const v = await page.evaluate(() => (window as unknown as { __value: Record<string, unknown> }).__value);
      const arctic = META["classic-pro"].looks.find((l) => l.name === "Arctic")!;
      expect(v.bgColor).toBe(arctic.bg);
      expect(v.finish).toBe("frosted");
      expect(v.titleColor).toBe(arctic.title);
      expect(v.companyColor).toBe(arctic.company);
      expect(v.infoColor).toBe(arctic.info);
      expect(v.accentColor).toBe(arctic.accent);
      expect(await page.getAttribute("button[title^='Arctic']", "aria-pressed")).toBe("true");
      expect(await page.getAttribute("button[title=\"The template's own colors, font and finish\"]", "aria-pressed")).toBe("false");
      // Close it: the row still says which look the card is wearing.
      await row(page, "Glass").click();
      expect(await row(page, "Glass").textContent()).toContain("Arctic");
      expect(await row(page, "Solid").textContent()).not.toContain("Arctic");
      // And Original takes it all back.
      await page.click("button[title=\"The template's own colors, font and finish\"]");
      const back = await page.evaluate(() => (window as unknown as { __value: Record<string, unknown> }).__value);
      for (const k of ["bgColor", "textColor", "fontFamily", "finish", "surfaceColor", "titleColor", "companyColor", "infoColor", "accentColor"]) {
        expect(back[k], k).toBeUndefined();
      }
      await page.close();
    });

    it("switching rows keeps the tapped row under your finger", async () => {
      const page = await mount(width);
      await row(page, "Solid").click();
      await page.waitForTimeout(400);
      // Bring Glass on screen the way a person would, then tap it: ten Solid
      // looks collapse above it in the same tap.
      await page.evaluate(() => {
        const r = [...document.querySelectorAll<HTMLElement>("button[aria-expanded]")].find((b) => (b.textContent || "").startsWith("Glass"))!;
        window.scrollBy(0, r.getBoundingClientRect().top - 500);
      });
      const before = await page.evaluate(() => {
        const r = [...document.querySelectorAll<HTMLElement>("button[aria-expanded]")].find((b) => (b.textContent || "").startsWith("Glass"))!;
        const w = window as unknown as { __trackRow: HTMLElement; __atReveal: number | null };
        w.__trackRow = r; w.__atReveal = null;
        return r.getBoundingClientRect().top;
      });
      const box = await row(page, "Glass").boundingBox();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      const justAfter = await page.evaluate(() => new Promise<number>((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const w = window as unknown as { __atReveal: number | null; __trackRow: HTMLElement };
        res(w.__atReveal ?? w.__trackRow.getBoundingClientRect().top);
      }))));
      expect(Math.abs(justAfter - before), `the Glass row jumped ${Math.round(justAfter - before)}px`).toBeLessThanOrEqual(2);
      expect(await row(page, "Glass").getAttribute("aria-expanded")).toBe("true");
      expect(await row(page, "Solid").getAttribute("aria-expanded")).toBe("false");
      await page.close();
    });
  });
}

describe("on a Free account's Edit card", () => {
  it("tags the Glass row PRO, and it still opens and applies", async () => {
    const page = await mount(390, "classic-pro", true);
    expect(await row(page, "Glass").locator("[data-ds='badge']").count()).toBe(1);
    // Solid and Gradient hold free looks, so their rows are not tagged.
    expect(await row(page, "Solid").locator("[data-ds='badge']").count()).toBe(0);
    expect(await row(page, "Gradient").locator("[data-ds='badge']").count()).toBe(0);
    await row(page, "Glass").click();
    await page.click("button[title^='Jade']");
    const v = await page.evaluate(() => (window as unknown as { __value: Record<string, unknown> }).__value);
    expect(v.finish).toBe("frosted");
    await page.close();
  });
});

describe("every template draws its own layout", () => {
  for (const t of Object.keys(META)) {
    it(`${t}: all 26 looks open, none overlapping`, async () => {
      const page = await mount(390, t);
      let seen = 0;
      for (const fam of ["Solid", "Gradient", "Glass"]) {
        await row(page, fam).click();
        await page.waitForTimeout(40);
        const rects = await page.$$eval("#panel button[aria-pressed][title]", (els) =>
          els.filter((e) => e.querySelector("[data-ds='specimen']") && !e.getAttribute("title")!.startsWith("The template"))
            .map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
        seen += rects.length;
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            const overlap = a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
            expect(overlap, `${t} ${fam}: tiles ${i} and ${j} overlap`).toBe(false);
          }
        }
      }
      expect(seen).toBe(26);
      await page.close();
    });
  }
});

// Owner, 2026-10-15: "make sure that if I press on one of them, it actually
// works — the color that the text says it's going to be, the background, all
// that." Every tile, on every template: one tap writes the WHOLE Look, lights
// that tile alone, and the closed row names it.
describe("every Look does exactly what its tile shows", () => {
  for (const t of Object.keys(META)) {
    it(`${t}: each of the 26 tiles applies its whole design`, async () => {
      const page = await mount(390, t);
      const meta = META[t];
      for (const fam of ["Solid", "Gradient", "Glass"] as const) {
        await row(page, fam).click();
        await page.waitForTimeout(40);
        for (const look of looksInFamily(meta, fam.toLowerCase() as "solid" | "gradient" | "glass")) {
          const tile = page.locator(`#panel button[aria-pressed][title="${look.finish ? `${look.name} — ` : look.name}"], #panel button[aria-pressed][title^="${look.name} — "]`).first();
          await tile.click();
          const v = await page.evaluate(() => (window as unknown as { __value: Record<string, unknown> }).__value);
          const want: Record<string, unknown> = {
            bgColor: look.bg, textColor: look.text, fontFamily: look.font, finish: look.finish,
            surfaceColor: meta.surface ? look.surface : undefined,
            titleColor: look.title, companyColor: look.company, infoColor: look.info, accentColor: look.accent,
          };
          for (const [k, x] of Object.entries(want)) expect(v[k], `${t}/${look.name} ${k}`).toBe(x);
          const lit = await page.$$eval("#panel button[aria-pressed='true'][title]", (els) =>
            els.filter((e) => e.querySelector("[data-ds='specimen']") && !e.getAttribute("title")!.startsWith("The template"))
              .map((e) => e.getAttribute("title")!.split(" — ")[0]));
          expect(lit, `${t}/${look.name}`).toEqual([look.name]);
        }
        await row(page, fam).click();
      }
      await page.close();
    });
  }
});

// Owner, 2026-10-15: Original's little picture "doesn't even fit correctly".
// It is now the tile's own drawing scaled down: everything in it stays inside
// it, on every template.
describe("Original's thumbnail fits", () => {
  for (const t of Object.keys(META)) {
    it(`${t}: nothing in the thumbnail spills past its frame`, async () => {
      const page = await mount(390, t);
      const spill = await page.evaluate(() => {
        const btn = document.querySelector<HTMLElement>("button[title=\"The template's own colors, font and finish\"]")!;
        const card = btn.querySelector<HTMLElement>("[data-ds='specimen']")!;
        const frame = card.parentElement!.parentElement!.getBoundingClientRect();
        const out: string[] = [];
        if (frame.width < 40 || frame.height < 20) out.push(`frame ${frame.width}x${frame.height}`);
        for (const el of [card, ...card.querySelectorAll<HTMLElement>("*")]) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (r.left < frame.left - 0.5 || r.right > frame.right + 0.5 || r.top < frame.top - 0.5 || r.bottom > frame.bottom + 0.5) {
            out.push(`${el.tagName}.${el.className} ${Math.round(r.top - frame.top)}/${Math.round(frame.bottom - r.bottom)}`);
          }
        }
        return out;
      });
      expect(spill).toEqual([]);
      await page.close();
    });
  }
});
