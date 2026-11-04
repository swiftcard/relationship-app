"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import DemoBookingFlow from "./DemoBookingFlow";

// ── The pricing page's "Book a demo" popup ──────────────────────────────────
// Built like site/MiniBuilderModal: portaled to <body> (the plan cards sit in
// transformed reveal-animation ancestors that would trap a fixed overlay), the
// dim + blur on its OWN layer behind the panel (backdrop-filter on a scrolling
// element kills touch scrolling on iOS Safari), and body scroll locked.
//
// Phone: a full-screen sheet that respects the notch and home bar.
// Computer: a 600px panel, centered, never taller than the window; only its
// middle scrolls, so the header and the button stay put.
//
// The fade is on an inner wrapper, never on the [role=dialog] element (the CI
// render job measures dialogs the moment they mount).

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function DemoBookingDialog({ seats, onClose }: { seats?: number | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useDialogA11y(true, onClose, panel);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => setShown(true));
    // Tab and Shift+Tab stay inside the popup.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[94] transition-opacity duration-200 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`}
        style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
        aria-hidden
      />
      <div className="fixed inset-0 z-[95] flex items-stretch sm:items-center justify-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className={`w-full sm:max-w-[600px] h-full sm:h-auto flex transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}>
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-dialog-title"
            // One height on a computer for every step, so the panel never
            // jumps as the steps change; only the middle scrolls.
            className="relative w-full flex flex-col bg-white sm:rounded-[28px] sm:border sm:border-slate-200 shadow-[0_40px_90px_-30px_rgba(15,23,42,0.45)] overflow-hidden h-[100dvh] sm:h-[min(720px,calc(100dvh-48px))]"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <DemoBookingFlow variant="dialog" seats={seats} onClose={onClose} headingId="demo-dialog-title" />
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
