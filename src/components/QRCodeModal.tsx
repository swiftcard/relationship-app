"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { useCardQrStyle } from "@/lib/use-card-qr-style";

// The encoder only loads once someone opens the popup — most dashboard visits
// never do — so it stays out of the initial bundle.
const MiniQR = dynamic(() => import("@/components/card-templates/MiniQR").then((m) => m.MiniQR), { ssr: false });

type Props = {
  url: string;
  /** Whose card, for the dialog's spoken name only — nothing is printed. */
  firstName: string;
  /** Button text. */
  label?: string;
  /** "light": the cream outline for a public/marketing surface (default).
      "primary": the dashboard's solid blue — the owner's one-tap Show QR. */
  variant?: "light" | "primary";
};

/**
 * Show QR. The popup is the code and nothing else (owner, 2026-09-30): no
 * title, no address under it, no panel around it — a dimmed screen with the
 * QR tile in the middle, drawn in the same colours as the QR printed on the
 * card on screen, so what the other person scans is exactly what the card
 * carries. Tap anywhere outside it or press Escape to close.
 */
export default function QRCodeModal({ url, firstName, label = "Show QR Code", variant = "light" }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(open, () => setOpen(false), panelRef);
  const qr = useCardQrStyle(open);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={
          variant === "primary"
            ? "w-full flex items-center justify-center gap-2 py-3.5 px-5 rounded-full font-bold text-sm text-white bg-blue-600 hover:bg-blue-500 transition-colors active:scale-[0.98]"
            : "w-full flex items-center justify-center gap-2 py-3 px-5 rounded-full font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] mt-2"
        }
        style={variant === "primary" ? undefined : { background: "#FAF7F2", border: "1px solid #E4DDD4", color: "#475569" }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 14h2v2h-2zM18 14h3v2M21 18v3M17 18h2v3M14 18v3" />
        </svg>
        {label}
      </button>

      {/* Portaled to <body>: ancestors with will-change/transform (e.g. the
          data-reveal scroll wrappers) become the containing block for
          position:fixed and cage the overlay to their own box otherwise. */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-6"
          style={{ background: "rgba(2, 6, 23, 0.88)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
          onClick={() => setOpen(false)}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${firstName}'s QR code — scan to open the card`}
            tabIndex={-1}
            className="animate-pop outline-none"
            // The tile is the card's own QR, only larger: min(78vw, 360px) so a
            // phone held across a table still reads it, and never wider than
            // a hand can hold steady.
            style={{ width: "min(78vw, 360px)", filter: "drop-shadow(0 24px 48px rgba(0,0,0,0.45))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <QRTile url={url} bg={qr.bg} fg={qr.fg} />
          </div>

          {/* Tap to close hint — under the code, never pinned to the screen
              bottom where a tab bar or the home indicator sits. */}
          <p className="mt-4 rounded-full bg-[#0d1b3e] px-3 py-1 text-white/85 text-xs">Tap outside to close</p>
        </div>,
        document.body
      )}

      <style>{`
        @keyframes pop {
          from { transform: scale(0.88); opacity: 0; }
          to   { transform: scale(1);    opacity: 1; }
        }
        .animate-pop { animation: pop 0.2s cubic-bezier(0.34,1.56,0.64,1); }
        @media (prefers-reduced-motion: reduce) { .animate-pop { animation: none; } }
      `}</style>
    </>
  );
}

/** MiniQR sized by its container: it takes a pixel size, so this measures. */
function QRTile({ url, bg, fg }: { url: string; bg: string; fg: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(0);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el && el.clientWidth && el.clientWidth !== px) setPx(el.clientWidth);
      }}
      className="w-full"
      style={{ aspectRatio: "1 / 1" }}
    >
      {px > 0 && <MiniQR size={px} bg={bg} fg={fg} url={url} />}
    </div>
  );
}
