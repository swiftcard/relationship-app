"use client";

import { useEffect } from "react";
import { flushOutbox } from "@/lib/offline-outbox";

/**
 * Delivers what was kept on this phone while it had no signal
 * (lib/offline-outbox.ts): on every page load, the moment the connection comes
 * back, and when the page is looked at again. Mounted once in the root layout,
 * so any later visit to swiftcard.me sends it. Renders nothing.
 */
export default function OfflineOutbox() {
  useEffect(() => {
    const flush = () => { void flushOutbox().catch(() => {}); };
    const onVisible = () => { if (document.visibilityState === "visible") flush(); };
    const first = window.setTimeout(flush, 2000);
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
