"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // updateViaCache "none": a new sw.js is picked up on the next visit,
    // never held back by the HTTP cache.
    const register = () => navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
    // After the page has loaded, not during it: installing the worker fetches
    // the offline page and precaches, which on a first visit — someone who just
    // scanned a card on a phone — competed with the page they came for
    // (perf audit 2026-10-06). Nothing needs the worker before `load`.
    if (document.readyState === "complete") { register(); return; }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
