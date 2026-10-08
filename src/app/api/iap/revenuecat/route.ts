import { NextResponse, after, type NextRequest } from "next/server";
import { revalidateUserCards } from "@/lib/card-page-data";
import { sendWelcomeWhenCardLive } from "@/lib/welcome-email";
import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { decideRcEvent, type PlanSource, appleGrantPatch, sandboxEventAllowed } from "@/lib/iap-entitlement";
import { recordProTrialStarted } from "@/lib/trial-ledger";
import { markProEnded } from "@/lib/pro-ended";
import { rcProActive } from "@/lib/revenuecat-rest";
import { recordAppleRedemption } from "@/lib/apple-offer-codes";

// ── RevenueCat webhook: the durable path from an App Store purchase to the
//    profiles.plan column ─────────────────────────────────────────────────────
//
// RevenueCat calls this for every subscription lifecycle event on the iOS
// shell's Pro subscription (App Review 3.1.1 remedy — see lib/iap.ts). The
// app_user_id is the Supabase user id, set at SDK configure time, so mapping
// an event to a profile is a primary-key lookup, not an email guess.
//
// Auth: RevenueCat sends the literal value configured in its dashboard as the
// Authorization header. We require `Bearer ${REVENUECAT_WEBHOOK_TOKEN}`.
// No token configured → endpoint refuses everything (fail closed, like every
// other IAP surface).
//
// Idempotent by construction: grants and revokes are absolute row states, not
// increments, so RevenueCat's retries and out-of-order deliveries converge.
// Source-guarding lives in lib/iap-entitlement.ts — Apple events can never
// downgrade a Stripe-paying customer.

const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only Supabase uids are ever set as app_user_id. Anonymous RC ids
 *  ($RCAnonymousID:...) and anything else can't map to a profile. */
function realUids(list: unknown): string[] {
  return (Array.isArray(list) ? list : [])
    .filter((v): v is string => typeof v === "string" && UID.test(v));
}

type Admin = ReturnType<typeof getAdminSupabase>;

/**
 * Run one lifecycle decision against one account: sandbox gate, profile
 * lookup, decideRcEvent, then the grant or revoke write. `eventType` is the
 * RevenueCat type the decision is made AS (a transfer's losing side is decided
 * as an EXPIRATION, its receiving side as a RENEWAL).
 */
async function applyEvent(
  admin: Admin,
  uid: string,
  eventType: string,
  opts: { environment?: string; periodType?: string },
): Promise<string> {
  // Sandbox events (a $0 purchase by a sandbox Apple ID — how App Review tests,
  // and how anyone with a sandbox tester account could farm free Pro) only
  // count for the designated review/test accounts. The auth lookup runs on the
  // rare sandbox path only.
  if (opts.environment?.toUpperCase() === "SANDBOX") {
    const { data: authUser } = await admin.auth.admin.getUserById(uid);
    if (!sandboxEventAllowed(authUser?.user?.email)) return "sandbox_not_allowed";
  }

  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, plan, customization, stripe_subscription_id, office_id")
    .eq("id", uid)
    .maybeSingle();
  if (error) throw new Error(`lookup_failed: ${error.message}`);
  if (!profile) return "no_profile";

  const customization = { ...((profile.customization as Record<string, unknown> | null) ?? {}) };
  const decision = decideRcEvent({
    eventType,
    currentPlan: (profile.plan as string | null) ?? null,
    planSource: customization._planSource as PlanSource | undefined,
    hasStripeSubscription: !!profile.stripe_subscription_id,
    isOfficeMember: !!profile.office_id,
  });

  if (decision.action === "grant") {
    // A grant event can arrive LATE: a RENEWAL that 500'd, then the
    // EXPIRATION, then RevenueCat's retry of the RENEWAL — and appleGrantPatch
    // clears plan_expires_at, so that was Pro forever (security audit
    // 2026-09-24). Ask RevenueCat what is true now; only a definite "no" stops
    // the grant, so an outage never keeps a paying customer out.
    if ((await rcProActive(profile.id as string)) === false) return "stale_grant";
    await admin
      .from("profiles")
      .update(appleGrantPatch(customization))
      .eq("id", profile.id);
    // Apple's intro offer is the Pro trial in the app. Apple enforces one per
    // Apple ID itself; recording it here stops the WEB offering a second one.
    if (opts.periodType?.toUpperCase() === "TRIAL") {
      const { data: authUser } = await admin.auth.admin.getUserById(profile.id as string);
      await recordProTrialStarted(profile.id as string, authUser?.user?.email ?? null);
    }
    // The plan is settled: cards go live now, and the welcome email can go.
    await revalidateUserCards(profile.id as string);
    after(() => sendWelcomeWhenCardLive(profile.id as string));
    return "grant";
  }

  if (decision.action === "revoke") {
    delete customization._planSource;
    await admin
      .from("profiles")
      .update({ plan: "free", customization })
      .eq("id", profile.id);
    // Same "Pro ended — choose" experience as a Stripe cancellation.
    await markProEnded(profile.id as string, { wasTrial: opts.periodType?.toUpperCase() === "TRIAL" });
    return "revoke";
  }

  if (decision.action === "forget_apple") {
    delete customization._planSource;
    await admin.from("profiles").update({ customization }).eq("id", profile.id);
    return "forget_apple";
  }

  return "ignore";
}

export async function POST(req: NextRequest) {
  const expected = process.env.REVENUECAT_WEBHOOK_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const want = Buffer.from(`Bearer ${expected}`);
  const got = Buffer.from(auth);
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const event = body?.event as
    | {
        type?: string;
        app_user_id?: string;
        original_app_user_id?: string;
        environment?: string;
        period_type?: string;
        /** The Apple offer code redeemed for this purchase, when there was one
         *  (the SwiftCard promo code's string — lib/apple-offer-codes). */
        offer_code?: string | null;
        cancel_reason?: string;
        transferred_from?: unknown;
        transferred_to?: unknown;
      }
    | undefined;
  if (!event?.type) return NextResponse.json({ error: "no_event" }, { status: 400 });
  const type = event.type.toUpperCase();
  const admin = getAdminSupabase();

  try {
    // ── Restore on a different SwiftCard account ─────────────────────────────
    // "Restore Purchases" while signed in to account B, with the Apple ID that
    // bought Pro on account A, moves the subscription to B. RevenueCat reports
    // that as TRANSFER, which carries transferred_from / transferred_to and NO
    // app_user_id — so it used to be skipped as "anonymous". B was granted by
    // the in-app sync, and A kept Pro for good: every later EXPIRATION goes to
    // B only, and nothing else ever looks at A. One subscription could unlock
    // any number of accounts.
    if (type === "TRANSFER") {
      const applied: Record<string, string> = {};
      for (const uid of realUids(event.transferred_from)) {
        // Take Pro off only if RevenueCat agrees this account has none left
        // (unknown → trust the event: the transfer is RevenueCat's own word).
        if ((await rcProActive(uid)) === true) { applied[uid] = "still_active"; continue; }
        applied[uid] = await applyEvent(admin, uid, "EXPIRATION", { environment: event.environment });
      }
      for (const uid of realUids(event.transferred_to)) {
        applied[uid] = await applyEvent(admin, uid, "RENEWAL", { environment: event.environment });
      }
      return NextResponse.json({ ok: true, transfer: applied });
    }

    const uid = [event.app_user_id, event.original_app_user_id].find(
      (v) => typeof v === "string" && v.length > 0 && !v.startsWith("$RCAnonymousID:"),
    );
    // Anonymous RC ids can appear on events that predate identification; there
    // is no profile to map them to. Acknowledge so RC stops retrying.
    if (!uid) return NextResponse.json({ ok: true, skipped: "anonymous" });
    // A 500 here would make RC retry it forever.
    if (!UID.test(uid)) return NextResponse.json({ ok: true, skipped: "not_a_uid" });

    // ── Refunds ───────────────────────────────────────────────────────────────
    // Apple support refunding the purchase ends access, but RevenueCat reports
    // it as a CANCELLATION (cancel_reason CUSTOMER_SUPPORT) — the same event
    // type as "auto-renew switched off, access continues", which is correctly
    // ignored. Nothing promised an EXPIRATION would follow, so a refunded buyer
    // could keep Pro. Ask RevenueCat: only a definite "no longer active"
    // revokes; anything unclear leaves the plan to the normal EXPIRATION.
    if (type === "CANCELLATION" && event.cancel_reason?.toUpperCase() === "CUSTOMER_SUPPORT") {
      if ((await rcProActive(uid)) === false) {
        const applied = await applyEvent(admin, uid, "EXPIRATION", { environment: event.environment, periodType: event.period_type });
        return NextResponse.json({ ok: true, applied, reason: "refund" });
      }
      return NextResponse.json({ ok: true, applied: "ignore", reason: "refund_still_active" });
    }

    const applied = await applyEvent(admin, uid, type, { environment: event.environment, periodType: event.period_type });
    if (applied === "sandbox_not_allowed" || applied === "no_profile") {
      return NextResponse.json({ ok: true, skipped: applied });
    }
    // ── A promo code redeemed through Apple ──────────────────────────────────
    // The SwiftCard code lives on Apple under the same string (lib/apple-
    // offer-codes), and Apple counts its own redemptions — this is the ONE
    // ledger: the use is counted against the code like a website redemption,
    // once per account, and the Apple copy is turned off when the cap is hit.
    // Only the purchase that started the offer counts (an INITIAL_PURCHASE,
    // or a lapsed subscriber's RENEWAL); the offer_code rides along on every
    // later renewal of that subscription too.
    let promo: string | undefined;
    if (applied === "grant" && typeof event.offer_code === "string" && event.offer_code.trim() && (type === "INITIAL_PURCHASE" || type === "RENEWAL" || type === "NON_RENEWING_PURCHASE" || type === "UNCANCELLATION")) {
      promo = await recordAppleRedemption(admin, { code: event.offer_code, userId: uid });
    }
    return NextResponse.json({ ok: true, applied, ...(promo ? { promo } : {}) });
  } catch {
    // A failed lookup must be retried by RevenueCat, not acknowledged.
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
}
