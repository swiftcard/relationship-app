"use client";

import { createContext, useContext, useEffect, useState, type ReactNode, type RefObject } from "react";

// Lets a panel OUTSIDE the card's own box offer "download this card as a PNG".
//
// The capture reads a live DOM node, and that node is owned by
// CardPreviewDownload in the Your Card box. "Other ways to share" is a sibling
// box, so it has no way to reach it — hence this.
//
// SCOPE THIS TIGHTLY. The dashboard renders its card panel TWICE (a lg:hidden
// copy under My Cards and a hidden lg:flex copy in the sticky right column);
// both are always in the DOM with one display:none. One provider around the
// whole page would let whichever card registered LAST win, and capturing a
// display:none node yields a blank PNG. Wrapping each copy separately gives
// each its own ref, so a modal always captures the card sitting next to it.

export type CardCapture = {
  /** The live card node the PNG capture rasterizes. */
  cardRef: RefObject<HTMLDivElement | null>;
  filename: string;
  /** The card's name: the PNG is checked for it, and for every picture. */
  name?: string;
};

type Store = { capture: CardCapture | null; register: (c: CardCapture | null) => void };

const Ctx = createContext<Store | null>(null);

export function CardCaptureProvider({ children }: { children: ReactNode }) {
  const [capture, setCapture] = useState<CardCapture | null>(null);
  return <Ctx.Provider value={{ capture, register: setCapture }}>{children}</Ctx.Provider>;
}

/**
 * Publish the live card node so sibling panels can offer a PNG of it.
 * A no-op outside a provider, so the component stays usable on its own.
 */
export function useRegisterCardCapture(capture: CardCapture): void {
  const register = useContext(Ctx)?.register;
  const { cardRef, filename, name } = capture;
  useEffect(() => {
    if (!register) return;
    register({ cardRef, filename, name });
    // Unregister on unmount so a consumer can never hold a ref to a card that
    // has left the page — it would capture nothing and look like a dead button.
    return () => register(null);
  }, [register, cardRef, filename, name]);
}

/**
 * null until a card registers. Callers MUST render nothing in that case rather
 * than a dead button: /preview also renders "Other ways to share", and its card
 * is an <iframe> with no capturable node at all.
 */
export function useCardCapture(): CardCapture | null {
  return useContext(Ctx)?.capture ?? null;
}
