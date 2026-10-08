import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

// Five sequential jobs run in ONE request here — the purge (≈20 deletes per
// expired account), seat reductions, downgrades, expiry warnings, then the
// sequence sends over a buffer of up to 50,000 rows. No maxDuration was set
// anywhere, so the platform default silently truncated the tail of the send
// list: no error, no alert, no retry, and the untouched contacts simply never
// heard from anyone. 300s is Vercel's ceiling on the current runtime.
//
// (This used to say "on the Pro plan". The project is on HOBBY, which matters
// for the thing right below this comment rather than for the duration: Hobby
// allows TWO cron jobs, DAILY ONLY. An hourly entry in vercel.json is not
// rejected at build time — it fails deploy validation and stops production
// updating at all. See .github/workflows/push-catchup.yml.)
export const maxDuration = 300;

// Automated SMS may only go out inside the recipient's 8am-9pm local window
// (TCPA, and the CTIA messaging principles). Leads carry no timezone, so this
// is evaluated against the widest span of US zones we serve rather than a
// per-recipient one: 08:00 in Hawaii (UTC-10) is 18:00 UTC, and 21:00 on the
// east coast (UTC-4, EDT) is 01:00 UTC the next day. Inside [18:00, 01:00) UTC
// it is therefore between 8am and 9pm EVERYWHERE in that span.
//
// Deliberately conservative: it refuses sends that might be fine for some
// recipients rather than allowing sends that are wrong for others. A real fix
// is to capture a lead timezone and window per contact — see the note in the
// audit — but this is correct for every recipient today.
export function withinSmsQuietHours(now: Date = new Date()): boolean {
  const h = now.getUTCHours();
  return h >= 18 || h < 1;
}
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";
import { isPaidPlan } from "@/lib/plan";
import { deliverToLead } from "@/lib/messaging";
import { getAccountEmail } from "@/lib/account-email";
import { expireFreeMonths } from "@/lib/referral-server";
import { purgeExpiredDeletedAccounts, reconcileDeletedSubscriptions } from "@/lib/account-purge";
import { applyDueSeatReductions } from "@/lib/office-scheduled-seats";
import { mirrorPendingPromosToApple, turnOffUsedUpAppleOffers } from "@/lib/apple-offer-codes";
import { insertNotification } from "@/lib/notify";
import { officeEndedNotice } from "@/lib/billing-state";
import { trialEndingSoonEmail, trialEndedEmail, unsubUrl, marketingHeaders } from "@/lib/email-templates";
import { sendTrialChargeNotices } from "@/lib/trial-notice";
import { canSendMarketing } from "@/lib/marketing-consent";
import { preferenceCenterUrl } from "@/lib/email-token";
import { reportError } from "@/lib/report-error";
import { cardIsOffline } from "@/lib/card-active";


// Automations send AS the card the contact came through: each card has its own
// name/title/company/email, so the sender identity (and the reply-to address)
// is the CARD's, with the owning profile supplying plan/settings/fallbacks.
// Legacy contacts on profile slugs resolve through the profile as before.
async function resolveCardSender(supabase: ReturnType<typeof getAdminSupabase>, username: string) {
  const { data: card } = await supabase
    .from("cards")
    .select("user_id, name, title, company, email, phone, is_offline")
    .eq("username", username)
    .maybeSingle();
  // A card an office admin took OFFLINE must stop sending too. Everything else
  // the card serves goes dark (card page, Swift Links, QR, wallet pass, lead
  // capture — see lib/card-active.ts), but automations never consulted it, so a
  // departed employee's card kept emailing and texting their contacts as them.
  // Nothing is deleted: bringing the card back online resumes the sequence.
  if (card && cardIsOffline(card)) return null;
  const profileSelect = "id, name, email, phone, company, title, flow_settings, plan, customization";
  const { data: profile } = card?.user_id
    ? await supabase.from("profiles").select(profileSelect).eq("id", card.user_id).maybeSingle()
    : await supabase.from("profiles").select(profileSelect).eq("username", username).maybeSingle();
  if (!profile) return null;
  // Deleted accounts send NOTHING — no automation may keep emailing/texting
  // a deleted account's contacts. Single choke point for both flows.
  if ((profile.customization as { _deleted?: boolean } | null)?._deleted) return null;
  // A CARD speaks only as itself. Filling its blank fields from the profile
  // signed card B's follow-ups with card A's legacy title/company and put the
  // private SIGNUP email in Reply-To (isolation audit 2026-09-24). The profile
  // stands in only for a legacy profile-card, which has no card row at all.
  const sender = card
    ? {
        name: (card.name as string) || (profile.name as string) || null,
        title: (card.title as string) || null,
        company: (card.company as string) || null,
        email: (card.email as string) || null, // replies go to the card's email
        phone: (card.phone as string) || null,
      }
    : {
        name: (profile.name as string) || null,
        title: (profile.title as string) || null,
        company: (profile.company as string) || null,
        email: (profile.email as string) || null,
        phone: (profile.phone as string) || null,
      };
  const ownerId = (card?.user_id as string) ?? (profile.id as string) ?? null;
  return { profile, sender, ownerId };
}

// Per-contact channel switches (email-paused / sms-paused tags) — each shuts
// that channel down entirely for this contact.
function channelPaused(tags: string[] | null | undefined, channel: "email" | "sms"): boolean {
  return (tags ?? []).includes(channel === "email" ? "email-paused" : "sms-paused");
}

type SeqStep = {
  day: number;
  time?: string;
  message: string;
  subject?: string;
  channel?: string;
  sent_at: string | null;
  anchor?: string;
  /** Claimed but did NOT go: "opted_out" (they unsubscribed) or "no_contact"
   *  (no email/phone for this channel). The claim (sent_at) stands so it is
   *  never retried; this is what stops the contact panel saying "Sent". */
  not_sent?: string;
};

const sameStep = (a: SeqStep, b: SeqStep) =>
  a.day === b.day && (a.channel ?? "email") === (b.channel ?? "email");

/**
 * Write `sent_at` for ONE step, against a freshly-read sequence.
 *
 * Two bugs this exists for.
 *
 * DUPLICATE SENDS. The loop used to deliver the message and THEN stamp, in two
 * un-transacted steps whose update error was never even read. Anything between
 * them — the 300s ceiling expiring mid-run, a transient PostgREST failure, a
 * manual retry overlapping the scheduled run — left the message delivered and
 * the step unstamped, so the next run sent the identical AI-written message to
 * the same contact again. (The comment there claimed it wrote per-step "so a
 * crash mid-run never re-sends what already went"; it described the opposite of
 * the code.) The caller now CLAIMS the step before sending and releases it only
 * on a transient failure, so the failure mode flips from "sent twice" to "sent
 * once or not at all" — the right side to be wrong on when a real person
 * receives it.
 *
 * CLOBBERED EDITS. The old write pushed a whole array snapshot read at the top
 * of a run that can last minutes, so an owner editing or resetting a sequence
 * mid-run had their change silently overwritten — or worse, deleted steps came
 * back. Re-reading here narrows that window to a single round trip and means we
 * never write back steps the owner has since removed.
 */
async function stampStep(
  supabase: ReturnType<typeof getAdminSupabase>,
  leadId: string,
  step: SeqStep,
  sentAt: string | null,
): Promise<{ ok: boolean; seq: SeqStep[] | null }> {
  const { data, error: readErr } = await supabase
    .from("leads")
    .select("follow_up_sequence")
    .eq("id", leadId)
    .single();
  if (readErr || !data) return { ok: false, seq: null };

  const fresh = (data.follow_up_sequence ?? []) as SeqStep[];
  // The owner may have removed this step while the run was in flight. Nothing
  // to claim, and re-adding it would resurrect something they deleted.
  if (!fresh.some((s) => sameStep(s, step))) return { ok: false, seq: fresh };

  const next = fresh.map((s) => (sameStep(s, step) ? { ...s, sent_at: sentAt } : s));
  const { error: writeErr } = await supabase
    .from("leads")
    .update({ follow_up_sequence: next })
    .eq("id", leadId);
  // The error was previously discarded, so a failed write meant the message
  // went out and the row still said unsent — a permanent daily re-send.
  if (writeErr) return { ok: false, seq: fresh };
  return { ok: true, seq: next };
}

/** Record WHY a claimed step did not go, keeping its claim (same re-read as stampStep). */
async function markNotSent(
  supabase: ReturnType<typeof getAdminSupabase>,
  leadId: string,
  step: SeqStep,
  reason: string,
): Promise<void> {
  const { data } = await supabase.from("leads").select("follow_up_sequence").eq("id", leadId).single();
  if (!data) return;
  const fresh = (data.follow_up_sequence ?? []) as SeqStep[];
  if (!fresh.some((s) => sameStep(s, step))) return;
  await supabase.from("leads")
    .update({ follow_up_sequence: fresh.map((s) => (sameStep(s, step) ? { ...s, not_sent: reason } : s)) })
    .eq("id", leadId);
}

// Email preferences for the two owner-directed plan-status emails below — same
// token/row the welcome email uses.
//   • unsubscribeUrl: the footer link + List-Unsubscribe header. Undefined (no
//     link shown) if the row hasn't been created yet; never blocks the send.
//   • marketingOk: whether this owner still accepts marketing mail. Someone who
//     one-click unsubscribed must NOT keep receiving upgrade-pitch mail carrying
//     a fresh unsubscribe link — that reads as ignoring their opt-out and is a
//     direct spam-complaint driver. The admin broadcast and promo senders
//     already skip these users; the cron didn't. A missing prefs row means
//     nobody has opted out yet → allowed.
async function getEmailPrefs(
  supabase: ReturnType<typeof getAdminSupabase>,
  userId: string,
): Promise<{ unsubscribeUrl?: string; marketingOk: boolean }> {
  const { data } = await supabase
    .from("email_preferences")
    .select("unsubscribe_token, marketing_emails")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    unsubscribeUrl: data?.unsubscribe_token ? unsubUrl(data.unsubscribe_token as string) : undefined,
    marketingOk: data?.marketing_emails !== false,
  };
}


export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  // The env var must exist AND match — with it unset, `Bearer undefined` would
  // otherwise pass and expose the whole send-run to anyone.
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const supabase = getAdminSupabase();
  const currentUTCHour = new Date().getUTCHours();
  let totalSent = 0;

  // Permanently delete accounts whose 30-day reopen window has passed. This is
  // what makes the "your data is removed for good" promise in the delete
  // dialog / Privacy Policy / Terms actually true (and satisfies Apple's
  // account-deletion requirement). Best-effort — never blocks the send run.
  let purged = 0;
  try {
    purged = await purgeExpiredDeletedAccounts();
  } catch (e) {
    await reportError("reminders.purge-deleted-accounts", e);
  }

  // A deleted account must never keep billing. Cancellation happens at delete
  // time; this retries the ones where Stripe was unreachable, so a transient
  // failure costs at most a day of wrong charges instead of continuing
  // indefinitely against a card whose owner can no longer log in to stop it.
  let subscriptionsStopped = 0;
  try {
    subscriptionsStopped = await reconcileDeletedSubscriptions();
  } catch (e) {
    await reportError("reminders.reconcile-deleted-subscriptions", e);
  }

  // Apply any Office seat reductions whose billing-period end has passed (spec §5).
  let seatReductionsApplied = 0;
  try {
    seatReductionsApplied = await applyDueSeatReductions();
  } catch (e) {
    await reportError("reminders.apply-seat-reductions", e);
  }

  // Promo codes not on Apple yet (made before App Store Connect was
  // connected, or Apple refused at the time) — so every code also works on the
  // iPhone app's Apple-billed Pro (lib/apple-offer-codes).
  let appleOfferCodesMade = 0;
  try {
    appleOfferCodesMade = await mirrorPendingPromosToApple();
    // …and a capped code that ran out on the website is turned off on Apple,
    // which can't hold a cap under 500 itself.
    await turnOffUsedUpAppleOffers();
  } catch (e) {
    await reportError("reminders.apple-offer-codes", e);
  }

  // Expire finished trial / free-month grants → back to Free, unless the user
  // converted to a paid subscription. Email each downgraded user what changed.
  let downgraded = 0;
  try {
    const downgradedUsers = await expireFreeMonths();
    downgraded = downgradedUsers.length;
    for (const u of downgradedUsers) {
      // Owner-directed mail goes to the ACCOUNT (auth) email, never profiles.email
      // (which can be the card's public contact address).
      // ALWAYS, before any email gating: losing Pro is an account-status
      // change, not marketing. The old comment justified skipping the email by
      // saying "the plan change is visible in-app" — it wasn't. No
      // notification was written anywhere, and the `_trialEnded` flag the job
      // sets is read by nothing. So a user who had opted out of marketing lost
      // Pro overnight in total silence: extra cards dark, sequences paused,
      // capture capped, and the first they knew of it was something breaking.
      // This is what makes that comment true.
      // A granted OFFICE ending (a tester code) is about the owner's TEAM, not
      // "your free month": expireFreeMonths has just released it, and the
      // office row it owns is kept for when they come back.
      const { data: ownedOffice } = await supabase.from("offices").select("id").eq("owner_id", u.id).limit(1).maybeSingle();
      await insertNotification({
        user_id: u.id,
        type: "plan_downgraded",
        ...(ownedOffice
          ? officeEndedNotice(u.wasTrial)
          : {
              title: u.wasTrial ? "Your free trial has ended" : "Your free month has ended",
              body: "Your account is back on the Free plan. Extra cards are offline and follow-up sequences are paused until you upgrade — nothing has been deleted.",
            }),
      });

      const to = await getAccountEmail(u.id, u.email);
      if (!to) continue;
      const { unsubscribeUrl: unsub, marketingOk } = await getEmailPrefs(supabase, u.id);
      // Honor the opt-out for the EMAIL only — the in-app notice above is
      // unconditional, so opting out of marketing no longer means finding out
      // by accident.
      if (!marketingOk) continue;
      // Same rule as the broadcast and promo senders: this mail carries an
      // unsubscribe footer and List-Unsubscribe headers, so it is marketing —
      // and marketing without a working opt-out doesn't go out. `unsub` is
      // undefined when the account has no email_preferences row, which used to
      // be every account. The downgrade itself is unaffected and visible in-app.
      if (!unsub) continue;
      // Lifecycle mail carries List-Unsubscribe, so by Gmail's own definition
      // it is bulk and the preference centre governs it too.
      if (!(await canSendMarketing(u.id as string, "product_updates"))) continue;
      const tpl = trialEndedEmail({
        firstName: u.name?.split(" ")[0] || "there",
        isTrial: u.wasTrial,
        // Same office check as the bell row above: a granted Office ending is
        // about the team, not "your free month of Pro".
        office: !!ownedOffice,
        unsubscribeUrl: unsub,
        prefsUrl: preferenceCenterUrl(u.id as string),
      });
      // One-click unsubscribe headers (Gmail/Yahoo requirement) on the lifecycle email.
      const { data: sent, error: sendError } = await resend.emails
        .send({ ...tpl, to, ...(unsub ? { headers: marketingHeaders(unsub) } : {}) })
        .catch((e: unknown) => ({ data: null, error: e instanceof Error ? e : new Error(String(e)) }));
      if (sendError || !sent?.id) {
        await reportError("reminders.trial-ended.email", sendError ?? "no id returned", { userId: u.id });
      } else {
        try {
          await supabase.from("email_logs").insert({ user_id: u.id, email: to, type: "trial_ended", subject: tpl.subject, resend_id: sent.id });
        } catch { /* logging is best-effort */ }
      }
    }
  } catch (e) {
    // Was console.error only, unlike the other three jobs in this cron. If
    // this throws, expired trials and free months keep full Pro indefinitely
    // and nobody is paged — a silent revenue leak, in the job whose entire
    // purpose is stopping it.
    console.error("[reminders] expireFreeMonths failed:", e);
    await reportError("reminders.expire-free-months", e);
  }

  // Heads-up ~3 days before an app-level Pro grant (trial / free month) ends.
  // For a fresh 14-day trial this lands on day 11. Fires once per expiry value
  // (tracked in customization._proWarnedFor); real subscribers are excluded.
  try {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const in3dIso = new Date(nowMs + 3 * 86400000).toISOString();
    const { data: ending } = await supabase
      .from("profiles")
      .select("id, email, name, plan, plan_expires_at, customization")
      // enterprise too: a TIMED enterprise grant expires straight to Free with no
      // heads-up when this is pro-only. Office sub-users are never caught here —
      // accepting an invite clears plan_expires_at, and this query requires it.
      .in("plan", ["pro", "enterprise"])
      .is("stripe_subscription_id", null)
      .not("plan_expires_at", "is", null)
      .gt("plan_expires_at", nowIso)
      .lte("plan_expires_at", in3dIso);
    for (const u of ending ?? []) {
      const cust = (u.customization ?? {}) as Record<string, unknown>;
      const expiresAt = u.plan_expires_at as string;
      if (cust._proWarnedFor === expiresAt) continue; // already warned for this expiry
      const daysLeft = Math.max(1, Math.ceil((new Date(expiresAt).getTime() - nowMs) / 86400000));
      // CLAIM this warning before sending, not after. The check above plus a
      // post-send stamp let two overlapping runs (the scheduled cron plus a
      // manual retry) both pass and both email the same user. Stamping first
      // means the second run sees _proWarnedFor and skips. Behaviour is
      // otherwise unchanged: this stamp always ran regardless of send outcome.
      await supabase.from("profiles").update({ customization: { ...cust, _proWarnedFor: expiresAt } }).eq("id", u.id);
      const to = await getAccountEmail(u.id as string, (u.email as string) ?? null);
      if (to) {
        const { unsubscribeUrl: unsub, marketingOk } = await getEmailPrefs(supabase, u.id as string);
        // This one is an upgrade pitch — never send it to someone who opted
        // out, and never without a working opt-out to offer (`unsub` is
        // undefined when the account has no email_preferences row).
        // Same category gate as the trial-ended mail above: this is an upgrade
        // pitch, and someone who paused or switched product updates off has
        // said not to send it.
        if (marketingOk && unsub && (await canSendMarketing(u.id as string, "product_updates"))) {
          const tpl = trialEndingSoonEmail({
            firstName: (u.name as string)?.split(" ")[0] || "there",
            daysLeft,
            isTrial: cust._trial === true,
            // A granted OFFICE ending is about the owner's team, never "your
            // free month of Pro … upgrade to Pro".
            office: u.plan === "enterprise",
            unsubscribeUrl: unsub,
            prefsUrl: preferenceCenterUrl(u.id as string),
          });
          // One-click unsubscribe headers (Gmail/Yahoo requirement) on the lifecycle email.
          const { data: sent, error: sendError } = await resend.emails
            .send({ ...tpl, to, ...(unsub ? { headers: marketingHeaders(unsub) } : {}) })
            .catch((e: unknown) => ({ data: null, error: e instanceof Error ? e : new Error(String(e)) }));
          if (sendError || !sent?.id) {
            await reportError("reminders.trial-ending-soon.email", sendError ?? "no id returned", { userId: u.id });
          } else {
            try {
              await supabase.from("email_logs").insert({ user_id: u.id, email: to, type: "trial_ending_soon", subject: tpl.subject, resend_id: sent.id });
            } catch { /* logging is best-effort */ }
          }
        }
      }
    }
  } catch (e) {
    // Same gap as expireFreeMonths above — this job reported to console only,
    // so a failure meant nobody was warned their plan was about to end and
    // nobody knew.
    console.error("[reminders] trial-ending warn failed:", e);
    await reportError("reminders.trial-ending-warn", e);
  }

  // Stripe trials: the ONE notice owed before the card is charged. The real
  // schedule is hourly (api/billing/trial-notice), because the notice has to
  // land within about an hour of exactly 7 days out to satisfy Visa and
  // Mastercard at once — see lib/trial-notice. This daily call is the backstop
  // for a stalled GitHub schedule: the shared function stamps
  // _trialChargeWarnedFor before sending, so it can never double-send.
  try {
    await sendTrialChargeNotices(supabase, resend);
  } catch (e) {
    console.error("[reminders] stripe trial warn failed:", e);
    await reportError("reminders.stripe-trial-warn", e);
  }

  // (Removed) The "you haven't shared your card yet" nudge email — users should
  // not receive engagement/reminder emails from SwiftCard.

  // Grace-period expiry: a failed renewal (invoice.payment_failed, in the Stripe
  // webhook) stamps customization._paymentFailedAt and keeps full access for 7
  // days. If payment is still unresolved once that window passes, cancel the
  // Stripe subscription here — Stripe then fires customer.subscription.deleted,
  // and the webhook's existing handler does the actual downgrade (including the
  // Office seat cascade), so there's one single source of truth for that logic
  // rather than duplicating it. A recovered payment clears _paymentFailedAt
  // (invoice.payment_succeeded, in the webhook) before this ever runs.
  try {
    // Filter to rows that actually HAVE the flag set, not every paid profile —
    // this keeps the result well under PostgREST's default page cap regardless
    // of total paid-user count (a plain .in("plan",...) fetch with no filter on
    // the flag itself would silently truncate at scale, letting payment-failed
    // users past the cap keep paid access forever).
    const { data: paidProfiles } = await supabase
      .from("profiles")
      .select("id, plan, customization, stripe_subscription_id")
      .in("plan", ["pro", "enterprise"])
      .not("stripe_subscription_id", "is", null)
      .not("customization->>_paymentFailedAt", "is", null);

    const stripe = getStripe();
    for (const u of paidProfiles ?? []) {
      const cust = (u.customization ?? {}) as Record<string, unknown>;
      const failedAt = cust._paymentFailedAt as string | undefined;
      if (!failedAt) continue;
      if (Date.now() - new Date(failedAt).getTime() < 7 * 86400000) continue; // still within the grace period

      try {
        // Re-read the subscription before cancelling it. The flag is stamped by
        // ANY failed invoice on the customer, with no billing_reason filter —
        // so a one-off or non-cycle invoice failing set a 7-day fuse on a
        // customer who is otherwise current and paying. Nothing between the
        // stamp and here ever checked whether the subscription had recovered,
        // and cancelling cascades: Office member downgrades, membership
        // deletion, the lot. Annual customers are the most exposed, because
        // the next successful invoice that would clear the flag can be months
        // away.
        //
        // Stripe is the authority on whether they're paid up, so ask it.
        const sub = await stripe.subscriptions.retrieve(u.stripe_subscription_id as string);
        if (sub.status === "active" || sub.status === "trialing") {
          // Healthy. The flag is stale — clear it and leave them alone.
          const healthy = { ...cust };
          delete healthy._paymentFailedAt;
          await supabase.from("profiles").update({ customization: healthy }).eq("id", u.id);
          continue;
        }
        if (sub.status === "canceled" || sub.status === "incomplete_expired") {
          // Already gone; the deleted-webhook has handled or will handle it.
          const done = { ...cust };
          delete done._paymentFailedAt;
          await supabase.from("profiles").update({ customization: done }).eq("id", u.id);
          continue;
        }

        await stripe.subscriptions.cancel(u.stripe_subscription_id as string);
        // Clear the marker so a FUTURE subscription (if they resubscribe later)
        // starts its own grace period instead of inheriting this expired one.
        const rest = { ...cust };
        delete rest._paymentFailedAt;
        await supabase.from("profiles").update({ customization: rest }).eq("id", u.id);
      } catch (e) {
        // A stuck cancel means a non-paying customer keeps paid access — alert.
        await reportError("reminders.grace-period.cancel", e, { profileId: u.id });
      }
    }
  } catch (e) {
    await reportError("reminders.grace-period.sweep", e);
  }


  // === PRESET-BASED SEQUENCE PROCESSING ===
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 86400000);

  // Page through EVERY lead that has a sequence. A single unpaginated select is
  // capped by PostgREST (1000 rows by default), and a fully-sent sequence stays
  // non-null forever — so once historical sequence-bearing contacts pass that
  // cap, every lead beyond it silently stops receiving follow-ups, with no error
  // anywhere. Keyset pagination on id (stable while rows are being updated in
  // the loop below) walks the whole set instead. The per-lead loop skips
  // already-stamped steps immediately, so completed sequences cost nothing.
  const SEQ_PAGE = 500;
  const SEQ_MAX = 50_000; // safety valve — reported, never silent
  const seqLeads: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    card_owner: string;
    created_at: string;
    follow_up_sequence: unknown;
    tags: string[] | null;
    status: string | null;
  }[] = [];
  let seqAfterId: string | null = null;
  for (;;) {
    let pageQuery = supabase
      .from("leads")
      .select("id, name, email, phone, card_owner, created_at, follow_up_sequence, tags, status")
      // "Not interested" now stops the cadence too. Only `dissolved` did, so an
      // owner who marked someone Not interested in the Office Leads tab watched
      // the full AI sequence keep going to a person they had explicitly written
      // off — the single most embarrassing way this automation can misfire.
      //
      // `or` with an explicit null arm because `status <> 'x'` is NULL (not
      // true) for a NULL status in SQL, so a plain .not() would silently drop
      // every lead whose status was never set.
      .or("status.is.null,and(status.neq.dissolved,status.neq.not_interested)")
      .not("follow_up_sequence", "is", null)
      .order("id", { ascending: true })
      .limit(SEQ_PAGE);
    if (seqAfterId) pageQuery = pageQuery.gt("id", seqAfterId);
    const { data: page } = await pageQuery;
    if (!page?.length) break;
    seqLeads.push(...(page as typeof seqLeads));
    seqAfterId = page[page.length - 1].id as string;
    if (page.length < SEQ_PAGE) break;
    if (seqLeads.length >= SEQ_MAX) {
      await reportError(
        "reminders.sequences.page-cap",
        new Error(`Sequence scan stopped at ${SEQ_MAX} leads — remaining follow-ups roll to the next run.`),
      );
      break;
    }
  }

  // Resolve each card owner once (identity + plan), cached across their leads.
  const ownerCache = new Map<string, Awaited<ReturnType<typeof resolveCardSender>>>();
  const getOwner = async (username: string) => {
    if (!ownerCache.has(username)) ownerCache.set(username, await resolveCardSender(supabase, username));
    return ownerCache.get(username)!;
  };
  // Notify each downgraded owner at most once per run about paused sequences.
  const seqPausedNotified = new Set<string>();

  for (const seqLead of seqLeads ?? []) {
    // One bad lead must not kill the whole run. deliverToLead swallows provider
    // errors, but a genuine throw (network failure resolving the card owner, a
    // notification write, a leads update) aborted the ENTIRE remaining loop and
    // 500'd the cron — every lead after the failing one silently skipped until
    // the next day. Every other phase of this cron is individually try/caught;
    // this loop was the exception. Body indentation left as-is to keep the diff
    // to the two lines that actually changed.
    try {
    const seq = seqLead.follow_up_sequence as { day: number; time?: string; message: string; subject?: string; channel?: string; sent_at: string | null; anchor?: string }[] | null;
    if (!seq?.length) continue;
    if ((seqLead.tags ?? []).includes("flow-paused")) continue;
    // The sample contact is not a person (its details are made up): an
    // automation set up on it to try the feature must never actually send.
    if ((seqLead.tags ?? []).includes("demo")) continue;

    // TEXT follow-ups are Pro; EMAIL ones send on every plan (owner,
    // 2026-09-11). This used to stop the WHOLE sequence for a non-paid account.
    //
    // The check moved DOWN to the step, beside the channel it is about — see
    // `ownerPaid` in the loop below. A free account's email steps go out
    // normally; its text steps are left unsent so they resume by themselves the
    // day the account is Pro, and the owner is told once. Nothing is deleted,
    // and the notice is only written when a text was actually held back, so
    // somebody running an email-only flow is never told their automations are
    // paused when they are not.
    const owner = await getOwner(seqLead.card_owner);
    if (!owner) continue;
    const ownerPaid = isPaidPlan(owner.profile.plan);

    // Back on a paid plan with sequences flowing again → clear the paused
    // marker so a future downgrade re-notifies.
    if (ownerPaid) {
      const cust = (owner.profile.customization ?? {}) as Record<string, unknown>;
      if (owner.ownerId && cust._seqPaused === true) {
        const rest = { ...cust };
        delete rest._seqPaused;
        await supabase.from("profiles").update({ customization: rest }).eq("id", owner.ownerId);
        (owner.profile as { customization?: unknown }).customization = rest; // keep cache coherent
      }
    }

    const createdAt = new Date(seqLead.created_at).getTime();
    // Sender = the CARD's identity (name/company/email of the card this contact
    // came through), so replies go to the right inbox.
    const seqSender = owner.sender;
    // Optional personal note the owner set (a calendar link, sign-off, etc.),
    // appended to every step of THIS user-built sequence.
    const customNote = ((owner.profile.flow_settings as { customNote?: string } | null)?.customNote ?? "").trim();

    // Working copy that ACCUMULATES sent_at stamps across this run. Stamping
    // against the original `seq` snapshot each time meant that when TWO steps
    // were due in one run (the catch-up case), the second write erased the
    // first step's stamp — and that step re-sent the next day.
    let curSeq = seq;
    // Channels this contact has already been messaged on during THIS run —
    // see the one-per-run guard below the channel checks.
    const sentThisRun = new Set<"email" | "sms">();

    for (const item of seq) {
      if (item.sent_at) continue;
      // Skip anything already stamped earlier in THIS run (same day+channel).
      const live = curSeq.find((s) => s.day === item.day && (s.channel ?? "email") === (item.channel ?? "email"));
      if (live?.sent_at) continue;
      // Steps schedule from their anchor (stamped when the sequence was set up)
      // so a flow added to an older contact still sends. Legacy items without an
      // anchor keep the original contact-creation reference.
      const anchorMs = item.anchor ? Date.parse(item.anchor) : NaN;
      const dueMs = (Number.isFinite(anchorMs) ? anchorMs : createdAt) + item.day * 86400000;
      // Send once the step is DUE, on the daily cron run — not gated to an exact
      // hour (a once-a-day cron would otherwise miss most steps). Overdue steps
      // (e.g. a missed cron day, or a flow un-paused) are caught up too; sent_at
      // below marks each step so nothing sends twice.
      if (dueMs >= todayEnd.getTime()) continue;

      const ownerFirst = seqSender.name?.split(" ")[0] ?? "there";
      const leadFirst = (seqLead.name as string).split(" ")[0];

      // Resolve the channel for this item — then honor the contact's
      // per-channel switch: a paused channel sends NOTHING.
      //
      // A step that names its channel keeps it. A LEGACY step (no channel on the
      // item) now prefers SMS for a contact who affirmatively opted in, falling
      // back to email as before. Consent is the whole gate: having a phone
      // number never routes a legacy step to SMS on its own, because the A2P
      // message flow we registered says ticking the box is the opt-in.
      //
      // Routing a consented contact here is safe against the guard below — it
      // re-checks sms-ok and would `continue` on a mismatch. The one behaviour
      // change worth knowing: outside SMS quiet hours a consented legacy step
      // now waits for the next run instead of going out as email that evening.
      // It is deferred, not lost — the claim is taken after these checks.
      const legacyTags = seqLead.tags ?? [];
      const legacyPrefersSms =
        legacyTags.includes("sms-ok") && !legacyTags.includes("sms-paused") && !!seqLead.phone;
      const itemChannel: "email" | "sms" =
        item.channel === "sms" ? "sms"
        : item.channel === "email" ? "email"
        : legacyPrefersSms ? "sms"
        : (seqLead.email ? "email" : "sms");
      // SMS is OPT-IN (TCPA): an automated text sends ONLY to a contact who
      // affirmatively consented — the sms-ok tag (checked the SMS box, or the
      // owner turned texts on for them). No consent tag, or an explicit
      // sms-paused, means NO automated text — even a phone-only lead. Email is
      // opt-in-by-sharing and only honors the email-paused toggle.
      if (itemChannel === "sms") {
        // TEXT IS PRO. Left unsent rather than skipped-forever: the step keeps
        // its empty sent_at, so the day the account is Pro it simply goes out.
        // Told once, and only when a text was really held — an email-only flow
        // on a free account must never be called "paused".
        if (!ownerPaid) {
          const cust = (owner.profile.customization ?? {}) as Record<string, unknown>;
          if (owner.ownerId && cust._seqPaused !== true && !seqPausedNotified.has(owner.ownerId)) {
            seqPausedNotified.add(owner.ownerId);
            await insertNotification({
              user_id: owner.ownerId,
              type: "sequence_paused",
              title: "Text follow-ups are paused",
              body: "Text follow-ups are part of Pro, so the texts in your follow-ups are waiting. Your email follow-ups are still sending, and nothing has been deleted.",
            }).catch(() => {});
            await supabase.from("profiles").update({ customization: { ...cust, _seqPaused: true } }).eq("id", owner.ownerId);
          }
          continue;
        }
        const t = seqLead.tags ?? [];
        if (!t.includes("sms-ok") || t.includes("sms-paused")) continue;
        // Quiet hours. The SMS path gated on CONSENT only, with no hour check
        // anywhere — so the daily cron's old 13:00 UTC slot put automated texts
        // on people's phones at 06:00 PDT / 05:00 PST / 03:00 HST, before the
        // 8am-9pm recipient-local window TCPA and the CTIA guidelines expect.
        // Leads carry no timezone, so this is enforced against the widest US
        // span rather than a per-recipient one. The cron moved to 18:00 UTC;
        // this is the guard that makes a future schedule change unable to
        // silently undo that. Email is unaffected — quiet hours are an SMS rule.
        if (!withinSmsQuietHours()) continue;
      } else if (channelPaused(seqLead.tags, "email")) {
        continue;
      }
      const asEmail = itemChannel === "email";

      // ONE MESSAGE PER CONTACT PER CHANNEL PER RUN. Overdue steps are caught
      // up (a missed cron day, a resumed flow) — but "caught up" used to mean
      // ALL of them, in one pass: an owner who re-upgraded after two months
      // had day 14, day 28 and day 56 land on the same person in the same
      // minute. Three emails at once from someone you met once reads as spam
      // and gets reported as it, which hurts every other sender on the
      // domain. The steps still all send — one per daily run, in order — so
      // nothing is lost, and a legitimately-missed single day is unaffected.
      if (sentThisRun.has(itemChannel)) continue;

      // CLAIM BEFORE SENDING. Recording the step first means a crash, timeout
      // or overlapping run can only ever LOSE a message, never duplicate one —
      // and if the claim cannot be written we do not send at all, because a
      // message we cannot prove we sent is one we will send again tomorrow.
      // This mirrors _proWarnedFor above, which already claims before emailing.
      const claimedAt = new Date().toISOString();
      const claim = await stampStep(supabase, seqLead.id as string, item, claimedAt);
      if (!claim.ok) {
        if (claim.seq) curSeq = claim.seq;
        continue;
      }
      curSeq = claim.seq ?? curSeq;
      // Counted at the claim, not the send result: a transient failure below
      // releases the claim for a later run, and this contact still should not
      // get a SECOND step on the same channel today.
      sentThisRun.add(itemChannel);

      const r = await deliverToLead({
        leadId: seqLead.id,
        cardOwner: seqLead.card_owner,
        lead: { email: seqLead.email, phone: seqLead.phone, name: seqLead.name },
        sender: { name: seqSender.name, company: seqSender.company, phone: seqSender.phone, email: seqSender.email, website: null },
        text: asEmail
          ? `Hi ${leadFirst},\n\n${item.message}${customNote ? `\n\n${customNote}` : ""}`
          : `${item.message}${customNote ? `\n\n${customNote}` : ""}`,
        subject: item.subject?.trim() || `${ownerFirst} following up`,
        cardUsername: seqLead.card_owner,
        channel: itemChannel,
        // Pro/Office = no SwiftCard branding on the message. (Sequences are
        // Pro-gated anyway, so this is effectively always true here — passed
        // explicitly rather than assumed.)
        senderPaid: isPaidPlan(owner.profile.plan as string | null),
      });

      // The claim stands for anything final — delivered, opted out, or no
      // contact details. Only a TRANSIENT failure is released, so the step is
      // retried on a later run instead of being burned.
      if (r.status === "sent") {
        totalSent++;
      } else if (r.status === "opted_out" || r.status === "no_contact") {
        // Final, and NOT sent — the panel must not say "Sent" for it.
        await markNotSent(supabase, seqLead.id as string, item, r.status).catch(() => {});
      } else {
        const released = await stampStep(supabase, seqLead.id as string, item, null);
        if (released.seq) curSeq = released.seq;
        // A step that keeps failing would otherwise retry every day forever
        // with nobody the wiser: sendRawEmail/sendBrandedEmail swallow a thrown
        // network error and return "failed", and nothing downstream looked at
        // it. Report it so a dead address or a missing API key is visible.
        await reportError("reminders.sequences.send-failed", {
          leadId: seqLead.id,
          day: item.day,
          channel: itemChannel,
          status: r.status,
        });
      }
    }
    } catch (e) {
      await reportError("reminders.sequences.lead", e);
    }
  }
  // === END PRESET-BASED SEQUENCE PROCESSING ===

  return NextResponse.json({ sent: totalSent, checkedHour: currentUTCHour, downgraded, purged, seatReductionsApplied, subscriptionsStopped, appleOfferCodesMade });
}
