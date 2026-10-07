import { DEFAULT_TIMEZONE, localHour } from "@/lib/push-policy";

// ── The one "getting started" push ──────────────────────────────────────────
//
// Owner, 2026-10-06 notification audit: a brand-new account whose card nobody
// has opened used to never hear from SwiftCard again — every push in the
// product is triggered by someone else touching the card, so a card that was
// never shared stays silent forever, and so does the app.
//
// This is the single exception to "no owner-initiated pushes"
// (lib/push-policy.ts), and it is fenced in on every side:
//   - ONCE EVER per account (push_log outcome ACTIVATION_MARK, written before
//     sending, never expires)
//   - only between 48 hours and 7 days after signup — never sent to the
//     existing base the day it ships
//   - only if NONE of their cards (or Swift Links) has a single view
//   - 10am–7pm in their own zone
//   - positive and actionable: how to share, never "nobody has seen your card"
//   - every plan; it opens the QR screen, where sharing actually happens

export const ACTIVATION_MARK = "activation";
export const ACTIVATION_MIN_AGE_MS = 48 * 3600 * 1000;
export const ACTIVATION_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
export const ACTIVATION_FROM_HOUR = 10;
export const ACTIVATION_UNTIL_HOUR = 19;

export const ACTIVATION_COPY = {
  title: "Your card is ready",
  body: "Show your QR at your next meeting — it takes two seconds.",
} as const;

/** Old enough to have had a chance, young enough to still be getting started. */
export function inActivationWindow(createdAt: string | null | undefined, now: number): boolean {
  const at = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  return age >= ACTIVATION_MIN_AGE_MS && age <= ACTIVATION_MAX_AGE_MS;
}

/** A good hour to suggest sharing — the working day in their own zone. */
export function isActivationHour(now: number, timezone: string | null | undefined): boolean {
  const h = localHour(now, timezone || DEFAULT_TIMEZONE) % 24;
  return h >= ACTIVATION_FROM_HOUR && h < ACTIVATION_UNTIL_HOUR;
}
