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
export const SHARE_CAPTURE_VERSION = 9;
// The moment the pixel-verified capture (v8, 5633d26a) went live: its Vercel
// deploy turned READY at 18:35:50Z. It was first set to 20:00Z, a guess in
// the FUTURE, so a verified re-capture taken at 19:27Z was ignored and the
// owner's shared link still showed the stand-in.
export const SHARE_CAPTURES_TRUSTED_SINCE = Date.parse("2026-10-06T18:36:00Z");
export const DROPPED_OLD_CAPTURES: ReadonlySet<string> = new Set([
  "aaronlavi-nadlanhomesllc", // logo slot empty
  "aaronlavi-malvecapital",   // logo slot empty
]);
