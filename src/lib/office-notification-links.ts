// Where each Office team notification OPENS — the admin bell row and the push
// for the same news land on the same screen. Pure (no database), so the bell,
// a client component, can import it.
//
// The team inbox used to be read-only text: tapping "Mia's first lead" or
// "3 team leads have no follow-up yet" went nowhere, and the admin had to know
// which tab held the answer.

export const LEADS_NO_FOLLOW_UP_PATH = "/office/admin/leads?followUp=none";

const TEAM = "/office/admin";
const LEADS = "/office/admin/leads";
const ANALYTICS = "/office/admin/analytics";

const PATHS: Record<string, string> = {
  member_joined: TEAM,
  member_left: TEAM,
  invite_declined: TEAM,
  invite_expired: TEAM,
  members_no_card: TEAM,
  member_first_lead: LEADS,
  leads_waiting: LEADS_NO_FOLLOW_UP_PATH,
  // Milestones are all-time totals, which are the Team tab's four numbers;
  // Analytics only goes back 90 days.
  team_milestone: TEAM,
  // The recap is the team's WEEK, so it opens Analytics on 7 days.
  team_weekly_recap: `${ANALYTICS}?range=7d`,
};

/** The admin page a team notification is about; the Team tab when unknown. */
export function officeNotificationPath(type: string): string {
  return PATHS[type] ?? TEAM;
}
