// Where a visit came FROM, encoded into the URL a QR carries.
//
// The QR image and the printable QR download once used the bare card URL, so
// every scan of a QR you showed, downloaded or printed was recorded as
// "direct_link" and displayed in Traffic as "Card link" — meaning the QR number
// could only ever read zero no matter how many people scanned it. "qr_code" is
// the canonical key in lib/source-labels ("QR code scan") and is exactly what
// the visitor-facing QR modal on the card page already encodes.
//
// This lives here rather than inline in one component because THREE surfaces now
// render a QR of the same card — the share modal's image, its PNG download, and
// the QR printed on the card in the dashboard's full-screen view. A second copy of the rule is how it
// drifts back to zero.
//
// NFC does its OWN tagging and does not come through here: NFCWriter appends
// "?source=nfc_card" itself, but only when the caller passed no query string of
// its own — so handing it a pre-tagged URL would silently suppress that and
// record every tap as a QR scan. Pass NFCWriter the PLAIN url.
// (An older comment here claimed NFC was left untagged entirely. It wasn't —
// see NFCWriter's tagUrl.)

/** Append a traffic-source marker, preserving any existing query string. */
export function withSource(url: string, source: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}source=${source}`;
}

/** The card URL exactly as a QR code should encode it. */
export function qrScanUrl(url: string): string {
  return withSource(url, "qr_code");
}
