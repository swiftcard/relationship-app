import type { getAdminSupabase } from "@/lib/supabase-admin";
import { DROPPED_OLD_CAPTURES, SHARE_CAPTURES_TRUSTED_SINCE } from "@/lib/share-capture-version";

type Admin = ReturnType<typeof getAdminSupabase>;

// ── Is the stored picture at <slug>.png really THIS card's? ──────────────────
//
// card-shares/<slug>.png and card-signatures/<slug>.png are keyed by ADDRESS,
// and an address can belong to a different card later: a deleted card's slug
// re-registered by someone else, an old address one card gave up and another
// took. Cleanup on release (lib/release-slug) removes those files, but it is
// best-effort — and a leftover picture of the PREVIOUS card (their name, phone,
// headshot) served on the new owner's link previews and email signature is
// exactly the cross-account bleed this must never allow (isolation audit
// 2026-09-24).
//
// So the picture is trusted only when it was written AFTER the card that holds
// the address now was created. Anything older, or anything we can't date,
// falls through to the live render, which always draws the current card.
export async function storedCaptureIsCurrent(
  admin: Admin,
  bucket: "card-shares" | "card-signatures",
  slug: string,
): Promise<boolean> {
  try {
    const [{ data: card }, { data: files, error }] = await Promise.all([
      admin.from("cards").select("created_at").eq("username", slug).maybeSingle(),
      admin.storage.from(bucket).list("", { search: slug, limit: 20 }),
    ]);
    if (error) return false;
    const file = (files ?? []).find((f) => f.name === `${slug}.png`);
    if (!file) return false;
    const written = Date.parse(String(file.updated_at ?? file.created_at ?? ""));
    // An old share capture that is KNOWN to have dropped the logo or name
    // (lib/share-capture-version) is set aside until its verified re-capture;
    // every other old capture is the card exactly and keeps serving.
    if (bucket === "card-shares" && DROPPED_OLD_CAPTURES.has(slug.toLowerCase()) && !(written >= SHARE_CAPTURES_TRUSTED_SINCE)) return false;
    // A legacy profile-card has no cards row; its address never changes hands.
    if (!card?.created_at) return true;
    const born = Date.parse(String(card.created_at));
    return Number.isFinite(written) && Number.isFinite(born) && written >= born;
  } catch {
    return false;
  }
}
