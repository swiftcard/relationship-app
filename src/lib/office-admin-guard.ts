import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { resolveOfficeContext, roleHasCapability, officeOwnerStillOnOffice, type OfficeRole } from "@/lib/office-roles";
import { seedBrandFromOwnersFirstCard } from "@/lib/office-brand";

// ── One gate for every /office/admin page ────────────────────────────────────
// Each page in the portal needs the same three things: the caller is on Office,
// they're allowed in here, and their office row. Doing that once means a new
// page can't accidentally ship without the check.
//
// This is the OFFICE admin. The site-owner console at /admin is a separate,
// ADMIN_EMAILS-gated area that office users must never reach.

export type OfficeAdminCtx = {
  userId: string;
  email: string;
  office: Record<string, unknown> | null; // null = on Office but hasn't created one yet
  officeId: string | null;
  ownerId: string | null;
  role: OfficeRole;
  isOwner: boolean;
  caps: {
    canInvite: boolean;
    canRemove: boolean;
    canBrand: boolean;
    canManageSeats: boolean;
    canManageCards: boolean;
  };
};

// cache(): the layout AND every page under /office/admin call this guard, so
// without request-level memoization the entire chain (auth round trip, profile
// read, office-context resolution, office fetch, brand-seed self-heal) ran
// TWICE per page load — roughly doubling time-to-first-byte for the whole
// admin section. cache() shares one execution across the layout and page
// within a single request; a fresh request always re-runs it, so nothing is
// cached across users or requests.
export const requireOfficeAdmin = cache(async (): Promise<OfficeAdminCtx> => {
  const supabase = await createClient();
  // getClaims verifies the token locally, so getUser()'s round trip joins the
  // batch below instead of standing in front of it — this guard blocks every
  // /office/admin page and its layout.
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");
  const uid = claimsData.claims.sub;

  // Independent lookups (both key on the user id alone) — run together instead
  // of serially. resolveOfficeContext is read-only, so running it speculatively
  // even when the profile check below redirects is harmless.
  const [{ data: { user } }, { data: profile }, ctx] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("plan").eq("id", uid).single(),
    resolveOfficeContext(uid),
  ]);
  if (!user || user.id !== uid) redirect("/login");
  if (!profile) redirect("/onboarding");
  // Deliberately /pricing, NOT /upgrade. The "Item 7" guard test locks this line
  // byte-for-byte AND asserts this file mentions no app-shell detection at all —
  // including in comments — so keep that vocabulary out of here.
  // Rationale: this runs server-side and can't reliably tell which shell the
  // request came from, so the protection lives downstream — /pricing itself
  // client-redirects to /dashboard inside the app shell, so a non-Office user
  // there never sees a selling page (an App Store requirement). Don't "fix" this
  // to match the in-app /upgrade convention without moving that whole contract.
  if (profile.plan !== "enterprise") redirect("/pricing");

  // An Office user with no office yet is the owner-to-be (they'll see the
  // create form). A member without org-analytics access is a plain employee and
  // has no business here.
  const role: OfficeRole = ctx ? ctx.role : "owner";
  if (ctx && !ctx.isOwner && !roleHasCapability(role, "view_org_analytics")) redirect("/dashboard");
  // A manager whose office OWNER is no longer on Office gets nothing either —
  // the console must agree with requireOfficeCapability, which already refuses
  // every office API in that state (2026-10-06 final analytics review).
  if (ctx && !ctx.isOwner && !(await officeOwnerStillOnOffice(ctx.ownerId))) redirect("/dashboard");

  // Reads go through the service-role client: the offices RLS policies are
  // mutually recursive with office_members, so a user-scoped read raises
  // "infinite recursion detected in policy for relation offices". Still pinned
  // to this caller (their own owner_id, or the office their context resolved to).
  const admin = getAdminSupabase();
  const { data: office } = ctx && !ctx.isOwner
    ? await admin.from("offices").select("*, office_members(*)").eq("id", ctx.officeId).maybeSingle()
    : await admin.from("offices").select("*, office_members(*)").eq("owner_id", user.id).maybeSingle();

  // Self-heal the brand seed: an office can be created by the Stripe webhook or
  // a plan change before the owner has any card to copy from. Seeding no-ops
  // the moment ANY brand identity exists, so this only ever fills a blank brand.
  if (office?.id && office?.owner_id) {
    try { await seedBrandFromOwnersFirstCard(office.id as string, office.owner_id as string); } catch { /* best-effort */ }
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    office: (office as Record<string, unknown> | null) ?? null,
    officeId: (office?.id as string | null) ?? null,
    ownerId: (office?.owner_id as string | null) ?? null,
    role,
    isOwner: ctx ? ctx.isOwner : true,
    caps: {
      canInvite: roleHasCapability(role, "invite_members"),
      canRemove: roleHasCapability(role, "remove_members"),
      canBrand: roleHasCapability(role, "manage_branding"),
      canManageSeats: roleHasCapability(role, "manage_seats"),
      canManageCards: roleHasCapability(role, "manage_member_cards"),
    },
  };
});
