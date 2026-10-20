// ── Which card captures the share preview may serve ──────────────────────────
//
// A capture is a picture of the card taken on the owner's device
// (ShareCardCapture) and served as the link preview. Before version 8 nothing
// checked the PIXELS, and WebKit routinely painted the card before its logo or
// name had decoded — production held captures with the logo slot empty
// (2026-10-06). Version 8 rejects any capture where the name, logo or photo
// didn't paint (lib/capture-verify).
//
// An upload that doesn't declare this version is refused, so every NEW
// picture is a verified one.
//
// The older pictures are NOT distrusted wholesale. That was tried for an
// afternoon (2026-10-06) and every link went out as the server-drawn
// stand-in, which has the right name and logo but not the card's design —
// "the card preview on the card link has to look exactly like the card. Every
// little detail. It was like that before but randomly here and there it would
// just miss something like a logo." (owner). The old pictures ARE the card,
// exactly; only the ones that actually dropped something are set aside.
// scripts/qa-share-preview.mjs compared every live card's picture with the
// real card that day and found exactly the two below. Each is ignored only
// while its picture predates SHARE_CAPTURES_TRUSTED_SINCE, so the first
// verified re-capture brings it straight back. Anything the nightly check
// finds later goes here the same way.
//
// Import-free on purpose: the browser capture imports it too.

// 9 = square corners, no drop shadow: the picture is the card edge to edge,
// so a messenger's own rounding never shows page-colour wedges (2026-10-06).
// 10 = every font at the card's real size: html-to-image had been rounding
// each one down, so the details came out 4–8% small (lib/capture-exact,
// 2026-10-07). Older pictures keep serving until the device retakes them.
// 11 = no row wraps in the picture that doesn't wrap on the card: rows fill
// their box exactly, and drawn a hair wider the email broke onto a second
// line over the row below (lib/capture-exact, 2026-10-20).
export const SHARE_CAPTURE_VERSION = 11;
// The moment the pixel-verified capture (v8, 5633d26a) went live: its Vercel
// deploy turned READY at 18:35:50Z. It was first set to 20:00Z, a guess in
// the FUTURE, so a verified re-capture taken at 19:27Z was ignored and the
// owner's shared link still showed the stand-in.
export const SHARE_CAPTURES_TRUSTED_SINCE = Date.parse("2026-10-06T18:36:00Z");
export const DROPPED_OLD_CAPTURES: ReadonlySet<string> = new Set([
  "aaronlavi-nadlanhomesllc", // logo slot empty
  "aaronlavi-malvecapital",   // logo slot empty
]);

// Captures stored AFTER the trust date that the nightly check still found
// missing something, each with the moment the fix for it went live. A capture
// written before that moment is set aside — the stand-in serves, and the
// owner's device, told it is stale, retakes it — and the first capture after
// it serves again.
// 2026-10-11: two empty rings where the logo and the headshot belonged. The
// pixel check took a picture's own ring for the picture (lib/capture-verify),
// fixed in 93eca35f, live 2026-10-12 16:27Z.
export const RETAKE_CAPTURES_AFTER: Readonly<Record<string, number>> = {
  "jordankhani-douglaselliman": Date.parse("2026-10-12T16:27:00Z"),
};

// The email signature's capture (EmailSignatureBox). 1 = pixel-verified like
// the share preview — the name, logo and headshot must be IN the picture
// (lib/capture-verify) — and sent with this number. The signature image is
// hot-linked from every email the person ever sent, so the route refuses
// anything older: a stale tab's unverified capture replaced the good one
// everywhere at once (audit C02-002, C02-010).
// 2 = a line the card shows unwrapped stays unwrapped in the picture: rows
// that fill their box exactly wrapped when drawn a hair wider ("MOBILE" over
// the email, lib/capture-exact, 2026-10-20).
export const SIGNATURE_CAPTURE_VERSION = 2;
