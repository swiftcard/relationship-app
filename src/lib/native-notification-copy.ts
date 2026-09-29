// What a stored notification may say INSIDE THE IPHONE APP.
//
// Rows are written once, for every surface, and some carry web-only selling
// or billing copy. App Review 3.1.1 allows none of that in the app, so the
// app's notification list (the NotificationBell dropdown — the dashboard's own
// list went with Quick Contacts, 2026-09-29) swaps or hides these rows at
// render time. The stored row — and the web — are unchanged.

/** A neutral body for rows whose stored body sells. */
export const NATIVE_BODY_REMAP: Record<string, string> = {
  sequence_paused:
    "Your automated follow-up sequences are paused. Sequences are only available on the Pro plan — nothing was deleted.",
  pro_ended:
    "Your account is on the Free plan now. Your dashboard shows what changes and lets you choose which card stays live — nothing has been deleted.",
  // Stored as "…paused until you upgrade" — purchase language (2026-09-22 audit).
  // The Free contact-limit heads-up (api/leads): the web version names Pro.
  lead_cap_reached:
    "Anyone else who shares their info this month is still saved — nothing is lost. Your free contacts reset on the 1st.",
  plan_downgraded:
    "Your account is back on the Free plan. Extra cards are offline and follow-up sequences are paused — nothing has been deleted.",
};

/**
 * Rows about managing a WEB subscription: nothing to act on in the app, and
 * "cancel your own subscription in Plan and billing" is billing copy. The web
 * still shows them. (referral_claim is filtered separately — pinned in
 * tests/native-suppression.test.ts.)
 */
export const NATIVE_HIDDEN_TYPES = new Set(["personal_sub_reminder"]);
