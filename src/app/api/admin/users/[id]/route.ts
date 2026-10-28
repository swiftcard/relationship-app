import { NextRequest, NextResponse } from "next/server";
import { isApplePaid } from "@/lib/iap-entitlement";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getAccountEmail } from "@/lib/account-email";
import { requireAdmin } from "@/lib/admin";
import { REFERRAL, freeMonthDays } from "@/lib/referral";
import { isPaidPlan } from "@/lib/plan";
import { DELETION_GRACE_DAYS } from "@/lib/deletion-grace";
import { reasonText, savedByText } from "@/app/admin/_ui/reasons";

// Everything the admin needs about ONE user: identity, plan, how they pay,
// attribution, every card with per-card views/leads, 30-day activity, recent
// leads — and `leaving`: if they closed the account or opened the delete /
// cancel flow, why, in their own words (customization._deletion/_retention).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const admin = getAdminSupabase();
  const { data: p } = await admin
    .from("profiles")
    .select("id, username, name, email, plan, created_at, company, title, phone, website, photo_url, signup_source, plan_expires_at, referral_code, referred_by, referral_reward_earned, customization, stripe_subscription_id")
    .eq("id", id)
    .maybeSingle();
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: cards } = await admin
    .from("cards")
    .select("id, username, label, name, title, company, template, created_at, is_offline")
    .eq("user_id", id)
    .order("created_at", { ascending: true });

  // All slugs this user owns (profile slug covers legacy cards).
  const usernames = Array.from(new Set([p.username as string, ...(cards ?? []).map((c) => c.username as string)].filter(Boolean)));

  const now = Date.now();
  const DAY = 86_400_000;

  const [{ data: leads }, { data: views }, { data: refRows }] = await Promise.all([
    usernames.length
      ? admin.from("leads").select("id, name, email, phone, source, card_owner, created_at").in("card_owner", usernames).order("created_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as never[] }),
    usernames.length
      ? admin.from("card_views").select("username, viewed_at").in("username", usernames.flatMap((u) => [u, `${u}__links`])).limit(5000)
      : Promise.resolve({ data: [] as never[] }),
    admin.from("referrals").select("status, reward_granted").eq("referrer_id", id),
  ]);

  // Referral earnings (3 valid signups = 1 claimable month, tap-to-claim, max 3).
  const validRefs = (refRows ?? []).filter((r) => r.status !== "flagged" && r.status !== "self_referral");
  const refClaimedRows = validRefs.filter((r) => r.reward_granted).length;
  const refMonthsClaimed = Math.min(3, Math.floor(refClaimedRows / 3));
  const refMonthsClaimable = Math.max(0, Math.min(3, Math.floor(Math.min(validRefs.length, 9) / 3)) - refMonthsClaimed);

  // Per-card rollups + 30-day daily series.
  const leadsByCard: Record<string, number> = {};
  for (const l of leads ?? []) leadsByCard[l.card_owner as string] = (leadsByCard[l.card_owner as string] ?? 0) + 1;

  const viewsByCard: Record<string, { card: number; links: number }> = {};
  const series: Record<string, { views: number; leads: number }> = {};
  for (let i = 29; i >= 0; i--) series[new Date(now - i * DAY).toISOString().slice(0, 10)] = { views: 0, leads: 0 };
  let views30 = 0;
  for (const v of views ?? []) {
    const raw = (v.username as string) || "";
    const base = raw.replace(/__links$/, "");
    const slot = (viewsByCard[base] ??= { card: 0, links: 0 });
    if (raw.endsWith("__links")) slot.links++; else slot.card++;
    const t = new Date(v.viewed_at as string).getTime();
    if (t >= now - 30 * DAY) {
      views30++;
      const k = new Date(v.viewed_at as string).toISOString().slice(0, 10);
      if (series[k]) series[k].views++;
    }
  }
  let leads30 = 0;
  for (const l of leads ?? []) {
    const t = new Date(l.created_at as string).getTime();
    if (t >= now - 30 * DAY) {
      leads30++;
      const k = new Date(l.created_at as string).toISOString().slice(0, 10);
      if (series[k]) series[k].leads++;
    }
  }

  // referred_by is the REFERRER'S user id — resolve it to a human identity,
  // labeled by the referrer's AUTH signup email (profiles.email drifts to the
  // card's public contact email — see lib/account-email).
  let referredBy: { id: string; name: string | null; email: string | null } | null = null;
  if (p.referred_by) {
    const { data: ref } = await admin.from("profiles").select("id, name, email").eq("id", p.referred_by).maybeSingle();
    if (ref) {
      const refEmail = await getAccountEmail(ref.id as string, ref.email as string | null);
      referredBy = { id: ref.id as string, name: ref.name as string | null, email: refEmail };
    }
  }

  const cardList = (cards ?? []).map((c) => ({
    ...c,
    leads: leadsByCard[c.username as string] ?? 0,
    cardViews: viewsByCard[c.username as string]?.card ?? 0,
    linkViews: viewsByCard[c.username as string]?.links ?? 0,
  }));
  // Legacy profile-slug card (pre-migration accounts have no cards rows).
  // Migrated profiles' slugs no longer resolve publicly, so exclude them.
  const cust = (p.customization ?? {}) as { _migrated?: boolean };
  const hasProfileCard = !cust._migrated && !!p.username && !(cards ?? []).some((c) => c.username === p.username);

  // Why they left, or nearly did. The delete flow writes _deletion (the
  // final answer) and every pass through its first step appends to
  // _retention.surveys; an offer they took is _retention.savedBy.
  const custAll = (p.customization ?? {}) as Record<string, unknown>;
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

  // How the plan is paid for: a Stripe subscription, Apple in the iPhone app,
  // a free month that ends by itself, or nothing (moved by hand).
  const billing = p.stripe_subscription_id
    ? "stripe"
    : isApplePaid(p.customization)
      ? "apple"
      : isPaidPlan(p.plan as string) && p.plan_expires_at
        ? "grant"
        : "none";

  return NextResponse.json({
    leaving,
    user: {
      billing,
      id: p.id, username: p.username, name: p.name,
      // Account identity = auth signup email, never the card's contact email.
      email: await getAccountEmail(p.id as string, p.email as string | null),
      plan: p.plan,
      plan_expires_at: p.plan_expires_at ?? null, created_at: p.created_at,
      company: p.company, title: p.title, phone: p.phone, website: p.website, photo_url: p.photo_url,
      signup_source: p.signup_source ?? "direct", referral_code: p.referral_code ?? null,
      referred_by: referredBy, referral_reward_earned: p.referral_reward_earned ?? false,
      deleted: !!((p.customization as { _deleted?: boolean } | null)?._deleted),
    },
    cards: cardList,
    profileCard: hasProfileCard
      ? {
          username: p.username,
          leads: leadsByCard[p.username as string] ?? 0,
          cardViews: viewsByCard[p.username as string]?.card ?? 0,
          linkViews: viewsByCard[p.username as string]?.links ?? 0,
        }
      : null,
    totals: {
      leads: (leads ?? []).length,
      views: (views ?? []).length,
      leads30,
      views30,
      referred: validRefs.length,
      referralMonthsClaimed: refMonthsClaimed,
      referralMonthsClaimable: refMonthsClaimable,
    },
    series: Object.entries(series).map(([date, v]) => ({ date, ...v })),
    recentLeads: (leads ?? []).slice(0, 12),
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
