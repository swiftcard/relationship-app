import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { launchBrowser, appCss } from "./harness";

import SwiftLinkLivePreview from "@/components/SwiftLinkLivePreview";

// ── Regression lock: the live preview must never render invisibly ────────────
//
// Aug 2026, found by the owner: "See how your Swift Links page would look" opened,
// took input, updated state — and showed nothing. CardScaler's outer div is
// w-full + contain:size, so it contributes ZERO intrinsic width by design; the
// preview's frame had no width class, and inside the mini-builder modal's
// CENTERED FLEX column a width-less div shrink-wraps its (zero-width) content.
// Frame 0×0 → scaler measures 0 → scale 0 → opacity 0. The preview rendered
// perfectly, invisibly, for ~12 days. No HTTP check can see this: the SSR HTML
// always contained the markup — only real layout exposes it.
//
// The frame's width is pure CSS (no effects involved), so static markup in the
// harness reproduces the collapse exactly: with w-full the frame fills the
// column; without it, it collapses to 0. If someone removes that class — or
// reintroduces the pattern anywhere in this component — this fails loudly.

const PREVIEW_PROPS = {
  name: "Alex Morgan",
  handle: "alex-morgan",
  company: "Morgan & Co.",
  bio: "Top realtor in Miami",
  socials: { instagram: "alexmorgan" },
  links: [{ label: "Leave a review", url: "https://example.com" }],
  paid: true,
} as const;

// The mini-builder modal's real preview slot: a centered flex column (measured
// live at ~383px with an inner w-full flex items-center justify-center row).
// This is the exact context that collapsed the width-less frame.
function modalContext(markup: string, columnWidth: number): string {
  return `<div style="width:${columnWidth}px" class="flex relative flex-col items-center justify-center p-6">
            <div class="w-full flex items-center justify-center mt-4">${markup}</div>
          </div>`;
}

describe("SwiftLinkLivePreview frame takes real width in the modal's flex context", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  async function frameWidthIn(wrapperHtml: string): Promise<{ frame: number; holder: number }> {
    const css = await appCss();
    const page = await browser.newPage({ viewportSize: { width: 800, height: 900 } });
    try {
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
         <style>body{margin:0;padding:20px;background:#0b0d14}</style>
         </head><body class="sc-app">${wrapperHtml}</body></html>`,
        { waitUntil: "load" },
      );
      return await page.evaluate(() => {
        const frame = document.querySelector("[data-preview-locked]") as HTMLElement;
        if (!frame) throw new Error("no preview frame in rendered output");
        return {
          frame: Math.round(frame.getBoundingClientRect().width),
          holder: Math.round((frame.parentElement as HTMLElement).getBoundingClientRect().width),
        };
      });
    } finally {
      await page.close();
    }
  }

  it("fills the centered flex column instead of shrink-wrapping to 0 (the shipped bug)", async () => {
    const markup = renderToStaticMarkup(createElement(SwiftLinkLivePreview, PREVIEW_PROPS));
    const { frame } = await frameWidthIn(modalContext(markup, 383));
    // 383px column minus p-6 padding (24px × 2) = 335. Anything near zero is
    // the collapse; anything close to the column is health. The generous floor
    // keeps font/rounding variance irrelevant — the failure mode is 0, not 300.
    expect(frame).toBeGreaterThan(250);
  }, 60_000);

  it("also fills a plain block container (the card editor / wizard context)", async () => {
    const markup = renderToStaticMarkup(createElement(SwiftLinkLivePreview, PREVIEW_PROPS));
    const { frame } = await frameWidthIn(`<div style="width:340px">${markup}</div>`);
    expect(frame).toBeGreaterThan(300);
  }, 60_000);
});
