"use client";

import { useEffect } from "react";
import { useCardQrStyle } from "@/lib/use-card-qr-style";
import { contactQrColors } from "@/lib/contact-qr";

/** localStorage key read by public/offline.html. Person-scoped: cleared on sign-out (lib/account-state.ts). */
export const OFFLINE_CARD_KEY = "sc_offline_card";

type Code = { count: number; bits: string; bg: string; fg: string };

/** The code's module grid (lib/qr-bits.ts), loaded only once the dashboard is idle. */
async function encode(text: string, bg: string, fg: string): Promise<Code | null> {
  try {
    const { qrBits } = await import("@/lib/qr-bits");
    return { ...qrBits(text), bg, fg };
  } catch {
    return null;
  }
}

/**
 * Keeps the owner's card QR codes on this device for the no-signal screen
 * (public/offline.html), the web and Android twin of the iPhone app's native
 * offline screen. Stores the module grid, not a picture: a few hundred bytes
 * per code, drawn on that screen with MiniQR's exact look. Renders nothing.
 */
export default function OfflineOwnerSnapshot({ name, company, url, contactPayload }: {
  name: string;
  company: string;
  /** The link QR's URL, exactly as Show QR encodes it. */
  url: string;
  contactPayload?: string;
}) {
  const qr = useCardQrStyle(true);

  useEffect(() => {
    let cancelled = false;
    const write = async () => {
      const contactColors = contactQrColors(qr.bg, qr.fg);
      const [link, contact] = await Promise.all([
        encode(url, qr.bg, qr.fg),
        contactPayload ? encode(contactPayload, contactColors.bg, contactColors.fg) : Promise.resolve(null),
      ]);
      if (cancelled || !link) return;
      const next = JSON.stringify({ v: 1, name, company, url, link, contact });
      try {
        if (localStorage.getItem(OFFLINE_CARD_KEY) !== next) localStorage.setItem(OFFLINE_CARD_KEY, next);
      } catch { /* storage blocked: the offline screen just shows no card */ }
    };
    // After the dashboard has settled: none of this is urgent.
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    let timer = 0;
    if (w.requestIdleCallback) w.requestIdleCallback(() => void write());
    else timer = window.setTimeout(() => void write(), 1500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [name, company, url, contactPayload, qr.bg, qr.fg]);

  return null;
}
