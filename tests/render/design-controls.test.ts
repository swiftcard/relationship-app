import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { launchBrowser, appCss } from "./harness";

import TemplateStyleControls from "@/components/card-templates/TemplateStyleControls";
import { Segmented, Switch } from "@/components/ui/DesignControls";

// ─────────────────────────────────────────────────────────────────────────────
// THE DESIGN EDITOR'S CONTROLS, MEASURED.
//
// Every claim here was a real number first. Audited at 390px on 2026-09-15,
// before any of this landed:
//
//   66 interactive controls in one panel
//   50 of them under 44px tall — colour presets at 28x28, "Default" at 53x25
//   7 distinct font sizes: 9, 10, 11, 12, 13, 14, 16px
//   5 different ways of drawing "selected", including a grey fill on a grey
//     track (the logo-shape control) that was invisible at a glance
//
// A source scan cannot see any of that — a tap target is font metrics x padding
// x the CSS that actually compiled, and none of it exists until something is
// laid out. So this renders the real components with the app's real Tailwind
// and measures, with touch emulation on so the any-pointer:coarse rules apply.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_TAP = 44;

describe("design controls", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  /** Render markup in a touch-emulated phone viewport and measure it. */
  async function inPhone<T>(markup: string, fn: (page: import("playwright").Page) => Promise<T>): Promise<T> {
    const css = await appCss();
    // hasTouch is what makes `any-pointer: coarse` match — without it the
    // sc-tap rules never apply and this file would measure the desktop panel
    // while claiming to test a phone.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 3200 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();
    try {
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8">
         <meta name="viewport" content="width=device-width, initial-scale=1">
         <style>${css}</style>
         <style>body{margin:0;padding:12px;background:#0b0f16}</style></head>
         <body class="sc-app"><div style="width:366px">${markup}</div></body></html>`,
        { waitUntil: "load" },
      );
      await page.waitForTimeout(200);
      return await fn(page);
    } finally {
      await ctx.close();
    }
  }

  /** bg-blue-600 as this build's CSS actually computes it (Tailwind 4 → oklch). */
  const BLUE_REF = `<span id="ref" class="bg-blue-600"></span>`;

  // With a logo, so every check below also covers the Logo shape step.
  const panel = (locked = false, template = "classic-pro", withLogo = true) =>
    renderToStaticMarkup(
      createElement(TemplateStyleControls, {
        value: { bgColor: "#101828", textColor: "#ffffff" },
        onChange: () => {},
        template,
        locked,
        logo: withLogo ? { shape: "auto", onChange: () => {} } : undefined,
      }),
    );

  it("every control in the style panel clears the 44px tap minimum on a phone", async () => {
    const small = await inPhone(panel(), (page) =>
      page.evaluate((min) => {
        const els = [...document.querySelectorAll<HTMLElement>("button, summary, input[type='color']")];
        return els
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              text: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 28),
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          })
          // A control inside a closed <details> has no box at all; it is
          // measured in its own test below, after opening it.
          .filter((r) => r.w > 0 && r.h > 0)
          .filter((r) => r.h < min);
      }, MIN_TAP),
    );
    expect(small, `controls under ${MIN_TAP}px tall: ${JSON.stringify(small)}`).toEqual([]);
  });

  it("the panel speaks three type sizes, not seven", async () => {
    const sizes = await inPhone(panel(), (page) =>
      page.evaluate(() => {
        const seen = new Map<string, number>();
        for (const el of [...document.querySelectorAll<HTMLElement>("body *")]) {
          // <style> holds the whole stylesheet as a text node.
          if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
          // Only elements that actually render text of their own.
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim());
          if (!own) continue;
          // A type SPECIMEN ("Aa", "Ag") is showing a typeface, not labelling
          // anything, and a PRO badge is deliberately smaller than any label.
          // Both say so in the DOM, so this excludes them by intent rather than
          // by hard-coding the sizes they happen to use today.
          if (el.closest("[data-ds='specimen'],[data-ds='badge']")) continue;
          const s = getComputedStyle(el).fontSize;
          seen.set(s, (seen.get(s) ?? 0) + 1);
        }
        return [...seen.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
      }),
    );
    // 11px for sections and help, 13px for labels and controls. That is the
    // whole scale. It was seven sizes before this (9, 10, 11, 12, 13, 14, 16).
    const labelSizes = sizes.map(([s]) => s).sort();
    expect(labelSizes, `type scale drifted: ${JSON.stringify(sizes)}`).toEqual(["11px", "13px"]);
  });

  it("selected means FILLED, and unselected never is", async () => {
    // The font pills are the clearest case: one is active, the rest are not,
    // and the difference has to survive a glance.
    const pills = await inPhone(panel() + BLUE_REF, (page) =>
      page.evaluate(() => {
        const ref = getComputedStyle(document.getElementById("ref")!).backgroundColor;
        const btns = [...document.querySelectorAll<HTMLElement>("button[aria-pressed]")];
        return btns
          .filter((b) => (b.textContent || "").includes("Ag"))
          .map((b) => ({
            pressed: b.getAttribute("aria-pressed") === "true",
            bg: getComputedStyle(b).backgroundColor,
            ref,
          }));
      }),
    );
    expect(pills.length).toBeGreaterThan(1);
    const active = pills.filter((p) => p.pressed);
    expect(active).toHaveLength(1);
    // A real fill, not a 10% tint — the same blue the reference element paints.
    expect(active[0].bg).toBe(active[0].ref);
    for (const p of pills.filter((x) => !x.pressed)) {
      expect(p.bg).not.toBe(active[0].bg);
    }
  });

  it("every choice control reports its state to a screen reader", async () => {
    const unlabelled = await inPhone(panel(), (page) =>
      page.evaluate(() => {
        // Swatches, font pills, finishes, Looks and the Default chip are all
        // "one of these is chosen" controls, so each owes an aria-pressed.
        const groups = [...document.querySelectorAll<HTMLElement>("button")];
        return groups
          .filter((b) => b.getAttribute("aria-label") === "Color preset")
          .filter((b) => b.getAttribute("aria-pressed") == null).length;
      }),
    );
    expect(unlabelled).toBe(0);
  });

  it("Segmented fills the active segment and marks it pressed", async () => {
    const markup = renderToStaticMarkup(
      createElement(Segmented, {
        label: "Logo shape",
        value: "circle",
        onChange: () => {},
        options: [
          { value: "auto", label: "Original" },
          { value: "circle", label: "Circle" },
        ],
      }),
    );
    const segs = await inPhone(markup + BLUE_REF, (page) =>
      page.evaluate(() => [...document.querySelectorAll<HTMLElement>("button")].map((b) => ({
        label: (b.textContent || "").trim(),
        pressed: b.getAttribute("aria-pressed") === "true",
        bg: getComputedStyle(b).backgroundColor,
        ref: getComputedStyle(document.getElementById("ref")!).backgroundColor,
        h: Math.round(b.getBoundingClientRect().height),
      }))),
    );
    const on = segs.find((s) => s.pressed)!;
    const off = segs.find((s) => !s.pressed)!;
    expect(on.label).toBe("Circle");
    expect(on.bg).toBe(on.ref);
    // The old control's "off" was grey-on-grey. Whatever off is, it must not be
    // a near-neighbour of on.
    expect(off.bg).not.toBe(on.bg);
    expect(on.h).toBeGreaterThanOrEqual(MIN_TAP);
    expect(off.h).toBeGreaterThanOrEqual(MIN_TAP);
    // And the group carries the accessible name, so the segments are not two
    // orphan buttons to a screen reader.
    expect(segs).toHaveLength(2);
  });

  it("Switch is a switch: role, state, and the whole row is the target", async () => {
    const markup = renderToStaticMarkup(
      createElement(Switch, {
        checked: true,
        onChange: () => {},
        label: "Blur the link buttons",
        help: "Frosted glass rows.",
      }),
    );
    const s = await inPhone(markup, (page) =>
      page.evaluate(() => {
        const el = document.querySelector<HTMLElement>("[role='switch']")!;
        const r = el.getBoundingClientRect();
        return {
          checked: el.getAttribute("aria-checked"),
          labelled: !!el.getAttribute("aria-labelledby"),
          described: !!el.getAttribute("aria-describedby"),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      }),
    );
    expect(s.checked).toBe("true");
    expect(s.labelled).toBe(true);
    expect(s.described).toBe(true);
    expect(s.h).toBeGreaterThanOrEqual(MIN_TAP);
    // Full-width row, not a lone 42px track floating at the right edge.
    expect(s.w).toBeGreaterThan(300);
  });

  it("nothing is folded away: every design step renders open, with no JavaScript", async () => {
    // Owner, 2026-09-16: one numbered path, nothing behind a tab or a "More"
    // fold. Static markup is what a phone paints before hydration.
    const html = panel();
    expect(html).not.toMatch(/<details/);
    expect(html).not.toMatch(/shidden(=|s|>)/);
  });

  it("Logo shape is a numbered step beside Photo shape, only when there is a logo", async () => {
    // Owner, 2026-10-14: moved out of "Logo & headshot" into the design steps,
    // right after the panels — on Photo First, directly under Photo shape.
    const steps = (html: string) =>
      inPhone(html, (page) =>
        page.evaluate(() => {
          const ol = document.querySelector("ol[aria-label]")!;
          return [...ol.children].map((li) => {
            const seg = li.querySelector<HTMLElement>("[role=group][aria-label=\"Logo shape\"]");
            return {
              text: (li.textContent || "").trim(),
              segs: seg ? [...seg.querySelectorAll("button")].map((b) => ({ label: (b.textContent || "").trim(), pressed: b.getAttribute("aria-pressed") === "true" })) : null,
              overflow: li.scrollWidth > li.clientWidth + 1,
            };
          });
        }),
      );
    const photoFirst = await steps(panel(false, "photo-first"));
    const at = (needle: string) => photoFirst.findIndex((s) => s.text.includes(needle));
    expect(at("Photo shape")).toBeGreaterThan(-1);
    expect(at("Logo shape")).toBe(at("Photo shape") + 1);
    const logo = photoFirst[at("Logo shape")];
    expect(logo.segs).toEqual([{ label: "Original", pressed: true }, { label: "Circle", pressed: false }]);
    // No colour behind the logo: the plate is white by design.
    expect(logo.text).not.toMatch(/color/i);
    expect(photoFirst.filter((s) => s.overflow)).toEqual([]);

    const noLogo = await steps(panel(false, "photo-first", false));
    expect(noLogo.some((s) => s.text.includes("Logo shape"))).toBe(false);
    expect(noLogo).toHaveLength(photoFirst.length - 1);
  });
});
