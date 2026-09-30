"use client";

import { useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { detectNativeApp, useIsNativeApp } from "@/lib/platform";

export default function QRDownloadButton({ url, compact = false }: { url: string; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // In the app the tap shares the card LINK (see download below), so the
  // label must not promise a PNG. useIsNativeApp is false until after mount,
  // so server HTML and first paint agree.
  const native = useIsNativeApp();

  async function download() {
    // Native shell: a canvas data-URL download can't be saved by WKWebView, so
    // fall back to the native share sheet with the card link the QR encodes —
    // a working, app-like action instead of a dead tap. Web keeps the PNG
    // download (detectNativeApp() is false there).
    if (detectNativeApp()) {
      try {
        const { Share } = await import("@capacitor/share");
        await Share.share({ url });
        return;
      } catch { /* fall through to the canvas download */ }
    }
    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "swiftcard-qr.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <>
      {/* Hidden high-res canvas for download */}
      <div ref={containerRef} className="hidden">
        <QRCodeCanvas value={url} size={512} level="H" bgColor="#ffffff" fgColor="#0d1b3e" />
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
