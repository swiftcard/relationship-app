// ── Central referral & free-month configuration ─────────────────────────────
// CHANGE THE NUMBERS HERE. Everything else reads from this file.

export const REFERRAL = {
  // A new user who arrives via a referral link gets this many free months of Pro.
  NEW_USER_FREE_MONTHS: 1,
  // ── Referrer rewards (signup-count based) ──────────────────────────────────
  // Every SIGNUPS_PER_REWARD successful signups through a user's link unlocks
  // one CLAIMABLE free month of Pro. The user must explicitly tap "claim" to
  // activate it (notification or the Refer-a-friend box in Settings).
  SIGNUPS_PER_REWARD: 3,
  // Months granted per completed batch of signups.
  REFERRER_FREE_MONTHS: 1,
  // Lifetime cap on referral months a user can earn (3 months = 9 signups).
  MAX_REFERRAL_REWARDS: 3,
  // Length of one "month" of a free grant, in days.
  DAYS_PER_FREE_MONTH: 30,
} as const;

export function freeMonthDays(months: number): number {
  return Math.round(months * REFERRAL.DAYS_PER_FREE_MONTH);
}

// ── Signup attribution ──────────────────────────────────────────────────────
// Where a new signup came from. Drives admin analytics + which sources grant a
// free month. "direct" = organic (no promo, no free month).
export const SIGNUP_SOURCES = [
  "referral",      // a real referral link /r/CODE (has a referrer who can earn a reward)
  "save_contact",  // popup after saving someone's contact (no referrer)
  "share_info",    // popup after submitting the "share your info" form (no referrer)
  "vcard",         // after downloading a vCard
  "link_button",   // after tapping a Swift Links button
  // Fired by ShareButton — triggerSignupNudge("share_card") — and missing from
  // this list, so isSignupSource() rejected it and every signup from that
  // button was attributed "direct".
  "share_card",    // after sharing someone's card onward
  // The inline "Create your free card" link under Save Contact — was missing
  // here too, so its attribution was silently dropped at /cards/new.
  "save_contact_cta",
  "badge",         // "Made with SwiftCard" badge
  "view_tracking_page",   // /business-card-view-tracking landing page
  "link_in_bio_page",     // /link-in-bio-with-analytics landing page
  "follow_up",     // "Sent with SwiftCard" link in an automation email/text
  "preview",       // a "Create Your Card for Free" button on the Test It Live page
  // The site already sent these and every one was dropped at /cards/new
  // (2026-09-22 signup review) — so the homepage hero box, the blog, a public
  // card's own "create yours" link and the Swift Links badge all reported
  // their signups as "direct".
  "hero_claim",         // homepage "Start for free" name box
  "blog",               // a blog post's CTA
  "card_cta",           // "Create your card" at the foot of someone's public card
  "links_promo_badge",  // the SwiftCard badge on a Swift Links page
  "direct",        // organic
] as const;
/** Landing pages generate their own: /for/<industry> → for_<slug>, /compare/<rival> → alt_<slug>. */
const LANDING_SOURCE = /^(for|alt)_[a-z0-9_]{1,48}$/;
// Social campaigns: a platform prefix + where on that platform the link lives.
// ig_bio, ig_dm, ig_ad, ig_creator_<handle>, ig_p_<post> (one per Instagram
// post, so the admin can see WHICH Reel brought the signups). Until 2026-10-02
// nothing social was accepted here, so every signup from Instagram was
// recorded as "direct" and no post could be told from another.
export const CAMPAIGN_PLATFORMS = { ig: "Instagram", fb: "Facebook", li: "LinkedIn", tt: "TikTok", yt: "YouTube", pin: "Pinterest", rd: "Reddit", al: "Alignable", ar: "ActiveRain" } as const;
const CAMPAIGN_SOURCE = /^(ig|fb|li|tt|yt|pin|rd|al|ar)_[a-z0-9_]{1,48}$/;
export type SignupSource =
  | (typeof SIGNUP_SOURCES)[number]
  | `for_${string}` | `alt_${string}`
  | `${keyof typeof CAMPAIGN_PLATFORMS}_${string}`;

export function isCampaignSource(s: string | null | undefined): boolean {
  return !!s && CAMPAIGN_SOURCE.test(s);
}

export function isSignupSource(s: string | null | undefined): s is SignupSource {
  return !!s && ((SIGNUP_SOURCES as readonly string[]).includes(s) || LANDING_SOURCE.test(s) || CAMPAIGN_SOURCE.test(s));
}

// Only a real referral (a friend sharing their /r/CODE link) grants a free month.
// All other prompts — save_contact, share_info, badge, follow_up, etc. — are plain
// "create a free account" CTAs with no free month.
export function sourceGrantsFreeMonth(src: string | null | undefined): boolean {
  return src === "referral";
}

// ── Shared nudge copy ───────────────────────────────────────────────────────
// One place for all the "create your own SwiftCard" wording. Keyed by source.
type NudgeCopy = { title: string; sub: string; cta: string };

// The CTA takes visitors to the Test It Live demo (/join?to=live → /preview),
// so the button promises the card, and the demo closes the sale.
// Copy rides the moment the visitor JUST had: they saved/received a card in one
// tap and it felt effortless — the headline turns that feeling into "I want
// that for me". "My" in the CTA (not "your") is the classic CRO ownership win.
// One button for every card invite (owner, 2026-09-23): "See how yours looks —
// free", the same words as the Swift Links sheet. It opens the builder, where
// they see their own card take shape before they sign up for anything.
export const CARD_CTA = "See how yours looks — free";

export const NUDGE_COPY: Record<string, NudgeCopy> = {
  default:      { title: "Look this good when you network", sub: "Your own tap-to-share card — stunning, smart, live in 60 seconds.", cta: CARD_CTA },
  save_contact: { title: "Next time, be the one they save", sub: "One tap and you're in their phone — card, links, everything.", cta: CARD_CTA },
  share_info:   { title: "Never type your info again", sub: "One tap shares who you are — your card, your links, your brand.", cta: CARD_CTA },
  vcard:        { title: "Saved in one tap. That could be you", sub: "Your own SwiftCard — in their phone before the handshake ends.", cta: CARD_CTA },
  link_button:  { title: "One link for everything you are", sub: "Your links + a smart business card in one beautiful page.", cta: CARD_CTA },
  badge:        { title: "Look this good when you network", sub: "Your own tap-to-share card — stunning, smart, live in 60 seconds.", cta: CARD_CTA },
  follow_up:    { title: "Look this good when you network", sub: "Your own tap-to-share card — stunning, smart, live in 60 seconds.", cta: CARD_CTA },
};

export function nudgeCopy(source: string | null | undefined): NudgeCopy {
  return (source && NUDGE_COPY[source]) || NUDGE_COPY.default;
}

// Cookie names used to carry a referral/promo through the signup flow.
export const REF_COOKIE = "sc_ref";      // referral code (has a referrer)
export const SRC_COOKIE = "sc_src";      // signup source (attribution + free month)
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
