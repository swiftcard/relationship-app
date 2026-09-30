"use client";

import { useRef } from "react";
import { MiniQR } from "@/components/card-templates/MiniQR";
import { useCardQrStyle } from "@/lib/use-card-qr-style";
import { detectNativeApp, useIsNativeApp } from "@/lib/platform";

const PNG_PX = 1024;

/**
 * "Download QR (PNG)": the same code the card carries — same rounded
 * drawing, same colours — rendered at 1024px for print. The hidden MiniQR
 * below is the source; its SVG is rasterised on a canvas at download time.
 */
export default function QRDownloadButton({ url, compact = false }: { url: string; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // In the app the tap shares the card LINK (see download below), so the
  // label must not promise a PNG. useIsNativeApp is false until after mount,
  // so server HTML and first paint agree.
  const native = useIsNativeApp();
  const qr = useCardQrStyle();

  async function download() {
    // Native shell: a canvas data-URL download can't be saved by WKWebView, so
    // fall back to the native share sheet with the card link the QR encodes —
    // the recipient gets the same destination, just as a link.
    if (detectNativeApp()) {
      try {
        const { Share } = await import("@capacitor/share");
        await Share.share({ url });
        return;
      } catch { /* fall through to the canvas download */ }
    }
    const tile = containerRef.current?.querySelector<HTMLElement>("[data-qr]");
    const svg = tile?.querySelector("svg");
    if (!tile || !svg) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = PNG_PX;
      canvas.height = PNG_PX;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // The tile: background colour, rounded corners, then the code inside
      // the same padding MiniQR uses (5.5%).
      const radius = PNG_PX * 0.1;
      ctx.fillStyle = qr.bg;
      ctx.beginPath();
      ctx.roundRect(0, 0, PNG_PX, PNG_PX, radius);
      ctx.fill();
      const pad = PNG_PX * 0.055;
      const inner = PNG_PX - pad * 2;
      const xml = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, pad, pad, inner, inner); resolve(); };
        img.onerror = () => reject(new Error("svg"));
        img.src = objectUrl;
      });
      URL.revokeObjectURL(objectUrl);
      const link = document.createElement("a");
      link.download = "swiftcard-qr.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch { /* nothing to save — the button simply stays */ }
  }

  return (
    <>
      <div ref={containerRef} className="hidden" aria-hidden="true">
        <MiniQR size={PNG_PX} bg={qr.bg} fg={qr.fg} url={url} />
      </div>
      <button
        onClick={download}
        className={
          compact
            ? "w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full py-2 transition-colors"
            : "w-full border border-gray-700 text-gray-300 hover:border-blue-500 hover:text-white font-semibold py-3 px-6 rounded-full transition-colors text-sm text-center"
        }
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
        {native ? "Share QR link" : "Download QR (PNG)"}
      </button>
    </>
  );
}
