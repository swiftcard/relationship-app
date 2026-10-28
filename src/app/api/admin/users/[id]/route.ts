import { NextRequest, NextResponse } from "next/server";
import { isApplePaid } from "@/lib/iap-entitlement";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getAccountEmail } from "@/lib/account-email";
import { requireAdmin } from "@/lib/admin";
import { REFERRAL, freeMonthDays } from "@/lib/referral";
import { DELETION_GRACE_DAYS } from "@/lib/deletion-grace";
import { planFromPriceId } from "@/lib/subscription";
import { reasonText, savedByText } from "@/app/admin/_ui/reasons";
import { loadAccount, hasLegacyProfileCard } from "@/lib/admin-data/accounts";
import { dailyActivity, perCardTotals, recentContacts, totalsFor } from "@/lib/admin-data/customer-stats";
import { getSubscription, monthlyCents } from "@/lib/admin-data/billing";

// Everything the admin needs about ONE user: identity, plan, how they pay
// (and, for a Stripe customer, the live subscription from Stripe), every card
// with its own views and contacts, 30-day activity in New York days, recent
// contacts — and `leaving`: if they closed the account or opened the delete /
// cancel flow, why, in their own words (customization._deletion/_retention).
// Every count goes through lib/admin-data/customer-stats: the same database
// aggregates the customer's own pages use, so the numbers agree with what
// they see (no 1,000-row cap, no sample contact, card and Swift Links apart).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const admin = getAdminSupabase();
  const a = await loadAccount(id);
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ data: extra }, { data: cardRows }, { data: refRows }] = await Promise.all([
    admin.from("profiles").select("phone, website, photo_url, referred_by, referral_reward_earned").eq("id", id).maybeSingle(),
    admin.from("cards").select("id, username, label, name, title, company, template, created_at, is_offline").eq("user_id", id),
    admin.from("referrals").select("status, reward_granted").eq("referrer_id", id),
  ]);

  // A legacy profile card only by the public page's own rule (not migrated,
  // has a name, no card at that slug) — the admin used to skip "has a name"
  // and showed every customer a phantom "(primary)" card.
  const legacy = hasLegacyProfileCard({ username: a.username, profileName: a.profileName, customization: a.customization, cardSlugs: a.cards.map((c) => c.username) });
  const withLegacy = legacy && a.username
    ? { ...a, cards: [...a.cards, { id: "profile", username: a.username, name: a.profileName, label: null, created_at: a.createdAt, is_offline: false }] }
    : a;

  const [totalsMap, perCard, series, recent, sub] = await Promise.all([
    totalsFor([a]),
    perCardTotals(withLegacy),
    dailyActivity(a, 30),
    recentContacts(a, 12),
    a.stripeSubscriptionId ? getSubscription(a.stripeSubscriptionId) : Promise.resolve(null),
  ]);
  const totals = totalsMap.get(a.id)!;

  // Referral earnings (3 valid signups = 1 claimable month, tap-to-claim, max 3).
  const validRefs = (refRows ?? []).filter((r) => r.status !== "flagged" && r.status !== "self_referral");
  const refClaimedRows = validRefs.filter((r) => r.reward_granted).length;
  const refMonthsClaimed = Math.min(3, Math.floor(refClaimedRows / 3));
  const refMonthsClaimable = Math.max(0, Math.min(3, Math.floor(Math.min(validRefs.length, 9) / 3)) - refMonthsClaimed);

  // referred_by is the REFERRER'S user id — resolve it to a human identity,
  // labeled by the referrer's AUTH signup email (profiles.email drifts to the
  // card's public contact email — see lib/account-email).
  let referredBy: { id: string; name: string | null; email: string | null } | null = null;
  if (extra?.referred_by) {
    const ref = await loadAccount(extra.referred_by as string);
    if (ref) referredBy = { id: ref.id, name: ref.name, email: ref.email ?? (await getAccountEmail(ref.id, null)) };
  }

  const byId = new Map((cardRows ?? []).map((c) => [c.id as string, c]));
  const cardList = a.cards.map((c) => {
    const row = byId.get(c.id) ?? {};
    const t = perCard.get(c.id);
    return { ...row, id: c.id, username: c.username, label: c.label, name: c.name, is_offline: c.is_offline, leads: t?.leads ?? 0, cardViews: t?.views ?? 0, linkViews: t?.swiftlinkViews ?? 0 };
  });
  const legacyStats = perCard.get("profile");

  const custAll = a.customization;
  // Why they left, or nearly did. The delete flow writes _deletion (the
  // final answer) and every pass through its first step appends to
  // _retention.surveys; an offer they took is _retention.savedBy.
  const ret = (custAll._retention ?? {}) as { surveys?: { reason?: string; comment?: string; plan?: string; at?: string }[]; savedBy?: string; savedAt?: string };
  const del = custAll._deletion as { reason?: string; comment?: string; plan?: string; at?: string } | undefined;
  const closed = custAll._deleted === true;
  const surveys = ret.surveys ?? [];
  const last = surveys[surveys.length - 1];
  const leaving = closed || surveys.length > 0
    ? {
        closed,
        closed_at: closed ? del?.at ?? null : null,
        purge_at: closed && del?.at ? new Date(Date.parse(del.at) + DELETION_GRACE_DAYS * 86_400_000).toISOString() : null,
        plan_at_close: closed ? del?.plan ?? null : null,
        reason_text: (del?.reason || last?.reason) ? reasonText(del?.reason || last?.reason, del?.plan ?? last?.plan) : null,
        comment: del?.comment || last?.comment || null,
        surveys: surveys.map((s) => ({ at: s.at ?? "", plan: s.plan ?? null, reason_text: reasonText(s.reason, s.plan), comment: s.comment || null })),
        saved_by_text: savedByText(ret.savedBy),
        saved_at: ret.savedAt ?? null,
      }
    : null;

  // The live subscription, straight from Stripe (an error note when Stripe
  // doesn't return it, so the page says so instead of guessing).
  const subscription = a.stripeSubscriptionId
    ? sub
      ? {
          status: sub.status,
          plan: planFromPriceId(sub.items[0]?.priceId)?.plan ?? null,
          interval: sub.items[0]?.interval === "year" ? "annual" : "monthly",
          unitCents: sub.items[0]?.unitAmount ?? 0,
          quantity: sub.items[0]?.quantity ?? 1,
          monthlyCents: monthlyCents(sub),
          discount: sub.discounts[0] ? { percentOff: sub.discounts[0].percentOff, amountOff: sub.discounts[0].amountOff, duration: sub.discounts[0].duration, end: sub.discounts[0].end } : null,
          trialEnd: sub.trialEnd ? new Date(sub.trialEnd * 1000).toISOString() : null,
          periodEnd: sub.periodEnd ? new Date(sub.periodEnd * 1000).toISOString() : null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          created: new Date(sub.created * 1000).toISOString(),
          livemode: sub.livemode,
        }
      : { error: "Stripe didn't return this subscription (it may have been deleted, or Stripe is unreachable)." }
    : null;

  return NextResponse.json({
    leaving,
    subscription,
    user: {
      billing: a.billing.source,
      billingState: a.billing,
      kind: a.kind,
      office_role: a.officeRole,
      id: a.id, username: a.username, name: a.name,
      // Account identity = auth signup email, never the card's contact email.
      email: a.email,
      plan: a.plan,
      effective_plan: a.effectivePlan,
      plan_expires_at: a.planExpiresAt, created_at: a.createdAt,
      company: a.company, title: a.title, phone: extra?.phone ?? null, website: extra?.website ?? null, photo_url: extra?.photo_url ?? null,
      signup_source: a.signupSource, referral_code: a.referralCode,
      referred_by: referredBy, referral_reward_earned: extra?.referral_reward_earned ?? false,
      deleted: a.deleted,
      apple: isApplePaid(a.customization),
    },
    cards: cardList,
    profileCard: legacy && a.username
      ? { username: a.username, leads: legacyStats?.leads ?? 0, cardViews: legacyStats?.views ?? 0, linkViews: legacyStats?.swiftlinkViews ?? 0 }
      : null,
    totals: {
      leads: totals.leads,
      lockedLeads: totals.lockedLeads,
      views: totals.views,
      swiftlinkViews: totals.swiftlinkViews,
      contactsSaved: totals.contactsSaved,
      leads30: series.reduce((n, d) => n + d.leads, 0),
      views30: series.reduce((n, d) => n + d.views, 0),
      referred: validRefs.length,
      referralMonthsClaimed: refMonthsClaimed,
      referralMonthsClaimable: refMonthsClaimable,
    },
    series,
    recentLeads: recent,
  });
}

// Admin actions on one user: change plan, grant a free month of Pro,
// set a custom referral code.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    plan?: string; grantFreeMonth?: boolean; referralCode?: string;
    cardOffline?: { cardId: string; offline: boolean };
  };

  const admin = getAdminSupabase();

  // Moderation takedown (App Review 1.2): flip a card's public kill-switch.
  // Everything the card serves (public page, Swift Links, QR, vCard, Wallet
  // pass, lead capture) goes dark via card-active.ts; nothing is deleted, so
  // a takedown can be reversed after review.
  if (body.cardOffline) {
    const { cardId, offline } = body.cardOffline;
    if (typeof cardId !== "string" || typeof offline !== "boolean") {
      return NextResponse.json({ error: "Invalid takedown request" }, { status: 400 });
    }
    const { data: card } = await admin.from("cards").select("id, user_id").eq("id", cardId).maybeSingle();
    if (!card || card.user_id !== id) {
      return NextResponse.json({ error: "Card not found on this user" }, { status: 404 });
    }
    const { error } = await admin.from("cards").update({ is_offline: offline }).eq("id", cardId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, cardId, offline });
  }

  if (body.grantFreeMonth) {
    // A paying subscriber doesn't need a grant — and stacking plan_expires_at
    // onto an active Stripe subscription creates a conflicting billing state.
    const { data: cur } = await admin.from("profiles").select("stripe_subscription_id, customization").eq("id", id).maybeSingle();
    if (cur?.stripe_subscription_id || isApplePaid(cur?.customization)) {
      return NextResponse.json({ error: "This user is on an active paid subscription — no free month needed." }, { status: 409 });
    }
    const expires = new Date(Date.now() + freeMonthDays(REFERRAL.NEW_USER_FREE_MONTHS) * 86_400_000).toISOString();
    const { error } = await admin.from("profiles").update({ plan: "pro", plan_expires_at: expires }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, plan: "pro", plan_expires_at: expires });
  }

  if (body.plan) {
    if (!["free", "pro", "enterprise"].includes(body.plan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    const { data: cur } = await admin.from("profiles").select("plan, stripe_subscription_id").eq("id", id).maybeSingle();
    const wasOffice = cur?.plan === "enterprise";
    // Same rule as api/admin/set-plan: a Stripe-billed Office owner is moved
    // to Pro in Stripe, never here (the charge would stay Office).
    if (wasOffice && body.plan === "pro" && cur?.stripe_subscription_id) {
      return NextResponse.json(
        { error: "This account pays for Office through Stripe. Switch it to Pro from Billing → Manage subscription (or in Stripe) so the charge changes too — the team is released automatically." },
        { status: 409 },
      );
    }
    // Downgrading to free must ALSO stop the billing — otherwise the user shows
    // as free in the app while Stripe keeps charging them.
    if (body.plan === "free") {
      if (cur?.stripe_subscription_id) {
        try {
          const { getStripe } = await import("@/lib/stripe");
          await getStripe().subscriptions.cancel(cur.stripe_subscription_id as string);
        } catch (e) {
          console.error("[admin user plan] Stripe cancel failed:", e instanceof Error ? e.message : e);
          return NextResponse.json(
            { error: "Couldn't cancel the user's Stripe subscription — plan NOT changed (they would keep being billed). Cancel it in Stripe first, then retry." },
            { status: 502 }
          );
        }
      }
    }
    // Explicit plan set clears any free-month expiry (it's a real plan now).
    // stripe_subscription_id is left set on purpose — see the identical write
    // in api/admin/set-plan: it is the ONLY handle
    // customer.subscription.deleted has for finding this profile, and nulling
    // it here made the whole Office teardown cascade silently no-op. The
    // webhook clears it as the last step of that cascade.
    const { error } = await admin
      .from("profiles")
      .update({ plan: body.plan, plan_expires_at: null })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Off Office with no Stripe cascade coming: release the team here.
    if (wasOffice && body.plan !== "enterprise" && !(body.plan === "free" && cur?.stripe_subscription_id)) {
      const { tearDownOfficeForOwner } = await import("@/lib/office-billing-sync");
      await tearDownOfficeForOwner(admin, id);
    }
    return NextResponse.json({ success: true, plan: body.plan });
  }

  if (typeof body.referralCode === "string") {
    const code = body.referralCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
    if (code.length < 4) return NextResponse.json({ error: "Code must be at least 4 characters (A-Z, 0-9, -)" }, { status: 400 });
    // Codes must stay unique — they're how referrals attribute.
    const { data: clash } = await admin.from("profiles").select("id").eq("referral_code", code).neq("id", id).maybeSingle();
    if (clash) return NextResponse.json({ error: "That code is already taken" }, { status: 409 });
    const { error } = await admin.from("profiles").update({ referral_code: code }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, referralCode: code });
  }

  return NextResponse.json({ error: "No action" }, { status: 400 });
}
