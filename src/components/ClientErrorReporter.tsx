"use client";

import { useEffect } from "react";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-reload";

// Catches runtime errors that happen in the BROWSER — uncaught exceptions in
// event handlers, unhandled promise rejections, resource failures — which React
// error boundaries never see. Reports them to /api/client-error so a glitch any
// user hits is visible to the team instead of silent. Deliberately conservative:
// an ignore-list drops non-actionable browser/extension noise, and a per-load
// cap means one broken component can never flood the alert channel.

// Noisy, non-actionable messages we never want to alert on.
const IGNORE = [
  /ResizeObserver loop/i,        // benign layout notification, not an error
  /^Script error\.?$/i,          // cross-origin script, zero detail — unactionable
  /Load failed/i,                // Safari's "offline / blocked resource"
  /Failed to fetch/i,            // offline / ad-blocker / cancelled request
  /NetworkError/i,
  /AbortError/i,                 // intentionally cancelled fetches
  /chrome-extension:\/\//i,      // browser extensions, not our code
  /moz-extension:\/\//i,
];

export default function ClientErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const MAX_PER_LOAD = 8;

    const report = (context: string, message: string, stack?: string) => {
      const msg = (message || "").trim();
      if (!msg || sent >= MAX_PER_LOAD) return;
      if (IGNORE.some((re) => re.test(msg))) return;
      sent++;
      try {
        // keepalive lets the report finish even if the page is navigating/unloading.
        fetch("/api/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context, message: msg, stack: stack ?? "", url: location.origin + location.pathname }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* reporting must never throw */
      }
    };

    // A chunk that 404s after a deploy is not a bug to file, it is a page from
    // the previous deployment: reload it once (lib/chunk-reload). Checked
    // before the ignore-list, which would drop Chrome's "Failed to fetch
    // dynamically imported module" as network noise.
    const recovered = (err: unknown, stack?: string): boolean => {
      if (!isChunkLoadError(err)) return false;
      // Filed either way, reworded so the ignore-list doesn't swallow Chrome's
      // wording. "chunk.reload" is a deploy doing its normal thing;
      // "chunk.missing" means the reload already happened and the chunk is
      // still gone, which is a real fault.
      const msg = typeof err === "string" ? err : (err as { message?: string })?.message || "chunk load";
      report(recoverFromChunkError() ? "chunk.reload" : "chunk.missing", msg.replace(/Failed to fetch/i, "Could not fetch"), stack);
      return true;
    };

    const onError = (e: ErrorEvent) => {
      if (recovered(e.error ?? e.message, e.error?.stack)) return;
      report("window.error", e.message || String(e.error ?? "unknown"), e.error?.stack);
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | string | undefined;
      if (recovered(r, typeof r === "object" ? r?.stack : undefined)) return;
      const message = typeof r === "string" ? r : r?.message || String(r ?? "unhandled rejection");
      report("unhandledrejection", message, typeof r === "object" ? r?.stack : undefined);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
