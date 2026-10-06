// A PNG of the card exactly as the Your Card box draws it. Shared by the
// "Download" under the card and "Download card (PNG)" in Other ways to share,
// and called ahead of time when that popup opens on a phone (see
// lib/save-image — iOS only lets a share sheet open shortly after the tap).
//
// THE BUG THIS GUARDS (owner, 2026-10-06: "the card is missing the logo, my
// headshot, and other information"). html-to-image draws the card through an
// SVG <foreignObject>, and WebKit — every iPhone, the app included — paints
// that SVG before its pictures and web-font glyphs have decoded. The FIRST
// raster comes back with the logo and headshot simply absent; a second one,
// moments later, has them. Reproduced in Playwright WebKit, where Chromium is
// fine. So: inline and DECODE every image, wait for fonts, never trust the
// first raster, and check the pixels (lib/capture-verify, the same check the
// share preview uses) before anything is saved.

import { capturePainted } from "@/lib/capture-verify";

// Inline every <img> src as a data URL before capturing — html-to-image
// re-fetches images while rasterizing and can drop them otherwise. Falls back
// to the same-origin image proxy when a remote host blocks the direct fetch.
// Each image counts only once it has DECODED (img.decode), which is what
// WebKit needs before it can paint it into the SVG.
async function inlineImages(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll("img"));
  await Promise.all(imgs.map(async (img) => {
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (src && !src.startsWith("data:")) {
      const candidates = [src];
      if (/^https?:\/\//.test(src)) candidates.push(`/api/img-proxy?url=${encodeURIComponent(src)}`);
      for (const url of candidates) {
        try {
          const res = await fetch(url, { cache: "force-cache" });
          if (!res.ok) continue;
          const blob = await res.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onloadend = () => resolve(r.result as string);
            r.onerror = reject;
            r.readAsDataURL(blob);
          });
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = dataUrl;
            setTimeout(resolve, 3000);
          });
          break;
        } catch { /* try next candidate */ }
      }
    }
    try { await img.decode(); } catch { /* broken or empty — the pixel check decides */ }
  }));
}

/** Decoded in place rather than fetch(dataUrl): no network stack, no CSP. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

const SCALE = 3;
const ATTEMPTS = 4;

/**
 * Rasterize the card node at 3×. `name` is the card's name, which the pixel
 * check looks for alongside every picture. Throws rather than hand back a
 * card with something missing.
 */
export async function captureCardPng(el: HTMLElement, name = ""): Promise<Blob> {
  // The card on screen is display-scaled (CardPreviewDownload). It is NOT
  // un-scaled for the capture any more: that made the visible card jump while
  // the popup prepared its picture. The clone gets its own transform below,
  // and the pixel check is told the on-screen width, so its element boxes and
  // the raster line up.
  await inlineImages(el);
  try { await document.fonts?.ready; } catch { /* fonts API absent */ }
  await new Promise((r) => setTimeout(r, 150)); // let reflow settle

  // Same proven recipe as the share/signature captures: html-to-image
  // (handles Tailwind 4's oklch colors, which html2canvas chokes on) with
  // the node rendered natively larger — pixelRatio-only upscaling is blurry.
  const { toPng } = await import("html-to-image");
  const w = el.offsetWidth || 460;
  const h = el.offsetHeight || 263;
  const shownW = el.getBoundingClientRect().width || w;
  const raster = () => Promise.race([
    toPng(el, {
      width: w * SCALE,
      height: h * SCALE,
      pixelRatio: 1,
      cacheBust: false,
      style: { transform: `scale(${SCALE})`, transformOrigin: "top left" },
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 20000)),
  ]);

  // The first raster primes WebKit's decode and is never the one saved.
  await raster().catch(() => null);
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt));
    const dataUrl = await raster().catch(() => null);
    if (!dataUrl || dataUrl.length < 5000) continue;
    if (await capturePainted(el, name, dataUrl, shownW, raster)) return dataUrlToBlob(dataUrl);
  }
  throw new Error("incomplete capture");
}
