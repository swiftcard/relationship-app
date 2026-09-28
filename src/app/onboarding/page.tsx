import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/safe-next";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { applyReferralOnSignup, hashDevice } from "@/lib/referral-server";
import { ensureUniqueUsername } from "@/lib/username";
import { ensureEmailPreferences } from "@/lib/email-prefs";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { REF_COOKIE, SRC_COOKIE } from "@/lib/referral";
import { findPendingInviteForEmail } from "@/lib/pending-invite";

function accountHandle(email: string | undefined, userId: string): string {
  const base = (email?.split("@")[0] ?? "user").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "user";
  return `${base}-${userId.slice(0, 6)}`;
}

// Account provisioning: create an account-only profile (no card). Cards are created
// from the dashboard, where a "Create your card" empty state guides new users.
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; intent?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Only honour a same-origin relative redirect (no open-redirect). Used to send
  // a brand-new signup back to the guest editor so their pending draft is claimed.
  const { next, intent } = await searchParams;
  const safeNext = safeNextPath(next);

  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).single();

  if (!profile) {
    // Task 4: they tried to SIGN IN (intent=signin, set by the Google button on
    // the Sign-in tab) but have no SwiftCard account yet. Don't silently create
    // one — sign them out and bounce to Create-account with a clear message. Any
    // other path (create-account, a claimed guest draft, an office-team invite,
    // an email-confirmation link) has no signin intent and provisions normally.
    // …unless a TEAM INVITE is waiting for this address: the invitee who
    // installs the app and taps "Continue with Google/Apple" on the Sign-in tab
    // has no account yet by design (their admin only invited them). Turning
    // them away sent them in a loop; provision and take them to Join instead
    // (inviteLanding below). (2026-09-16 journey audit.)
    if (intent === "signin" && !(await findPendingInviteForEmail(user.email, user.id))) {
      try { await supabase.auth.signOut(); } catch { /* best-effort */ }
      // Preserve a same-origin continuation (e.g. a guest's card-draft claim) so
      // it survives the bounce and resumes once they create the account.
      redirect(`/login?error=no_account${safeNext ? `&next=${encodeURIComponent(safeNext)}` : ""}`);
    }

    const admin = getAdminSupabase();

    // SwiftCard is open to everyone — anyone who authenticates (email/password
    // OR Google/Apple) and has no profile yet gets one provisioned here. There is
    // NO signup invite code / invite-only gate. (The Task-4 "you don't have an
    // account" check runs earlier, in the auth callback, only for a SIGN-IN
    // attempt — a genuine Create-account flow always provisions.)
    // Card slugs and profile handles share ONE public namespace (/<slug>
    // resolves against both), and getOwnerUsernames treats a profile's handle as
    // an owned slug. Minting this handle without checking the cards table meant a
    // collision would silently hand the new account read/write access to another
    // user's leads for that slug. ensureUniqueUsername checks BOTH tables (and
    // suffixes on collision) — the same guard every other slug writer uses.
    const { error: insertErr } = await admin.from("profiles").insert({
      id: user.id,
      username: await ensureUniqueUsername(accountHandle(user.email ?? undefined, user.id), admin),
      name: "",
      title: "",
      company: "",
      email: user.email ?? "",
      phone: "",
      website: "",
      linkedin: "",
      instagram: "",
      twitter: "",
      tiktok: "",
      template: "classic-pro",
    });

    // A unique-violation (23505) usually means a concurrent request for this
    // SAME user already won the insert race — but profiles.username is ALSO
    // unique, so a 23505 could instead mean a (vanishingly rare, given
    // accountHandle() suffixes a slice of the user's own uuid) username
    // collision against a DIFFERENT user, in which case THIS user's row was
    // never created. Don't guess from the error code alone — re-check that
    // this user's own row actually exists before treating it as a safe,
    // already-provisioned duplicate (code review).
    const gotUniqueViolation = (insertErr as { code?: string } | null)?.code === "23505";
    let isDuplicate = false;
    if (gotUniqueViolation) {
      const { data: nowExists } = await admin.from("profiles").select("id").eq("id", user.id).maybeSingle();
      isDuplicate = !!nowExists;
    }
    if (insertErr && !isDuplicate) {
      console.error("[onboarding] profile insert failed:", insertErr.message);
      throw new Error("We couldn't finish setting up your account. Please refresh and try again, or contact support if this continues.");
    }

    // Mint the unsubscribe token alongside the profile. Without this row the
    // account has no token, so every marketing email we later send it carries
    // no working opt-out and no List-Unsubscribe headers. Best-effort: a failure
    // here must not block signup, and the send side now skips anyone missing it.
    await ensureEmailPreferences(user.id, admin);

    // NO WELCOME EMAIL HERE ANY MORE (owner, 2026-09-11). It used to go out
    // right here, at signup — but it is titled "Your SwiftCard is live" and it
    // links to the card, so it promised a card that did not exist yet and
    // linked to a URL that 404'd until the builder was finished. It is now sent
    // the first time the account actually HAS a card, from every path that can
    // create one (lib/welcome-email.ts → sendWelcomeWhenCardLive). An account
    // that never finishes a card never gets an email claiming it has one.

    // NOTE: the 14-day reverse trial is DISCONTINUED (owner decision, Jul 2026) —
    // new signups start on Free, and signup grants no plan of any kind. The
    // startProTrial() helper that used to implement it was deleted on
    // 2026-09-15 (see lib/referral-server.ts for why); anyone still holding a
    // timed grant is wound down by the daily cron reading plan_expires_at.

    // First-time signup: apply any referral/promo (free month, attribution,
    // fraud checks, referral row, own referral code). Only the request that
    // actually WON the insert race runs this — a concurrent duplicate must
    // never re-apply it (this used to double-grant a free month/credit).
    if (!isDuplicate) {
      const c = await cookies();
      const h = await headers();
      try {
        // The LEFTMOST x-forwarded-for hop is attacker-controlled — anyone can
        // prepend a fake IP and mint a fresh identity, which is exactly what the
        // referral IP-dedup fraud check is trying to catch. Use the shared
        // trusted-IP rule (x-real-ip, else the LAST hop) like every other caller.
        const trustedIp = clientIpFromHeaders(h);
        const ip = trustedIp === "unknown" ? null : trustedIp;
        // Same reasoning as the welcome email: several queries and fraud
        // checks that the new account should never wait on.
        // AWAITED, not after(): the plan step (/welcome, or the builder's gate)
        // reads the referral row to offer the friend's free month, and it can
        // render before an after() task finishes — the gift was then never
        // shown and lost for good once a plan was picked. The referrer's
        // notification inside is still deferred.
        await applyReferralOnSignup(user.id, {
          code: c.get(REF_COOKIE)?.value ?? null,
          source: c.get(SRC_COOKIE)?.value ?? null,
          ip,
          email: user.email ?? null,
          device: hashDevice(h.get("user-agent"), h.get("accept-language")),
        }).catch((e) => console.error("[onboarding] referral apply failed:", e));
      } catch (e) {
        console.error("[onboarding] referral apply failed:", e);
      }
    }

    // Brand-new account → return to a pending guest editor (to claim the draft)
    // if we have one, otherwise the dashboard with the App Store prompt.
    redirect(safeNext ?? (await inviteLanding(user.email, user.id)) ?? "/dashboard?welcome=1");
  }

  redirect(safeNext ?? (await inviteLanding(user.email, user.id)) ?? "/dashboard");
}

// Someone with an unaccepted team invite for this email who signed in some
// other way (typically: installed the iPhone app first, then Google) goes to
// the Join step, not to a dashboard that asks them to build a personal card.
// A tapped invite link arrives with ?next=/join/… and never reaches this.
async function inviteLanding(email: string | null | undefined, userId: string): Promise<string | null> {
  const invite = await findPendingInviteForEmail(email, userId);
  return invite ? `/join/${encodeURIComponent(invite.token)}` : null;
}
