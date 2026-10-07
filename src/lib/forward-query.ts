// ── A redirect must not throw away where the visitor came from ───────────────
//
// The card and Swift Links pages redirect in two cases: a mixed-case URL (308 to
// the lowercase slug) and an old slug from before a rename (308 to the current
// one). Both used to rebuild the query from a hand-picked list — and the alias
// redirect kept nothing at all — so a printed QR (?source=qr_code), an NFC tag
// (?source=nfc_card), a Wallet pass (?source=apple_wallet), the desktop
// save-QR (?save=1) and a per-contact link (?ct=) all lost their meaning the
// moment the card was renamed (2026-10-06 final analytics review).
//
// Every param rides along, first value of a repeated one (the same rule the
// pages apply when they read ?source=).
export function forwardQuery(
  path: string,
  params: Record<string, string | string[] | undefined> | null | undefined,
): string {
  const qs = new URLSearchParams();
  for (const [k, raw] of Object.entries(params ?? {})) {
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (typeof v === "string" && v) qs.set(k, v);
  }
  const q = qs.toString();
  return q ? `${path}?${q}` : path;
}
