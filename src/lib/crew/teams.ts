import type { TeamId } from "./types";

// ── Which teams the admin page shows ────────────────────────────────────────
// Since 2026-10-26 the admin Agents tab shows the Watchdog's group (with its
// pause switch, hours and manager chat). Every other agent is started and
// stopped one by one (Start / Stop on the admin page, or the Sheet's Controls
// tab), so the old group "doors" of those teams no longer gate anything: a
// door nobody can see must never silently hold an agent back.
// Kept free of imports so doors.ts and the registry can both use it.

export const ADMIN_TEAMS: TeamId[] = ["watchdog"];

export function isAdminTeam(team: TeamId): boolean {
  return ADMIN_TEAMS.includes(team);
}
