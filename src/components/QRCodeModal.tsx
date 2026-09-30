"use client";

import { useRef, useState } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";

// qrcode.react only needs to load once a visitor actually opens this modal —
// most card viewers never do, so this keeps it out of the public card page's
// initial bundle (performance audit).
const QRCodeSVG = dynamic(() => import("qrcode.react").then((m) => m.QRCodeSVG), { ssr: false });

type Props = {
  url: string;
  /** Whose card: the popup's title reads "Scan to connect with <firstName>",
      written for the person holding up the OTHER phone. */
  firstName: string;
  /** Button text. */
  label?: string;
  /** "light": the cream outline for a public/marketing surface (default).
      "primary": the dashboard's solid blue — the owner's one-tap Show QR. */
  variant?: "light" | "primary";
};

export default function QRCodeModal({ url, firstName, label = "Show QR Code", variant = "light" }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(open, () => setOpen(false), panelRef);

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
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setOpen(false)}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="qr-modal-title"
            className="w-full max-w-sm rounded-3xl overflow-hidden flex flex-col items-center animate-pop"
            style={{ background: "#0d1b3e" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="w-full flex items-center justify-between px-6 pt-5 pb-2">
              <p id="qr-modal-title" className="text-white font-bold text-base">Scan to connect with {firstName}</p>
              <button
                onClick={() => setOpen(false)}
                className="-mr-3 w-10 h-10 flex items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-white/10 text-2xl leading-none transition-colors"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* QR code — the hero. It fills the panel's width (up to 288px)
                instead of a fixed 220px, so a phone held up across a table
                scans from further away. Plain navy on white, error level M:
                the highest-contrast QR the product draws. */}
            <div className="bg-white rounded-2xl p-5 mx-6 my-4 shadow-xl w-[calc(100%-3rem)] max-w-[328px]">
              <QRCodeSVG
                value={url}
                size={288}
                bgColor="#ffffff"
                fgColor="#0d1b3e"
                level="M"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>

            {/* URL */}
            <p
              className="text-sm font-medium pb-6 px-6 text-center"
              style={{
                background: "linear-gradient(to right, #60a5fa, #a78bfa)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {/* The address as a person would type it — no scheme, and no
                  ?source=qr_code tracking tag (that is for the scan, not for
                  reading aloud). */}
              {url.replace(/^https?:\/\//, "").replace(/[?#].*$/, "")}
            </p>
          </div>

          {/* Tap to close hint — under the card, never pinned to the screen
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
