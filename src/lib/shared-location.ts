// ── A location the visitor CHOSE to share ────────────────────────────────────
//
// Feature 4 (owner, 2026-10-18). Unlike every other place in analytics, this
// one is not a guess from an IP address: it is the phone's own GPS fix, sent
// only because the person tapped "Add my current location" on a share form and
// then allowed it when their phone asked (components/ShareLocationToggle).
// It belongs to one contact and is read only on Pro.
//
// Client-safe: the Contacts page uses the label and the map link, api/leads
// the parser.

export type SharedPoint = { lat: number; lng: number; accuracy: number };

/** Past this a phone is guessing from Wi-Fi or a tower — not worth calling exact. */
export const MAX_SHARED_ACCURACY_M = 2000;

/**
 * The body's shared_location, or null. A public endpoint: anything that is not
 * a real point on Earth with a believable radius is dropped, never stored.
 */
export function parseSharedLocation(v: unknown): SharedPoint | null {
  if (!v || typeof v !== "object") return null;
  const { lat, lng, accuracy } = v as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lng !== "number" || typeof accuracy !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // Null Island: what a broken fix reports, never where a person is.
  if (lat === 0 && lng === 0) return null;
  if (accuracy <= 0 || accuracy > MAX_SHARED_ACCURACY_M) return null;
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    accuracy: Math.max(1, Math.round(accuracy)),
  };
}

/** "Within about 15 m" — the phone's own radius, said plainly. */
export function sharedAccuracyLabel(accuracyM: number | null | undefined): string | null {
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM <= 0) return null;
  const m = Math.round(accuracyM);
  return m >= 1000 ? `Within about ${(m / 1000).toFixed(1).replace(/\.0$/, "")} km` : `Within about ${m} m`;
}

/**
 * A map link for the point. Apple Maps' web address opens Apple Maps on an
 * iPhone or Mac and a map in the browser everywhere else — no API key, nothing
 * sent anywhere until the owner taps it.
 */
export function sharedMapUrl(lat: number, lng: number, label = "Shared location"): string {
  return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(label)}`;
}
