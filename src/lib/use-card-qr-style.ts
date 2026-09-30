"use client";
import { useEffect, useState } from "react";

/** SwiftCard's own QR colours, used wherever no card is on screen. */
export const BRAND_QR = { bg: "#ffffff", fg: "#0d1b3e" };

/**
 * The colours of the QR printed on the card currently on screen — so the Show
 * QR popup, the PNG download and "Other ways to share" show the SAME code
 * the card carries (owner, 2026-09-30: "it copies the design of the QR code
 * on their card"). Every template's QR is a MiniQR, and MiniQR labels itself
 * with data-qr-bg / data-qr-fg, so this reads the card's real, final choice —
 * including a custom design — without re-deriving any template's palette.
 * Falls back to the brand colours when no card is rendered (the "card is
 * live" screens, /welcome).
 */
export function useCardQrStyle(enabled = true): { bg: string; fg: string } {
  const [style, setStyle] = useState(BRAND_QR);
  useEffect(() => {
    if (!enabled) return;
    const read = () => {
      const el = document.querySelector<HTMLElement>("[data-qr][data-qr-bg][data-qr-fg]");
      const bg = el?.dataset.qrBg;
      const fg = el?.dataset.qrFg;
      if (bg && fg) setStyle((s) => (s.bg === bg && s.fg === fg ? s : { bg, fg }));
    };
    read();
    // The card preview renders after its templates load (dynamic imports), so
    // watch for it rather than reading once and missing it.
    const mo = new MutationObserver(read);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-qr-bg", "data-qr-fg"] });
    return () => mo.disconnect();
  }, [enabled]);
  return style;
}
