import { getAdminSupabase } from "./supabase-admin";
import { isApplePaid } from "./iap-entitlement";
import { getAccountEmail } from "./account-email";
import { getStripe } from "./stripe";
import { isPaidPlan } from "./plan";
import { REFERRAL, freeMonthDays, sourceGrantsFreeMonth, isSignupSource } from "./referral";
import { insertNotification } from "./notify";
import { markProEnded } from "./pro-ended";
import { tearDownOfficeForOwner } from "./office-billing-sync";
import { reportError } from "./report-error";
import { after } from "next/server";


const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0/O/1/I/L)

function randomCode(len = 7): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

// Normalize an email for self-referral detection: lowercase, strip +tags, and
// collapse Gmail dots — so name+1@gmail.com / n.a.m.e@gmail.com can't bypass it.
export function normEmail(e: string | null | undefined): string {
  const raw = (e || "").toLowerCase().trim();
  const [local, domain] = raw.split("@");
  if (!domain) return raw;
  let l = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") l = l.replace(/\./g, "");
  return `${l}@${domain}`;
}

// A coarse device fingerprint from headers (user-agent + language). Weak on its
// own, but combined with IP it's a useful "same person referring themselves"
// signal. Stored at signup and compared to the referrer's device.
export function hashDevice(ua: string | null, lang: string | null): string | null {
  const s = `${ua || ""}|${lang || ""}`.trim();
  if (!s) return null;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Ensure a user has a referral code; generate a unique one if missing.
export async function ensureReferralCode(userId: string): Promise<string | null> {
  const admin = getAdminSupabase();
  const { data: p } = await admin.from("profiles").select("referral_code").eq("id", userId).maybeSingle();
  if (p?.referral_code) return p.referral_code as string;

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    const { error } = await admin.from("profiles").update({ referral_code: code }).eq("id", userId);
    if (!error) return code;
    // 23505 = unique violation → try another code
    if ((error as { code?: string }).code !== "23505") break;
  }
  return null;
}

// App-level "free month": Pro now, downgraded back to free after the expiry
// (unless they convert to a paid Stripe subscription before then).
async function grantAppFreeMonths(userId: string, months: number, extend: boolean): Promise<void> {
  const admin = getAdminSupabase();
  const { data: p } = await admin
    .from("profiles")
    .select("plan, plan_expires_at")
    .eq("id", userId)
    .maybeSingle();

  let baseMs = Date.now();
  if (extend) {
    const cur = p?.plan_expires_at ? new Date(p.plan_expires_at as string).getTime() : 0;
    if (cur > baseMs) baseMs = cur;
  }
  const expires = new Date(baseMs + freeMonthDays(months) * 86400000).toISOString();

  // NEVER write a plan DOWN. This wrote `plan: "pro"` unconditionally, so an
  // enterprise (Office) owner claiming a referral month was demoted to Pro by
  // the very act of collecting their reward — losing Office access, and their
  // team with it. A grant is a gift; it can only ever be at least what they
  // already had.
  const plan = p?.plan === "enterprise" ? "enterprise" : "pro";
  await admin.from("profiles").update({ plan, plan_expires_at: expires }).eq("id", userId);
}

// startProTrial() USED TO LIVE HERE and is deliberately gone (2026-09-15).
//
// It granted `plan: "pro"` with a 14-day `plan_expires_at` for the reverse
// trial, which was discontinued in Jul 2026. It had had zero callers ever
// since — kept "for the users already mid-trial", except those are wound down
// by the daily cron reading `plan_expires_at`, which never needed this
// function. What was actually left behind was the only code in the repo that
// could put an account on Pro with no payment of any kind, sitting unreferenced
// where a future caller could pick it up by autocomplete.
//
// That matters here specifically: the bug that prompted this work was an
// account landing on a Pro trial it had explicitly declined, and the first hour
// of tracing it was spent proving this function was not the cause. Dead code
// that can grant a paid plan costs more than it saves.
//
// Trials are granted in exactly one place now: Stripe's `trial_period_days`,
// set in api/stripe/checkout from lib/trial-eligibility.

// Reward a referrer with free months. If they're already a paying subscriber we
// credit their Stripe balance (auto-applies to the next invoice); otherwise we
// give them an app-level free month.
/** "credit": taken off a paying subscriber's next Stripe bill. "grant": app-level Pro days. */
export type ReferralRewardKind = "credit" | "grant";

async function grantReferrerReward(userId: string, months: number): Promise<ReferralRewardKind> {
  const admin = getAdminSupabase();
  const { data: p } = await admin
    .from("profiles")
    .select("plan, stripe_customer_id, stripe_subscription_id, plan_expires_at, customization")
    .eq("id", userId)
    .maybeSingle();
  if (!p) throw new Error("referral_no_profile");
  // An Apple subscriber is paying too — never hand them an app grant, whose
  // expiry would later downgrade the subscription they're still paying for.
  // Throw rather than return: the caller releases the claimed signups on a
  // throw, so a race past its own Apple check can never burn them silently.
  if (isPaidPlan(p.plan) && isApplePaid(p.customization)) throw new Error("referral_apple_subscriber");

  const payingNow = isPaidPlan(p.plan) && !!p.stripe_subscription_id && !p.plan_expires_at;
  if (payingNow && p.stripe_customer_id) {
    try {
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(p.stripe_subscription_id as string);
      const price = sub.items.data[0]?.price;
      const amount = (price?.unit_amount ?? 0) * months;
      if (amount > 0) {
        await stripe.customers.createBalanceTransaction(p.stripe_customer_id as string, {
          amount: -amount,
          currency: price?.currency ?? "usd",
          description: `SwiftCard referral reward — ${months} month${months > 1 ? "s" : ""} of Pro free`,
        });
        return "credit";
      }
    } catch (e) {
      // REFUSE rather than fall through. For someone who is actively paying,
      // an app-level grant is worth nothing: plan_expires_at on a real
      // subscriber changes no access they don't already have, so the month
      // silently evaporated while the three referral rows were already
      // consumed. Throwing surfaces it to the caller, which leaves the reward
      // unclaimed and claimable again — the only outcome that doesn't quietly
      // take something from them.
      console.error("[referral] Stripe credit failed for a paying subscriber:", e);
      throw new Error("referral_credit_failed");
    }
  }
  if (payingNow) {
    // Paying, but no Stripe customer id, or the price came back at zero. Same
    // reasoning as the catch above: an app grant would be a no-op reward.
    throw new Error("referral_credit_unavailable");
  }
  await grantAppFreeMonths(userId, months, true);
  return "grant";
}

// Called ONCE when a new user's profile is first created (onboarding), for both
// email and Google signups. Attributes the source, links the referrer, grants
// the new user's free month, runs basic fraud checks, and records a referrals row.
export async function applyReferralOnSignup(
  userId: string,
  opts: { code: string | null; source: string | null; ip: string | null; email: string | null; device?: string | null },
): Promise<void> {
  const admin = getAdminSupabase();
  const code = (opts.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
  let source = isSignupSource(opts.source) ? opts.source : (code ? "referral" : "direct");

  // Resolve referrer from code.
  type Referrer = { id: string; email: string | null; signup_ip: string | null; signup_device: string | null };
  let referrer: Referrer | null = null;
  if (code) {
    const { data } = await admin
      .from("profiles")
      .select("id, email, signup_ip, signup_device")
      .eq("referral_code", code)
      .maybeSingle();
    if (data) referrer = data as Referrer;
  }

  // Fraud / self-referral checks.
  let status = "signed_up";
  let flaggedReason: string | null = null;
  if (referrer) {
    const sameAccount = referrer.id === userId;
    // Compare against the referrer's AUTH signup email — profiles.email drifts
    // to the card's public contact email, which would let a self-referral slip
    // through (or falsely flag someone who shares a card inbox).
    const referrerAuthEmail = await getAccountEmail(referrer.id, referrer.email);
    const sameEmail = !!opts.email && !!referrerAuthEmail && normEmail(opts.email) === normEmail(referrerAuthEmail);
    if (sameAccount || sameEmail) {
      status = "self_referral";
      flaggedReason = "self_referral";
    } else if (opts.ip && referrer.signup_ip && opts.ip === referrer.signup_ip) {
      status = "flagged";
      flaggedReason = "same_ip_as_referrer";
    } else if (opts.device && referrer.signup_device && opts.device === referrer.signup_device) {
      status = "flagged";
      flaggedReason = "same_device_as_referrer";
    } else if (opts.ip) {
      const { count } = await admin
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("signup_ip", opts.ip);
      if ((count ?? 0) >= 3) {
        status = "flagged";
        flaggedReason = "ip_signup_volume";
      }
    }
    if (status === "self_referral") {
      referrer = null; // a self-referral has no valid referrer for analytics linkage
      source = "direct";
    }
  }

  // Attribution update — kept SEPARATE from referral-code assignment so a (rare)
  // code collision can never abort it and silently drop referred_by/source/ip.
  // Only a clean, non-fraud referral grants the free month — a "flagged"
  // signup (same IP/device as the referrer, or high signup volume from one IP)
  // must NOT still grant it, or someone can farm unlimited free Pro months by
  // signing up disposable emails from their own referral link on one device.
  // Read the comment above, then the old expression:
  //
  //   sourceGrantsFreeMonth(source) || (!!referrer && status === "signed_up")
  //
  // The `||` decided it before `status` was ever consulted. `source` is
  // "referral" for ANY signup carrying a code (line 137), and a flagged one
  // keeps that source — only a self-referral resets it to "direct". So the
  // left side was true and short-circuited, and every fraud check below it
  // (same IP, same device, 3+ signups from one IP) set a status nothing read.
  // Disposable emails through your own link on your own device each got their
  // free month: precisely the farming this code was written to stop.
  //
  // The left side had a second hole. `source` arrives from a COOKIE
  // (onboarding/page.tsx reads SRC_COOKIE), so it is client-controlled — and
  // on its own it granted a month with no referrer, no code and no fraud
  // check involved at all.
  //
  // A free month requires all three: a referrer who actually exists, a clean
  // fraud status, and the referral source. There is no legitimate free month
  // without a referrer — the whole point is crediting one.
  const grantsFreeMonth = !!referrer && status === "signed_up" && sourceGrantsFreeMonth(source);
  const { error: attrErr } = await admin
    .from("profiles")
    .update({
      referred_by: referrer?.id ?? null,
      signup_source: source,
      signup_ip: opts.ip,
      signup_device: opts.device ?? null,
    })
    .eq("id", userId);
  if (attrErr) console.error("[referral] attribution update failed:", attrErr);

  // Generate the new user's own referral code (retries on collision).
  await ensureReferralCode(userId);

  // The friend's free month is NOT switched on here any more (owner,
  // 2026-09-17). Granting it at signup put the account on Pro before the plan
  // step, and the plan step only shows for an account still on Free — so a
  // referred sign-up skipped "choose your plan" entirely and landed on Pro
  // without ever being asked. It is now offered ON the plan step ("Start my
  // free month of Pro"), claimed through api/account/choose-plan. What makes
  // it claimable is exactly what grantsFreeMonth checked: the referral row
  // below with status "signed_up" and the referral source (referralGiftPending).
  void grantsFreeMonth;

  // Record the referral relationship (only when there's a real or attempted referrer).
  if (referrer || flaggedReason) {
    await admin.from("referrals").upsert(
      {
        referrer_id: referrer?.id ?? null,
        referred_id: userId,
        code,
        status,
        signup_ip: opts.ip,
        signup_device: opts.device ?? null,
        flagged_reason: flaggedReason,
      },
      { onConflict: "referred_id" },
    );

    // Successful (non-fraud) signup → tell the referrer where they stand
    // (1/3, 2/3, or the claimable 3/3). Best-effort: never blocks signup.
    if (referrer && status === "signed_up") {
      // after(): onboarding now AWAITS this function (so the plan step can
      // see the gift), and the referrer's notification must not hold up the
      // new account's first page.
      const referrerId = referrer.id;
      const notify = async () => {
        try {
          await notifyReferrerOfSignup(referrerId);
        } catch (e) {
          console.error("[referral] progress notification failed:", e);
        }
      };
      try { after(notify); } catch { await notify(); }
    }
  }
}

/**
 * Whether this account has a friend's free month waiting to be started on the
 * plan step. The same three conditions the signup grant used (a real referrer,
 * a clean fraud status, the referral source), plus: still on Free and no plan
 * chosen yet — so it can be started once, only at the plan step.
 */
export async function referralGiftPending(userId: string, accountEmail: string | null | undefined): Promise<boolean> {
  if (!(await referralGiftOffered(userId))) return false;
  // ONE FREE PRO PERIOD PER PERSON (owner, 2026-09-17): the friend's month and
  // the 14-day trial are both first-time-only, and each rules out the other.
  // Someone who already had a trial — on this account, or on this email before
  // an account deletion (the purge-proof ledger) — gets no referral month.
  const { isProTrialEligible } = await import("./trial-eligibility");
  const { trialHistoryFor } = await import("./trial-ledger");
  const history = await trialHistoryFor(userId, accountEmail);
  return isProTrialEligible(null, undefined, { ...history, referralGiftOffered: false });
}

/**
 * The referral half of referralGiftPending, without the trial-history check —
 * what lib/trial-ledger reads so that, while the friend's month is on offer,
 * the 14-day trial is not ALSO offered (and checkout does not grant it).
 */
export async function referralGiftOffered(userId: string): Promise<boolean> {
  const admin = getAdminSupabase();
  const { data: p } = await admin
    .from("profiles")
    .select("plan, signup_source, referred_by, customization, office_id")
    .eq("id", userId)
    .maybeSingle();
  if (!p || isPaidPlan(p.plan as string | null) || p.office_id) return false;
  if (!p.referred_by || !sourceGrantsFreeMonth(p.signup_source as string | null)) return false;
  const cust = (p.customization ?? {}) as Record<string, unknown>;
  if (cust._planChosen || cust._proEndedChoicePending || cust._trialEnded) return false;
  const { data: row } = await admin
    .from("referrals")
    .select("status")
    .eq("referred_id", userId)
    .maybeSingle();
  return row?.status === "signed_up";
}

/**
 * Start the friend's free month. Callers check referralGiftPending first.
 *
 * Recorded exactly like a trial (profiles.pro_trial_started_at + the email
 * ledger), so lib/trial-eligibility refuses the 14-day trial afterwards: an
 * account that had the referral month pays from day one when it upgrades.
 */
export async function startReferralGift(userId: string, accountEmail: string | null | undefined): Promise<void> {
  await grantAppFreeMonths(userId, REFERRAL.NEW_USER_FREE_MONTHS, true);
  const { recordProTrialStarted } = await import("./trial-ledger");
  await recordProTrialStarted(userId, accountEmail);
}

// ── Signup-count referral rewards ────────────────────────────────────────────
// Every REFERRAL.SIGNUPS_PER_REWARD (3) successful signups through a user's
// link unlock ONE claimable free month of Pro, up to MAX_REFERRAL_REWARDS (3)
// months total (= 9 signups). The user must explicitly TAP to claim — from the
// notification or the Refer-a-friend box in Settings; nothing is auto-granted.
//
// Claims are tracked on the EXISTING referrals columns (no schema change):
// claiming marks 3 valid rows reward_granted=true + rewarded_at, so
//   months claimed  = floor(#reward_granted rows / 3)
//   months unlocked = floor(min(#valid rows, 9) / 3)
//   claimable now   = unlocked − claimed
// Flagged / self-referral signups never count.

const INVALID_REF_STATUSES = ["flagged", "self_referral"];

export type ReferralProgress = {
  code: string | null;
  validSignups: number;    // successful (non-fraud) signups, uncapped
  progressInBatch: number; // 0..2 — signups toward the NEXT free month
  claimable: number;       // free months ready to claim right now
  monthsClaimed: number;   // free months already claimed (0..3)
  capReached: boolean;     // all 3 months claimed
};

async function computeProgress(userId: string): Promise<Omit<ReferralProgress, "code">> {
  const admin = getAdminSupabase();
  const { data: rows } = await admin
    .from("referrals")
    .select("id, status, reward_granted")
    .eq("referrer_id", userId);

  const per = REFERRAL.SIGNUPS_PER_REWARD;
  const cap = REFERRAL.MAX_REFERRAL_REWARDS;
  const valid = (rows ?? []).filter((r) => !INVALID_REF_STATUSES.includes(r.status as string));
  const claimedRows = valid.filter((r) => r.reward_granted).length;

  const monthsClaimed = Math.min(cap, Math.floor(claimedRows / per));
  const counted = Math.min(valid.length, cap * per); // signups beyond the cap don't count
  const unlocked = Math.min(cap, Math.floor(counted / per));
  const claimable = Math.max(0, unlocked - monthsClaimed);
  const capReached = monthsClaimed >= cap;
  const progressInBatch = capReached ? 0 : counted - unlocked * per;

  return { validSignups: valid.length, progressInBatch, claimable, monthsClaimed, capReached };
}

// For Settings / dashboard. Resilient: returns null pre-migration so UI never breaks.
export async function getReferralProgress(userId: string): Promise<ReferralProgress | null> {
  try {
    // Independent: the code is ensured while progress is computed.
    const [code, p] = await Promise.all([
      ensureReferralCode(userId),
      computeProgress(userId),
    ]);
    return { code, ...p };
  } catch {
    return null;
  }
}

// The explicit "tap to get it" action. Consumes 3 unclaimed valid signups and
// grants one month — Stripe balance credit for active paying subscribers,
// app-level Pro month (extending any current grant) for everyone else.
export async function claimReferralReward(
  userId: string,
): Promise<{ ok: true; monthsClaimed: number; claimable: number; kind: ReferralRewardKind } | { ok: false; error: string }> {
  const admin = getAdminSupabase();
  const per = REFERRAL.SIGNUPS_PER_REWARD;

  const before = await computeProgress(userId);
  if (before.claimable <= 0) {
    return {
      ok: false,
      error: before.capReached
        ? `You've already claimed all ${REFERRAL.MAX_REFERRAL_REWARDS} referral months — thanks for spreading the word!`
        : `No free month ready yet — ${per - before.progressInBatch} more signup${per - before.progressInBatch === 1 ? "" : "s"} to go.`,
    };
  }

  // An App Store subscriber: Apple bills them, and there is no way to put a
  // free month on an Apple subscription (and an app-level grant would later
  // downgrade the subscription they are still paying for). This used to fall
  // through, mark the signups as used, and say "Pro is active for the next
  // month" while nothing was granted. Refuse BEFORE anything is consumed, so
  // the months stay saved for if their Pro ever moves off the App Store.
  {
    const { data: acct } = await admin.from("profiles").select("plan, customization").eq("id", userId).maybeSingle();
    if (acct && isPaidPlan(acct.plan as string | null) && isApplePaid(acct.customization)) {
      return {
        ok: false,
        error: "Your Pro is billed through the App Store, which can't take a free-month credit, so nothing was used up. Your earned months stay saved.",
      };
    }
  }

  // Consume the OLDEST unclaimed valid signups for this claim.
  const { data: candidates } = await admin
    .from("referrals")
    .select("id")
    .eq("referrer_id", userId)
    .eq("reward_granted", false)
    .not("status", "in", `(${INVALID_REF_STATUSES.join(",")})`)
    .order("created_at", { ascending: true })
    .limit(per);
  const ids = (candidates ?? []).map((c) => c.id as string);
  if (ids.length < per) return { ok: false, error: "No free month ready to claim yet." };

  const nowIso = new Date().toISOString();
  const { data: updated } = await admin
    .from("referrals")
    .update({ reward_granted: true, rewarded_at: nowIso })
    .in("id", ids)
    .eq("reward_granted", false)
    .select("id");

  if ((updated ?? []).length < per) {
    // A concurrent claim raced us — release whatever we took and bail cleanly.
    if (updated?.length) {
      await admin.from("referrals").update({ reward_granted: false, rewarded_at: null }).in("id", updated.map((u) => u.id));
    }
    return { ok: false, error: "That claim was already processed — refresh to see your updated plan." };
  }

  // The rows above are already consumed, so a failure here has to put them
  // back — otherwise the referrer pays for our outage with their reward. This
  // is the same release the concurrent-claim branch does a few lines up.
  //
  // grantReferrerReward now THROWS for a paying subscriber whose Stripe credit
  // could not be applied, rather than falling through to an app-level grant
  // that would be worth nothing to them (plan_expires_at changes no access a
  // real subscriber doesn't already have). Rolling back leaves the month
  // claimable again, which is the honest outcome.
  let kind: ReferralRewardKind;
  try {
    kind = await grantReferrerReward(userId, REFERRAL.REFERRER_FREE_MONTHS);
  } catch (e) {
    await admin
      .from("referrals")
      .update({ reward_granted: false, rewarded_at: null })
      .in("id", (updated ?? []).map((u) => u.id as string));
    console.error("[referral] reward failed, claim released:", e instanceof Error ? e.message : e);
    return {
      ok: false,
      error: "We couldn't apply your free month just now — nothing was used up. Please try again in a few minutes.",
    };
  }

  await admin.from("profiles").update({ referral_reward_earned: true }).eq("id", userId); // legacy "earned ≥1" flag

  const after = await computeProgress(userId);
  // `kind` lets the screen say what actually happened: a paying subscriber's
  // month comes off their next bill; anyone else gets Pro switched on now.
  return { ok: true, monthsClaimed: after.monthsClaimed, claimable: after.claimable, kind };
}

// After each successful referred signup: tell the referrer where they stand.
// 1/3 and 2/3 are progress notes; 3/3 is the claimable "tap here to get it".
async function notifyReferrerOfSignup(referrerId: string): Promise<void> {
  // No referral programme on any Office account, owner or team member —
  // Settings hides it for all of them. A link shared before the Office plan
  // still brings signups (they keep counting), but nobody on a team is told
  // "One more to unlock Pro free for one month". The bell also hides older
  // rows like it (lib/office-account-notifications).
  try {
    const { data: acct } = await getAdminSupabase()
      .from("profiles").select("plan").eq("id", referrerId).maybeSingle();
    if (acct?.plan === "enterprise") return;
  } catch { /* unknown plan → carry on as before */ }

  const per = REFERRAL.SIGNUPS_PER_REWARD;
  const cap = REFERRAL.MAX_REFERRAL_REWARDS;
  const p = await computeProgress(referrerId);

  // The words depend on what the reward IS for this person. "Unlock Pro" is
  // Free copy — to someone already paying it is an upgrade pitch for a plan
  // they have. A paying subscriber's month comes off their next bill; an App
  // Store subscriber's cannot be applied at all (Apple bills them), so it is
  // saved and no "Tap here" is offered that would only refuse.
  let paying = false;
  let apple = false;
  try {
    const { data: acct } = await getAdminSupabase()
      .from("profiles").select("plan, customization").eq("id", referrerId).maybeSingle();
    paying = isPaidPlan(acct?.plan as string | null);
    apple = paying && isApplePaid(acct?.customization);
  } catch { /* unknown plan → the Free wording, as before */ }

  let type = "referral_progress";
  let title: string;
  let body: string;

  if (p.validSignups > cap * per) {
    // Past the lifetime cap — appreciative, no reward implied.
    title = "Another friend joined through your link!";
    body = `You've already earned the maximum ${cap} referral months — thanks for spreading the word.`;
  } else if (p.progressInBatch === 0 && p.claimable > 0) {
    // This signup completed a batch of 3 → a month is ready to claim.
    title = "3 of 3 referrals complete!";
    if (apple) {
      // Nothing to tap: the claim would refuse. The month stays earned.
      body = "You've earned a free month. Your Pro is billed through the App Store, which can't take the credit, so it stays saved for you.";
    } else {
      type = "referral_claim";
      body = paying
        ? "Congratulations — you've earned a free month of Pro. Tap here and it comes off your next bill."
        : "Congratulations — you've got Pro free for one month. Tap here to get it.";
    }
  } else {
    const left = per - p.progressInBatch;
    title = `${p.progressInBatch} of ${per} referrals complete`;
    body = paying
      ? `${left === 2 ? "Two more" : "One more"} to earn a free month of Pro.`
      : `${left === 2 ? "Two more" : "One more"} to unlock Pro free for one month.`;
  }

  await insertNotification({ user_id: referrerId, type, title, body });
  // NO PUSH. Earning a referral month is good news, but it is our marketing,
  // not something the person must act on — see push-policy.ts. The in-app
  // notification and the email still tell them.
}

// Called from the Stripe webhook when a referred user becomes a PAYING customer.
// Rewards are NOT granted here anymore (they're signup-count based and claimed
// by the user) — this records the conversion for analytics and runs the
// same-payment-method fraud check (a flagged signup stops counting).
export async function markReferralConversion(referredUserId: string): Promise<void> {
  const admin = getAdminSupabase();
  const { data: ref } = await admin
    .from("referrals")
    .select("id, referrer_id, status")
    .eq("referred_id", referredUserId)
    .maybeSingle();
  if (!ref || !ref.referrer_id) return;
  if (INVALID_REF_STATUSES.includes(ref.status as string)) return;

  const nowIso = new Date().toISOString();

  // Payment-method self-referral: the friend pays with the SAME card as the
  // referrer → same person on two accounts. Flag it (removes it from counting).
  const [{ data: friendPm }, { data: referrerPm }] = await Promise.all([
    admin.from("profiles").select("payment_fingerprint").eq("id", referredUserId).maybeSingle(),
    admin.from("profiles").select("payment_fingerprint").eq("id", ref.referrer_id).maybeSingle(),
  ]);
  if (friendPm?.payment_fingerprint && referrerPm?.payment_fingerprint && friendPm.payment_fingerprint === referrerPm.payment_fingerprint) {
    await admin.from("referrals").update({ status: "flagged", flagged_reason: "same_payment_method", paid_at: nowIso }).eq("id", ref.id);
    return;
  }

  if (ref.status === "signed_up") {
    await admin.from("referrals").update({ status: "paid", paid_at: nowIso }).eq("id", ref.id);
  }
}

export type DowngradedUser = { id: string; email: string | null; name: string | null; wasTrial: boolean };

// Daily cron: downgrade users whose trial / free-month grant has ended (unless
// they converted to a paid Stripe subscription). Returns the users who were
// actually downgraded (app-grant users only) so the caller can email them.
// NOTE: only NEW capture / creation pauses on Free — existing cards, contacts,
// and sequences are never deleted (see the card/lead routes and the sequence
// send-time check).
export async function expireFreeMonths(): Promise<DowngradedUser[]> {
  const admin = getAdminSupabase();
  const { data: expired } = await admin
    .from("profiles")
    .select("id, email, name, plan, stripe_subscription_id, customization")
    .not("plan_expires_at", "is", null)
    .lte("plan_expires_at", new Date().toISOString());

  const downgraded: DowngradedUser[] = [];
  for (const u of expired ?? []) {
    if (u.stripe_subscription_id || isApplePaid(u.customization)) {
      // A real subscriber whose grant window lapsed — just clear the expiry so
      // the row is never mistaken for an app grant. Never downgrade them.
      await admin.from("profiles").update({ plan_expires_at: null }).eq("id", u.id);
      continue;
    }
    // Already on Free with a stale expiry: there is nothing to downgrade, so
    // clear the leftover fields but DON'T report them as downgraded — they'd
    // otherwise be emailed "your trial has ended" for a plan they left long ago.
    if (u.plan !== "pro" && u.plan !== "enterprise") {
      const cleanCust = { ...((u.customization ?? {}) as Record<string, unknown>) };
      delete cleanCust._trial;
      delete cleanCust._proWarnedFor;
      await admin
        .from("profiles")
        .update({ plan_expires_at: null, customization: cleanCust })
        .eq("id", u.id);
      continue;
    }
    const cust = (u.customization ?? {}) as Record<string, unknown>;
    const wasTrial = cust._trial === true;
    const nextCust = { ...cust };
    delete nextCust._trial;
    delete nextCust._proWarnedFor;
    if (wasTrial) nextCust._trialEnded = true;
    // Conditional on the row still being an unpaid, expired grant: a Stripe
    // checkout or Apple purchase landing between the select above and this
    // write would otherwise be downgraded straight back to Free the moment
    // they paid. Zero rows back = they converted; leave them alone.
    const { data: wrote } = await admin
      .from("profiles")
      .update({ plan: "free", plan_expires_at: null, customization: nextCust })
      .eq("id", u.id)
      .is("stripe_subscription_id", null)
      .lte("plan_expires_at", new Date().toISOString())
      .select("id");
    if (!(wrote ?? []).length) continue;
    // A granted OFFICE (a tester code, lib/promo) ends like a cancelled one:
    // release the team. Without this only the owner went to Free, and every
    // invited member kept plan "enterprise" and an active membership forever.
    // Reached only for unpaid grants — Stripe and Apple subscribers are
    // skipped above.
    if (u.plan === "enterprise") {
      await tearDownOfficeForOwner(admin, u.id as string).catch((e) =>
        reportError("office.grant-expiry-teardown-failed", e, { ownerId: u.id }).catch(() => {}),
      );
    }
    // Same "Pro ended — choose" prompt as every other end of Pro. The cron
    // sends its own notification and email wording, so no second notice here.
    await markProEnded(u.id as string, { wasTrial, notify: false });
    downgraded.push({ id: u.id as string, email: (u.email as string) ?? null, name: (u.name as string) ?? null, wasTrial });
  }
  return downgraded;
}
