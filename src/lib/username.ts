import { getAdminSupabase } from "@/lib/supabase-admin";
import { normalizeSlug, isReservedSlug } from "@/lib/slug";
import { slugHeldAsAlias } from "@/lib/slug-alias";

// ── Public card slug (username) uniqueness ───────────────────────────────────
// A card's `username` is only the public URL slug (/<username>) — it is NOT
// the account's identity. Identity is the email / auth user; the account handle
// (profiles.username) is already email-derived and unique. So a slug collision
// (two people named "Aaron Lavi" at "Malve Capital", or the same person's second
// card) must NEVER block card creation — we just pick the next free variant.
//
// A slug is "taken" if any CARD uses it OR any account handle (profiles.username)
// uses it, since the public /<username> route resolves against both.

// Re-exported from the pure @/lib/slug module (no server deps) so client code
// and this server module share ONE normalizer — the slug a user is shown while
// creating/editing a card is exactly what gets saved.
export { normalizeSlug };

type Admin = ReturnType<typeof getAdminSupabase>;

/**
 * Is this slug already in use by EITHER a card or a profile?
 *
 * Card slugs and profile handles share one public namespace (/<slug>
 * resolves against both), so checking only one table is not a check. Exported
 * because the admin create-card route was doing exactly that — see the comment
 * at its call site.
 */
export async function slugTaken(admin: Admin, slug: string): Promise<boolean> {
  // Card pages live at the ROOT since 2026-08-19, so an app route name is
  // permanently "taken" — a card at /pricing would be unreachable.
  if (isReservedSlug(slug)) return true;
  const [{ data: card }, { data: profile }, heldAsAlias] = await Promise.all([
    admin.from("cards").select("id").eq("username", slug).limit(1).maybeSingle(),
    admin.from("profiles").select("id").eq("username", slug).limit(1).maybeSingle(),
    // A card's OLD address (customization._prevSlugs) still redirects to that
    // card, so it is not free: a new card given it would receive the other
    // owner's QR scans, NFC taps and shared links.
    slugHeldAsAlias(admin, slug),
  ]);
  return !!card || !!profile || heldAsAlias;
}

export type SlugAvailability = "available" | "current" | "taken" | "reserved" | "invalid" | "error";

/**
 * Can THIS card take this URL? The live check behind the card URL editor
 * (owner, 2026-11-12: "if a username is taken and a user puts in that
 * username, it won't let them save it and it'll say it's taken already").
 *
 * Exactly the rules the save enforces — the rename route (reserved names,
 * another card's old address) plus rename_card_slug (any card, any account
 * handle) — so what the editor says while you type is what the save does.
 * A card may take back ITS OWN old address, as the rename allows. The save
 * stays the authority: a lookup that errors here says "error", not
 * "available", and the rename still checks for itself.
 */
export async function slugAvailability(admin: Admin, raw: string, cardId: string): Promise<{ slug: string; status: SlugAvailability }> {
  const slug = normalizeSlug(raw);
  if (!slug) return { slug, status: "invalid" };
  if (isReservedSlug(slug)) return { slug, status: "reserved" };
  try {
    const [card, profile, heldAsAlias] = await Promise.all([
      admin.from("cards").select("id").eq("username", slug).limit(1).maybeSingle(),
      admin.from("profiles").select("id").eq("username", slug).limit(1).maybeSingle(),
      slugHeldAsAlias(admin, slug, cardId),
    ]);
    if (card.error || profile.error) return { slug, status: "error" };
    if (card.data && (card.data as { id: string }).id === cardId) return { slug, status: "current" };
    if (card.data || profile.data || heldAsAlias) return { slug, status: "taken" };
    return { slug, status: "available" };
  } catch {
    return { slug, status: "error" };
  }
}

// Return an available slug based on `base`, appending -2, -3, … then a short
// random suffix if we somehow exhaust the numbered range. Always returns a valid,
// non-empty, ≤60-char slug — never throws, so card creation can't be blocked.
export async function ensureUniqueUsername(base: string, admin: Admin = getAdminSupabase()): Promise<string> {
  let root = normalizeSlug(base);
  if (!root) root = "my-card"; // "card" itself is a reserved route since the root-URL move

  // Leave headroom for the "-<n>" / "-<rand>" suffix within the 60-char cap.
  const MAX_ROOT = 52;
  if (root.length > MAX_ROOT) root = root.slice(0, MAX_ROOT).replace(/-+$/g, "") || "my-card";

  if (!(await slugTaken(admin, root))) return root;

  for (let n = 2; n <= 60; n++) {
    const candidate = `${root}-${n}`;
    if (!(await slugTaken(admin, candidate))) return candidate;
  }

  // Extremely unlikely fall-through — a stable-ish random suffix. Retry a few
  // times in case of a collision; the caller's insert also catches a 23505 race.
  for (let i = 0; i < 5; i++) {
    const rand = Math.floor(Date.now() % 1_000_000).toString(36) + i;
    const candidate = `${root}-${rand}`.slice(0, 60);
    if (!(await slugTaken(admin, candidate))) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`.slice(0, 60);
}
