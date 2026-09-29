"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The owner's card, full screen and SIDEWAYS, for handing the phone to someone
// (owner, 2026-09-29). Replaces the dashboard's "Scan to connect (QR)" button:
// tap the card, turn the phone, and the person in front of you scans the QR
// that every template prints bottom-right of the card itself.
//
// Sideways by ROTATION, not by asking the device to rotate. The iOS app and
// most phones with rotation lock never report a landscape viewport, so the card
// is turned 90° inside a portrait screen. When the viewport IS already
// landscape (rotation unlocked, phone turned) the card is shown upright
// instead — either way it reads the right way up once the phone is sideways.
//
// Everything lives in one "stage" the size of the landscape screen: the card
// is centred in it at the largest scale that fits, and the close button sits
// in the stage's top-right corner, so turning the stage turns the button with
// the card and it is always top-right for the person holding the phone.
//
// Portaled to <body>: CardPreviewDownload scales the card node a few levels up,
// and an ancestor transform would cage a position:fixed overlay inside the
// panel. z-[10001] sits above the guided tour (masks z-[9998], tooltip
// z-[10000]), whose "Your SwiftCard" step invites exactly this tap.

/** Room kept clear at each END of the card — the close button and, turned
 *  sideways, the notch / Dynamic Island and the home indicator live here. */
const END_GAP = 64;
/** Room kept clear along the card's long edges. */
const SIDE_GAP = 24;

export default function CardFullscreen({
  width,
  onClose,
  children,
}: {
  /** The card's natural (unscaled) width — the width `children` render at. */
  width: number;
  onClose: () => void;
  /** The card, rendered at `width`. */
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const [cardH, setCardH] = useState(0);

  // The screen, re-read on every resize — turning a rotation-unlocked phone
  // swaps the two sides, and the stage must follow.
  useEffect(() => {
    const read = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);

  // The card's own height at its natural width. Templates differ slightly,
  // so it is measured rather than assumed.
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const read = () => setCardH(node.offsetHeight);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // Read through a ref so a parent re-render (a new onClose each time) never
  // re-runs the open/close bookkeeping below mid-display.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Escape closes it; the page behind does not scroll while it is up; focus
  // goes to the close button and comes back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      root.style.overflow = prevOverflow;
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  const portrait = !!viewport && viewport.h > viewport.w;
  const long = viewport ? Math.max(viewport.w, viewport.h) : 0;
  const short = viewport ? Math.min(viewport.w, viewport.h) : 0;
  const scale = viewport && cardH
    ? Math.max(0, Math.min((long - END_GAP * 2) / width, (short - SIDE_GAP * 2) / cardH))
    : 0;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your card, full screen"
      className="fixed inset-0 z-[10001] bg-black overflow-hidden"
    >
      {/* The landscape stage: long side across, turned 90° on a portrait
          screen. Centred on the viewport, so the turn happens in place. */}
      <div
        className="absolute left-1/2 top-1/2 flex items-center justify-center"
        style={{
          width: long,
          height: short,
          transform: `translate(-50%, -50%)${portrait ? " rotate(90deg)" : ""}`,
        }}
      >
        <div
          className="overflow-hidden rounded-2xl"
          style={{ width: width * scale, height: cardH * scale, opacity: scale ? 1 : 0 }}
        >
          <div
            ref={cardRef}
            className="pointer-events-none"
            style={{ width, transform: `scale(${scale})`, transformOrigin: "top left" }}
          >
            {children}
          </div>
        </div>

        {/* Top-right of the stage. Turned, the stage's right edge is the
            phone's BOTTOM, so the offset clears the home indicator there;
            upright it clears the landscape notch side instead. */}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 border border-white/20 text-white text-2xl leading-none flex items-center justify-center transition-colors"
          style={portrait
            ? { top: 14, right: "calc(14px + env(safe-area-inset-bottom, 0px))" }
            : { top: "calc(14px + env(safe-area-inset-top, 0px))", right: "calc(14px + env(safe-area-inset-right, 0px))" }}
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}
