"use client";

import { useEffect, useRef } from "react";
import { MiniQR } from "@/components/card-templates/MiniQR";
import { useSavePicture } from "@/components/SavePictureSheet";
import { useCardQrStyle } from "@/lib/use-card-qr-style";
import { QR_PNG_PX, renderQrPng } from "@/lib/qr-png";
import { prefersShareSheet } from "@/lib/save-image";

/**
 * "Download QR (PNG)": the same code Show QR shows — same rounded drawing,
 * same colours as the card — rendered at 1024px for print. The hidden MiniQR
 * below is the source; its SVG is rasterised on a canvas (lib/qr-png).
 *
 * It saves a PICTURE everywhere, the app included (lib/save-image). In the app
 * it used to send the card URL under a share-the-link label (owner, 2026-10-06:
 * "That button should be a Download QR PNG").
 */
export default function QRDownloadButton({ url, compact = false }: { url: string; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const qr = useCardQrStyle();
  const { save, sheet } = useSavePicture();
  // Drawn ahead on a phone, so the tap can open the share sheet while iOS
  // still counts it as the tap. Keyed by colour + link, which is the picture.
  const prepared = useRef<{ key: string; png: Promise<Blob> } | null>(null);
  const key = `${qr.bg}|${qr.fg}|${url}`;

  function draw(): Promise<Blob> {
    if (prepared.current?.key === key) return prepared.current.png;
    const svg = containerRef.current?.querySelector<SVGSVGElement>("[data-qr] svg");
    const png = svg ? renderQrPng(svg, qr.bg) : Promise.reject(new Error("no qr"));
    png.catch(() => { if (prepared.current?.png === png) prepared.current = null; });
    prepared.current = { key, png };
    return png;
  }

  useEffect(() => {
    if (prefersShareSheet()) draw().catch(() => {});
    // draw reads the refs; key is everything the picture depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function download() {
    try {
      await save(await draw(), "swiftcard-qr.png");
    } catch { /* nothing to save — the button simply stays */ }
  }

  return (
    <>
      <div ref={containerRef} className="hidden" aria-hidden="true">
        <MiniQR size={QR_PNG_PX} bg={qr.bg} fg={qr.fg} url={url} />
      </div>
      <button
        type="button"
        onClick={download}
        className={
          compact
            ? "w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full py-2 transition-colors"
            : "w-full border border-gray-700 text-gray-300 hover:border-blue-500 hover:text-white font-semibold py-3 px-6 rounded-full transition-colors text-sm text-center"
        }
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
        Download QR (PNG)
      </button>
      {sheet}
    </>
  );
}
