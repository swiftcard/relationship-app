// ── The account-deletion save sequence ───────────────────────────────────────
//
// Deleting an account used to be one question and a typed DELETE. Owner order
// 2026-09-04: ask first, then make a real case for staying — a sequence of six
// steps, DIFFERENT for Free and for Pro, because the two are leaving for
// different reasons and only one of them is paying us.
//
//   1. why      — the reason (required; the only required step)
//   2. detail   — a follow-up that CHANGES with the reason they picked
//   3. keep     — the no-money save (Free: go quiet. Pro: switch to Free instead)
//   4. loss     — what deleting actually destroys, with their real numbers
//   5. offer    — the promotion (Free: 30 days of Pro on us. Pro: 50% off 3 months)
//   6. confirm  — password (when the account has one) + type DELETE
//
// The promotion is the LAST thing before the typed DELETE (owner order
// 2026-09-30): it lands right after "Here's what goes", with the cost of
// leaving on screen. Each promotion is once per PERSON, ever — the account
// record and a purge-proof ledger (lib/trial-ledger) both remember it, so
// nobody takes free Pro, deletes, signs up again and takes it again.
//
// APPLE 5.1.1(v). Deletion must stay reachable and completable in the app. So:
// every step after the first carries a plain "Continue" that advances toward
// deletion, no step can be answered wrongly into a dead end, and the offers are
// declined by pressing Continue — never by hunting for a hidden link. The
// promotion (step 5) is SKIPPED, not merely skippable, when the account isn't eligible for
// what they offer (a second deletion attempt, an Apple-billed subscription, a
// grant already taken), so nobody is walked through an offer we cannot honour.
//
// APPLE 3.1.1. Inside the shell we may not sell, link out to a purchase, or
// quote a price. A GIFT is not a sale — 30 free days with no card is fine
// there — but the price tag, the discount percentage off a real invoice, and
// the "manage billing" pointer are web-only. Every string below therefore
// comes in a web form and a native form, and `stepsFor()` takes the platform.

import { FREE_MONTH_DAYS, PLAN_PRICES, TRIAL_DAYS } from "@/lib/plan";

/** Days of Pro handed to a Free user who is about to delete. One per account. */
export const RETENTION_GRANT_DAYS = FREE_MONTH_DAYS;

/**
 * Days for someone who has ALREADY had a Pro trial (owner, 2026-09-16): the
 * trial plus this gift add up to the same 30 free days anyone else gets, never
 * more. One per person — the email ledger (lib/trial-ledger) keeps it from
 * coming back after delete, purge and sign up again.
 */
export const RETENTION_GRANT_DAYS_AFTER_TRIAL = RETENTION_GRANT_DAYS - TRIAL_DAYS;
/** Percent off, and for how many months, offered to a paying Pro subscriber. */
export const RETENTION_DISCOUNT_PERCENT = 50;
export const RETENTION_DISCOUNT_MONTHS = 3;

export type RetentionPlan = "free" | "pro";
/**
 * Who takes the money. Apple-billed accounts cannot be discounted by us.
 * "grant" is free Pro with no subscription behind it (the delete-flow gift, a
 * referral month): nobody is paying, and it ends on its own.
 */
export type PlanSource = "stripe" | "apple" | "grant" | null;

export type StepId = "why" | "detail" | "offer" | "keep" | "loss" | "confirm";

export type Reason = {
  /** Stored verbatim on the account, so keep these stable. */
  id: string;
  label: string;
  /** The follow-up question this reason earns at step 2. */
  followUp: string;
  /** Placeholder for the free-text box under it. */
  placeholder: string;
};

// Free-plan reasons. Somebody who never paid is telling us about the PRODUCT,
// so every follow-up digs at what it failed to do.
export const FREE_REASONS: Reason[] = [
  {
    id: "not-using",
    label: "I'm not really using it",
    followUp: "What were you hoping SwiftCard would do for you?",
    placeholder: "I wanted to…",
  },
  {
    id: "missing-feature",
    label: "It's missing something I need",
    followUp: "What's missing? We build the things people ask for by name.",
    placeholder: "I needed…",
  },
  {
    id: "too-complicated",
    label: "I couldn't get it set up",
    followUp: "Where did it lose you? We'd rather fix the step than lose you.",
    placeholder: "I got stuck at…",
  },
  {
    id: "alternative",
    label: "I'm using something else",
    followUp: "Which one — and what does it do better?",
    placeholder: "I switched to…",
  },
  {
    id: "privacy",
    label: "Privacy — I don't want my details up",
    followUp: "What specifically worried you?",
    placeholder: "I was concerned about…",
  },
  {
    id: "testing",
    label: "I was just testing / signed up by mistake",
    followUp: "Anything that would have made it worth keeping?",
    placeholder: "Optional",
  },
  {
    id: "other",
    label: "Something else",
    followUp: "Tell us what happened — this one goes straight to the founder.",
    placeholder: "What happened?",
  },
];

// Pro reasons. A paying subscriber is telling us about VALUE and PRICE, and
// "too expensive" and "I only needed it for one event" are different problems
// with different answers.
export const PRO_REASONS: Reason[] = [
  {
    id: "too-expensive",
    label: "It costs more than I get out of it",
    followUp: "What would make it worth it?",
    placeholder: "It'd be worth it if…",
  },
  {
    id: "not-using",
    label: "I'm not using it enough to justify it",
    followUp: "What stopped you using it — no time, no events, or something in the way?",
    placeholder: "Mostly because…",
  },
  {
    id: "missing-feature",
    label: "It's missing something I need",
    followUp: "What's missing? Paying customers' requests get built first.",
    placeholder: "I needed…",
  },
  {
    id: "one-off",
    label: "I only needed it for one event or season",
    followUp: "When would you want it back? We can be here then instead of gone.",
    placeholder: "I'd need it again around…",
  },
  {
    id: "alternative",
    label: "I moved to another tool",
    followUp: "Which one, and what won you over?",
    placeholder: "I switched to…",
  },
  {
    id: "problem",
    label: "Something didn't work properly",
    followUp: "What broke? If it's still broken, we'll fix it today.",
    placeholder: "What went wrong…",
  },
  {
    id: "other",
    label: "Something else",
    followUp: "Tell us what happened — this one goes straight to the founder.",
    placeholder: "What happened?",
  },
];

export function reasonsFor(plan: RetentionPlan): Reason[] {
  return plan === "pro" ? PRO_REASONS : FREE_REASONS;
}

export function reasonById(plan: RetentionPlan, id: string): Reason | null {
  return reasonsFor(plan).find((r) => r.id === id) ?? null;
}

/** What the account can actually be offered — decided on the server. */
export type Eligibility = {
  /** Free plan, never granted retention time before → free days of Pro. */
  grant: boolean;
  /** How many days the grant gives: 30, or 16 after a Pro trial. Absent = 30. */
  grantDays?: number;
  /** Paying via Stripe, never discounted before → 50% off for 3 months. */
  discount: boolean;
  /** Pro on Stripe → "switch to Free" keeps everything and stops billing. */
  downgrade: boolean;
};

/**
 * The account's own numbers, for step 5. Nothing here is invented: a zero is
 * shown as a zero, and a card with no link is simply not mentioned.
 */
export type AccountFacts = {
  contacts: number;
  views: number;
  cards: number;
  /** The public link that stops resolving, e.g. "swiftcard.me/dana-acme". */
  cardUrl: string | null;
  /** ISO date the account was created, or null when unknown. */
  since: string | null;
  isOfficeOwner: boolean;
  /** ISO end of free Pro with no subscription behind it (source "grant"). */
  proEndsAt?: string | null;
};

export type OfferCopy = {
  /** Headline of the offer step. */
  title: string;
  /** The body — why staying is worth something. */
  body: string;
  /** Label on the button that ACCEPTS the offer, or null when there is none. */
  accept: string | null;
  /** The action the accept button posts. */
  action: "grant" | "discount" | "downgrade" | "quiet" | null;
  /** Label on the button that declines and continues toward deletion. */
  decline: string;
  /** The small pill above a promotion's headline ("Pro · on us"). */
  badge?: string;
  /** What the promotion actually contains, one line each. */
  bullets?: string[];
  /** Price context. NULL inside the iOS app (3.1.1) — never a "$" there. */
  priceLine?: string | null;
  /** The reassurance under the headline: what it costs and how it ends. */
  fineprint?: string;
  /** Free days the accept button starts — the card shows the date they end. */
  days?: number;
};

const DAY_MS = 86_400_000;

/** The date a gift accepted now would end on, e.g. "Oct 30". */
export function giftEndLabel(days: number, nowMs: number = Date.now()): string {
  return new Date(nowMs + days * DAY_MS).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Step 5 — the promotion, the last step before the typed DELETE.
 *
 * Free + native reads exactly like Free + web minus the price: a gift is not a
 * sale, so the shell may offer the days, but never "$4.99/mo".
 * Pro + Apple has no money offer at all — we do not hold their billing — so
 * this returns null and the step is dropped.
 */
export function offerStep(plan: RetentionPlan, elig: Eligibility, native: boolean): OfferCopy | null {
  if (plan === "free") {
    if (!elig.grant) return null;
    const days = elig.grantDays ?? RETENTION_GRANT_DAYS;
    const price = (PLAN_PRICES.PRO_MONTHLY_CENTS / 100).toFixed(2);
    return {
      badge: "Pro · on us",
      title: `Try Pro free for ${days} days — on us`,
      body: `Before you delete anything, see what the full SwiftCard does for you. ${days} days of Pro, free, starting the moment you press the button — and it ends by itself.`,
      bullets: native
        ? ["Unlimited cards and links", "Every contact unlocked", "Automatic follow-up", "The AI card scanner"]
        : ["Unlimited cards and links", "Every contact unlocked", "Automatic email and text follow-up", "The AI card scanner"],
      // A gift is not a sale, so the shell may offer the days — never the tag.
      priceLine: native ? null : `Normally $${price}/month`,
      fineprint: "No card needed. Nothing to cancel.",
      days,
      accept: `Start my free ${days} days`,
      action: "grant",
      decline: "No thanks, continue to delete",
    };
  }
  // Never inside the app: a discount on the WEB (Stripe) subscription is a
  // price offer for a purchase Apple doesn't process — App Review 3.1.1, and
  // the billing panel's own rule ("no retention offers on native").
  if (!elig.discount || native) return null;
  const price = (PLAN_PRICES.PRO_MONTHLY_CENTS / 100).toFixed(2);
  return {
    badge: `Pro · ${RETENTION_DISCOUNT_PERCENT}% off`,
    title: `Stay for ${RETENTION_DISCOUNT_PERCENT}% off your next ${RETENTION_DISCOUNT_MONTHS} months`,
    body: `We'd rather cut the price than lose you. Press the button and ${RETENTION_DISCOUNT_PERCENT}% comes off your next ${RETENTION_DISCOUNT_MONTHS} monthly invoices automatically — same account, same card, same everything, nothing else to do.`,
    // Monthly subscriptions only (the server refuses annual — a 3-month coupon
    // would lapse before a yearly renewal), so the monthly price is the right one.
    priceLine: `${RETENTION_DISCOUNT_PERCENT}% off your $${price}/month plan for ${RETENTION_DISCOUNT_MONTHS} months`,
    fineprint: "Same card. Cancel any time. One-time offer.",
    accept: `Apply ${RETENTION_DISCOUNT_PERCENT}% off`,
    action: "discount",
    decline: "No thanks, continue to delete",
  };
}

/**
 * Step 3 — the save that costs nobody anything.
 *
 * Free: the account goes quiet (every SwiftCard email off) but the card, the
 * link and the contacts stay alive. Deleting is not the only way to stop
 * hearing from us, and most "I'm not using it" deletions are really that.
 * Pro on Stripe: switch to Free instead — billing stops today, nothing is
 * destroyed. Pro on Apple: same idea, but auto-renew is turned off in the
 * App Store, which is the ONLY place we may point them (3.1.1).
 */
export function keepStep(plan: RetentionPlan, elig: Eligibility, source: PlanSource, proEndsAt?: string | null): OfferCopy {
  if (plan === "free") {
    return {
      title: "Or just make it go quiet",
      body: "If it's the emails, you don't have to delete anything. We'll switch off every SwiftCard email to you and leave your card, your link and your contacts exactly where they are — come back whenever, or don't.",
      accept: "Turn off all emails, keep my account",
      action: "quiet",
      decline: "No thanks, keep deleting",
    };
  }
  // Free Pro with nothing behind it: there is no charge to stop and nothing to
  // cancel — "your subscription can be cancelled" was untrue for these accounts.
  if (source === "grant") {
    const t = proEndsAt ? Date.parse(proEndsAt) : NaN;
    const when = Number.isFinite(t)
      ? `On ${new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`
      : "When it ends";
    return {
      title: "Your free Pro ends on its own",
      body: `${when} your account moves back to Free by itself — nothing is charged and nothing is deleted. You don't need to delete your account to stop anything.`,
      accept: null,
      action: null,
      decline: "Continue with deletion",
    };
  }
  if (source === "apple") {
    return {
      title: "You can stop paying without losing anything",
      body: "Turning off auto-renew in your Apple subscription settings stops the charges and keeps your account, your cards and every contact you've collected. Deleting the account here does not manage the subscription for you — and it does destroy the data.",
      accept: null,
      action: null,
      decline: "Continue with deletion",
    };
  }
  return {
    title: "Switch to Free instead of deleting",
    body: elig.downgrade
      ? "You won't be charged again. Pro stays on until the end of the period you've already paid for, then your account moves to Free — nothing is destroyed: your card stays live, your link keeps working, and every contact you've collected stays in your account. You can come back to Pro any time — or never."
      : "Your subscription can be cancelled without deleting anything: your card stays live, your link keeps working, and every contact stays in your account.",
    accept: elig.downgrade ? "Cancel Pro, keep my account" : null,
    action: elig.downgrade ? "downgrade" : null,
    decline: "No thanks, keep deleting",
  };
}

/**
 * Step 4 — the honest list of what is destroyed, in their numbers.
 * Returned as lines so the component can render them without string surgery,
 * and so a test can assert we never claim a contact that isn't there.
 */
export function lossLines(plan: RetentionPlan, facts: AccountFacts): string[] {
  const lines: string[] = [];
  if (facts.contacts > 0) {
    // The download is only mentioned to accounts that can actually do it: CSV
    // export is a Pro feature, and telling a Free user to save their contacts
    // first would send them into a 403 on the way out the door.
    const download = plan === "pro" ? " Download them first if you want them." : "";
    lines.push(
      `${facts.contacts} contact${facts.contacts === 1 ? "" : "s"} — every name, email and phone number you've collected.${download}`,
    );
  }
  if (facts.cardUrl) {
    lines.push(`${facts.cardUrl} stops working. Anyone you've already given it to lands on nothing.`);
  } else if (facts.cards > 0) {
    lines.push(`Your card${facts.cards === 1 ? "" : "s"} and their links stop working.`);
  }
  if (facts.views > 0) {
    lines.push(`${facts.views} recorded card view${facts.views === 1 ? "" : "s"} and everything the analytics learned about who opens your card.`);
  }
  if (plan === "pro") {
    lines.push("Your follow-up automations stop the moment the account goes, mid-sequence for anyone in one.");
  }
  if (facts.isOfficeOwner) {
    lines.push("Your team's subscription is cancelled immediately and every teammate's card loses its Office features.");
  }
  lines.push("Your email address can't be used to sign up again while the account is held.");
  return lines;
}

/**
 * The steps this particular account will actually walk through.
 * `why`, `detail`, `keep`, `loss` and `confirm` are always present; the
 * promotion appears only when there is something real behind it, and always as
 * the step immediately before the typed DELETE.
 */
export function stepsFor(plan: RetentionPlan, elig: Eligibility, native: boolean): StepId[] {
  // The Apple "keep" step is a disclosure with no button, and it is worth
  // showing: it is the only place we can tell an Apple subscriber that deleting
  // here does not stop their renewal.
  const steps: StepId[] = ["why", "detail", "keep", "loss"];
  if (offerStep(plan, elig, native)) steps.push("offer");
  steps.push("confirm");
  return steps;
}

/** Human progress label ("Step 3 of 6"), so the sequence never feels endless. */
export function progressLabel(steps: StepId[], current: StepId): string {
  const i = steps.indexOf(current);
  return i < 0 ? "" : `Step ${i + 1} of ${steps.length}`;
}
