"use client";

import { createContext, useContext, type ReactNode } from "react";

// ── How a MiniQR is put on the page ─────────────────────────────────────────
//
// "inline" (the default, everywhere in the product): the code is an inline
// <svg>, so the Show QR popup, "Download QR (PNG)" and the share-preview
// capture can read the drawing straight out of the DOM.
//
// "img": the same code as <img src="/api/qr?…">, a cached SVG file. For the
// marketing pages only, where a card is a picture of the product: the
// homepage carried 25 cards' worth of inline QR path data — 1.9 MB of its
// 2.4 MB HTML (SEO audit, 2026-10-14) — for codes nobody scans off a demo.
// As files they are fetched off the critical path, cached for a year, and
// cost the HTML one tag each.

export type QrRenderMode = "inline" | "img";

const QrRenderModeContext = createContext<QrRenderMode>("inline");

/** Every MiniQR below this renders as a cached <img> instead of inline SVG. */
export function QrAsImages({ children }: { children: ReactNode }) {
  return <QrRenderModeContext.Provider value="img">{children}</QrRenderModeContext.Provider>;
}

export const useQrRenderMode = (): QrRenderMode => useContext(QrRenderModeContext);
