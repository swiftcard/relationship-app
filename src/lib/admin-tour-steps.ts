import type { TourStep } from "./tour-steps";

// ── Office Admin guided tour: the walkthrough itself ────────────────────────
// A separate, shorter tour scoped to the Office admin console — Team,
// Analytics, Leads and Branding. Runs independently of the main dashboard tour (own storage
// keys in tour.ts) so an admin can replay just this one without restarting
// the whole-app tour.

const TEAM = "/office/admin";
const LEADS = "/office/admin/leads";
const BRANDING = "/office/admin/branding";

export const ADMIN_TOUR_STEPS: TourStep[] = [
  {
    id: "admin-welcome",
    path: TEAM,
    title: "Welcome to your Admin console",
    body: "A quick lap around Team, Analytics, Leads and Branding — everything you see and manage for your whole office. Use Next and Back, or Skip anytime.",
  },
  {
    id: "admin-nav-team",
    path: TEAM,
    anchor: "admin-nav-team",
    title: "Team",
    body: "Your landing page — everyone with a company card, and their cards in one place. You're on it now.",
    placement: "bottom",
  },
  {
    id: "admin-stats",
    path: TEAM,
    anchor: "admin-stats",
    title: "Your team at a glance",
    body: "Leads captured, card views, how many invited teammates actually finished their card, and how many seats you're paying for vs. using.",
    placement: "bottom",
  },
  {
    id: "admin-add-member",
    path: TEAM,
    anchor: "admin-add-member",
    title: "Add a team member",
    // Was "Seats are unlimited; add or remove people here anytime." Seats are
    // purchased, a pending invite holds one, and the invite dialog offers to
    // buy another when you run out — so "unlimited" set up the exact surprise
    // the tour exists to prevent.
    body: "Invite someone by email — their card is ready before your meeting ends. Each person uses a seat; if you're out, the invite offers to add one.",
    placement: "left",
  },
  {
    id: "admin-team-list",
    path: TEAM,
    anchor: "admin-team-list",
    title: "Your roster",
    // "resend an invite" from Manage described a button that isn't in the
    // drawer — resending is "Remind" on the pending invitation's own row.
    body: "Everyone with a company card, plus anyone you've invited who hasn't finished yet. Tap Manage on anyone to see their card or remove them; a pending invite has its own Remind button.",
    placement: "top",
  },
  {
    id: "admin-team-bell",
    path: TEAM,
    anchor: "admin-team-bell",
    title: "Team notifications",
    // Team news, rolled up (lib/team-alerts, 2026-09-22) — never each lead or
    // view a teammate gets; those stay on that teammate's own bell.
    body: "Your team's news lands here — who joined or left, leads still waiting after a day, a teammate's first lead, team milestones and Monday's recap. The important ones reach your phone too, at most two a day.",
    placement: "bottom",
  },
  // Analytics is one of the console's four tabs. The tour used to walk past it
  // to Leads, so an office admin finished a "tour of the console" without ever
  // being told a whole section existed — and the closing step then claimed the
  // console was Team, Leads and Branding.
  //
  // A nav-tab step rather than a page step: nothing on the analytics page
  // carries a data-tour anchor, and a step that navigates there would need one
  // to point at. Naming what the tab holds is honest and needs no new markup.
  {
    id: "admin-nav-analytics",
    path: TEAM,
    anchor: "admin-nav-analytics",
    title: "Analytics",
    body: "Views, scans, contact downloads and leads for every card on your team. Tap anyone to see their own page.",
    placement: "bottom",
  },
  {
    id: "admin-nav-leads",
    path: TEAM,
    anchor: "admin-nav-leads",
    title: "Leads",
    body: "Tap here to see everyone across your whole team who's shared their info.",
    placement: "bottom",
  },
  {
    id: "admin-leads-table",
    path: LEADS,
    anchor: "admin-leads-table",
    title: "Every lead, whoever captured it",
    body: "One combined list for the whole office — who they are, which teammate's card they came from, and when. No lead gets lost when someone leaves.",
    placement: "top",
  },
  {
    id: "admin-nav-branding",
    path: LEADS,
    anchor: "admin-nav-branding",
    title: "Branding",
    body: "Tap here to set the look every card on your team shares.",
    placement: "bottom",
  },
  {
    id: "admin-branding-note",
    path: BRANDING,
    anchor: "admin-branding-note",
    title: "One look, set once",
    // Was "Your own card's colors, fonts, and layout are the template — change
    // your card and every teammate's card updates with it automatically."
    // Backwards: the brand lives on the OFFICE and is set here, and the owner's
    // personal card is explicitly left alone (office-brand targets sub-users).
    // Editing your own card and expecting the team to follow does nothing.
    body: "The design you set here is the one every teammate's card uses — save it and their cards update automatically. Your own personal card stays yours and is never overwritten.",
    placement: "bottom",
  },
  {
    id: "admin-branding-tabs",
    path: BRANDING,
    anchor: "admin-branding-tabs",
    title: "Two things to brand",
    // Added 2026-09-11: Branding grew a second half and the tour never
    // mentioned it, so an admin who took the tour left believing the Swift
    // Links page was out of their hands.
    body: "Card is the business card itself. Links is your team's Swift Links page — the one link they share that holds everything. Both are yours to set.",
    placement: "bottom",
  },
  {
    id: "admin-branding-form",
    path: BRANDING,
    anchor: "admin-branding-form",
    title: "Company-wide details",
    body: "Your logo, company name, website, and office contact info — these live on the office itself and appear on every card on your team.",
    placement: "top",
  },
  {
    id: "admin-branding-links",
    path: BRANDING,
    // `section` opens the surface before the anchor is looked for — the Links
    // half only renders when its tab is on. OfficeBranding reads the hash.
    section: "links",
    anchor: "admin-branding-links",
    title: "The team's Swift Links page",
    body: "Set the company bio, the company Instagram and any company links every teammate's page carries — theirs are kept and simply sit underneath. Leave a field blank and that part stays their own.",
    placement: "top",
  },
  {
    id: "admin-finish",
    path: BRANDING,
    title: "You're all set",
    body: "That's Team, Analytics, Leads, and Branding — both the card and the Swift Links halves. Replay this anytime from the Tour button on the Team page.",
  },
];

/** The steps a role without the Branding tab never sees — the tab is hidden
 *  for them and /office/admin/branding redirects. */
const BRANDING_STEP_IDS = new Set([
  "admin-nav-branding", "admin-branding-note", "admin-branding-tabs", "admin-branding-form", "admin-branding-links",
]);

/**
 * The tour for the person actually taking it. A manager has no Branding tab and
 * some roles cannot invite, but every admin role got the full list: five
 * Branding steps aimed at a tab they don't have (each one a ~3-second frozen
 * search before the engine skipped it), "Invite someone by email" pointing at a
 * spot with no button, and a closing line about branding both halves.
 */
export function adminTourSteps({ canBrand, canInvite }: { canBrand: boolean; canInvite: boolean }): TourStep[] {
  return ADMIN_TOUR_STEPS.filter(
    (s) => (canBrand || !BRANDING_STEP_IDS.has(s.id)) && (canInvite || s.id !== "admin-add-member")
  ).map((s) => {
    if (canBrand) return s;
    if (s.id === "admin-welcome") {
      return { ...s, body: "A quick lap around Team, Analytics and Leads — everything you see and manage for your whole office. Use Next and Back, or Skip anytime." };
    }
    if (s.id === "admin-finish") {
      return { ...s, path: LEADS, body: "That's Team, Analytics and Leads. Replay this anytime from the Tour button on the Team page." };
    }
    return s;
  });
}
