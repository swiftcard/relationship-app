import { isOptedOut } from "@/lib/messaging";
import { Resend } from "resend";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { welcomeEmail, unsubUrl, marketingHeaders } from "@/lib/email-templates";
import { ensureEmailPreferences } from "@/lib/email-prefs";
import { getAccountEmail } from "@/lib/account-email";
import { isPaidPlan } from "@/lib/plan";
import { isTestMailbox } from "@/lib/test-mailbox";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// ── Welcome email ────────────────────────────────────────────────────────────
//
// This logic lived only inside POST /api/welcome, and nothing ever called that
// route — not the app, not a cron, not a server action. (The /welcome PAGE is
// a different thing entirely.) So no signup has ever received a welcome email,
// and the template, the idempotency claim and its unique index were all dead
// code that looked alive.
//
// Extracted here so the app can call it directly instead of self-fetching its
// own HTTP route from a server component. The route still exists and now
// delegates to this, so any future caller behaves identically.
//
// WHEN IT SENDS: the first time the account HAS A CARD — never at signup
// (owner, 2026-09-11). The subject is "Your SwiftCard is live" and the body
// links to the card, so sending it the moment an account existed promised a
// card that did not, and linked to a URL that 404'd until the builder was
// finished. Signup and a finished card are minutes apart at best, and for
// anyone who abandons the builder they never happen at all.
//
// sendWelcomeWhenCardLive() below is the only thing the app calls. It is safe
// to call from every path that can create a card: it refuses when the account
// has none, and the email_logs claim inside sendWelcomeEmail makes it once per
// account however many times it is reached.

export type WelcomeResult = "sent" | "already_sent" | "skipped" | "failed";

/**
 * Send the welcome email once per account. Safe to call concurrently: the
 * email_logs insert is the atomic gate (a partial unique index on user_id
 * WHERE type='welcome'), so of two racing signup submissions exactly one
 * sends and the loser returns "already_sent".
 *
 * Never throws — a welcome email must not be able to fail a signup.
 */
export async function sendWelcomeEmail(userId: string, accountEmail: string | null | undefined): Promise<WelcomeResult> {
  if (!userId || !accountEmail) return "skipped";
  // A QA throwaway (`*@swiftcard-test.invalid`) is not a person, and a message
  // to it is a guaranteed bounce against our sender reputation — see
  // lib/test-mailbox.ts for the number. Skipped BEFORE the email_logs claim so
  // the log stays a record of mail that went to people.
  if (isTestMailbox(accountEmail)) return "skipped";
  // Nor to an address that bounced or reported spam (audit N-09).
  if (await isOptedOut("email", accountEmail)) return "skipped";
  try {
    const admin = getAdminSupabase();

    const { data: profile } = await admin
      .from("profiles")
      .select("name, username, office_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) return "skipped";

    // Cheap pre-check. The insert below is the real gate; this just avoids
    // building a template and burning an insert attempt on the common path.
    const { data: alreadySent } = await admin
      .from("email_logs")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "welcome")
      .maybeSingle();
    if (alreadySent) return "already_sent";

    await ensureEmailPreferences(userId, admin);
    const { data: prefsRow } = await admin
      .from("email_preferences")
      .select("unsubscribe_token")
      .eq("user_id", userId)
      .maybeSingle();

    // THE CARD THE EMAIL IS ABOUT. profiles.username is a legacy slug that may
    // not be any card the person can actually open — the card the email links
    // to has to be a real one, so the oldest card wins and the profile slug is
    // only a fallback for accounts that predate the cards table.
    const { data: firstCard } = await admin
      .from("cards")
      .select("username, name")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const slug = (firstCard?.username as string | null) || (profile.username as string | null);
    if (!slug) return "skipped";

    // THE NAME COMES OFF THE CARD FIRST. profiles.name is blank for every
    // account created through normal signup — the name is typed into the card
    // builder, not the signup form — so greeting from the profile made this
    // read "Your SwiftCard is live, there!" for exactly the people it is sent
    // to. The card is what the email is about; its name is the right one.
    const firstName =
      ((firstCard?.name as string | null) || (profile.name as string | null) || "").trim().split(" ")[0] || "there";

    const unsub = unsubUrl(prefsRow?.unsubscribe_token as string | undefined ?? "");
    // A team member (on an office they do not own) gets no "connect your CRM"
    // step — their contacts belong to the team.
    // The Office OWNER instead gets the two team-setup steps (invite, check
    // the branding). Asked of offices directly: the owner's own profile need
    // not carry office_id.
    // A failed lookup only loses the extra team steps, never the email.
    const owned = await admin.from("offices").select("id").eq("owner_id", userId).limit(1).maybeSingle()
      .then((r) => r.data, () => null);
    const officeOwner = !!owned;
    const officeMember = !!profile.office_id && !owned;
    const template = welcomeEmail({
      officeMember,
      officeOwner,
      firstName,
      cardUrl: `${APP_URL}/${slug}`,
      unsubscribeUrl: unsub,
    });

    // CLAIM before sending. The check above is a check-then-act that two
    // concurrent requests can both pass; this insert is what actually
    // serializes them.
    const { error: claimError } = await admin.from("email_logs").insert({
      user_id: userId,
      email: accountEmail,
      type: "welcome",
      subject: template.subject,
    });
    if (claimError) return "already_sent";

    const resend = new Resend(process.env.RESEND_API_KEY);
    // Resend RESOLVES {data, error} rather than throwing, so the error must be
    // read off the result — a .catch() here would never fire on an API-level
    // failure and the claim would stick, costing this user their welcome
    // email permanently.
    const { data: sent, error: sendError } = await resend.emails.send({
      ...template,
      to: accountEmail,
      // One-click unsubscribe headers, only when there is a token to resolve.
      ...(unsub ? { headers: marketingHeaders(unsub) } : {}),
    });

    if (sendError) {
      // Release the claim so a retry can still deliver it.
      await admin.from("email_logs").delete().eq("user_id", userId).eq("type", "welcome");
      console.error("[welcome] send failed:", sendError.message);
      return "failed";
    }

    if (sent?.id) {
      await admin.from("email_logs").update({ resend_id: sent.id }).eq("user_id", userId).eq("type", "welcome");
    }
    return "sent";
  } catch (e) {
    console.error("[welcome] unexpected error:", e instanceof Error ? e.message : e);
    return "failed";
  }
}

/** Set on profiles.customization the moment a plan is settled — "free" when the
 *  visitor confirms Free, or the plan name when Stripe/Apple provisions a paid
 *  one. The welcome email waits for it. */
export const PLAN_CHOSEN_KEY = "_planChosen";

/**
 * Send the welcome email if — and only if — the card is live AND the plan is
 * settled.
 *
 * THE ONE ENTRY POINT the app uses. Call it from anywhere a card can come into
 * existence or a plan can be decided; it is cheap, it never throws, and it
 * cannot double-send:
 *
 *   • no card yet            → "skipped"
 *   • card but no plan yet   → "skipped"
 *   • both, not yet welcomed → sends, and claims the row that blocks the rest
 *   • already welcomed       → "already_sent"
 *
 * ── WHY THE PLAN GATE (2026-09-15) ──────────────────────────────────────────
 * The card row is created the moment a guest's draft is claimed, which is now
 * BEFORE they have chosen a plan. Sending on card creation therefore mailed
 * "Your SwiftCard is live" to someone still sitting on the plan screen, and —
 * worse — before a Pro buyer had paid. The owner's rule is that the mail goes
 * out once the plan is settled: after payment for a paid plan, or on confirming
 * Free. Since 2026-09-16 that is also the moment a new account's card goes
 * live (lib/card-active rule 5), so the email and the card agree.
 *
 * The account email is resolved from AUTH, not from profiles.email — that
 * column drifts to the card's public contact address the moment someone sets
 * one (see lib/account-email.ts), and owner mail must never follow it.
 */
export async function sendWelcomeWhenCardLive(
  userId: string,
  fallbackEmail?: string | null,
): Promise<WelcomeResult> {
  if (!userId) return "skipped";
  try {
    const admin = getAdminSupabase();
    const { count } = await admin
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (!count) return "skipped";

    // A paid plan on the profile IS a settled plan, even without the marker —
    // an account upgraded by an admin, by Apple, or before this marker existed
    // must still be able to receive its welcome.
    const { data: profile } = await admin
      .from("profiles")
      .select("plan, customization")
      .eq("id", userId)
      .maybeSingle();
    const cust = (profile?.customization ?? {}) as Record<string, unknown>;
    const planSettled = !!cust[PLAN_CHOSEN_KEY] || isPaidPlan(profile?.plan as string | null);
    if (!planSettled) return "skipped";

    const to = await getAccountEmail(userId, fallbackEmail ?? null);
    return await sendWelcomeEmail(userId, to);
  } catch {
    // A welcome email may never break card creation.
    return "failed";
  }
}
