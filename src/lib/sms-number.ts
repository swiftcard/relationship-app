// ── Which phone numbers SwiftCard can text ───────────────────────────────────
//
// Client-safe on purpose: lib/messaging imports Twilio and the admin client,
// so the contact screen could not ask it whether a number is textable. That is
// how a contact with a UK number could have a text automation switched on that
// showed "Sends Oct 20" forever — the sender refused the number every day,
// released the step and tried again the next day, and nothing on screen said so.

// The texting program is a US A2P 10DLC campaign, so a text only ever goes to a
// North American (+1) number. Anything else is refused BEFORE Twilio: an
// international premium route costs up to 50x a US text, and "text any number
// in the world from a free account" is the SMS-pumping fraud pattern
// (security audit 2026-09-24). Returns the E.164 form, or null.
export function nanpE164(raw: string | null | undefined): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  let digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) {
    if (!digits.startsWith("1")) return null;
    digits = digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  // NXX-NXX-XXXX: neither the area code nor the exchange starts with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  if (NOT_DOMESTIC_NANP.has(digits.slice(0, 3)) || /^[2-9]11$/.test(digits.slice(0, 3))) return null;
  return `+1${digits}`;
}

// "+1" is not only the US and Canada. These area codes are other countries
// that share the North American plan (the Caribbean, Bermuda), billed as
// international, plus 900 premium-rate. Texting them from a free account is
// the SMS-pumping pattern a +1 check alone lets through. US territories
// (Puerto Rico 787/939, USVI 340, Guam 671, N. Marianas 670, Am. Samoa 684)
// are domestic and stay allowed.
const NOT_DOMESTIC_NANP = new Set([
  "242", "246", "264", "268", "284", "345", "441", "473", "649", "658", "664",
  "721", "758", "767", "784", "809", "829", "849", "868", "869", "876", "900",
]);

// Territories whose clocks sit outside the span the daily run is timed for.
// Automated texts go out once a day at 18:00 UTC, which is 8am-2pm across the
// US mainland, Alaska and Hawaii — and 4am in Guam and the Northern Marianas
// (UTC+10), 7am in American Samoa (UTC-11). No single daily hour reaches them
// inside 8am-9pm, so an automated text to one would break the quiet-hours rule
// the run exists to keep. A person can still text them by hand.
const OUTSIDE_SEND_WINDOW = new Set(["670", "671", "684"]);

/**
 * Can an AUTOMATED text go to this number? A valid domestic +1 number that the
 * daily run reaches inside 8am-9pm local. The contact screen uses it to decide
 * whether Text automation can be switched on; the sender uses it to record a
 * step as not sent instead of retrying a number that will never take one.
 */
export function autoTextable(raw: string | null | undefined): boolean {
  const e164 = nanpE164(raw);
  return !!e164 && !OUTSIDE_SEND_WINDOW.has(e164.slice(2, 5));
}
