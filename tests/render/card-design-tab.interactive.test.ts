import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// THE CARD DESIGN TAB, MOUNTED AND USED.
//
// The 2026-09-16 restructure (Template gallery → one numbered design path, a
// pinned preview on phones, and the old-designer card left alone) is all
// behaviour: a thumbnail that only exists after CardScaler measures, a patch a
// tap produces, a preview that stays pinned on scroll, an onChange that must NOT fire on
// mount. None of that is visible to a source scan or to static markup, so each
// piece is bundled and mounted for real in a touch-emulated phone viewport.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_TAP = 44;
const DATA = `{ name: "Alex Morgan", title: "Realtor", company: "Coastline Realty", phone: "(415) 555-0188", email: "alex@coastline.com", website: "coastline.com", initials: "AM", photoUrl: null, logoUrl: null, cardUrl: "swiftcard.me/alexmorgan" }`;

const ENTRIES: Record<string, string> = {
  picker: `
    import { createRoot } from "react-dom/client";
    import { createElement, useState } from "react";
    import TemplatePicker from "@/components/card-templates/TemplatePicker";
    const params = new URLSearchParams(location.hash.slice(1));
    function App() {
      const [t, setT] = useState(params.get("t") || "classic-pro");
      (window as any).__picked = t;
      return createElement(TemplatePicker, { template: t, onSelect: setT, data: ${DATA}, customUnlocked: params.get("unlocked") === "1", proTags: params.get("proTags") === "1" });
    }
    createRoot(document.getElementById("root")!).render(createElement(App));
  `,
  style: `
    import { createRoot } from "react-dom/client";
    import { createElement, useState } from "react";
    import TemplateStyleControls from "@/components/card-templates/TemplateStyleControls";
    const params = new URLSearchParams(location.hash.slice(1));
    const initial = JSON.parse(params.get("v") || "{}");
    function App() {
      const [v, setV] = useState(initial);
      (window as any).__value = v;
      return createElement(TemplateStyleControls, {
        value: v,
        onChange: (p: any) => { (window as any).__patches = [...((window as any).__patches || []), p]; setV((prev: any) => ({ ...prev, ...p })); },
        template: params.get("t") || "classic-pro",
        locked: params.get("locked") === "1",
        proTags: params.get("proTags") === "1",
      });
    }
    createRoot(document.getElementById("root")!).render(createElement(App));
  `,
  legacy: `
    import { createRoot } from "react-dom/client";
    import { createElement, useState } from "react";
    import CustomCardDesigner from "@/components/CustomCardDesigner";
    const legacy = {
      background: "#0e1b35", fontFamily: "Georgia, serif", textColor: "#ffffff",
      elements: [
        { id: "n", type: "field", field: "name", x: 8, y: 20, fontSize: 22, bold: true },
        { id: "t", type: "field", field: "title", x: 8, y: 40, fontSize: 12 },
        { id: "q", type: "qr", x: 75, y: 55, size: 80 },
      ],
    };
    (window as any).__calls = 0;
    function App() {
      const [layout, setLayout] = useState<any>(legacy);
      return createElement(CustomCardDesigner, {
        layout, data: ${DATA},
        onChange: (l: any) => { (window as any).__calls++; (window as any).__last = l; setLayout(l); },
        canScan: true,
      });
    }
    createRoot(document.getElementById("root")!).render(createElement(App));
  `,
  pinned: `
    import { createRoot } from "react-dom/client";
    import { createElement } from "react";
    import PinnedCardPreview from "@/components/PinnedCardPreview";
    import ClassicPro from "@/components/card-templates/ClassicPro";
    const card = createElement(ClassicPro, { data: ${DATA} });
    createRoot(document.getElementById("root")!).render(
      createElement("div", { style: { padding: "0 20px" } },
        createElement(PinnedCardPreview, null, card),
        createElement("div", { id: "below", style: { height: 4000 } }, "controls"),
      )
    );
  `,
};

let browser: Browser;
let tmp: string;
const bundles: Record<string, string> = {};

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "card-design-tab-"));
  for (const [name, src] of Object.entries(ENTRIES)) {
    writeFileSync(join(tmp, `${name}.tsx`), src);
    const out = await build({
      entryPoints: [join(tmp, `${name}.tsx`)], bundle: true, write: false, format: "iife", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      alias: { "@": resolve("src") },
      loader: { ".svg": "text" },
      // PlanGate and friends read NEXT_PUBLIC_* at runtime; there is no Next here.
      banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
    });
    bundles[name] = out.outputFiles[0].text;
  }
}, 180_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

async function mount(name: string, hash = "", width = 390, height = 844): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`about:blank#${hash}`);
  await page.setContent(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${await appCss()}</style>
     <style>body{margin:0;padding:12px;background:#0b0f16}</style></head>
     <body class="sc-app"><div id="root"></div></body></html>`,
  );
  // setContent keeps the about:blank URL, so the hash set above survives.
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.addScriptTag({ content: bundles[name] });
  await page.waitForTimeout(400);
  return page;
}

describe("template gallery", () => {
  it("shows seven real options, each a proper thumb target", async () => {
    const page = await mount("picker", "unlocked=1");
    const tiles = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].map((b) => {
        const r = b.getBoundingClientRect();
        return { label: b.getAttribute("aria-label"), h: Math.round(r.height), w: Math.round(r.width), pressed: b.getAttribute("aria-pressed") };
      }),
    );
    expect(tiles.map((t) => t.label)).toEqual([
      "Classic Pro", "Modern Bold", "Photo First", "Local Business", "Luxury Minimal", "Logo First", "Custom design",
    ]);
    for (const t of tiles) expect(t.h, `${t.label} is ${t.h}px tall`).toBeGreaterThanOrEqual(MIN_TAP);
    expect(tiles.filter((t) => t.pressed === "true").map((t) => t.label)).toEqual(["Classic Pro"]);
    await page.context().close();
  });

  it("draws every template for real — no collapsed thumbnails", async () => {
    const page = await mount("picker", "unlocked=1");
    const widths = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-preview-locked='true']")].map((el) => Math.round(el.getBoundingClientRect().height)),
    );
    expect(widths).toHaveLength(6);
    for (const h of widths) expect(h).toBeGreaterThan(40);
    await page.context().close();
  });

  it("selects on tap, and never nests the card's links inside the button", async () => {
    const page = await mount("picker", "unlocked=1");
    await page.click("button[aria-label='Modern Bold']");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as unknown as { __picked: string }).__picked)).toBe("modern-bold");
    expect(await page.evaluate(() => document.querySelectorAll("button a, button [href]").length)).toBe(0);
    await page.context().close();
  });

  it("locks Custom without Pro, and says so — to the eye and to a screen reader", async () => {
    const page = await mount("picker", "unlocked=0");
    const custom = await page.$("button[aria-label='Custom design (Pro, locked)']");
    expect(await custom!.isDisabled()).toBe(true);
    expect(await page.textContent("body")).toContain("unlock the custom designer with Pro");
    // Locked means tagged, on every screen (owner, 2026-09-18: "shown with a
    // very small pro tag but I want it to be locked") — not only a Free Edit
    // card any more.
    const tag = await page.$("[data-ds='badge']");
    expect(await tag!.textContent()).toBe("PRO");
    expect(await tag!.isVisible()).toBe(true);
    // Tapping it does nothing: the card stays on the template it had.
    await page.click("button[aria-label='Custom design (Pro, locked)']", { force: true });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as unknown as { __picked: string }).__picked)).toBe("classic-pro");
    await page.context().close();
  });

  it("open for Pro: no tag, no lock", async () => {
    const page = await mount("picker", "unlocked=1");
    expect(await page.$("button[aria-label='Custom design']")).not.toBeNull();
    expect(await page.$$eval("[data-ds='badge']", (els) => els.length)).toBe(0);
    await page.context().close();
  });

  it("tags the Custom design row PRO on a Free Edit card (owner, 2026-09-18)", async () => {
    const page = await mount("picker", "unlocked=0&proTags=1");
    const tag = await page.$("[data-ds='badge']");
    expect(await tag!.textContent()).toBe("PRO");
    expect(await tag!.isVisible()).toBe(true);
    expect(await page.$$eval("[data-ds='badge']", (els) => els.length)).toBe(1);
    await page.context().close();
  });
});

describe("style panel: one numbered path, in build order", () => {
  it("an untouched card shows Original selected", async () => {
    const page = await mount("style", "v={}");
    const pressed = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLButtonElement>("button[aria-pressed='true']")].map((b) => (b.textContent || "").trim()),
    );
    expect(pressed.some((t) => t.includes("Original"))).toBe(true);
    await page.context().close();
  });

  it("Original hands back exactly the keys a Look sets — nothing else", async () => {
    const v = encodeURIComponent(JSON.stringify({ bgColor: "#052e2b", textColor: "#ffffff", finish: "sheen", accentColor: "#be123c", infoColor: "#111827", titleColor: "#d4af7a", companyColor: "#93c5fd" }));
    const page = await mount("style", `v=${v}`);
    await page.click("button[title=\"The template's own colours, font and finish\"]");
    await page.waitForTimeout(80);
    const { patches, value } = await page.evaluate(() => ({
      patches: (window as unknown as { __patches: Record<string, unknown>[] }).__patches,
      value: (window as unknown as { __value: Record<string, unknown> }).__value,
    }));
    expect(Object.keys(patches.at(-1)!).sort()).toEqual(["bgColor", "companyColor", "finish", "fontFamily", "surfaceColor", "textColor", "titleColor"]);
    expect(Object.values(patches.at(-1)!).every((x) => x === undefined)).toBe(true);
    // Accent and details colour are not part of a Look, so Original leaves them.
    expect(value.accentColor).toBe("#be123c");
    expect(value.infoColor).toBe("#111827");
    await page.context().close();
  });

  it("a Look puts Title and Company color back on Default, so neither can vanish on the new ground", async () => {
    // Logo First's "Bone" is a light card. A white title picked for the navy
    // card would disappear on it if the Look left it in place.
    const v = encodeURIComponent(JSON.stringify({ titleColor: "#ffffff", companyColor: "#ffffff" }));
    const page = await mount("style", `v=${v}&t=logo-first`);
    await page.click("button[title='Bone']");
    await page.waitForTimeout(80);
    const value = await page.evaluate(() => (window as unknown as { __value: Record<string, unknown> }).__value);
    expect(value.bgColor).toBe("#f4f2ed");
    expect(value.titleColor).toBeUndefined();
    expect(value.companyColor).toBeUndefined();
    // The tile reads as picked, and stops claiming it once a line is recoloured.
    expect(await page.getAttribute("button[title='Bone']", "aria-pressed")).toBe("true");
    await page.locator("li", { hasText: "Company color" }).locator("button[aria-label='Color preset']").nth(1).click();
    await page.waitForTimeout(80);
    expect(await page.getAttribute("button[title='Bone']", "aria-pressed")).toBe("false");
    await page.context().close();
  });

  it("runs Look → Branding panel → Photo or video → Info panel → Name → Title → Company → Accent → Details → Font → Finish (owner, 2026-09-16; Title and Company 2026-10-09)", async () => {
    const page = await mount("style", "v={}");
    const steps = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("ol[aria-label] > li")].map((li) => ({
        n: (li.querySelector("span[aria-hidden]")?.textContent || "").trim(),
        label: (li.querySelector("p")?.textContent || "").trim(),
        visible: li.getBoundingClientRect().height > 0,
      })),
    );
    expect(steps.map((s) => s.label)).toEqual([
      "Look", "Branding panel", "Photo or video", "Info panel", "Name color", "Title color", "Company color", "Accent / icons", "Details color", "Font", "Finish",
    ]);
    expect(steps.map((s) => s.n)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    expect(steps.every((s) => s.visible), "a step is hidden").toBe(true);
    // Nothing folded behind a tab or a More row any more.
    expect(await page.evaluate(() => document.querySelectorAll("details, [role='group'][aria-label='Fine-tune']").length)).toBe(0);
    await page.context().close();
  });

  it("every control on the path clears 44px, and finishes and fonts are all on screen", async () => {
    const page = await mount("style", "v={}");
    const small = await page.evaluate((min) =>
      [...document.querySelectorAll<HTMLElement>("button, summary, input[type='color']")]
        .map((el) => ({ t: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24), h: Math.round(el.getBoundingClientRect().height), w: el.getBoundingClientRect().width }))
        .filter((r) => r.w > 0 && r.h > 0 && r.h < min), MIN_TAP);
    expect(small, JSON.stringify(small)).toEqual([]);
    const visible = await page.evaluate(() => ({
      finishTiles: [...document.querySelectorAll<HTMLElement>("button[title*='·']")].filter((b) => b.getBoundingClientRect().width > 0).length,
      fontPills: [...document.querySelectorAll<HTMLElement>("button")].filter((b) => (b.textContent || "").includes("Ag") && b.getBoundingClientRect().width > 0).length,
    }));
    expect(visible.finishTiles).toBe(8);
    expect(visible.fontPills).toBeGreaterThan(1);
    await page.context().close();
  });

  it("a template with no second surface just has one step fewer", async () => {
    const page = await mount("style", "v={}&t=modern-bold");
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("ol[aria-label] > li p:first-child")].map((p) => (p.textContent || "").trim()),
    );
    expect(labels[0]).toBe("Look");
    expect(labels.at(-1)).toBe("Finish");
    // Classic Pro's eleven, less the second surface.
    expect(labels).toHaveLength(10);
    await page.context().close();
  });

  it("shows no PRO tag without `proTags` — the build wizard and Pro accounts", async () => {
    // `locked` alone is what the wizard passes; it must stay untagged.
    const v = encodeURIComponent(JSON.stringify({ bgColor: "#123456", finish: "carbon" }));
    const page = await mount("style", `v=${v}&locked=1`);
    const proText = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => el.children.length === 0 && /\bPRO\b/i.test(el.textContent || "")).map((el) => el.textContent),
    );
    expect(proText, JSON.stringify(proText)).toEqual([]);
    await page.context().close();
  });

  it("tags exactly the Pro choices on a Free Edit card, visibly, without cutting a name short (owner, 2026-09-18)", async () => {
    const page = await mount("style", "v={}&locked=1&proTags=1");
    const found = await page.evaluate(() => {
      const tags = [...document.querySelectorAll<HTMLElement>("[data-ds='badge']")].filter((el) => el.textContent === "PRO");
      const where = tags.map((t) => {
        const finish = t.closest("[data-design-step='finish'] button");
        const look = t.closest("[data-design-step='look'] button");
        const step = t.closest("li[data-design-step]")?.getAttribute("data-design-step");
        const r = t.getBoundingClientRect();
        return {
          kind: finish ? `finish:${finish.textContent?.replace("PRO", "").trim()}` : look ? "look" : t.closest("label") ? `anycolor:${step}` : `step:${step}`,
          visible: r.width > 8 && r.height > 8 && getComputedStyle(t).visibility !== "hidden",
          inside: (() => { const b = (t.closest("button,label,li") as HTMLElement).getBoundingClientRect(); return r.left >= b.left - 0.5 && r.right <= b.right + 0.5; })(),
        };
      });
      // A tile name that truncates shows an ellipsis: scrollWidth > clientWidth.
      const cut = [...document.querySelectorAll<HTMLElement>("[data-design-step='finish'] button span.truncate")]
        .filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent);
      return { where, cut };
    });
    const kinds = found.where.map((w) => w.kind);
    expect(kinds.filter((k) => k.startsWith("finish:")).sort()).toEqual(
      ["finish:Brushed", "finish:Carbon", "finish:Frosted", "finish:Gilt edge", "finish:Linen"],
    );
    expect(kinds).toContain("step:media");
    expect(kinds.filter((k) => k.startsWith("anycolor:")).length).toBeGreaterThanOrEqual(4);
    // Free finishes and fonts are never tagged.
    expect(kinds.some((k) => /Flat|Sheen|Halo/.test(k) || k === "step:font")).toBe(false);
    for (const w of found.where) {
      expect(w.visible, JSON.stringify(w)).toBe(true);
      expect(w.inside, JSON.stringify(w)).toBe(true);
    }
    expect(found.cut, "a finish name is cut short").toEqual([]);
    await page.context().close();
  });

  it("Photo or video comes straight after the background it goes behind", async () => {
    const page = await mount("style", "v={}");
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("ol[aria-label] > li p:first-child")].map((p) => (p.textContent || "").trim()),
    );
    expect(labels.indexOf("Photo or video")).toBe(labels.indexOf("Branding panel") + 1);
    expect(await page.isVisible("button:has-text('Add a photo or video')")).toBe(true);
    await page.context().close();
  });
});

describe("a card from the previous custom designer", () => {
  // Positioned elements are what the fine-tune editor edits (owner,
  // 2026-09-23), so an old card no longer needs converting: it opens straight
  // into the editor, exactly as saved, and changes only when its owner acts.
  it("is shown as saved and NOT rewritten on mount", async () => {
    const page = await mount("legacy");
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { __calls: number }).__calls)).toBe(0);
    expect(await page.textContent("body")).toContain("Tap anything on the card");
    expect(await page.locator(".sc-free-canvas [data-el='n']").count()).toBe(1);
    await page.context().close();
  });

  it("can be fine-tuned straight away, keeping its own colour and font", async () => {
    const page = await mount("legacy");
    await page.locator(".sc-free-canvas [data-el='n']").click();
    await page.click("button[aria-label='Bigger']");
    await page.waitForTimeout(200);
    const last = await page.evaluate(() => (window as unknown as { __last: { blocks?: unknown[]; elements?: { id: string; fontSize?: number }[]; background?: string; fontFamily?: string } }).__last);
    expect(last.blocks).toBeUndefined();
    expect(last.elements?.find((e) => e.id === "n")?.fontSize).toBeGreaterThan(22);
    expect(last.background, "kept the card's colour").toBe("#0e1b35");
    expect(last.fontFamily).toBe("Georgia, serif");
    await page.context().close();
  });
});

describe("pinned preview on a phone", () => {
  const box = (page: Page) => page.evaluate(() => {
    const el = document.querySelector("[data-preview-locked='true']") as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, height: r.height, width: r.width };
  });

  it("stays at the top of the screen however far the step scrolls", async () => {
    const page = await mount("pinned");
    const rest = await box(page);
    expect(rest?.height, "the card rendered with no height").toBeGreaterThan(50);
    for (const y of [600, 3000]) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(150);
      const now = await box(page);
      expect(now, `preview gone after scrolling to ${y}`).not.toBeNull();
      expect(now!.top, `preview left the top after scrolling to ${y}`).toBeGreaterThanOrEqual(0);
      expect(now!.top).toBeLessThan(40);
    }
    await page.context().close();
  });

  it("opens full size on a tap, and closes again", async () => {
    const page = await mount("pinned");
    const small = await box(page);
    await page.click("button[aria-label='See your card full size']");
    await page.waitForTimeout(250);
    const dialog = await page.evaluate(() => {
      const d = document.querySelector("[role='dialog'] [data-preview-locked='true']") as HTMLElement | null;
      return d ? d.getBoundingClientRect().width : 0;
    });
    expect(dialog, "the full-size card is not bigger than the pinned one").toBeGreaterThan(small!.width + 20);
    await page.click("[role='dialog'] button:has-text('Close')");
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => !!document.querySelector("[role='dialog']"))).toBe(false);
    await page.context().close();
  });

  it("is not shown on desktop, where the preview column is already pinned", async () => {
    const page = await mount("pinned", "", 1280, 900);
    const now = await box(page);
    expect(now === null || now.height === 0).toBe(true);
    await page.context().close();
  });
});
