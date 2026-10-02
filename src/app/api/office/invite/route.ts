import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { NextResponse } from "next/server";
import { sendRawEmail, isOptedOut } from "@/lib/messaging";
import { buildInviteEmail, inviteReplyTo } from "@/lib/office-invite-email";
import { PLAN_LIMITS } from "@/lib/plan";
import { isRateLimited } from "@/lib/rate-limit";
import { getOfficeSeatUsage } from "@/lib/office-seats";
import { writeAudit } from "@/lib/audit";
import { INVITE_TTL_MS, isInviteExpired } from "@/lib/office-invite";
import { requireOfficeCapability } from "@/lib/office-roles";
import { getOfficeBrand } from "@/lib/office-brand";
import { officeCompanyName } from "@/lib/office-display-name";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Cap invite emails per caller — otherwise this endpoint is an unthrottled
  // spam-email relay (loop with different target emails, never accept any).
  // 60, not 10. Ten per ten minutes made the product's own core scenario
  // impossible: onboarding a 15-person office is 14 invites in one sitting, and
  // the eleventh returned "Too many invites sent" with no countdown, ten minutes
  // from invite #1. The abuse this guards against is a spam relay — but reaching
  // this line already requires an authenticated caller holding invite_members in
  // a PAID office, and the seat check below is the real bound on how many
  // invites can exist at all. A cap that stops a customer before it stops an
  // attacker is the wrong cap.
  if (await isRateLimited(`office-invite:${user.id}`, 60, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many invites sent — try again in a few minutes." }, { status: 429 });
  }

  // Server-side authorization: the caller must have the invite_members capability
  // in an office (owner or admin). Never trust the UI. Returns the office context.
  const ctx = await requireOfficeCapability(user.id, "invite_members");
  if (!ctx) return NextResponse.json({ error: "You don't have permission to invite members." }, { status: 403 });

  const admin = getAdminSupabase();
  const { data: office } = await admin
    .from("offices")
    .select("id, name, seats")
    .eq("id", ctx.officeId)
    .maybeSingle();
  if (!office) return NextResponse.json({ error: "No office found. Create one first." }, { status: 404 });

  // The office OWNER must currently be on a paid Office plan (the offices row
  // survives a cancel; without this a downgraded team could keep minting
  // enterprise). Also fetch the owner's name for the invite email brand.
  const { data: ownerProfile } = await admin.from("profiles").select("plan, name").eq("id", ctx.ownerId).maybeSingle();
  if (ownerProfile?.plan !== "enterprise") {
    return NextResponse.json({ error: "An active Office subscription is required to invite members." }, { status: 403 });
  }

  // Seats is required for the math; fall back to the minimum for legacy rows.
  const seatCap = (office.seats as number | null) ?? PLAN_LIMITS.OFFICE_MIN_SEATS;

  const { email, name } = await req.json();
  if (!email?.trim()) return NextResponse.json({ error: "Email required" }, { status: 400 });

  // Suppression gate — the same one every other send to a third party passes
  // through (scanner/send, leads/share-card). Mailing an address that already
  // said stop is the highest-yield way to earn a spam complaint, and it breaks
  // the one-click unsubscribe this email now advertises. Checked BEFORE any row
  // is written so a suppressed address never consumes a seat.
  if (await isOptedOut("email", email)) {
    return NextResponse.json(
      {
        error: "opted_out",
        message: "This person has unsubscribed from SwiftCard emails, so we can't send them an invite. Invite them at a different email address.",
      },
      { status: 409 },
    );
  }
  // Optional display name: personalises the invite email AND is stored on the
  // office_members row (invite_name) so the admin's Team dashboard can show WHO
  // a pending invite went to, not just the email.
  const inviteName = typeof name === "string" && name.trim() ? name.trim() : null;
  const inviteeFirst = inviteName ? inviteName.split(/\s+/)[0] : null;

  // Check for duplicate (case-insensitive — invite emails are stored lowercased).
  const { data: existing } = await admin
    .from("office_members")
    // invited_at — office_members has no created_at, and naming a missing column
    // fails the whole select, which made this duplicate check silently return
    // nothing (so a resend looked like a brand-new invite).
    .select("id, status, expires_at, invited_at")
    .eq("office_id", office.id)
    .eq("invite_email", email.trim().toLowerCase())
    .maybeSingle();

  if (existing?.status === "active") {
    return NextResponse.json({ error: "This person is already a member." }, { status: 400 });
  }

  // THE OWNER CANNOT INVITE THEMSELVES. Nothing stopped it, and the damage was
  // permanent: /api/join blocks owning a DIFFERENT office but lets the owner
  // accept into their own, which creates an office_members row for them. Seat
  // accounting then counts that row on top of the hardcoded +1 for the owner
  // (lib/office-seats), so they silently burn two of their seats — and the
  // Team list gates Remove on `!person.isOwner`, so there is no way back
  // without a database edit. It also runs the join-time rebrand across the
  // owner's own cards, which office-brand-targets exists specifically to
  // prevent. Plausible in a demo: "let me show you what they receive."
  const ownerEmails = new Set(
    [
      (await admin.auth.admin.getUserById(ctx.ownerId).catch(() => null))?.data?.user?.email,
      user.email,
    ].filter(Boolean).map((e) => String(e).toLowerCase()),
  );
  if (ownerEmails.has(email.trim().toLowerCase())) {
    return NextResponse.json(
      { error: "That's your own account — you already hold a seat. Invite a teammate's address instead." },
      { status: 400 },
    );
  }

  // Seat gate — required for a NEW invite AND for a resend that would newly
  // consume a seat. A *live* pending row already reserves its seat, but a
  // revoked/declined/expired row does NOT count in getOfficeSeatUsage, so
  // re-inviting one is effectively a new reservation and must pass the gate —
  // otherwise the owner could over-reserve past their purchased seats.
  // NOTE: an EXPIRED-but-unswept pending is still status='pending' yet is
  // excluded from the usage count, so it must be gated too — use the SAME
  // isInviteExpired() check the usage counter uses. (billing audit #5)
  const isPendingReservation = existing?.status === "pending" && !isInviteExpired(existing);
  if (!existing || !isPendingReservation) {
    const usage = await getOfficeSeatUsage(office.id as string, seatCap);
    if (usage.available <= 0) {
      return NextResponse.json(
        {
          error: "no_seats",
          message: `You've used all ${usage.purchased} seats (you + ${usage.active} active + ${usage.pending} pending). Add a seat to invite this employee.`,
          usage,
        },
        { status: 409 }
      );
    }
  }

  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  // Upsert: re-send invite if a row already exists.
  let token: string;
  if (existing) {
    // Resend: restart the acceptance window AND flip the status back to 'pending'
    // so a previously revoked/declined/expired invite becomes live again (and the
    // same email can always be re-invited). expires_at is best-effort (column may
    // not exist pre-migration — an unknown-column error just leaves it null and
    // the join route falls back to created_at + TTL).
    // Only overwrite the stored name when this invite carries one, so a plain
    // "Remind" (no name) never blanks the name shown on the dashboard.
    const nameField = inviteName ? { invite_name: inviteName } : {};
    let member: { invite_token: string } | null = null;
    ({ data: member } = await admin
      .from("office_members")
      .update({ invited_at: nowIso, status: "pending", user_id: null, joined_at: null, expires_at: expiresIso, ...nameField })
      .eq("id", existing.id)
      .select("invite_token")
      .maybeSingle());
    if (!member) {
      // Retry without expires_at in case the column isn't there yet.
      ({ data: member } = await admin
        .from("office_members")
        .update({ invited_at: nowIso, status: "pending", user_id: null, joined_at: null, ...nameField })
        .eq("id", existing.id)
        .select("invite_token")
        .maybeSingle());
    }
    token = member!.invite_token;
    await writeAudit({ action: "invite.resent", actorId: user.id, orgId: office.id as string, targetId: email.trim().toLowerCase() });
  } else {
    let member: { invite_token: string } | null = null;
    let error: { message: string } | null = null;
    const nameField = inviteName ? { invite_name: inviteName } : {};
    // role is written EXPLICITLY. The column's historical default was 'member',
    // which is not one of OfficeRole (owner|admin|manager|billing_admin|
    // employee) — resolveOfficeContext coerced it to "employee", so it behaved
    // correctly, but only because of that one fallback line. Storing the real
    // value means the database and the capability map agree, instead of every
    // existing member's permissions hinging on an unrecognised string.
    ({ data: member, error } = await admin
      .from("office_members")
      .insert({ office_id: office.id, invite_email: email.trim().toLowerCase(), role: "employee", expires_at: expiresIso, ...nameField })
      .select("invite_token")
      .single());
    if (error) {
      // Retry without expires_at (pre-migration) before giving up.
      ({ data: member, error } = await admin
        .from("office_members")
        .insert({ office_id: office.id, invite_email: email.trim().toLowerCase(), role: "employee", ...nameField })
        .select("invite_token")
        .single());
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    token = member!.invite_token;
    await writeAudit({ action: "invite.created", actorId: user.id, orgId: office.id as string, targetId: email.trim().toLowerCase() });
  }

  const inviteUrl = `${APP_URL}/join/${token}`;

  // Company logo when branding is set — the email should look like it comes
  // from THEIR company, not from us. If the Branding page has no logo yet, fall
  // back to the OWNER's own card logo (the same mark their cards already carry)
  // so a team that never opened Branding still gets a branded invite.
  //
  // WHO IT IS FROM AND WHICH COMPANY, on the same fallback ladder.
  //
  // profiles.name and profiles.company are EMPTY for every account created
  // through normal signup — verified against real production rows; only seeded
  // test accounts have them. The card wizard writes the person's name and
  // company to the CARD, never to the profile, and /profile is not linked from
  // anywhere. So the old code produced, verbatim:
  //
  //     " invited you to create your My Office digital business card"
  //
  // ("" for the name because `??` does not catch an empty string, and "My
  // Office" because offices.name was seeded from the same empty company. With
  // a null name it read "Your invited you to…" instead.)
  //
  // The card is the reliable source, which is exactly why the logo already
  // falls back to it. Name and company now use the same ladder.
  let brandLogoUrl: string | null = null;
  let inviterCardName: string | null = null;
  let brandCompany: string | null = null;
  try {
    const brand = await getOfficeBrand(office.id as string);
    brandLogoUrl = brand?.logoUrl ?? null;
    brandCompany = (brand?.company as string | null) || null;
    const { data: ownerCard } = await admin
      .from("cards")
      .select("logo_url")
      .eq("user_id", ctx.ownerId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!brandLogoUrl) brandLogoUrl = (ownerCard?.logo_url as string | null) ?? null;
    // The person who pressed Send — an office ADMIN can invite too, and the
    // email used to name the OWNER while its Reply-To went to the admin, so
    // "Alex entered your email address" was false and replies went to someone
    // the body never mentioned.
    const { data: inviterCard } = await admin
      .from("cards")
      .select("name")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    inviterCardName = (inviterCard?.name as string | null) || null;
  } catch { /* a nicety, never block the invite */ }

  // The caller's own profile name first (for the owner that is ownerProfile).
  const { data: inviterProfile } = user.id === ctx.ownerId
    ? { data: ownerProfile }
    : await admin.from("profiles").select("name").eq("id", user.id).maybeSingle();
  // First word, and null — not a stand-in word — when there is no name: the
  // old fallback phrase was split to its first word and sent "A invited
  // you…". The builder has its own wording for an unnamed inviter.
  const ownerFirst = ((inviterProfile?.name as string | null) || inviterCardName || "").trim().split(/\s+/)[0] || null;
  // The company the invitee will recognise — the same ladder the /join page
  // and the dashboard banner use (lib/office-display-name): Branding, the
  // owner's card, the stored name; never a placeholder like "My Office".
  const officeDisplayName = await officeCompanyName(office.id as string, {
    brandCompany,
    storedName: (office.name as string | null) || null,
    ownerId: ctx.ownerId,
  });

  const invite = buildInviteEmail({
    ownerFirst,
    officeName: officeDisplayName,
    inviteeFirst,
    inviteUrl,
    brandLogoUrl,
    inviteEmail: email.trim().toLowerCase(),
  });

  // Through the shared layer rather than a second resend.emails.send() call.
  // This was the ONLY send site in the app that bypassed sendRawEmail, which is
  // exactly why it was the only one missing the personalised From, a Reply-To,
  // the RFC 8058 one-click headers, and a text part guaranteed to match the HTML.
  // A divergent second send site is the defect; centralising is the fix.
  const sendResult = await sendRawEmail({
    to: email.trim(),
    subject: invite.subject,
    html: invite.html,
    fromName: invite.fromName,
    // A named colleague is being invited to a workspace — transactional, and it
    // has to reach the inbox to be actionable. List-Unsubscribe would both file
    // it under Promotions and let a one-click opt-out land the invitee in
    // message_opt_outs, silently blocking the resend they'd then ask for.
    personal: true,
    // A team invitation is the platform writing to a stranger on a customer's
    // behalf: support@ carries it, and the inviter's own address is the
    // Reply-To below so "who are you?" reaches the person who can answer.
    sender: "support",
    // The inviting admin's verified auth email — from supabase.auth.getUser(),
    // never a free-text profile field — so a stranger's "who is this?" reaches
    // them. Only at a company address: a gmail.com Reply-To on mail From
    // swiftcard.me is a spam rule on its own, so those fall back to support@
    // (inviteReplyTo, lib/office-invite-email).
    replyTo: inviteReplyTo(user.email),
  });
  const emailSent = sendResult === "sent";

  // `resent` lets the caller tell the truth: there is only ever ONE invite row
  // per (office, email), so re-inviting someone who's already pending re-sends
  // that invitation rather than creating a duplicate. Saying "invite sent" for
  // both would leave an owner wondering why the person has two emails.
  // `emailSent` lets the UI fall back to "copy the invite link" when delivery
  // failed, instead of claiming success. (billing audit #13)
  return NextResponse.json({ ok: true, resent: !!existing, inviteToken: token, emailSent });
}
