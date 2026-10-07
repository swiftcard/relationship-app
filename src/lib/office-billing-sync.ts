import { getAdminSupabase } from "@/lib/supabase-admin";
import { reportError } from "@/lib/report-error";
import { getOfficeBrand, stripBrandFromUserCards, memberFallbackPlan, seedBrandFromOwnersFirstCard, applyBrandToUserCards } from "@/lib/office-brand";
import { insertNotification } from "@/lib/notify";
import { PLAN_CHOSEN_KEY } from "@/lib/welcome-email";
import { recordOfficeDeparture } from "@/lib/office-departure";

type Admin = ReturnType<typeof getAdminSupabase>;

// Shared notification copy for every "your Office access ended" path (this
// teardown, the seat-trim cascade, and the subscription-cancellation cascade
// in the webhook) — one place to word it, and correctly reflects the ACTUAL
// fallback plan instead of always claiming "Free" (code review: a member
// with their own live Pro subscription falls back to "pro", not "free", and
// telling them they lost paid access they still have is simply false).
export function officeAccessEndedMessage(fallback: "pro" | "free"): string {
  // Says what happened to their CARD too — the thing they will notice first.
  // Every path that sends this (team plan ended, seats cut, switched to Pro)
  // strips the company branding and hands the card back to them.
  return fallback === "pro"
    ? "Your team's Office plan changed, so your account is back on your own Pro plan. The company branding came off your card, and your card and contacts are yours — manage them in Settings → Cards and sharing. Reach out to your team admin if this was unexpected."
    : "Your team's Office plan changed, so your account moved to a Free plan. The company branding came off your card, and your card and contacts are yours — manage them in Settings → Cards and sharing. Reach out to your team admin if this was unexpected.";
}

// An admin REMOVED this person. Not "the team's plan changed" — nothing about
// the team changed; they left it. Says where their card went and how to get it
// back (removal takes office cards offline, then hands them back to the owner,
// so Settings → Cards and sharing can turn them on again).
export function officeRemovedMessage(fallback: "pro" | "free"): string {
  return `You were removed from your team, so your account is on your own ${fallback === "pro" ? "Pro" : "Free"} plan. Your card was turned off and the company branding came off it — turn it back on any time in Settings → Cards and sharing. Your contacts are still yours.`;
}

// ── Office provisioning/teardown reconciler ─────────────────────────────────
// Shared by the in-app change-plan route AND the customer.subscription.updated
// webhook. A Pro<->Office swap made through the Stripe billing portal (rather
// than our in-app flow) fires only the webhook — before this existed, only
// change-plan provisioned/tore down the office row, so a portal-initiated
// Office->Pro downgrade left every member with unpaid enterprise access
// indefinitely, and a portal-initiated Pro->Office upgrade never created the
// office row at all (billing audit).

// Provision (create or update) the office row for an owner who just became —
// or already is — Office/enterprise on Stripe.
export async function provisionOfficeForOwner(admin: Admin, ownerId: string, seats: number): Promise<void> {
  const { data: existing } = await admin.from("offices").select("id").eq("owner_id", ownerId).maybeSingle();
  let officeId: string | null = null;
  if (existing) {
    await admin.from("offices").update({ seats }).eq("id", existing.id);
    officeId = existing.id as string;
  } else {
    const { data: prof } = await admin.from("profiles").select("name, company").eq("id", ownerId).maybeSingle();
    // profiles.company/name are empty for a normal signup (the card holds
    // them), which named nearly every office "My Office" — shown in the admin
    // header, on the join page and in invites. The owner's first card first.
    const { data: firstCard } = await admin.from("cards").select("company, name").eq("user_id", ownerId).order("created_at", { ascending: true }).limit(1).maybeSingle();
    const cardCompany = ((firstCard?.company as string | null) ?? "").trim();
    const cardName = ((firstCard?.name as string | null) ?? "").trim();
    const officeName = cardCompany || (prof?.company as string | null) || (cardName ? `${cardName}'s Team` : prof?.name ? `${prof.name}'s Team` : "My Office");
    const { data: created } = await admin
      .from("offices")
      .insert({ owner_id: ownerId, name: officeName, seats })
      .select("id")
      .maybeSingle();
    officeId = (created?.id as string | null) ?? null;
  }

  // Seed the brand from the owner's earliest card right now, so a freshly-
  // provisioned office is branded from the moment it exists — for BOTH new
  // Office signups and Pro→Office upgrades. Idempotent: no-ops the moment any
  // brand identity is set; the /office/admin guard self-heals as a safety net.
  if (officeId) {
    try { await seedBrandFromOwnersFirstCard(officeId, ownerId); } catch { /* best-effort — the console self-heal covers it */ }
    try { await restoreSuspendedMembers(admin, officeId, seats); } catch { /* best-effort — the team can always be re-invited */ }
  }
}

/**
 * Bring a suspended roster back when an office starts paying again.
 *
 * A lapsed subscription (or a seat cut) leaves members at status 'suspended'
 * rather than deleting them — see releaseOfficeMember in the Stripe webhook.
 * This is the other half of that promise: re-subscribing restores the team
 * instead of making the owner re-invite fourteen people one at a time.
 *
 * FOUR RULES, each of which would otherwise be a bug:
 *
 *  • Capacity. Restore at most `seats − 1 − (already active) − (pending)`. An
 *    owner who comes back on fewer seats than they left with must not end up
 *    over capacity, which would put the seat gate into a state the UI cannot
 *    explain.
 *  • Oldest first, by joined_at — the same ordering the seat trim uses to
 *    decide who goes, so coming back is the exact inverse of leaving.
 *  • Never steal someone. A suspended member who has since joined ANOTHER
 *    office is skipped; their active membership there wins.
 *  • Plan and office_id are restored too. The cascade set them to free/null,
 *    and a membership row without them is a member who cannot use anything.
 *
 *  • The office's CURRENT brand goes back on. The lapse stripped it, and the
 *    notification below promises "your company card … back to normal"; left to
 *    the next Branding save, a restored teammate's card stayed unbranded (and
 *    unlocked) with nothing saying why. Whatever the owner changed while lapsed
 *    is simply what is applied.
 */
async function restoreSuspendedMembers(admin: Admin, officeId: string, seats: number): Promise<void> {
  const { data: suspended } = await admin
    .from("office_members")
    .select("id, user_id, joined_at")
    .eq("office_id", officeId)
    .eq("status", "suspended")
    .not("user_id", "is", null)
    .order("joined_at", { ascending: true });
  if (!suspended?.length) return;

  const [{ count: activeCount }, { count: pendingCount }] = await Promise.all([
    admin.from("office_members").select("*", { count: "exact", head: true }).eq("office_id", officeId).eq("status", "active"),
    admin.from("office_members").select("*", { count: "exact", head: true }).eq("office_id", officeId).eq("status", "pending"),
  ]);
  // The owner always holds seat 1.
  let room = Math.max(0, seats - 1 - (activeCount ?? 0) - (pendingCount ?? 0));
  if (room <= 0) return;

  // Anyone already active in a different office keeps that membership.
  const ids = suspended.map((m) => m.user_id as string);
  const { data: elsewhere } = await admin
    .from("office_members")
    .select("user_id")
    .in("user_id", ids)
    .eq("status", "active")
    .neq("office_id", officeId);
  const taken = new Set((elsewhere ?? []).map((r) => r.user_id as string));
  const brand = await getOfficeBrand(officeId).catch(() => null);

  for (const m of suspended) {
    if (room <= 0) break;
    const uid = m.user_id as string;
    if (taken.has(uid)) continue;
    const { error } = await admin.from("office_members").update({ status: "active" }).eq("id", m.id);
    if (error) continue;
    // Counted the moment the seat is really taken (the write above succeeded).
    room--;
    await admin.from("profiles").update({ plan: "enterprise", office_id: officeId }).eq("id", uid);
    // A seat is not a timed grant: clear any leftover expiry, or the daily
    // cron would read it and move a paid-for member to Free.
    await admin.from("profiles").update({ plan_expires_at: null }).eq("id", uid); // best-effort, older schemas
    // Re-flag their cards as office cards — the exact pair api/join sets when
    // somebody accepts an invite, and the mirror of what releaseOfficeMember
    // cleared. NOT cosmetic: /api/office/brand scopes every propagation with
    // .eq("is_office_card", true), so without this a restored teammate's card
    // silently stops receiving branding. The admin would change the logo, see
    // "Applied to every card", and one person's card would never update, with
    // nothing anywhere saying why.
    await admin.from("cards").update({ is_office_card: true }).eq("user_id", uid);
    if (brand) await applyBrandToUserCards(uid, brand).catch(() => {});
    // They were told "Your Office access ended" when the plan lapsed. Being
    // put back without a word is its own kind of broken — their plan and their
    // card's branding change under them.
    await insertNotification({
      user_id: uid,
      type: "office_restored",
      title: "Your Office access is back",
      body: "Your team's plan is active again, so your company card and your team's tools are back to normal.",
    }).catch(() => {});
  }
}

// Release an owner's team when their Office ends — a switch to Pro (in-app or
// in the Stripe portal), a tester grant running out, or the owner deleting
// their account (a 30-day soft delete; the purge removes the rest).
//
// SAME RULES AS A LAPSED SUBSCRIPTION (the customer.subscription.deleted
// cascade). This used to hard-DELETE every membership row and the office
// itself, so the cheaper "switch to Pro" lost the roster, the office name, the
// whole brand, the team inbox and the office id ex-members' leads are tagged
// with — while cancelling, which ends MORE, kept all of it. Re-subscribing to
// Office then restored nothing. Now, for every ACTIVE member only (a suspended
// row may belong to someone who has since joined another office — touching
// them would knock them off a team that is paying for them):
//   • plan → their own fallback (Pro if they pay for it themselves, else Free),
//     office_id cleared;
//   • the office brand comes off their cards, THEN the cards are handed back
//     (is_office_card cleared — stripBrandFromUserCards only sees flagged rows,
//     and an unhanded card could never be brought back online by its owner);
//   • their plan is recorded as settled, so a newer account's first card stays
//     live on Free instead of going dark behind the plan step they were never
//     shown — their card is theirs again, as the lapse cascade promises;
//   • they are told, in the bell;
//   • the membership is SUSPENDED, not deleted.
// The office row stays, so provisionOfficeForOwner restores the team (and its
// brand) the moment the owner is on Office again. Pending invites are left as
// they are: /api/join refuses them while the owner is not on Office.
export async function tearDownOfficeForOwner(admin: Admin, ownerId: string): Promise<void> {
  const { data: office } = await admin.from("offices").select("id").eq("owner_id", ownerId).maybeSingle();
  if (!office) return;
  const brand = await getOfficeBrand(office.id).catch(() => null);
  const { data: members } = await admin
    .from("office_members")
    .select("id, user_id")
    .eq("office_id", office.id)
    .eq("status", "active")
    .not("user_id", "is", null);
  for (const m of members ?? []) {
    const uid = m.user_id as string | null;
    if (uid) {
      // Their contacts stay with the company, as on a manual removal — so the
      // team comes back WITH them if the owner returns to Office, even for
      // someone who has moved on by then (lib/office-departure). Never throws.
      await recordOfficeDeparture(office.id as string, uid, "office_ended");
      const fallback = await memberFallbackPlan(uid);
      const { data: prof } = await admin.from("profiles").select("customization").eq("id", uid).maybeSingle();
      const cust = (prof?.customization as Record<string, unknown> | null) ?? {};
      await admin.from("profiles").update({
        plan: fallback,
        office_id: null,
        ...(cust[PLAN_CHOSEN_KEY] ? {} : { customization: { ...cust, [PLAN_CHOSEN_KEY]: fallback } }),
      }).eq("id", uid);
      await admin.from("profiles").update({ plan_expires_at: null }).eq("id", uid); // best-effort, older schemas
      await stripBrandFromUserCards(uid, brand).catch(() => {});
      await admin.from("cards").update({ is_office_card: false }).eq("user_id", uid);
      await insertNotification({
        user_id: uid,
        type: "office_plan_downgraded",
        title: "Your Office access ended",
        body: officeAccessEndedMessage(fallback),
      }).catch(() => {});
    }
    const { error } = await admin.from("office_members").update({ status: "suspended" }).eq("id", m.id);
    if (error) await reportError("office.teardown-suspend-failed", new Error(`member ${m.id}: ${error.message}`)).catch(() => {});
  }
  // The owner's own profile, if it points at the office — as the delete-era
  // teardown did, so nothing treats a Pro owner as still inside a team.
  await admin.from("profiles").update({ office_id: null }).eq("id", ownerId).eq("office_id", office.id);
}

