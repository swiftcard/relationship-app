// ── Team member status: the states, and how they read ───────────────────────
//
// Split out of office-team.ts, which also queries the database through the
// service-role client. The team list is a client component and imports
// MEMBER_STATUS_LABEL, so taking it from office-team put a server-only module
// on a path the browser bundle follows. The build tree-shook it, so nothing
// ever leaked — but the boundary was held by an optimisation, not a rule.
//
// Pure data. Nothing here that cannot be sent to a browser.

// The six states an owner can see. Deliberately a closed set — no raw enums
// reach the UI, and every one of them implies a different next action.
export type MemberStatus =
  | "active"            // live card + activity in the window
  | "card_incomplete"   // accepted the invite, never built a card
  | "card_deactivated"  // has cards, all of them switched off
  | "idle"              // live card, but nothing has happened lately
  | "invite_sent"       // pending invitation, still valid
  | "invite_expired";   // pending invitation, past its window

export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  active: "Active",
  card_incomplete: "Card not completed",
  // "Offline" is the word on the card page and its "Take offline" button.
  card_deactivated: "Card offline",
  // Not "Not using it yet": this is also someone who used their card daily
  // until two weeks ago, and it can sit on the owner's own row.
  idle: "No recent activity",
  invite_sent: "Pending",
  invite_expired: "Invite expired",
};
