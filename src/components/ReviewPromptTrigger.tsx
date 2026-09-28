"use client";

import { useEffect } from "react";
import { detectNativeApp } from "@/lib/platform";

// The one place the App Store rating sheet can be requested from, and it is
// deliberately NOT a tap: it runs a few seconds after the dashboard has settled.
// Every rule (a real win first, only after about a week of real use, once per
// 90 days) lives in src/lib/app-review.ts; this only picks a calm moment.
// Renders nothing.
//
// `hasLead` is the server's answer to "has a lead landed on this card?" — a lead
// arrives from another person's phone, so the dashboard is where the owner's
// app first learns of it.

const SETTLE_MS = 4000;

export default function ReviewPromptTrigger({ hasLead }: { hasLead: boolean }) {
  useEffect(() => {
    if (!detectNativeApp()) return;
    const timer = window.setTimeout(() => {
      // Not over something the person is in the middle of: a hidden app, or any
      // open dialog (the guided tour, a sheet, a confirmation).
      if (document.visibilityState !== "visible") return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"], dialog[open]')) return;
      import("@/lib/app-review").then((m) => m.maybeAskForReview({ hasLead })).catch(() => {});
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [hasLead]);
  return null;
}
