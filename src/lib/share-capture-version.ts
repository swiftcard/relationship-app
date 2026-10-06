// ── Which card captures the share preview may serve ──────────────────────────
//
// A capture is a picture of the card taken on the owner's device
// (ShareCardCapture) and served as the link preview. Before version 8 nothing
// checked the PIXELS, and WebKit routinely painted the card before its logo or
// name had decoded — production held captures with the logo slot empty
// (2026-10-06). Version 8 rejects any capture where the name, logo or photo
// didn't paint (lib/capture-verify).
//
// Those older pictures are still in storage, and re-capturing only happens
// when the owner next opens the app. So the server stops trusting them on
// its own: a card-shares capture written before SHARE_CAPTURES_TRUSTED_SINCE
// is ignored (the preview falls back to the rendered stand-in, which draws the
// name and logo itself), and an upload that doesn't declare this version is
// refused. The cutoff sits just after the v8 deploy, so every older capture
// falls before it.
//
// Import-free on purpose: the browser capture imports it too.

export const SHARE_CAPTURE_VERSION = 8;
export const SHARE_CAPTURES_TRUSTED_SINCE = Date.parse("2026-10-06T20:00:00Z");
