// Single source of truth for the marketing plan copy — the feature lists and
// descriptions shown on BOTH the public Pricing page (/pricing) and the
// in-product plan chooser used during account creation (PlanCards, shown in the
// card wizard's plan step and on /welcome). Keeping them here guarantees the
// two screens always show the same plans, prices come from PLAN_PRICES.
import { PLAN_LIMITS } from "./plan";
import { META } from "./template-style-presets";

export const PLAN_DESCRIPTIONS = {
  free: "Try it out, with limits.",
  pro: "Everything, unlimited.",
  office: "Your whole team on one brand.",
} as const;

// ── How these lists are built ────────────────────────────────────────────────
// Free used to list TWELVE features against Pro's nine, so the free plan read as
// the more generous one and Pro looked like a shorter list for $4.99. Every
// claim was true — the framing was just upside-down.
//
// The fix is framing, not gating: nothing moved between plans. Free's list
// states its CAPS plainly (the numbers a real user hits in week one) and ends
// on the SwiftCard note Pro removes, and Pro's is one unlock per line so the
// value is countable.
// Never pad these to win the comparison — if a claim isn't enforced in
// PLAN_LIMITS / sanitizeCustomizationForPlan, it doesn't belong here.
//
// Written for someone who has never used SwiftCard (owner, 2026-09-29: "What
// do you mean, 5 new leads a month? Does that mean they're going to give us 5
// new leads?"). So: the app's own words ("contacts", not "leads" — the tab is
// called Contacts), every product name explained in the same line (Swift Links,
// Swift Signature), and no bare jargon ("additional links", "sequences",
// "CRM sync"). Every number comes from PLAN_LIMITS / META, so changing a limit
// or adding a template updates /pricing, the plan chooser, /upgrade, the app
// and the support assistants together.
const cards = PLAN_LIMITS.FREE_CARD_LIMIT;
const templates = Object.keys(META).length;

export const PLAN_FEATURES = {
  free: [
    `${cards} digital business card${cards === 1 ? "" : "s"} — share it with a QR code, a link or an NFC tap`,
    `All ${templates} card designs to choose from`,
    // "5 new leads a month" read as SwiftCard handing out 5 leads. What it
    // counts: people who share their details from your card, plus anyone you
    // add by hand (api/leads + api/leads/manual share one monthly meter).
    `Save up to ${PLAN_LIMITS.FREE_LEADS_PER_MONTH} new contacts a month — people who share their details from your card, or who you add yourself`,
    // "2 additional links" meant nothing to someone who doesn't know what
    // Swift Links is. Socials are uncapped; the cap is on the link buttons.
    `Swift Links — your own link-in-bio page with all your socials, plus ${PLAN_LIMITS.FREE_MAX_LINKS} extra links (like your website or booking page)`,
    "Swift Signature — turn your card into your email signature",
    "Contacts CRM — one list of everyone you've met, with notes",
    // Email follow-ups send on every plan (owner, 2026-09-11 — reminders route
    // holds back only TEXT steps for Free). The owner switches them on per
    // contact; nothing is sent automatically on capture, so the line says so.
    // The wording is ready-made on Free; AI writes it on Pro.
    "Automatic follow-up emails — switch them on for any contact",
    "Send your card back to any contact in one tap",
    // What the Free dashboard really shows (dashboard "Traffic" panel): card
    // and Swift Links views, link taps, best day. There is no "saves" number.
    "Basic stats — views of your card and Swift Links, link taps & your best day",
    // The Swift Links footer and the "Sent with SwiftCard" email line — the
    // two things Pro removes. The card page's own badge and "Create your free
    // SwiftCard" button stay on every plan, so this does not promise that.
    "A small SwiftCard note at the bottom of your emails and Swift Links page",
  ],
  pro: [
    "Everything in Free, with no limits:",
    "Unlimited cards — one for every job or business",
    "Unlimited new contacts every month",
    "Unlimited extra links on your Swift Links page",
    "Follow-ups by text message, not just email",
    // generate-sequence: aiWritten only when paid. There is no other AI draft
    // surface in the product, so this is the whole of the claim.
    "AI writes your follow-up messages for each contact",
    "Scan a paper business card — AI types the contact in for you",
    // The designer since 2026-09-23 is "copy a card" or "AI design" (see
    // CustomCardDesigner). The eight Looks it used to offer are gone.
    "Custom card design — copy a card you like, or have AI design one",
    "Premium card finishes, your own colors & a photo or video background",
    "Every Swift Links look — gradients, glass, your own colors, fonts & background",
    "Big featured links with photo or video previews on Swift Links",
    // "Who" = known contacts named in alerts and the activity feed (blurred on
    // Free); "where" = the Locations tab. Free already has the when.
    "See who viewed your card and which cities your views come from",
    // What Pro really drops: the "Made with swiftcard.me" footer on Swift Links
    // and the "Sent with SwiftCard" email line. Texts keep "via SwiftCard".
    "No SwiftCard note at the bottom of your emails or Swift Links page",
    "Send contacts straight to Salesforce, HubSpot, GoHighLevel, Pipedrive, Google Contacts or Zapier — or download them as a spreadsheet",
  ],
  office: [
    "Everything in Pro, for every person on your team",
    // lib/office-seats: used = owner + members + pending invites.
    `Seats include you — ${PLAN_LIMITS.OFFICE_MIN_SEATS} seats is you plus ${PLAN_LIMITS.OFFICE_MIN_SEATS - 1} teammate${PLAN_LIMITS.OFFICE_MIN_SEATS === 2 ? "" : "s"}`,
    "Set your logo, company details & card design once — every teammate's card uses them",
    "Lock the design so every card stays on-brand",
    "Invite teammates by email — they join with Google or an emailed link, no password to set up",
    "See views, contacts & last activity for each person",
    // Was "…each account stays private to them" — but the admin's Leads tab
    // shows every teammate's contacts (name, email, phone) and exports them.
    "Every contact your team collects, in one list you can export — and they stay when someone leaves",
    // Was "your bill updates itself". Adding a seat is a prorated charge the
    // admin confirms; removing one lowers the bill at the next renewal.
    "Add seats anytime — you only pay for the rest of the billing period. Remove one and your bill drops at renewal",
    "Take any teammate's card offline, or fix their details",
    // "Priority support" removed (2026-09-29): nothing in the product routes
    // Office requests differently, so it was a promise with nothing behind it.
  ],
} as const;

export const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
