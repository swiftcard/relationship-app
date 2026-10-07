import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, createRef } from "react";
import type { Browser } from "playwright";
import { appCss, launchBrowser } from "./harness";
import DownloadCardButton from "@/components/DownloadCardButton";

// RENDER TEST — measures real layout, because this bug is invisible to source
// scanning.
//
// The compact Download button lived in a `flex` row next to a "Preview" link and
// was sized by `flex-1`. The Preview link was deliberately removed; the row
// became a plain block; `flex-1` silently stopped applying. A <button> is
// shrink-to-fit even at display:flex, so it collapsed to the width of the word
// "Download" and sat half-width above the full-width Wallet button.
//
// Every class involved still "looked right" in the source — flex-1 was still
// there, it just had no flex parent any more. Only laying it out shows it.

// Where the compact button lives now: "Other ways to share" (MoreShareOptions)
// — its panel and the "Save as a picture" stack. It used to sit under the card
// in the dashboard's Your Card box too, on desktop only; that copy was removed
// (owner, 2026-10-07) because it duplicated this one, which every device has.
const PANEL = "w-full max-w-sm bg-gray-950 border border-gray-800 rounded-2xl p-5";
const WRAPPER = "space-y-2";
// The Wallet button in the same dialog (AddToWalletButton).
const WALLET = "w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold text-white bg-black";

// Pathological, not boundary: widths span the narrow sticky sidebar through a
// wide phone, so the assertions hold regardless of font metrics.
const PANEL_WIDTHS = [280, 320, 384, 440];

let browser: Browser;
beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
afterAll(async () => { await browser?.close(); });

async function measure(panelWidth: number) {
  const css = await appCss();
  const button = renderToStaticMarkup(
    createElement(DownloadCardButton, { cardRef: createRef<HTMLDivElement>(), compact: true, label: "Download card (PNG)" }),
  );
  const page = await browser.newPage({ viewportSize: { width: panelWidth + 120, height: 700 } });
  try {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
       <style>body{margin:0;padding:20px;background:#030712}#panel{width:${panelWidth}px}</style>
       </head><body class="sc-app">
         <div id="panel" class="${PANEL}">
           <div id="wrap" class="${WRAPPER}">${button}</div>
           <button id="wallet" class="${WALLET} mt-2">Add to Apple Wallet</button>
         </div>
       </body></html>`,
    );
    return await page.evaluate(() => {
      const wrap = document.getElementById("wrap")!;
      const btn = wrap.querySelector("button")!;
      const wallet = document.getElementById("wallet")!;
      const panel = document.getElementById("panel")!;
      const b = btn.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      const wl = wallet.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      return {
        buttonWidth: b.width, contentWidth: w.width,
        walletWidth: wl.width, walletHeight: wl.height, buttonHeight: b.height,
        // How far the button escapes the panel's padding box, if at all.
        overLeft: p.left + parseFloat(getComputedStyle(panel).paddingLeft) - b.left,
        overRight: b.right - (p.right - parseFloat(getComputedStyle(panel).paddingRight)),
        label: btn.textContent?.trim() ?? "",
      };
    });
  } finally {
    await page.close();
  }
}

describe("the share options' Download card (PNG) button fills its panel", () => {
  it.each(PANEL_WIDTHS)("fills the content width at a %ipx panel", async (panelWidth) => {
    const m = await measure(panelWidth);
    // THE regression: a shrink-wrapped button is a fraction of the row.
    expect(m.buttonWidth, `button is ${Math.round(m.buttonWidth)}px in a ${Math.round(m.contentWidth)}px row — it collapsed`)
      .toBeCloseTo(m.contentWidth, 0);
  }, 120_000);

  it("lines up with the Wallet button beneath it and stays inside the panel", async () => {
    const m = await measure(320);
    expect(m.buttonWidth, "Download and Wallet are different widths — the stack looks ragged")
      .toBeCloseTo(m.walletWidth, 0);
    // "not out of the border" — nothing pokes past the panel's padding box.
    expect(m.overLeft, "button starts left of the panel's padding").toBeLessThanOrEqual(0.5);
    expect(m.overRight, "button extends past the panel's padding").toBeLessThanOrEqual(0.5);
  }, 120_000);

  it("is slimmer than the Wallet button, and on one line", async () => {
    const m = await measure(320);
    expect(m.buttonHeight, "Download is no longer the slimmer of the two").toBeLessThan(m.walletHeight);
    // A single line of text-xs in a py-2 pill. Taller means the label wrapped.
    expect(m.buttonHeight).toBeLessThan(40);
    expect(m.label).toBe("Download card (PNG)");
  }, 120_000);
});
