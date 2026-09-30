"use client";

import { MiniQR } from "@/components/card-templates/MiniQR";
import { useCardQrStyle } from "@/lib/use-card-qr-style";

/**
 * The QR inside "Other ways to share" (desktop): the card's own code, same
 * colours as the one printed on the card, on nothing but a soft shadow.
 * The navy poster with a logo and a wave that used to frame it is gone —
 * the code IS the design now (owner, 2026-09-30).
 */
export default function QRCard({ url }: { url: string }) {
  const qr = useCardQrStyle();
  return (
    <div className="flex flex-col items-center py-2">
      <div style={{ filter: "drop-shadow(0 12px 28px rgba(0,0,0,0.35))" }}>
        <MiniQR size={240} bg={qr.bg} fg={qr.fg} url={url} />
      </div>
      <p className="text-gray-400 text-xs font-medium mt-3">Scan to connect</p>
    </div>
  );
}
