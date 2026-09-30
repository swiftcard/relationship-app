import { NextRequest, NextResponse, after } from "next/server";
import Stripe from "stripe";
import { Resend } from "resend";
import { getStripe, subscriptionPeriodEndIso } from "@/lib/stripe";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { receiptEmail, trialStartedEmail, paymentFailedEmail } from "@/lib/email-templates";
import { markReferralConversion } from "@/lib/referral-server";
import { getAccountEmail } from "@/lib/account-email";
import { getOfficeBrand, stripBrandFromUserCards, memberFallbackPlan } from "@/lib/office-brand";
import { planFromPriceId } from "@/lib/subscription";
import { PLAN_LIMITS } from "@/lib/plan";
import { isDuplicateStripeEvent, clearStripeEvent } from "@/lib/stripe-idempotency";
import { reportError } from "@/lib/report-error";
import { insertNotification } from "@/lib/notify";
import { sendPushToUser } from "@/lib/push";
import { stripeDowngradeAllowed } from "@/lib/iap-entitlement";
import { provisionOfficeForOwner, tearDownOfficeForOwner, officeAccessEndedMessage } from "@/lib/office-billing-sync";
import { getOfficeSubUserContext } from "@/lib/office-roles";
import { PLAN_CHOSEN_KEY, sendWelcomeWhenCardLive } from "@/lib/welcome-email";
import { ledgerAdd, ledgerHas, recordProTrialStarted } from "@/lib/trial-ledger";
import { EVER_PAID_KEY, PRO_ENDED_PENDING_KEY, TRIAL_CHARGE_CENTS_KEY, TRIAL_CHARGE_INTERVAL_KEY, TRIAL_ENDS_KEY, anyInvoiceActuallyPaid, proEndedNotice, stripeTrialEndIso } from "@/lib/billing-state";
import { revalidateCardPage, revalidateUserCards } from "@/lib/card-page-data";
// The name billing mail greets with — the card's name first, since
// profiles.name is blank for normal signups ("Thank you, there."). Shared with
// the day-7 trial notice so both read it the same way.
import { greetingFirstName } from "@/lib/greeting-name";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// invoiceUrl is Stripe's CUSTOMER-facing hosted invoice link, passed in by the
// caller. It used to be built here as
// `https://dashboard.stripe.com/invoices/${invoiceId}` — the MERCHANT dashboard,
// which lands the customer on a Stripe login or permission wall with no invoice.
// Every receipt we have ever sent carried that button. The customer-facing URLs
// are `hosted_invoice_url` / `invoice_pdf` on the Invoice object.
//
// trialFirstChargeDate switches this to the trial-start template: a checkout
// that starts with a free trial or promo free days charges $0.00, and sending
// "Payment confirmed / processed successfully — $0.00" for that is both wrong
// and silent about when billing actually begins.
async function sendReceiptForUser(opts: {
  userId: string;
  planName: string;
  amountCents: number;
  interval: string;
  invoiceUrl?: string | null;
  trialFirstChargeDate?: string | null;
  /** Office only: seats on the subscription, shown as a receipt row. */
  seats?: number | null;
  /** Stripe's invoice number, so "Receipt #" matches what the customer sees
   *  in the billing portal (it used to be an invented SC-<timestamp>). */
  invoiceNumber?: string | null;
}) {
  const admin = getAdminSupabase();

  const [{ data: profile }, { data: prefs }] = await Promise.all([
    admin.from("profiles").select("name, email").eq("id", opts.userId).single(),
    admin.from("email_preferences").select("receipt_emails").eq("user_id", opts.userId).single(),
  ]);

  // Receipt goes to the ACCOUNT (auth) email, not profiles.email (which can be
  // the card's public contact address).
  const accountEmail = await getAccountEmail(opts.userId, profile?.email ?? null);
  // The receipts switch mutes RECEIPTS. The trial-start email is the first
  // charge's disclosure (date and amount), so it goes regardless — the same
  // rule as the day-7 notice (lib/trial-notice).
  if (!profile || !accountEmail || (prefs?.receipt_emails === false && !opts.trialFirstChargeDate)) return;

  // Guard against a duplicate send: if the webhook handler is retried after a
  // partial failure (e.g. a later step in the same event threw, or Stripe
  // redelivered), this same receipt path can run again within seconds/minutes.
  //
  // With a Stripe invoice number the guard is EXACT: the number is in the
  // receipt's subject ("Your SwiftCard receipt #ABC-0002 — $19.95"), so one
  // invoice is receipted once, ever — and two DIFFERENT charges minutes apart
  // (buying Office, then adding a seat) each get theirs. The old 10-minute
  // window swallowed the second. The trial-start email carries no number in
  // its subject, so it — and anything without a number — keeps the coarse
  // window as its backstop.
  const invoiceNo = (!opts.trialFirstChargeDate && opts.invoiceNumber?.trim()) || null;
  let dedupe = admin
    .from("email_logs")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("type", "receipt");
  dedupe = invoiceNo
    ? dedupe.ilike("subject", `%#${invoiceNo.replace(/[%_\\]/g, "\\$&")} —%`)
    : dedupe.gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  const { data: recentReceipt } = await dedupe.limit(1).maybeSingle();
  if (recentReceipt) return;

  const firstName = await greetingFirstName(admin, opts.userId, profile.name);
  const amount =`$${(opts.amountCents / 100).toFixed(2)}`;
  // The same string the de-dupe above searched for, so subject and guard agree.
  const invoiceNum = invoiceNo || opts.invoiceNumber?.trim() || `SC-${Date.now().toString().slice(-8)}`;

  const manageUrl = `${APP_URL}/settings/flows?billing=1`;
  const template = opts.trialFirstChargeDate
    ? trialStartedEmail({
        firstName,
        planName: opts.planName,
        amount,
        interval: opts.interval,
        firstChargeDate: opts.trialFirstChargeDate,
        seats: opts.seats ?? undefined,
        manageUrl,
      })
    : receiptEmail({
        firstName,
        email: accountEmail,
        planName: opts.planName,
        amount,
        interval: opts.interval,
        paymentDate: new Date().toLocaleDateString("en-US", {
          year: "numeric", month: "long", day: "numeric",
        }),
        invoiceNumber: invoiceNum,
        numberInSubject: !!invoiceNo,
        invoiceUrl: opts.invoiceUrl ?? undefined,
        seats: opts.seats ?? undefined,
        manageUrl,
      });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data: sent, error: sendError } = await resend.emails.send({ ...template, to: accountEmail });
  if (sendError || !sent?.id) {
    // Report and stop. Writing the log row anyway would claim a receipt that
    // never left, and the 10-minute dedupe above would then suppress a retry.
    await reportError("billing.email.receipt", sendError?.message ?? "no id returned", { userId: opts.userId });
    return;
  }

  await admin.from("email_logs").insert({
    user_id: opts.userId,
    email: accountEmail,
    type: "receipt",
    subject: template.subject,
    resend_id: sent.id,
  });
}

type PaymentFailedSituation = "grace" | "retry" | "trial_ended";

/**
 * Which plan an invoice is FOR — read from the invoice's own price, never
 * from profiles.plan. An Office MEMBER who still pays for their own Pro has
 * plan "enterprise" (their team seat), so their own Pro renewal was receipted
 * as "Office · 1 seat" and a failed Pro charge was called "your Office
 * payment" — the owner's plan, on a bill the owner never sees. profiles.plan
 * is only the fallback for a price this deployment doesn't know.
 */
function invoicePlanName(invoice: Stripe.Invoice, fallbackPlan: string | null | undefined): "Office" | "Pro" {
  for (const l of invoice.lines?.data ?? []) {
    const d = l?.pricing?.price_details?.price;
    const known = planFromPriceId(typeof d === "string" ? d : d?.id);
    if (known) return known.plan === "office" ? "Office" : "Pro";
  }
  return fallbackPlan === "enterprise" ? "Office" : "Pro";
}

async function sendPaymentFailedEmail(opts: { customerId: string; amountCents: number; situation: PaymentFailedSituation; invoice?: Stripe.Invoice }) {
  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, name, email, plan")
    .eq("stripe_customer_id", opts.customerId)
    .single();

  if (!profile) return;
  // Owner mail goes to the ACCOUNT (auth) email, not profiles.email.
  const accountEmail = await getAccountEmail(profile.id as string, (profile.email as string) ?? null);
  if (!accountEmail) return;

  const firstName = await greetingFirstName(admin, profile.id as string, profile.name as string | null);
  // "Office", never the internal "enterprise" id — this said "your SwiftCard
  // Enterprise plan" to Office owners (the receipts were fixed 2026-09-16).
  // From the failed invoice's own price when we have it (invoicePlanName).
  const planName = opts.invoice
    ? invoicePlanName(opts.invoice, profile.plan as string | null)
    : profile.plan === "enterprise" ? "Office" : "Pro";
  // Their OWN Pro while on someone else's team: the email must not say the
  // account "moves to Free" — the seat keeps everything (see the restore in
  // customer.subscription.deleted).
  const { data: seat } = await admin.from("office_members").select("office_id").eq("user_id", profile.id).eq("status", "active").limit(1).maybeSingle();
  const { data: owns } = await admin.from("offices").select("id").eq("owner_id", profile.id).limit(1).maybeSingle();
  const template = paymentFailedEmail({
    firstName,
    planName,
    amount: `$${(opts.amountCents / 100).toFixed(2)}`,
    manageUrl: `${APP_URL}/settings/flows?billing=1`,
    situation: opts.situation,
    teamMember: !!seat && !owns && planName === "Pro",
  });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data: sent, error: sendError } = await resend.emails.send({ ...template, to: accountEmail });
  if (sendError || !sent?.id) {
    await reportError("billing.email.payment_failed", sendError?.message ?? "no id returned", { userId: profile.id });
    return;
  }

  await admin.from("email_logs").insert({
    user_id: profile.id,
    email: accountEmail,
    type: "payment_failed",
    subject: template.subject,
    resend_id: sent.id,
  });

  // Push as well as email. Quiet hours apply to this like everything else —
  // the email has already gone, Stripe retries a decline over days, and a 3am
  // banner changes nothing. Never a sales message: it says what happened and
  // opens billing.
  //
  // A BELL ROW FIRST, and the push only if this call wrote it. Two reasons:
  //   • A failed payment used to leave no trace inside the app at all, and the
  //     8am catch-up is built from bell rows (type "payment_failed" is already
  //     in its map) — so a card declining at 11pm was held by quiet hours and
  //     then never mentioned again.
  //   • This whole handler is retried by Stripe if anything later in the event
  //     throws. insertNotification refuses identical words inside ten minutes,
  //     so the redelivery finds the row, returns false, and the phone does not
  //     buzz a second time for the same declined charge.
  const wrote = await insertNotification({
    user_id: profile.id as string,
    type: "payment_failed",
    title: "Payment failed",
    body: `Your ${planName} payment didn't go through.`,
  }).catch(() => false);
  if (!wrote) return;
  await sendPushToUser(profile.id as string, {
    category: "billing_problem",
    title: "Payment failed",
    body: `Your ${planName} payment didn't go through.`,
    url: `${APP_URL}/settings/flows?billing=1`,
    tag: "billing-problem",
  }).catch(() => {});
}


// ── Releasing a member without destroying the team ──────────────────────────
//
// Both automated cascades — a seat count shrinking, and the subscription ending
// — used to DELETE the office_members row. Two things were wrong with that.
//
// 1. The roster was unrecoverable. lib/office-roles states that "the offices row
//    outlives the subscription on purpose (so re-subscribing restores the
//    team)" — but every membership was hard-deleted, so re-subscribing meant
//    re-inviting all fourteen people and each of them accepting a fresh email.
//    The offices row surviving on its own restores nothing.
//
// 2. The member's cards were stranded. The manual removal path deliberately
//    clears is_office_card, with a comment explaining that without it "removal
//    was terminal". Neither cascade got that fix, so api/cards/[id] kept
//    refusing to bring those cards back online — "Your company manages this
//    card. Ask your Office admin" — when, after a lapse, there is no office and
//    no admin. Permanently dead short of a database edit.
//
// `suspended` fixes both. Every office query filters on status 'active' or
// 'pending', so a suspended row is inert: it reserves no seat, receives no
// brand, and its leads leave the office list — which is exactly what the old
// delete comment wanted. But the row survives, so provisionOfficeForOwner can
// restore it, and a fresh invite to the same address reuses it (the invite
// route flips any non-active row back to 'pending').
//
// Cards are NOT taken offline here, unlike a manual removal. Nobody did
// anything wrong: the company stopped paying. Their card stays live, loses the
// office branding, and becomes theirs again.
async function releaseOfficeMember(
  admin: ReturnType<typeof getAdminSupabase>,
  memberRowId: string,
  userId: string | null,
): Promise<void> {
  if (userId) {
    // Hand the cards back before the membership goes inert, so a failure here
    // cannot leave a card flagged to an office that no longer claims it.
    // Best-effort: a failure here must not stop the membership from going
    // inert, or a lapsed office would keep an active-looking member forever.
    try {
      await admin.from("cards").update({ is_office_card: false }).eq("user_id", userId);
    } catch { /* the suspend below is the part that must happen */ }
    // Their plan was settled by the team. Without a marker, an account created
    // after PLAN_STEP_REQUIRED_SINCE that falls to Free here reads as "never
    // chose a plan" (lib/card-active awaitingPlanChoice) and its card goes dark
    // — the opposite of this cascade's promise that the card stays live and
    // becomes theirs again. /api/join sets it now; this covers members who
    // joined before it did. Best-effort.
    try {
      const { data: prof } = await admin.from("profiles").select("customization").eq("id", userId).maybeSingle();
      const pc = (prof?.customization as Record<string, unknown> | null) ?? {};
      if (!pc[PLAN_CHOSEN_KEY]) {
        await admin.from("profiles").update({ customization: { ...pc, [PLAN_CHOSEN_KEY]: "office_member" } }).eq("id", userId);
      }
    } catch { /* best-effort */ }
  }
  await admin.from("office_members").update({ status: "suspended" }).eq("id", memberRowId);
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Idempotency: Stripe redelivers events (and retries after our 500s), so skip
  // anything we've already processed to avoid double receipts / double cascades.
  if (await isDuplicateStripeEvent(event.id, event.type)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Everything past signature verification runs inside a guard: an unexpected
  // failure while provisioning a plan / cascading a downgrade is a money-and-
  // access event, so we alert AND return 500 so Stripe retries the delivery
  // rather than dropping it silently.
  try {
  // ── First checkout / upgrade ─────────────────────────────────────────────────
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id;
    if (userId) {
      const lineItems = await getStripe().checkout.sessions.listLineItems(session.id, { limit: 1 });
      const priceId = lineItems.data[0]?.price?.id;
      // Recognise BOTH the monthly AND annual Office prices — matching only the
      // monthly one silently provisioned annual Office buyers as Pro.
      const mapped = planFromPriceId(priceId);
      // An unmapped price silently falling through to "pro" reintroduces the
      // exact "annual Office provisioned as Pro" bug when an env price var is
      // missing at runtime — alert instead of guessing. (billing audit #10)
      if (!mapped) {
        await reportError("stripe.webhook.unmapped_price", new Error(`Unmapped checkout price ${priceId}`), { eventId: event.id, priceId });
      }
      const isEnterprise = mapped?.plan === "office";
      const plan = isEnterprise ? "enterprise" : "pro";
      const seats = isEnterprise
        ? (session.metadata?.seats ? parseInt(session.metadata.seats) : (lineItems.data[0]?.quantity ?? PLAN_LIMITS.OFFICE_MIN_SEATS))
        : 1;

      // Card fingerprint for referral fraud dedup (same card on two accounts).
      // The same retrieve also answers the receipt's two questions: is this a
      // trial (so the $0.00 "Payment confirmed" receipt is the wrong email),
      // and if so, what is the recurring amount and the first charge date.
      let paymentFingerprint: string | null = null;
      let trialFirstChargeDate: string | null = null;
      let recurringCents: number | null = null;
      let trialEndsAt: string | null = null;
      // Set when the repeat-card rule below ends this trial on the spot: the
      // real charge then arrives on its own invoice (billing_reason
      // subscription_update), and THAT invoice's receipt is the right one —
      // this session's invoice is the $0.00 trial one.
      let trialEndedEarly = false;
      if (session.subscription) {
        // One retry, then fail the delivery. This used to be swallowed, and
        // a single failed lookup then sent a trial customer a "Payment
        // confirmed — $0.00" receipt, never recorded the trial (no ledger
        // entry, no day-7 charge notice, no dashboard trial banner) and
        // nothing ever retried. Nothing has been written yet at this point,
        // so a 500 here costs only a short wait: Stripe redelivers and the
        // whole event runs again with the subscription in hand.
        const retrieveSub = () => getStripe().subscriptions.retrieve(session.subscription as string, { expand: ["default_payment_method"] });
        let sub: Stripe.Subscription;
        try {
          sub = await retrieveSub();
        } catch {
          sub = await retrieveSub();
        }
        const pm = sub.default_payment_method as Stripe.PaymentMethod | null;
        paymentFingerprint = pm?.card?.fingerprint ?? null;
        trialEndsAt = stripeTrialEndIso(sub);
        // trial_end is the moment billing starts. Also treat a $0.00 total
        // as a trial even if trial_end is somehow absent — a "receipt" for
        // nothing is never the right email.
        const trialEnd = sub.trial_end ?? null;
        if (trialEnd || (session.amount_total ?? 0) === 0) {
          trialFirstChargeDate = trialEnd
            ? new Date(trialEnd * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
            : "when your free period ends";
        }
        // unit price × QUANTITY: Office is priced per seat, and quoting one
        // seat told a 5-seat office "then $3.99 monthly" before charging
        // $19.95 — in the trial email and in the day-7 charge notice that
        // exists to state the amount.
        {
          const item = sub.items?.data?.[0];
          recurringCents = item?.price?.unit_amount != null ? item.price.unit_amount * (item.quantity ?? 1) : null;
        }
        // …but a trial's FIRST charge is not always the list price: checkout
        // can pair the trial with a coupon (a /pricing promo, or a Stripe
        // promotion code typed on Stripe's page), and the trial email and the
        // day-7 notice — which Visa requires to state the amount — quoted
        // the undiscounted price. Stripe's own preview of the invoice the
        // trial will end with is the amount that will actually be taken.
        if (trialEnd) {
          try {
            const upcoming = await getStripe().invoices.createPreview({ subscription: sub.id });
            if (typeof upcoming.amount_due === "number" && upcoming.amount_due > 0) recurringCents = upcoming.amount_due;
          } catch { /* keep the list price — right unless a discount applies */ }
        }
      }

      // The customer-facing invoice link, and Stripe's own number for it, so
      // the receipt's "Receipt #" is one the customer can find in the portal.
      // Absent on a $0.00 trial checkout, which is fine — the trial email
      // doesn't show an invoice button.
      let invoiceUrl: string | null = null;
      let invoiceNumber: string | null = null;
      try {
        if (session.invoice) {
          const inv = await getStripe().invoices.retrieve(session.invoice as string);
          invoiceUrl = inv.hosted_invoice_url ?? inv.invoice_pdf ?? null;
          invoiceNumber = inv.number ?? null;
        }
      } catch (e) {
        console.error("[stripe] invoice fetch failed:", e);
      }

      const admin = getAdminSupabase();

      // ── One Pro trial per PERSON ─────────────────────────────────────────
      // Checkout already refused trial days to an account or email that has
      // had one (lib/trial-eligibility). What it cannot see is the CARD: a new
      // email is a new Stripe customer, so the same card could start trial
      // after trial. If this card has trialled before, end the trial now —
      // Stripe invoices immediately. Signing up and Pro itself are never
      // blocked; only the free period is.
      //
      // A promo code's free days are exempt (the owner issued that code on
      // purpose). Idempotent: a replay finds pro_trial_started_at already set
      // on this account (or the subscription no longer trialing) and skips.
      // So is the rest of a delete-flow gift (checkout `grant_bridge`): that
      // trial only moves the first charge to the day the free Pro they were
      // already given ends — ending it here would bill them for gifted days.
      const redemptionForTrial = session.metadata?.promo_redemption_id;
      const giftBridge = session.metadata?.grant_bridge === "1";
      const trialAccountEmail = trialEndsAt ? await getAccountEmail(userId, null) : null;
      if (trialEndsAt && session.subscription && !redemptionForTrial && !giftBridge) {
        const { data: markerRow, error: markerErr } = await admin
          .from("profiles")
          .select("pro_trial_started_at")
          .eq("id", userId)
          .maybeSingle();
        const alreadyStamped = !markerErr && !!(markerRow as { pro_trial_started_at?: string | null } | null)?.pro_trial_started_at;
        if (!alreadyStamped && paymentFingerprint && (await ledgerHas("card", paymentFingerprint))) {
          try {
            await getStripe().subscriptions.update(session.subscription as string, { trial_end: "now", proration_behavior: "none" });
            trialEndsAt = null;
            trialFirstChargeDate = null;
            trialEndedEarly = true;
          } catch (e) {
            // They keep this one trial. Worth knowing about, not worth failing
            // the provisioning of a subscription the customer did start.
            await reportError("stripe.webhook.repeat_trial_end_failed", e, { userId, subscription: session.subscription });
          }
        }
      }
      if (trialEndsAt) {
        // Record the trial against the card and the email (survives account
        // purge), and against the account (never cleared). Best-effort: the
        // upgrade below must not depend on the safeguards migration.
        await ledgerAdd("card", paymentFingerprint);
        await recordProTrialStarted(userId, trialAccountEmail);
      }

      // Spend the promo redemption. Checkout requires an UNCONSUMED row before
      // it will apply free days, and nothing used to ever consume one — so a
      // single redeemed code granted its free period again on every
      // re-subscribe. Stamped here rather than at session creation because this
      // is the first point the customer has actually received anything; an
      // abandoned Checkout must not burn their code.
      //
      // Deliberately not keyed on invoice payment: the exploit is to cancel
      // before the first bill, so a code consumed only on a successful invoice
      // would never be consumed in exactly the case that matters.
      const redemptionId = session.metadata?.promo_redemption_id;
      if (redemptionId) {
        const { error } = await admin
          .from("promo_code_redemptions")
          .update({ consumed_at: new Date().toISOString() })
          .eq("id", redemptionId)
          .is("consumed_at", null); // idempotent: a redelivered event won't re-stamp
        if (error) console.error("[stripe] promo redemption consume failed:", error);
      }

      // Guard against double-billing: if this customer already had a DIFFERENT
      // active subscription (e.g. clicked upgrade twice, or switched plans by
      // starting a new Checkout instead of using the billing portal), cancel
      // the old one now that the new one is confirmed active. Never cancel the
      // subscription we're about to write (defends against Stripe redelivering
      // this same event).
      const { data: priorProfile } = await admin
        .from("profiles")
        .select("stripe_subscription_id")
        .eq("id", userId)
        .single();
      const priorSubId = priorProfile?.stripe_subscription_id as string | null | undefined;
      if (priorSubId && priorSubId !== session.subscription) {
        try {
          await getStripe().subscriptions.cancel(priorSubId);
        } catch (e) {
          // A failure here means the customer is left on TWO simultaneously
          // active Stripe subscriptions, billed every cycle for both — this
          // must be visible, not just logged (code review: this was the one
          // remaining unchecked Stripe mutation in this file still using a
          // silent console.error after the same class of gap was fixed
          // elsewhere in this file tonight).
          await reportError("stripe.webhook.supersede_cancel_failed", e, { userId, priorSubId, newSubscriptionId: session.subscription });
        }
      }
      // Critical: upgrade the plan. Kept to pre-existing columns ONLY so it can
      // never be blocked by a not-yet-run REFERRAL_SETUP.sql migration.
      // supabase-js RESOLVES with { error } rather than throwing, so a failed
      // write used to return 200: the dedup marker stayed, Stripe never
      // retried, and the buyer had paid with no plan (and /checkout/success
      // spun on "Setting up…" forever). Throw so the handler 500s and Stripe
      // redelivers.
      const { error: planWriteError } = await admin.from("profiles").update({
        plan,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
      }).eq("id", userId);
      if (planWriteError) throw new Error(`plan write failed: ${planWriteError.message}`);
      // Referral columns (added by the migration) — best-effort; a missing column
      // just no-ops here and never affects the upgrade above.
      await admin.from("profiles").update({
        plan_expires_at: null, // a real paying customer — no free-month downgrade
        ...(paymentFingerprint ? { payment_fingerprint: paymentFingerprint } : {}),
      }).eq("id", userId);

      // Record Stripe as the source backing the plan (see lib/iap-entitlement:
      // a source may only revoke what it granted, so an Apple-subscription
      // expiry can never strip a plan Stripe is paying for). Best-effort,
      // separate write: the upgrade above must never be blocked by this.
      try {
        const { data: srcProfile } = await admin.from("profiles").select("customization").eq("id", userId).single();
        const srcCust = { ...((srcProfile?.customization as Record<string, unknown> | null) ?? {}) };
        // _planChosen is what releases the welcome email (lib/welcome-email).
        // Payment IS the plan decision for a paid plan, so it is settled here
        // and nowhere earlier — "Your SwiftCard is live" must not arrive while
        // somebody is still on the plan screen, or before they have paid.
        // A paid plan settles any open "Pro ended — choose" prompt, and the
        // legacy app-grant trial keys no longer describe this account.
        delete srcCust[PRO_ENDED_PENDING_KEY];
        delete srcCust._trial;
        delete srcCust._proWarnedFor;
        if (trialEndsAt) {
          srcCust[TRIAL_ENDS_KEY] = trialEndsAt;
          // What the card will actually be charged when the trial converts.
          // Stored now because the day-7 notice must quote it (lib/trial-notice),
          // and the trial row is the only place that knows the price the person
          // signed up at — a later price change must not rewrite their notice.
          if (recurringCents) srcCust[TRIAL_CHARGE_CENTS_KEY] = recurringCents;
          srcCust[TRIAL_CHARGE_INTERVAL_KEY] = mapped?.interval === "annual" ? "annually" : "monthly";
        } else {
          delete srcCust[TRIAL_ENDS_KEY];
          delete srcCust[TRIAL_CHARGE_CENTS_KEY];
          delete srcCust[TRIAL_CHARGE_INTERVAL_KEY];
        }
        await admin.from("profiles").update({
          customization: { ...srcCust, _planSource: "stripe", [PLAN_CHOSEN_KEY]: plan },
        }).eq("id", userId);
      } catch { /* best-effort */ }

      // The plan is settled and the card already exists (the guest flow creates
      // it before signup completes), so this is the moment the welcome is true.
      // Gated and idempotent — it no-ops if there is no card yet, and the
      // email_logs claim makes it once per account however often it is reached.
      after(() => sendWelcomeWhenCardLive(userId));
      // …and the moment the cards go live (lib/card-active rule 5).
      await revalidateUserCards(userId);

      // Referral: the friend just became a PAYING customer — grant the referrer
      // their one-time reward (verified Stripe event, never from the browser).
      try {
        await markReferralConversion(userId);
      } catch (e) {
        console.error("Referral reward error:", e);
      }

      // Send receipt — unless the trial was just ended early, whose real charge
      // is receipted from its own invoice (invoice.payment_succeeded below).
      if (!trialEndedEarly) try {
        await sendReceiptForUser({
          userId,
          // "Office", never the internal "enterprise" id (2026-09-16 audit:
          // receipts said "Enterprise", a name the product never uses).
          planName: plan === "enterprise" ? "Office" : "Pro",
          // On a trial the session total is $0.00, and showing that as the
          // price tells the customer nothing about what they'll pay. The
          // trial email needs the RECURRING amount ("then $X monthly").
          // A repeat-card trial ended above charges on a separate invoice after
          // this session closed at $0.00 — show the real recurring amount then too.
          amountCents: trialFirstChargeDate || !session.amount_total
            ? (recurringCents ?? session.amount_total ?? 0)
            : session.amount_total,
          interval: mapped?.interval === "annual" ? "Annual" : "Monthly",
          invoiceUrl,
          invoiceNumber,
          trialFirstChargeDate,
          seats: isEnterprise ? seats : null,
        });
      } catch (e) {
        console.error("Receipt email error:", e);
      }

      // Auto-create office for enterprise. Shared with the change-plan route
      // and the subscription.updated portal-swap path so an office gets the
      // SAME name regardless of which signup/upgrade path created it (code
      // review — this used to have its own slightly different name-fallback,
      // so an office's name depended on how it was purchased).
      if (isEnterprise) {
        await provisionOfficeForOwner(admin, userId, seats);
      }
    }
  }

  // ── Recurring billing — send receipt on every renewal ────────────────────────
  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice;
    if (invoice.customer) {
      const admin = getAdminSupabase();
      const { data: profile } = await admin
        .from("profiles")
        .select("id, plan, customization")
        .eq("stripe_customer_id", invoice.customer as string)
        .single();

      // The first money after a free trial arrives as an ordinary
      // "subscription_cycle" invoice, and its receipt said "Monthly renewal" —
      // for a subscription that had never been paid for. Read before the
      // trial marker is cleared just below.
      let firstChargeAfterTrial = false;
      if (profile?.id) {
        // Payment recovered — clear the grace-period clock so a future failure
        // starts fresh instead of inheriting an already-elapsed window. Cleared
        // on ANY successful invoice for this customer (not just renewals) —
        // e.g. the very first invoice retrying after a decline, or a seat-count
        // update invoice — otherwise a stale clock survives and the reminders
        // cron can cancel a customer who is actively paying.
        const cust = (profile.customization ?? {}) as Record<string, unknown>;
        // Money actually moved → this is a paying customer from now on, so a
        // later failed renewal gets the 7-day grace (see payment_failed). A
        // $0.00 trial-start invoice does not count.
        const becamePaying = (invoice.amount_paid ?? 0) > 0 && cust[EVER_PAID_KEY] !== true;
        firstChargeAfterTrial = becamePaying && typeof cust[TRIAL_ENDS_KEY] === "string";
        if (cust._paymentFailedAt || becamePaying) {
          const rest = { ...cust };
          delete rest._paymentFailedAt;
          if ((invoice.amount_paid ?? 0) > 0) {
            rest[EVER_PAID_KEY] = true;
            delete rest[TRIAL_ENDS_KEY];
          }
          await admin.from("profiles").update({ customization: rest }).eq("id", profile.id);
        }
      }

      // Skip the very first invoice — checkout.session.completed sends that receipt.
      if (invoice.billing_reason === "subscription_cycle" && profile?.id) {
        try {
          // Same `as unknown as` schema drift as current_period_end: the
          // top-level `price` on an invoice line no longer exists, so this
          // read was always undefined, planFromPriceId always returned null,
          // and the interval always fell through to "Monthly renewal" —
          // including on every annual Pro and annual Office renewal. The id
          // now lives at pricing.price_details.price (verified in the
          // installed SDK's InvoiceLineItems.d.ts).
          const line = invoice.lines?.data?.[0];
          const priceDetail = line?.pricing?.price_details?.price;
          const renewalPriceId = typeof priceDetail === "string" ? priceDetail : priceDetail?.id;
          const annualRenewal = planFromPriceId(renewalPriceId)?.interval === "annual";
          const renewalInterval = firstChargeAfterTrial
            ? (annualRenewal ? "Annual · first payment after your free trial" : "Monthly · first payment after your free trial")
            : (annualRenewal ? "Annual renewal" : "Monthly renewal");
          const renewalPlan = invoicePlanName(invoice, profile.plan as string | null);
          await sendReceiptForUser({
            userId: profile.id,
            planName: renewalPlan,
            amountCents: invoice.amount_paid,
            interval: renewalInterval,
            seats: renewalPlan === "Office" ? line?.quantity ?? null : null,
            // The renewal handler already HAS the invoice object, so the
            // customer-facing link is right here — no extra fetch.
            invoiceUrl: invoice.hosted_invoice_url ?? invoice.invoice_pdf ?? null,
            invoiceNumber: invoice.number ?? null,
          });
        } catch (e) {
          console.error("Renewal receipt error:", e);
        }
      }

      // Charged NOW by a change to the subscription: an Office owner adding
      // seats, an upgrade from Pro to Office (both invoiced immediately with
      // always_invoice), or a trial the repeat-card rule ended on the spot. The
      // card was charged and no email said so — receipts only went out for
      // checkout and renewals. $0.00 changes (a downgrade credited to the next
      // invoice) are not charges and get nothing.
      if (invoice.billing_reason === "subscription_update" && (invoice.amount_paid ?? 0) > 0 && profile?.id) {
        try {
          const lines = invoice.lines?.data ?? [];
          const priceOf = (l: (typeof lines)[number]) => {
            const d = l?.pricing?.price_details?.price;
            return typeof d === "string" ? d : d?.id;
          };
          const isProration = (l: (typeof lines)[number]) =>
            !!(l?.parent?.subscription_item_details?.proration || l?.parent?.invoice_item_details?.proration);
          // The line that is being paid FOR (positive), not the credit for the
          // unused time on what it replaced — its price names the plan and
          // interval now in force, and its quantity is the new seat count.
          const charged = [...lines].reverse().find((l) => (l.amount ?? 0) > 0) ?? lines[0];
          const nowPlan = planFromPriceId(priceOf(charged));
          const office = nowPlan ? nowPlan.plan === "office" : profile.plan === "enterprise";
          const prorated = lines.some(isProration);
          // The credit line for the unused time on what was there before.
          const credited = prorated ? lines.find((l) => (l.amount ?? 0) < 0) : undefined;
          const creditedPlan = credited ? planFromPriceId(priceOf(credited)) : null;
          const annual = nowPlan?.interval === "annual";
          const PRORATED = "prorated to your next billing date";
          const label = !prorated
            ? (annual ? "Annual" : "Monthly")
            : creditedPlan && nowPlan && creditedPlan.plan !== nowPlan.plan
              ? `Upgrade to ${office ? "Office" : "Pro"} · ${PRORATED}`
              : creditedPlan && nowPlan && creditedPlan.interval !== nowPlan.interval
                ? `Switched to ${annual ? "annual" : "monthly"} billing · ${PRORATED}`
                : office && (credited?.quantity ?? 0) < (charged?.quantity ?? 0)
                  ? `Seats added · ${PRORATED}`
                  : `Plan change · ${PRORATED}`;
          await sendReceiptForUser({
            userId: profile.id,
            planName: office ? "Office" : "Pro",
            amountCents: invoice.amount_paid,
            interval: label,
            seats: office ? charged?.quantity ?? null : null,
            invoiceUrl: invoice.hosted_invoice_url ?? invoice.invoice_pdf ?? null,
            invoiceNumber: invoice.number ?? null,
          });
        } catch (e) {
          console.error("Change receipt error:", e);
        }
      }
    }
  }

  // ── Failed renewal charge — start a 7-day grace period ───────────────────────
  // The customer keeps full access for 7 days to fix their payment method. The
  // daily reminders cron (/api/reminders) checks _paymentFailedAt and cancels
  // the subscription (triggering the downgrade below) if it's still unresolved
  // after 7 days. A recovered payment (invoice.payment_succeeded, above) clears
  // the clock. Stripe's own Smart Retries may also exhaust and cancel first —
  // either path lands on customer.subscription.deleted, which downgrades.
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    // Only a failed RENEWAL arms the 7-day cancellation fuse. This used to
    // stamp _paymentFailedAt for any failed invoice on the customer — a
    // one-off charge, a proration, a manual invoice — so a customer who is
    // current and paying could be put on a 7-day countdown to having their
    // subscription cancelled (and, for an Office owner, their whole team
    // downgraded). The sweep re-checks the live subscription status now too;
    // this stops the wrong ones being armed in the first place.
    const isCycleInvoice = invoice.billing_reason === "subscription_cycle";
    if (invoice.customer) {
      // The email says what is ACTUALLY about to happen. It used to go out
      // first, always promising "7 days… your plan stays fully active" — also
      // to a trial whose first charge failed, which is cancelled a few lines
      // below in the same minute (for an Office, the whole team with it), and
      // to non-renewal invoices, where no 7-day clock is ever started.
      let failedEmailSent = false;
      const sendFailed = async (situation: PaymentFailedSituation) => {
        if (failedEmailSent) return;
        failedEmailSent = true;
        try {
          await sendPaymentFailedEmail({
            customerId: invoice.customer as string,
            amountCents: invoice.amount_due,
            situation,
            invoice,
          });
        } catch (e) {
          console.error("Payment-failed email error:", e);
        }
      };
      try {
        const admin = getAdminSupabase();
        const { data: profile } = await admin
          .from("profiles")
          .select("id, customization, stripe_subscription_id")
          .eq("stripe_customer_id", invoice.customer as string)
          .single();
        if (profile?.id) {
          const cust = (profile.customization ?? {}) as Record<string, unknown>;

          // ── A trial whose FIRST charge failed gets no grace week ────────────
          // The 7-day grace exists so a PAYING customer with an expired card
          // doesn't lose their account overnight. Someone who has never paid —
          // a 14-day trial whose conversion charge just failed — would get up
          // to 21 days of Pro for nothing. Cancel now; subscription.deleted
          // below does the downgrade and asks them to choose.
          //
          // "Never paid" is asked of Stripe, not just our flag, because every
          // customer who paid before EVER_PAID_KEY existed lacks the flag. Any
          // doubt (the lookup fails) keeps the grace: wrongly cancelling a
          // paying customer is the worse mistake.
          const invoiceSubRaw = invoice.parent?.subscription_details?.subscription;
          const invoiceSubId = typeof invoiceSubRaw === "string" ? invoiceSubRaw : invoiceSubRaw?.id;
          // subscription_cycle = the trial ran out naturally; subscription_update
          // = a trial ended early (the repeat-card rule in checkout.completed).
          if (
            (isCycleInvoice || invoice.billing_reason === "subscription_update") &&
            invoiceSubId &&
            invoiceSubId === profile.stripe_subscription_id &&
            cust[EVER_PAID_KEY] !== true
          ) {
            let neverPaid = false;
            try {
              const paid = await getStripe().invoices.list({ subscription: invoiceSubId, status: "paid", limit: 20 });
              neverPaid = !anyInvoiceActuallyPaid(paid.data);
            } catch (e) {
              await reportError("stripe.webhook.never_paid_lookup_failed", e, { eventId: event.id, subscription: invoiceSubId });
            }
            if (neverPaid) {
              await sendFailed("trial_ended");
              await getStripe().subscriptions.cancel(invoiceSubId);
              return NextResponse.json({ received: true, canceledUnpaidTrial: true });
            }
          }
          // Only set on the FIRST failure for this billing cycle — a later retry
          // failing again must not push the deadline back out. And only for a
          // RENEWAL: a failed one-off or proration invoice is not a lapsed
          // subscription, and arming the fuse for one put a current customer
          // seven days from cancellation.
          if (isCycleInvoice && !cust._paymentFailedAt) {
            await admin.from("profiles").update({
              customization: { ...cust, _paymentFailedAt: new Date().toISOString() },
            }).eq("id", profile.id);
          }
        }
      } catch (e) {
        // This write is the ONLY trigger for the entire 7-day grace-period
        // sweep (see /api/reminders) — if it silently fails, nothing ever
        // downgrades a non-paying past_due customer. Must be visible, not
        // just logged (billing audit).
        await reportError("stripe.webhook.grace_period_tracking_failed", e, { eventId: event.id, customerId: invoice.customer });
      }
      await sendFailed(isCycleInvoice ? "grace" : "retry");
    }
  }

  // ── Subscription changed: cancel-scheduled, plan swap, or seat count ─────────
  // Fires for portal actions AND our own in-app endpoints; reconciles the DB so
  // the billing UI always reflects Stripe truth regardless of where the change
  // was made.
  if (event.type === "customer.subscription.updated") {
    const sub = event.data.object as Stripe.Subscription;
    const quantity = sub.items.data[0]?.quantity;
    const admin = getAdminSupabase();
    const { data: subProfile } = await admin
      .from("profiles")
      .select("id, plan, customization")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();

    if (subProfile?.id) {
      const cust = { ...((subProfile.customization as Record<string, unknown> | null) ?? {}) };
      let dirty = false;
      // Captured BEFORE any plan write below, so the Pro<->Office transition
      // is judged against the PRIOR plan, not the freshly-reconciled one —
      // gating the office provision/teardown on the post-write plan (as this
      // used to) makes the transition itself invisible (billing audit).
      const wasOffice = subProfile.plan === "enterprise";

      // 1) Mirror the scheduled-cancel state so the UI shows "cancels on <date>"
      //    + the Keep Subscription button, even when cancelled via the portal.
      const periodEndIso = subscriptionPeriodEndIso(sub);
      // 0) Mirror the trial end, so the dashboard banner and billing copy know
      //    when a charge is coming without calling Stripe on every page load.
      const trialEndIso = stripeTrialEndIso(sub);
      if ((cust[TRIAL_ENDS_KEY] ?? null) !== trialEndIso) {
        if (trialEndIso) cust[TRIAL_ENDS_KEY] = trialEndIso;
        else delete cust[TRIAL_ENDS_KEY];
        dirty = true;
      }
      // Keep the trial's charge amount beside the date (see TRIAL_CHARGE_CENTS_KEY).
      // A portal plan swap mid-trial lands here, not on checkout.session.completed,
      // so without this the day-7 notice would quote the OLD price.
      {
        const trialItem = sub.items?.data?.[0];
        const trialPrice = trialItem?.price;
        // × quantity — the whole bill, not one Office seat (see checkout.session.completed).
        const cents = trialEndIso && trialPrice?.unit_amount != null ? trialPrice.unit_amount * (trialItem?.quantity ?? 1) : null;
        const word = trialEndIso ? (trialPrice?.recurring?.interval === "year" ? "annually" : "monthly") : null;
        if ((cust[TRIAL_CHARGE_CENTS_KEY] ?? null) !== cents) {
          if (cents) cust[TRIAL_CHARGE_CENTS_KEY] = cents;
          else delete cust[TRIAL_CHARGE_CENTS_KEY];
          dirty = true;
        }
        if ((cust[TRIAL_CHARGE_INTERVAL_KEY] ?? null) !== word) {
          if (word) cust[TRIAL_CHARGE_INTERVAL_KEY] = word;
          else delete cust[TRIAL_CHARGE_INTERVAL_KEY];
          dirty = true;
        }
      }

      if (sub.cancel_at_period_end) {
        if (cust._cancelAtPeriodEnd !== true || cust._cancelAt !== periodEndIso) {
          cust._cancelAtPeriodEnd = true;
          cust._cancelAt = periodEndIso;
          dirty = true;
        }
      } else if (cust._cancelAtPeriodEnd) {
        delete cust._cancelAtPeriodEnd;
        delete cust._cancelAt;
        delete cust._cancelReason;
        dirty = true;
      }

      // 2) Reconcile the plan from the CURRENT price (a Pro↔Office swap done in
      //    the portal must not leave the DB on the old plan). Only while the sub
      //    is live (active/trialing/past_due) — a fully cancelled sub is handled
      //    by subscription.deleted.
      const mapped = planFromPriceId(sub.items.data[0]?.price?.id);
      const liveStatuses = ["active", "trialing", "past_due"];
      if (mapped && liveStatuses.includes(sub.status)) {
        const targetDbPlan = mapped.plan === "office" ? "enterprise" : "pro";
        // A TEAM MEMBER who kept their own Pro subscription (allowed — they
        // may want it for if they leave) is on "enterprise" through their
        // seat, which outranks it. Every renewal and every scheduled cancel of
        // that personal sub used to rewrite them to "pro" here, so the rest of
        // the app treated a seated member as a plain Pro user. Same check as
        // the subscription.deleted path's active-membership restore.
        const seatOutranks =
          targetDbPlan === "pro" && subProfile.plan === "enterprise" && !!(await getOfficeSubUserContext(subProfile.id));
        if (subProfile.plan !== targetDbPlan && !seatOutranks) {
          await admin.from("profiles").update({ plan: targetDbPlan }).eq("id", subProfile.id);
          subProfile.plan = targetDbPlan;
          // This live Stripe sub now backs the plan (see lib/iap-entitlement).
          cust._planSource = "stripe";
          dirty = true;

          // Reconcile the office row for a Pro<->Office swap made ANYWHERE
          // (Stripe portal included) — previously only the in-app change-plan
          // route did this, so a portal swap left Stripe/DB plan reconciled
          // but the office never provisioned (Pro->Office) or torn down
          // (Office->Pro, leaving every member with unpaid enterprise access
          // indefinitely). (billing audit)
          if (targetDbPlan === "enterprise" && !wasOffice) {
            const seats = sub.items.data[0]?.quantity ?? PLAN_LIMITS.OFFICE_MIN_SEATS;
            await provisionOfficeForOwner(admin, subProfile.id, seats);
          } else if (targetDbPlan === "pro" && wasOffice) {
            await tearDownOfficeForOwner(admin, subProfile.id);
          }
        }
      }

      if (dirty) await admin.from("profiles").update({ customization: cust }).eq("id", subProfile.id);
    }

    if (quantity) {
      const profile = subProfile;
      if (profile?.id && profile.plan === "enterprise") {
        const { data: office } = await admin.from("offices").select("id").eq("owner_id", profile.id).single();
        if (office) {
          await admin.from("offices").update({ seats: quantity }).eq("id", office.id);
          // Seats reduced below current headcount (e.g. self-service downgrade
          // via the billing portal) — trim the most-recently-added active
          // members so paid seat count and actual access stay in sync. Without
          // this, shrinking seats only lowers the bill while every existing
          // member keeps enterprise access forever.
          // Ordered by joined_at, NOT created_at: office_members has no
          // created_at column, so that query errored, activeMembers came back
          // null, and the trim below silently iterated nothing — seats (and the
          // bill) shrank while every member kept enterprise access. joined_at is
          // the right column anyway: it's set in the same update that flips a
          // row to "active" (api/join), and cleared whenever it reverts to
          // pending, so it's non-null for exactly the rows selected here.
          const { data: activeMembers } = await admin
            .from("office_members")
            .select("id, user_id, joined_at")
            .eq("office_id", office.id)
            .eq("status", "active")
            .not("user_id", "is", null)
            .order("joined_at", { ascending: true });
          // The owner occupies seat 1, so a quantity of N leaves N−1 seats for
          // members. Keep the oldest N−1 active members and trim the rest.
          const memberSeats = Math.max(0, quantity - 1);
          const overflow = (activeMembers ?? []).slice(memberSeats);
          const trimBrand = overflow.length ? await getOfficeBrand(office.id).catch(() => null) : null;
          for (const m of overflow) {
            if (m.user_id) {
              // Members with their own live subscription revert to Pro, not
              // free — being trimmed from a team must not clobber a plan
              // they're still paying for. And their cards drop the office
              // brand (only fields still matching it).
              const fallback = await memberFallbackPlan(m.user_id);
              await admin.from("profiles").update({ plan: fallback, office_id: null }).eq("id", m.user_id);
              await admin.from("profiles").update({ plan_expires_at: null }).eq("id", m.user_id);
              await stripBrandFromUserCards(m.user_id, trimBrand).catch(() => {});
              // Removed because the office's seat count shrank — tell them
              // why their access just changed (billing audit: members
              // previously got no notification of any kind).
              await insertNotification({
                user_id: m.user_id,
                type: "office_seat_trimmed",
                title: "Your Office access ended",
                body: officeAccessEndedMessage(fallback),
              }).catch(() => {});
            }
            await releaseOfficeMember(admin, m.id as string, m.user_id as string | null);
          }
        }
      }
    }
  }

  // ── Cancellation ─────────────────────────────────────────────────────────────
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const admin2 = getAdminSupabase();
    // Find the owner profile WITHOUT clearing stripe_subscription_id yet — the
    // previous version nulled that column in the SAME statement used to find
    // the row, which meant a retry after any failure mid-cascade below could
    // no longer locate the profile at all, silently skipping the member
    // downgrade cascade forever (billing audit: retry-idempotency gap).
    // stripe_subscription_id is only cleared as the FINAL step, once the
    // whole cascade has run.
    const { data: profile } = await admin2.from("profiles")
      .select("id, plan, customization")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();
    let stripeDowngraded = false;
    if (profile?.id) {
      // Re-check stripe_subscription_id at write time (not just at the
      // SELECT above) — otherwise a retry of this event arriving after the
      // customer already resubscribed (a new sub.id written in the
      // meantime) would downgrade a now-paying customer to free with no
      // guard, since the write would match on id alone. Mirrors the
      // original single atomic UPDATE...WHERE stripe_subscription_id this
      // replaced (code review).
      //
      // Source guard: Stripe may only revoke what Stripe granted. If the
      // current plan is backed by an Apple subscription (bought in the iOS
      // shell via IAP — see lib/iap-entitlement.ts), the customer is still
      // paying and this cancellation must not touch the plan.
      const src = ((profile.customization as Record<string, unknown> | null) ?? {})._planSource;
      if (stripeDowngradeAllowed(src as "stripe" | "apple" | undefined)) {
        const { data: downgradedRows } = await admin2
          .from("profiles")
          .update({ plan: "free" })
          .eq("id", profile.id)
          .eq("stripe_subscription_id", sub.id)
          .select("id");
        stripeDowngraded = (downgradedRows ?? []).length > 0;
      }
    }
    // Best-effort: clear any free-month expiry so the row can't later be mistaken
    // for an active subscriber (which would leak Pro forever), and drop the
    // scheduled-cancel mirror (the cancellation has now happened).
    if (profile?.id) {
      const cust = { ...((profile.customization as Record<string, unknown> | null) ?? {}) };
      delete cust._cancelAtPeriodEnd;
      delete cust._cancelAt;
      delete cust._cancelReason;
      delete cust[TRIAL_ENDS_KEY];
      // Pro just ended on this account: the dashboard asks them to choose —
      // subscribe, or continue on Free (components/ProEndedPanel). Cleared if
      // the membership check below finds they are still Office-entitled.
      if (stripeDowngraded) cust[PRO_ENDED_PENDING_KEY] = true;
      // Same stripe_subscription_id re-check as the plan write above — a
      // resubscribed customer's NEW subscription's cancel-mirror/expiry must
      // not be silently cleared by a stale write for the OLD, now-cancelled
      // one (code review).
      await admin2.from("profiles").update({ plan_expires_at: null, customization: cust }).eq("id", profile.id).eq("stripe_subscription_id", sub.id);
    }

    // If the person whose PERSONAL subscription just ended is still an active
    // member of someone else's PAID office, they remain entitled to enterprise
    // — the blanket downgrade above wrongly dropped them to free. Restore it
    // and re-link the office (stripe_subscription_id is cleared for them
    // regardless, at the very end of this block, since their own sub is
    // gone). (billing audit #6B) The office-OWNER path below is unaffected:
    // an owner's own sub ending correctly cascades to members.
    if (profile?.id) {
      const { data: membership } = await admin2
        .from("office_members")
        .select("office_id")
        .eq("user_id", profile.id)
        .eq("status", "active")
        .maybeSingle();
      if (membership?.office_id) {
        const { data: owningOffice } = await admin2.from("offices").select("owner_id").eq("id", membership.office_id).maybeSingle();
        if (owningOffice?.owner_id) {
          const { data: ownerProfile } = await admin2.from("profiles").select("plan").eq("id", owningOffice.owner_id).maybeSingle();
          if (ownerProfile?.plan === "enterprise") {
            await admin2.from("profiles").update({ plan: "enterprise", office_id: membership.office_id }).eq("id", profile.id);
            if (stripeDowngraded) {
              stripeDowngraded = false;
              const { data: restored } = await admin2.from("profiles").select("customization").eq("id", profile.id).maybeSingle();
              const restoredCust = { ...((restored?.customization as Record<string, unknown> | null) ?? {}) };
              delete restoredCust[PRO_ENDED_PENDING_KEY];
              await admin2.from("profiles").update({ customization: restoredCust }).eq("id", profile.id);
            }
          }
        }
      }
    }

    // Pro ended and they are on Free now — say so, once, and point at the
    // choice. The individual got NO notice of any kind before this (only Office
    // members did), so a trial that lapsed looked like the product breaking.
    // In-app only: this is a prompt to subscribe, which push-policy keeps out
    // of push. Public card pages are revalidated so extra cards go offline now,
    // not after the cache TTL.
    if (profile?.id && stripeDowngraded) {
      const endedSec = sub.ended_at ?? Math.floor(Date.now() / 1000);
      const wasTrial = !!sub.trial_end && endedSec <= sub.trial_end + 2 * 86400;
      // profile.plan is the plan BEFORE this downgrade: an Office owner hears
      // about Office and their team, not "Your Pro plan has ended".
      await insertNotification({ user_id: profile.id, type: "pro_ended", ...proEndedNotice(wasTrial, profile.plan as string | null) }).catch(() => {});
      const { data: ownCards } = await admin2.from("cards").select("username").eq("user_id", profile.id);
      for (const c of ownCards ?? []) revalidateCardPage(c.username as string);
    }

    if (profile?.id) {
      // Re-verify the subscription id hasn't changed since the initial
      // lookup (e.g. the owner resubscribed via a fresh Checkout session in
      // the narrow window since) before running this destructive member
      // cascade — the final writes below already guard on this; the cascade
      // itself needs the same guard so it can't downgrade every member of an
      // office whose owner is, by the time this runs, an active paying
      // customer again under a NEW subscription (code review).
      const { data: stillCurrent } = await admin2.from("profiles").select("stripe_subscription_id").eq("id", profile.id).maybeSingle();
      if (stillCurrent?.stripe_subscription_id === sub.id) {
        const admin = getAdminSupabase();
        const { data: office } = await admin.from("offices").select("id").eq("owner_id", profile.id).single();
        if (office) {
          const { data: activeMembers } = await admin
            .from("office_members")
            .select("id, user_id")
            .eq("office_id", office.id)
            .eq("status", "active")
            .not("user_id", "is", null);

          const cascadeBrand = (activeMembers ?? []).length ? await getOfficeBrand(office.id).catch(() => null) : null;
          for (const m of activeMembers ?? []) {
            if (m.user_id) {
              // Same rules as removal: own-subscription members land on Pro,
              // and the office brand comes off their cards.
              const fallback = await memberFallbackPlan(m.user_id);
              await admin.from("profiles").update({ plan: fallback, office_id: null }).eq("id", m.user_id);
              await admin.from("profiles").update({ plan_expires_at: null }).eq("id", m.user_id); // best-effort
              await stripBrandFromUserCards(m.user_id, cascadeBrand).catch(() => {});
              // Removed because the Office subscription ended — tell them why
              // their access just changed (billing audit: members previously
              // got no notification of any kind).
              await insertNotification({
                user_id: m.user_id,
                type: "office_subscription_ended",
                title: "Your Office access ended",
                body: officeAccessEndedMessage(fallback),
              }).catch(() => {});
            }
            // Suspend rather than delete — see releaseOfficeMember. The row
            // going inert is what the old delete was really after; keeping it
            // is what makes re-subscribing restore the team instead of
            // re-inviting fourteen people one at a time.
            await releaseOfficeMember(admin, m.id as string, m.user_id as string | null);
          }
        }
      }
    }

    // Clear the subscription link LAST — only once the entire cascade above
    // has run. Guarded on stripe_subscription_id still matching sub.id (not
    // just id) so a stale retry can never null out a DIFFERENT subscription
    // the customer resubscribed to in the meantime — it just no-ops instead,
    // same as the original single atomic UPDATE this replaced (code review).
    if (profile?.id) {
      await admin2.from("profiles").update({ stripe_subscription_id: null }).eq("id", profile.id).eq("stripe_subscription_id", sub.id);
    }
  }
  } catch (e) {
    await reportError("stripe.webhook", e, { eventType: event.type, eventId: event.id });
    // The dedup marker was inserted BEFORE the handler ran; a failed handler
    // must release it so Stripe's retry re-processes instead of being skipped
    // as a duplicate (which would drop the event permanently). (billing audit #1)
    await clearStripeEvent(event.id);
    return NextResponse.json({ error: "webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
