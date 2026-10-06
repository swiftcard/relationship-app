import { cache } from "react";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isOfficePlan } from "@/lib/plan";

// ── Office roles & capabilities (spec §6/§7) ─────────────────────────────────
// Secure, SERVER-SIDE authorization. The office OWNER (offices.owner_id) is
// implicit and always has every capability. Members carry a role on
// office_members.role. Capabilities — not roles — are checked at each route, so
// the mapping lives in exactly one place.

export type OfficeRole = "owner" | "admin" | "manager" | "billing_admin" | "employee";

export type Capability =
  | "manage_billing"      // subscription, payment method, invoices, seat quantity
  | "manage_seats"        // change seat count (a billing action)
  | "invite_members"      // send/resend/revoke invitations, add members
  | "remove_members"      // remove/suspend members
  | "manage_roles"        // assign member roles
  | "manage_branding"     // company card branding + company info
  | "manage_member_cards" // view/edit/take offline any employee's card
  | "view_org_analytics"; // organization-wide + per-employee analytics

// Owner = superset of everything. Delegated roles get a deliberate subset.
// manage_member_cards is deliberately NOT given to manager or billing_admin:
// editing someone's live public card is a content/brand action, not a reporting
// or billing one.
const ROLE_CAPABILITIES: Record<OfficeRole, Capability[]> = {
  owner: ["manage_billing", "manage_seats", "invite_members", "remove_members", "manage_roles", "manage_branding", "manage_member_cards", "view_org_analytics"],
  billing_admin: ["manage_billing", "manage_seats", "view_org_analytics"],
  admin: ["invite_members", "remove_members", "manage_branding", "manage_member_cards", "view_org_analytics"],
  manager: ["view_org_analytics"],
  employee: [],
};

const VALID_MEMBER_ROLES: OfficeRole[] = ["admin", "manager", "billing_admin", "employee"];
export function isAssignableRole(r: string): r is OfficeRole {
  return (VALID_MEMBER_ROLES as string[]).includes(r);
}

export function roleHasCapability(role: OfficeRole, cap: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(cap) ?? false;
}

export type OfficeContext = {
  officeId: string;
  ownerId: string;
  role: OfficeRole;   // the caller's role in this office
  isOwner: boolean;
};

// Resolve the caller's office + role. A user is either the OWNER of an office,
// or an ACTIVE member of one, or neither. Returns null when they're in no office.
// A missing `role` column (pre-migration) or null role degrades to 'employee'.
//
// cache(): this 1-3 query chain sits under EVERY helper below
// (requireOfficeCapability, getOfficeSubUserContext, officeSubUserBlockMessage,
// resolveBillingSubjectId, canViewOfficeAdmin) plus the admin guard and the
// settings page — so a single request routinely resolved the same office two or
// three times over. Memoized per request, so the first caller pays and the rest
// are free; a fresh request always re-runs it, and nothing is shared across
// users or requests. Same pattern as requireOfficeAdmin in office-admin-guard.
// Safe against staleness: no route re-reads this after mutating membership.
export const resolveOfficeContext = cache(async (userId: string): Promise<OfficeContext | null> => {
  const admin = getAdminSupabase();

  // Owner path and member path (active membership only), asked together. They
  // used to run one after the other, and the common case — a plain Free/Pro
  // user in no office — misses BOTH, so every portal page paid two serial
  // round trips before it could render (perf audit 2026-10-06). Owner still
  // wins when both exist, exactly as before.
  const [{ data: owned }, { data: member }] = await Promise.all([
    admin.from("offices").select("id, owner_id").eq("owner_id", userId).maybeSingle(),
    admin
      .from("office_members")
      .select("office_id, role, status")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  if (owned) {
    return { officeId: owned.id as string, ownerId: owned.owner_id as string, role: "owner", isOwner: true };
  }
  if (!member) return null;

  const rawRole = (member as { role?: string | null }).role;
  const role: OfficeRole = rawRole && isAssignableRole(rawRole) ? rawRole : "employee";

  const { data: office } = await admin.from("offices").select("owner_id").eq("id", member.office_id).maybeSingle();
  return {
    officeId: member.office_id as string,
    ownerId: (office?.owner_id as string) ?? "",
    role,
    isOwner: false,
  };
});

// Whose SUBSCRIPTION a billing action (cancel, change-plan, discount, preview,
// keep) operates on. For an office OWNER — or a plain user with no office — it's
// themselves. For a DELEGATED billing_admin (an active member with manage_billing)
// it's the office OWNER, whose subscription they manage on the org's behalf.
// Without this, those routes read the delegate's own (nonexistent) subscription
// and every billing action but seat-count fails. SERVER-SIDE only.
/**
 * Whether this account should see BILLING surfaces: the plan-and-billing
 * section, and the "Payment receipts" email preference.
 *
 * An Office sub-user's seat is paid by the office owner. They are never
 * charged, and the receipt path is keyed to the user who holds the Stripe
 * subscription — so a "Confirmation emails when you're billed" switch offers
 * them control over mail that cannot reach them. Owner request 2026-09-06:
 * hide it rather than explain it.
 *
 * Two exceptions, both real money:
 *   • a delegated billing_admin manages the ORGANISATION's billing; and
 *   • a sub-user who kept a PERSONAL subscription from before joining the team
 *     is still charged for it every month, and does get those receipts.
 *
 * Pure so both settings pages can share one rule instead of re-deriving it and
 * drifting apart.
 */
export function canSeeBilling(
  office: OfficeContext | null | undefined,
  personalSubscriptionId: string | null | undefined,
  /** customization._planSource — "apple" is a personal Pro bought in the app
   *  before joining. Apple keeps charging for it, and only the member can stop
   *  it, so it counts as their own subscription exactly like a Stripe one. */
  planSource?: unknown,
): boolean {
  if (!office || office.isOwner) return true;
  if (roleHasCapability(office.role, "manage_billing")) return true;
  return !!personalSubscriptionId || planSource === "apple";
}

/**
 * WHOSE subscription this user's billing actions apply to.
 *
 * A delegated billing_admin manages the ORGANISATION's — that is the role.
 * Everyone else manages their own.
 *
 * TWO RULES THIS HAS TO KEEP, both learned the hard way:
 *
 * 1. The owner must still be on a paid Office plan, the same re-check
 *    requireOfficeCapability makes. Membership outlives the subscription on
 *    purpose (so re-subscribing restores the team), and /api/admin/set-plan
 *    and /api/admin/users/[id] change profiles.plan with no office teardown.
 *    Without this, a billing_admin left over from a lapsed Office plan could
 *    reach the ex-owner's now-PERSONAL subscription and cancel or change it.
 *    /api/stripe/subscription/seats already 403s in that state through
 *    requireOfficeCapability; this made the other five routes disagree with it.
 *
 * 2. EVERY caller must resolve the subject the same way — the read as well as
 *    the writes. The subscription GET used to read `user.id` while cancel,
 *    change-plan, discount, keep and preview all resolved through here, so a
 *    billing_admin who also held a personal subscription was SHOWN their own
 *    plan and would have CANCELLED the organisation's. You may only act on
 *    what you were shown; that is the whole invariant, and it is now pinned
 *    by a test.
 */
export async function resolveBillingSubjectId(userId: string): Promise<string> {
  const ctx = await resolveOfficeContext(userId);
  if (ctx && !ctx.isOwner && roleHasCapability(ctx.role, "manage_billing") && ctx.ownerId) {
    const admin = getAdminSupabase();
    const { data: ownerProfile } = await admin
      .from("profiles")
      .select("plan")
      .eq("id", ctx.ownerId)
      .maybeSingle();
    // Lapsed Office plan: the delegation is over. Fall back to their own
    // account rather than reaching into a subscription that is now personal.
    if (!isOfficePlan(ownerProfile?.plan as string | null)) return userId;
    return ctx.ownerId;
  }
  return userId;
}

// Authorize: does this user have `cap` in some office? Returns the office context
// on success, or null on failure (caller returns 403). SERVER-SIDE only.
export async function requireOfficeCapability(userId: string, cap: Capability): Promise<OfficeContext | null> {
  const ctx = await resolveOfficeContext(userId);
  if (!ctx) return null;
  if (!roleHasCapability(ctx.role, cap)) return null;

  // The office OWNER must still be on a paid Office plan. Only /brand and
  // /invite checked this; role resolution never looked at profiles.plan at
  // all, so every other office route ran on membership alone. An owner whose
  // Office plan had lapsed — cancelled, admin-downgraded, or an expired free
  // month — kept editing and taking offline every employee's live card,
  // changing roles, removing members, exporting org analytics and reading the
  // whole team's lead PII. For free, indefinitely.
  //
  // Checked here so the gate is inherited rather than remembered: a new office
  // route gets it by calling this, which is what the two routes that had it
  // were relying on developers to notice.
  //
  // The offices row outlives the subscription on purpose (so re-subscribing
  // restores the team), which is exactly why membership can't be the test.
  const admin = getAdminSupabase();
  const { data: ownerProfile } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", ctx.ownerId)
    .maybeSingle();
  if (!isOfficePlan(ownerProfile?.plan as string | null)) return null;

  return ctx;
}

// An office SUB-USER is an ACTIVE member of someone else's office (any member
// role) — never the owner. Their account is company-managed: no personal
// billing, referrals, or account deletion. Returns the office context when the
// user is a sub-user, else null. SERVER-SIDE only — never trust a client flag.
export async function getOfficeSubUserContext(userId: string): Promise<OfficeContext | null> {
  const ctx = await resolveOfficeContext(userId);
  return ctx && !ctx.isOwner ? ctx : null;
}

// Route guard for account-holder-only APIs (billing, referrals, account
// deletion). Blocks office sub-users; `unless` lets a delegated capability
// (e.g. manage_billing for a billing_admin) through. Returns a plain-English
// message to send back with a 403, or null when the caller may proceed.
export async function officeSubUserBlockMessage(
  userId: string,
  opts?: { unless?: Capability; message?: string; allowIfOwnSubscription?: boolean },
): Promise<string | null> {
  const ctx = await getOfficeSubUserContext(userId);
  if (!ctx) return null;
  if (opts?.unless && roleHasCapability(ctx.role, opts.unless)) return null;
  // A sub-user who joined a team while still holding their OWN personal Stripe
  // subscription must be able to cancel/manage THAT subscription — otherwise
  // they're billed forever with no way out (billing audit #6A). This is their
  // own sub, never the org's, so allowing it can't touch org billing.
  // An Apple one counts too (see canSeeBilling): the read model has to reach
  // them so Plan and billing can say where to cancel it. The write routes all
  // act on a Stripe subscription and refuse cleanly when there is none.
  if (opts?.allowIfOwnSubscription) {
    const { data: profile } = await getAdminSupabase()
      .from("profiles")
      .select("stripe_subscription_id, customization")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.stripe_subscription_id) return null;
    if ((profile?.customization as { _planSource?: unknown } | null)?._planSource === "apple") return null;
  }
  return opts?.message ?? "This is managed by your organization. Ask your Office admin if you need a change.";
}

// Should this user see the "Admin" nav item (the team console at /office/admin)?
// Mirrors the page's own access rule, so the link never leads to a redirect:
// the office owner, an Office user who hasn't created their office yet
// (owner-to-be), or a member holding a management role. Plain employees: no.
//
// This is the OFFICE admin — unrelated to the site-owner console at /admin,
// which is gated separately by ADMIN_EMAILS and is not for office users.
export async function canViewOfficeAdmin(userId: string, plan: string | null | undefined): Promise<boolean> {
  if (plan !== "enterprise") return false;
  const ctx = await resolveOfficeContext(userId);
  if (!ctx) return true; // Office plan, no office yet → they're the owner-to-be
  return ctx.isOwner || roleHasCapability(ctx.role, "view_org_analytics");
}
