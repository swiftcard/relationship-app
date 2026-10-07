import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { PLAN_LIMITS } from "@/lib/plan";
import { getOfficeBrand, applyBrandToUserCards, stripBrandFromUserCards, type OfficeBrand } from "@/lib/office-brand";
import { sendWelcomeWhenCardLive, PLAN_CHOSEN_KEY } from "@/lib/welcome-email";
import { isInviteExpired } from "@/lib/office-invite";
import { writeAudit } from "@/lib/audit";
import { recordOfficeDeparture } from "@/lib/office-departure";
import { notifyOffice, displayLabelFrom } from "@/lib/office-notify";
import { alertTeam } from "@/lib/team-alerts";
import { insertNotification } from "@/lib/notify";
import { officeCompanyName } from "@/lib/office-display-name";
import { NextResponse, after } from "next/server";

const OFFICE_MIN_SEATS = PLAN_LIMITS.OFFICE_MIN_SEATS;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  const admin = getAdminSupabase();

  // Look up the invite (use admin client to bypass RLS for public invite lookup)
  const { data: member } = await admin
    .from("office_members")
    .select("*, offices(id, name, owner_id)")
    .eq("invite_token", token)
    .single();

  if (!member) return NextResponse.json({ error: "Invalid or expired invite link." }, { status: 404 });
  if (member.status === "active") return NextResponse.json({ error: "This invite has already been used." }, { status: 400 });
  if (member.status === "revoked") return NextResponse.json({ error: "This invitation was canceled by the team admin." }, { status: 410 });
  if (member.status === "declined") return NextResponse.json({ error: "This invitation was already declined." }, { status: 410 });
  // Suspended: the office's subscription lapsed or its seats were cut, and the
  // membership was parked rather than deleted so it can be restored (see
  // releaseOfficeMember / restoreSuspendedMembers). The invite link in their
  // original email still resolves, so this MUST be refused explicitly — the
  // activation UPDATE below is scoped to status='pending', so a suspended row
  // silently fails to activate while the rest of this route carries on and
  // applies the plan, the brand and the is_office_card flag to somebody who is
  // not a member.
  if (member.status === "suspended") {
    return NextResponse.json(
      { error: "This team's plan is no longer active, so the invite is paused. Ask your admin to invite you again once it's back." },
      { status: 410 },
    );
  }

  // Invites expire after 14 days (matches the deadline stated in the invite email)
  // — otherwise a leaked/forwarded link would work indefinitely. Uses stored
  // expires_at when present, else created_at + TTL.
  if (isInviteExpired(member as { status?: string; expires_at?: string | null; invited_at?: string | null })) {
    return NextResponse.json({ error: "This invite has expired. Ask the team admin to send a new one." }, { status: 410 });
  }

  // The invite is only valid for the email it was sent to — without this, anyone
  // who obtains the token (forwarded email, leaked link, shared inbox) could
  // accept it under a DIFFERENT account and consume the seat instead of the
  // person actually invited, regardless of whether their own email matches.
  const inviteEmail = (member.invite_email as string | null)?.trim().toLowerCase();
  const userEmail = user.email?.trim().toLowerCase();
  // Fail CLOSED: the accepting session must carry a verifiable email that
  // matches the invite. A session with NO email (e.g. a phone/OAuth-without-
  // email account) can't be proven to be the invited person, so it must not be
  // able to consume the seat — the earlier `inviteEmail && userEmail && …` form
  // skipped the check entirely when either side was empty (fail-open). When the
  // invite carries an email, it must match exactly. (security audit)
  if (!userEmail || (inviteEmail && inviteEmail !== userEmail)) {
    return NextResponse.json(
      { error: inviteEmail
          ? `This invite was sent to ${member.invite_email}. Sign in with that email address to accept it.`
          : "Sign in with the email address this invite was sent to in order to accept it." },
      { status: 403 }
    );
  }

  const officeId = (member.offices as { id: string } | null)?.id ?? member.office_id;

  // Accepting mints enterprise access, so the office's owner must CURRENTLY be
  // on a paid Office plan — the offices row survives a cancel, and a pending
  // invite from a since-cancelled office must not keep granting enterprise.
  const ownerId = (member.offices as { owner_id?: string } | null)?.owner_id;
  if (ownerId) {
    const { data: ownerProfile } = await admin.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
    if (ownerProfile?.plan !== "enterprise") {
      return NextResponse.json(
        { error: "This team's subscription is no longer active. Ask the team admin to reactivate it." },
        { status: 410 }
      );
    }
  }

  // HARD seat guard at accept time. Seats include the OWNER (seat 1) plus active
  // members, so active members may never exceed seats − 1. This is the real
  // overflow guarantee (the invite gate reserves seats, this backstops downgrades
  // and races).
  const { data: officeRow } = await admin.from("offices").select("seats").eq("id", officeId).maybeSingle();
  const seatCap = (officeRow?.seats as number | null) ?? OFFICE_MIN_SEATS;
  const { count: activeCount } = await admin
    .from("office_members")
    .select("*", { count: "exact", head: true })
    .eq("office_id", officeId)
    .eq("status", "active");
  if (1 + (activeCount ?? 0) >= seatCap) {
    return NextResponse.json(
      { error: "This team's seats are all full. Ask the team admin to free up or add a seat." },
      { status: 409 }
    );
  }

  // A profile row must exist BEFORE any mutation below — checked here, not
  // just after activating (the earlier version of this fix rolled back the
  // NEW office's membership on a missing profile, but by then the OLD
  // office's membership row was already hard-deleted a few steps later with
  // no way back, permanently losing the user's original office membership
  // for nothing (code review). Bailing out here, before anything is
  // touched, needs no rollback at all.
  const { data: existingProfile } = await admin.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!existingProfile) {
    return NextResponse.json(
      { error: "Your account isn't fully set up yet. Please finish creating your account, then use the invite link again." },
      { status: 409 }
    );
  }

  // An office OWNER cannot join someone else's team. There was no such check,
  // and accepting flags ALL of the accepter's cards is_office_card (below), so
  // an owner who clicked an invite handed their own company's cards to the
  // other org: branded with the other company's logo, editable and
  // take-offline-able by that company's admins. They'd occupy a paid seat
  // there while remaining full owner of their own office — two orgs, one
  // person, mutually clobbering brand state.
  //
  // Checked before anything is touched, like the profile check above, so there
  // is nothing to roll back. Membership in another office is fine and is
  // handled below (switching teams); OWNING one is not.
  const { data: ownedOffice } = await admin
    .from("offices")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (ownedOffice && ownedOffice.id !== officeId) {
    return NextResponse.json(
      {
        error:
          "You already own a SwiftCard Office team, so you can't also join another one. End your Office plan first (Settings → Plan and billing), or accept this invite from a different account.",
      },
      { status: 409 }
    );
  }

  // NOTE: any membership this user still holds in a DIFFERENT office is removed
  // AFTER the seat recount below succeeds — never before. Deleting it up front
  // (the old order) meant a seat-race rollback returned 409 having already wiped
  // the user's OLD office row, leaving them with no membership anywhere but a
  // stale profiles.plan='enterprise' + office_id pointing at the old office —
  // permanent unpaid enterprise that no cascade could ever clean up. (office
  // audit H2)

  // Accept: mark active, link user_id. Scope the UPDATE to status='pending' so two
  // near-simultaneous accepts of the same token can't both count as an activation —
  // only one changes a row; `didActivate` gates the team notification below so the
  // "joined your team" bell entry never doubles on a double-submit.
  const { data: activated, error: updateError } = await admin
    .from("office_members")
    .update({ user_id: user.id, status: "active", joined_at: new Date().toISOString() })
    .eq("id", member.id)
    .eq("status", "pending")
    .select("id");

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  const didActivate = (activated?.length ?? 0) > 0;

  // A lost race is fine — the other request activated the same row for the same
  // person, and this one should still finish their setup. A row that is not
  // active for THIS user afterwards is not fine: everything below writes a plan,
  // a brand and an is_office_card flag, and none of that may happen for someone
  // who did not actually join. Checked on the RESULTING STATE rather than on who
  // won, so double-submit keeps working and any future status that skips the
  // pending update fails closed instead of half-joining.
  if (!didActivate) {
    const { data: settled } = await admin
      .from("office_members")
      .select("status, user_id")
      .eq("id", member.id)
      .maybeSingle();
    if (settled?.status !== "active" || settled?.user_id !== user.id) {
      return NextResponse.json(
        { error: "That invitation isn't active any more. Ask your team admin to send a new one." },
        { status: 409 },
      );
    }
  }

  // Count-then-update above isn't atomic — two invitees accepting the LAST
  // seat simultaneously can both pass the pre-check. Recount after activating
  // and, if we overflowed, roll THIS activation back. Self-heals the race
  // instead of leaving active > paid seats.
  const { count: afterCount } = await admin
    .from("office_members")
    .select("*", { count: "exact", head: true })
    .eq("office_id", officeId)
    .eq("status", "active");
  if (1 + (afterCount ?? 0) > seatCap) {
    await admin
      .from("office_members")
      .update({ user_id: null, status: "pending", joined_at: null })
      .eq("id", member.id);
    return NextResponse.json(
      { error: "This team's seats are all full. Ask the team admin to free up or add a seat." },
      { status: 409 }
    );
  }

  // The activation stuck — NOW it's safe to leave the previous office. Capture
  // the old office(s) so we can strip their brand from this user's cards too;
  // otherwise the ex-employer's logo/company/fax/address linger on a card now
  // serving under the new team. (office audit H2/M3)
  const { data: oldRows } = await admin
    .from("office_members")
    .select("office_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("office_id", officeId);
  // Leaving the old team the way a removal does: the contacts they captured
  // there stay with that company, stamped before the old membership goes
  // (lib/office-departure). Without this, accepting a new invite made every
  // one of them vanish from the old company's Contacts tab. Never throws.
  for (const r of oldRows ?? []) {
    if (r.office_id) await recordOfficeDeparture(r.office_id as string, user.id, "joined_another_team");
  }
  await admin
    .from("office_members")
    .delete()
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("office_id", officeId);

  // Give the joining user enterprise plan + link to office. Must verify a
  // profile row actually exists first — an UPDATE silently affects 0 rows if
  // it doesn't (e.g. onboarding hasn't finished provisioning it yet), which
  // would leave the seat we just activated above permanently spent with no
  // enterprise access ever granted, and nothing later reconciles it (auth
  // audit).
  // plan_expires_at is cleared: enterprise here is granted by the office seat,
  // not a timed free-month grant. If a member still carried a referral/promo
  // expiry (plan_expires_at set, no Stripe sub), the downgrade cron
  // (expireFreeMonths) would later flip this active member back to "free" —
  // silently pausing their automations while they still occupy a paid seat.
  const { data: updatedProfile } = await admin
    .from("profiles")
    .update({ plan: "enterprise", office_id: officeId, plan_expires_at: null })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();

  if (!updatedProfile) {
    // Roll back the activation — same rollback pattern as the seat-race
    // check above, so the seat isn't silently spent for nothing.
    await admin
      .from("office_members")
      .update({ user_id: null, status: "pending", joined_at: null })
      .eq("id", member.id);
    return NextResponse.json(
      { error: "Your account isn't fully set up yet. Please finish creating your account, then use the invite link again." },
      { status: 409 }
    );
  }

  // Their plan is SETTLED — by the team. Recorded now, because every way off a
  // team (removal, a seat cut, the office lapsing or switching to Pro) drops
  // them to their own plan with office_id cleared, and an account created after
  // PLAN_STEP_REQUIRED_SINCE with no marker reads as "hasn't chosen a plan yet"
  // (lib/card-active awaitingPlanChoice): their card, QR, NFC tag and wallet
  // pass went dark behind a plan step they were never shown. Kept if already
  // set (a plan they chose themselves stays the record). Best-effort.
  try {
    const { data: prof } = await admin.from("profiles").select("customization").eq("id", user.id).maybeSingle();
    const pc = (prof?.customization as Record<string, unknown> | null) ?? {};
    if (!pc[PLAN_CHOSEN_KEY]) {
      await admin.from("profiles").update({ customization: { ...pc, [PLAN_CHOSEN_KEY]: "office_member" } }).eq("id", user.id);
    }
  } catch { /* best-effort — the release paths set it too */ }

  // Uniform branding: strip any OLD office brand first, then adopt the new one,
  // so switching teams never leaves the previous company's contact details on
  // the card. (cards created/edited later already get the overlay in the APIs.)
  //
  // FLAG FIRST: every brand operation (apply here, Branding-page propagation,
  // strip on removal) is scoped .eq("is_office_card", true) — so a member's
  // PRE-EXISTING cards must be flagged at join or the apply below is a no-op,
  // later brand edits never reach them, and strip-on-exit misses them (an
  // ex-member would walk away with the company logo baked on). A member's
  // cards are ALL office cards while they serve under the team; leaving is
  // what un-flags/strips them.
  try {
    await admin.from("cards").update({ is_office_card: true }).eq("user_id", user.id);
    for (const r of oldRows ?? []) {
      const oldBrand = await getOfficeBrand(r.office_id as string).catch(() => null);
      if (oldBrand) await stripBrandFromUserCards(user.id, oldBrand);
    }
    const brand = await getOfficeBrand(officeId);
    if (brand) await applyBrandToUserCards(user.id, brand);
    // Company-level fields are the organization's from here on — the editor
    // no longer shows them to a member and PATCH discards them. So whatever an
    // existing card carried that the office does NOT set (their old company,
    // logo, website, fax, address — typically from a card built on the site
    // before accepting) would sit on the company card with no way to change
    // it, while the editor says the organization manages it. Clear exactly
    // those; everything the office sets was just applied above.
    await clearUnmanagedCompanyFields(admin, user.id, brand);
  } catch { /* best-effort — the next card edit applies the overlay anyway */ }

  await writeAudit({ action: "invite.accepted", actorId: user.id, orgId: officeId, targetId: user.email ?? user.id });

  // Whether they already have a card: join has just branded every card they
  // own, so sending them to build ANOTHER one made a second company card.
  const { data: existingCard } = await admin.from("cards").select("id, name").eq("user_id", user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();

  // Team inbox (admin bell): a genuinely important event — someone JOINED. And
  // for each office this user just LEFT, tell that office too. Only when THIS
  // request performed the activation (didActivate) so a concurrent double-submit
  // never doubles the entry. Best-effort; the notify helper swallows its own
  // errors so accept is never blocked.
  if (didActivate) {
    // The name the admin typed, else the name on a card they already built,
    // else their address — "Riley Chen joined", not "riley.c4 joined".
    const joinerLabel = displayLabelFrom((member.invite_name as string | null) || (existingCard?.name as string | null), user.email);
    // Also to the admins' phones (team_alert, ≤2 a day — lib/team-alerts):
    // a new person on the team is news an owner wants, and it happens a
    // handful of times, not twenty times a day.
    const { count: members } = await admin
      .from("office_members").select("id", { count: "exact", head: true })
      .eq("office_id", officeId).eq("status", "active");
    const teamSize = (members ?? 0) + 1; // + the owner
    await alertTeam(officeId, {
      type: "member_joined",
      title: `${joinerLabel} joined your team`,
      body: user.email ? `${user.email} accepted their invitation and is now on your team.` : "A new teammate accepted their invitation.",
      meta: { userId: user.id },
      // Only "their card is live" when it is: a first-time joiner goes on to
      // BUILD their card after this, and the push arrived while they hadn't.
      push: {
        body: existingCard
          ? `Their card is live — your team is now ${teamSize}.`
          : `They're setting up their card now — your team is now ${teamSize}.`,
      },
      skipPushFor: [user.id],
    });
    // And the person who joined gets one line of their own that says what
    // being on a team means for their card — the admin heard about the join,
    // they heard nothing. Bell only, once (didActivate), no push: they are
    // on screen right now.
    const company = await officeCompanyName(officeId as string, {
      storedName: (member.offices as { name?: string | null } | null)?.name ?? null,
      ownerId: ownerId ?? null,
    }).catch(() => null);
    await insertNotification({
      user_id: user.id,
      type: "office_joined",
      title: company ? `You joined ${company}` : "You joined your team",
      body: "Your team admin manages the company details on your card; your name, title, headshot and your own links are yours to edit. You'll hear from us here when someone opens your card or shares their details with you.",
    }).catch(() => {});
    for (const r of oldRows ?? []) {
      await notifyOffice(r.office_id as string, {
        type: "member_left",
        title: `${joinerLabel} left your team`,
        body: user.email ? `${user.email} moved to another team.` : "A teammate moved to another team.",
        meta: { userId: user.id },
      });
    }
  }

  // If the joiner still pays for their OWN subscription, say so NOW — at the one
  // moment they're paying attention. Their seat covers Pro from here on, so the
  // personal sub is pure cost unless they deliberately keep it as a fallback.
  // Without this, the sub kept charging while the billing UI hid it (fixed
  // alongside this: Settings → Billing now shows their personal sub + cancel).
  // Bell notification so the message survives the redirect; response flag so
  // the join screen can show it inline too. Best-effort — never blocks accept.
  // Pro bought in the iPhone app counts too: Apple bills it, so nothing here
  // can cancel it and it kept charging with no word said. Only the member can
  // stop it, in their Apple account — so that is where this sends them.
  const { data: joinerBilling } = await admin
    .from("profiles")
    .select("stripe_subscription_id, customization")
    .eq("id", user.id)
    .maybeSingle();
  const personalBilledBy: "stripe" | "apple" | null = joinerBilling?.stripe_subscription_id
    ? "stripe"
    : (joinerBilling?.customization as { _planSource?: unknown } | null)?._planSource === "apple"
      ? "apple"
      : null;
  const hasPersonalSubscription = personalBilledBy !== null;
  if (hasPersonalSubscription && didActivate) {
    await insertNotification({
      user_id: user.id,
      type: "personal_sub_reminder",
      title: "You still have a personal Pro subscription",
      body: personalBilledBy === "apple"
        ? "Your team seat now includes everything in Pro. Your own Pro is billed by Apple and keeps renewing until you cancel it on your iPhone: Settings → Apple ID → Subscriptions — or keep it for if you ever leave the team."
        : "Your team seat now includes everything in Pro. You can cancel your own subscription in Settings → Plan and billing — or keep it for if you ever leave the team.",
    }).catch(() => {});
  }

  // Their card is live under the team from this moment, so this is when
  // "Your SwiftCard is live" belongs. A card built on the site before
  // accepting never got it: the claim skipped it (no plan chosen yet) and
  // nothing after the join ever sent it. Once per account (email_logs), so a
  // first-time joiner still gets it from card creation instead.
  if (existingCard) after(() => sendWelcomeWhenCardLive(user.id, user.email));

  return NextResponse.json({
    ok: true,
    officeName: (member.offices as { name: string } | null)?.name,
    hasPersonalSubscription,
    personalBilledBy,
    firstCardId: (existingCard?.id as string | undefined) ?? null,
  });
}

// Blank the company-level fields on a new member's cards that the office does
// NOT set (the ones it does set were just applied). Scoped to office cards —
// join flags all of the member's cards — and to the member's own id.
async function clearUnmanagedCompanyFields(
  admin: ReturnType<typeof getAdminSupabase>,
  userId: string,
  brand: OfficeBrand | null,
): Promise<void> {
  const top: Record<string, unknown> = {};
  if (!brand?.logoUrl) top.logo_url = null;
  if (!brand?.company) top.company = "";
  if (!brand?.website) top.website = "";
  const dropFax = !brand?.fax;
  const dropAddress = !brand?.address;
  const { data: cards } = await admin
    .from("cards")
    .select("id, customization")
    .eq("user_id", userId)
    .eq("is_office_card", true);
  for (const c of cards ?? []) {
    const cust = { ...((c.customization as Record<string, unknown> | null) ?? {}) };
    let custChanged = false;
    if (dropFax && "fax" in cust) { delete cust.fax; custChanged = true; }
    if (dropAddress && "address" in cust) { delete cust.address; custChanged = true; }
    const update = custChanged ? { ...top, customization: cust } : top;
    if (Object.keys(update).length) await admin.from("cards").update(update).eq("id", c.id);
  }
}
