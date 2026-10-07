import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOfficeBrand } from "@/lib/office-brand";
import { isInviteExpired } from "@/lib/office-invite";
import { officeCompanyName } from "@/lib/office-display-name";
import { invitedEmailHasAccount } from "@/lib/invite-account";
import JoinButton from "@/components/JoinButton";
import JoinSignIn from "@/components/JoinSignIn";
import JoinSwitchAccount from "@/components/JoinSwitchAccount";
import SwiftCardLogo from "@/components/SwiftCardLogo";
import Link from "next/link";

// A dead end with one way out — used for every state where the invite cannot
// be accepted, so none of them shows an Accept button that is guaranteed to
// fail against /api/join (the rule every branch below exists for).
function DeadEnd({ title, message, href, cta }: { title: string; message: ReactNode; href: string; cta: string }) {
  return (
    <main className="sc-app min-h-screen bg-gray-950 flex items-center justify-center px-5">
      <div className="text-center max-w-sm">
        <SwiftCardLogo size={32} onDark />
        <h1 className="text-2xl font-bold text-white mt-8 mb-3">{title}</h1>
        <p className="text-gray-500 text-sm mb-6">{message}</p>
        <Link href={href} className="text-blue-400 hover:text-blue-300 text-sm transition-colors">
          {cta}
        </Link>
      </div>
    </main>
  );
}

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ link?: string }>;
}) {
  const { token } = await params;
  const { link } = await searchParams;

  // Look up invite using admin client (bypasses RLS — token is the secret)
  const admin = getAdminSupabase();
  const { data: invite } = await admin
    .from("office_members")
    .select("*, offices(id, name, owner_id)")
    .eq("invite_token", token)
    .single();

  if (!invite) {
    return (
      <DeadEnd
        title="This link doesn't work anymore"
        message="The invite may have expired or been canceled. Ask whoever invited you to send a fresh one."
        href="/login"
        cta="Go to sign in →"
      />
    );
  }

  if (invite.status === "active") {
    return (
      <DeadEnd
        title="You're already on the team"
        message="This invite has already been used."
        href="/dashboard"
        cta="Go to my dashboard →"
      />
    );
  }

  const officeRef = invite.offices as { id?: string; name?: string; owner_id?: string } | null;
  const officeId = officeRef?.id ?? (invite.office_id as string);

  // Revoked/declined/expired invites must not show an enabled "Accept" CTA
  // that's guaranteed to fail against the API — mirrors the API's own
  // rejection logic (isInviteExpired) so the page and API agree (auth audit).
  // A LAPSED office too: /api/join refuses an invite whose owner is no longer
  // on the Office plan, and the cancel cascade suspends members but leaves
  // pending invites pending — so this page kept offering Accept on a team that
  // could no longer take anyone.
  let ownerLapsed = false;
  if (officeRef?.owner_id) {
    const { data: ownerProfile } = await admin.from("profiles").select("plan").eq("id", officeRef.owner_id).maybeSingle();
    ownerLapsed = ownerProfile?.plan !== "enterprise";
  }
  if (ownerLapsed || invite.status === "revoked" || invite.status === "declined" || invite.status === "suspended" || isInviteExpired(invite as { status?: string; expires_at?: string | null; invited_at?: string | null })) {
    const message =
      invite.status === "revoked"
        ? "This invitation was canceled by the team admin."
        : invite.status === "declined"
        ? "This invitation was already declined."
        // Suspended: the team's plan lapsed or its seats were cut, and the
        // membership was parked so it can be restored. The API refuses this
        // too — the page mirrors it so nobody is shown an Accept button that
        // is guaranteed to fail, which is the rule this whole branch exists
        // for. Worded as paused, not cancelled: it is likely to come back, and
        // "your admin cancelled you" would be both wrong and alarming.
        : invite.status === "suspended" || ownerLapsed
        ? "This team's plan isn't active right now, so the invite is paused."
        : "This invite has expired.";
    return (
      <DeadEnd
        title="This link doesn't work anymore"
        message={`${message} Ask whoever invited you to send a fresh one.`}
        href="/login"
        cta="Go to sign in →"
      />
    );
  }

  // The company the invitee recognises — the same ladder as the invite email
  // they just tapped (lib/office-display-name), so the email's "Meridian Bank"
  // is not followed by "Create your My Office card". null = no company known.
  const [officeName, brand] = await Promise.all([
    officeCompanyName(officeId, { storedName: officeRef?.name ?? null, ownerId: officeRef?.owner_id ?? null }),
    getOfficeBrand(officeId).catch(() => null),
  ]);
  const cardTitle = officeName ? `Create your ${officeName} card` : "Create your company card";
  // Only promise what the admin has actually set up. "Your company logo and
  // design are already set up" on a team with no branding described a card
  // the invitee would never see.
  const brandSetUp = !!(brand?.logoUrl || brand?.template || brand?.design);
  const intro = brandSetUp
    ? "Your company logo and design are already set up. You just add your name, photo and contact info — it takes about 2 minutes."
    : "Your team covers your card. You just add your name, photo and contact info — it takes about 2 minutes.";

  const header = (
    <div className="text-center mb-8">
      <div className="flex justify-center mb-6">
        {brand?.logoUrl ? (
          // object-CONTAIN + padding: a company logo is rarely square, and
          // object-cover cropped wide/tall logos (the "logo cut out" bug).
          // Contain shows the whole mark inside the rounded tile.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt="" className="w-14 h-14 rounded-2xl object-contain bg-white p-1.5" />
        ) : (
          <SwiftCardLogo size={32} onDark />
        )}
      </div>
      <h1 className="text-2xl font-bold text-white mb-2">{cardTitle}</h1>
      <p className="text-gray-400 text-sm">{intro}</p>
    </div>
  );

  // Check if user is logged in. A signed-out invitee signs in RIGHT HERE —
  // Google, or a passwordless email link to the invited address — instead of
  // being bounced to the login page's password form (owner request).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const inviteEmail = invite.invite_email as string;

  if (!user) {
    // One way in, fixed to the invited address: create the account — or, only
    // if that address already has one, sign in (lib/invite-account).
    const hasAccount = await invitedEmailHasAccount(inviteEmail);
    return (
      <main className="sc-app min-h-screen bg-gray-950 flex items-center justify-center px-5">
        <div className="w-full max-w-sm">
          {header}
          <JoinSignIn token={token} inviteEmail={inviteEmail} hasAccount={hasAccount} linkFailed={link === "expired"} />
        </div>
      </main>
    );
  }

  // Signed in as SOMEONE ELSE. /api/join accepts only the invited address, so
  // an Accept button here could only fail with a 403. Say whose invite it is,
  // and make switching the one button.
  const invitedAddr = inviteEmail?.trim().toLowerCase();
  if (!user.email || (invitedAddr && user.email.trim().toLowerCase() !== invitedAddr)) {
    return (
      <main className="sc-app min-h-screen bg-gray-950 flex items-center justify-center px-5">
        <div className="w-full max-w-sm">
          {header}
          <div className="bg-gray-900 border border-amber-500/30 rounded-2xl px-5 py-4 mb-5 space-y-2">
            <p className="text-amber-200 text-sm font-semibold">This invite is for a different email</p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-500 text-xs">Invite sent to</span>
              <span className="text-gray-200 text-xs font-medium truncate">{inviteEmail}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-500 text-xs">You&apos;re signed in as</span>
              <span className="text-gray-400 text-xs font-medium truncate">{user.email ?? "an account with no email"}</span>
            </div>
          </div>
          <JoinSwitchAccount inviteEmail={inviteEmail} />
          <p className="text-center text-gray-600 text-xs mt-4 leading-relaxed">
            You&apos;ll sign out of this account, then sign in as {inviteEmail} to accept.
          </p>
        </div>
      </main>
    );
  }

  // Signed in with no profile yet — an account whose sign-in skipped
  // onboarding (e.g. an email link opened in another browser). /api/join would
  // answer "finish creating your account" with no way to do it; onboarding
  // provisions the profile and brings them straight back here.
  const [{ data: profile }, { data: ownedOffice }, { count: existingCards }] = await Promise.all([
    admin.from("profiles").select("id").eq("id", user.id).maybeSingle(),
    admin.from("offices").select("id").eq("owner_id", user.id).maybeSingle(),
    admin.from("cards").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);
  if (!profile) redirect(`/onboarding?next=${encodeURIComponent(`/join/${token}`)}`);

  // An office OWNER can't also join another team (/api/join refuses it).
  if (ownedOffice && ownedOffice.id !== officeId) {
    return (
      <DeadEnd
        title="You already run a team"
        message={`${user.email} owns a SwiftCard Office team, so it can't also join ${officeName ?? "another team"}. Ask the admin to invite a different email address, or end your Office plan first (Settings → Plan and billing).`}
        href="/dashboard"
        cta="Go to my dashboard →"
      />
    );
  }

  return (
    <main className="sc-app min-h-screen bg-gray-950 flex items-center justify-center px-5">
      <div className="w-full max-w-sm">
        {header}

        <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4 mb-5 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500 text-xs">Invite sent to</span>
            <span className="text-gray-300 text-xs font-medium truncate">{inviteEmail}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500 text-xs">Cost to you</span>
            <span className="text-xs font-bold text-green-400">Free — {officeName ?? "your team"} covers it</span>
          </div>
        </div>

        {/* Said BEFORE they accept (owner, 2026-10-06): an existing card comes
            with its history, and the team's admin console lists every contact
            on a teammate's card. Nobody with no card yet has anything to see. */}
        {(existingCards ?? 0) > 0 && (
          <p className="text-gray-500 text-xs leading-relaxed mb-5">
            {existingCards === 1 ? "Your card becomes your" : "Your cards become"} {officeName ?? "team"} {existingCards === 1 ? "card" : "cards"}, with
            the company look. The team&apos;s admin will see the contacts on {existingCards === 1 ? "it" : "them"} — your
            private notes stay yours.
          </p>
        )}

        <JoinButton token={token} />

        {/* No "Switch account": only the invited address can accept, and this
            IS the invited address — any other account would be refused. */}
        <p className="text-center text-gray-600 text-xs mt-4">
          Signed in as {user.email}
        </p>
      </div>
    </main>
  );
}
