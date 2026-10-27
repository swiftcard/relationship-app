import { ADMIN_TEAMS } from "./registry";
import type { TeamId } from "./types";

// ── The Agents tab's views (?tab= on /admin/crew) ───────────────────────────
// "lobby" is Home, one view per group the admin page still shows (the
// Watchdog), the task list and settings. Old tab names (links in emails,
// bookmarks) and the groups that moved to the Google Sheet land on Home.

export type OfficeTab = "lobby" | TeamId | "desk" | "tasks" | "settings";

const OLD: Record<string, OfficeTab> = { home: "lobby", inbox: "tasks", teams: "lobby", reports: "lobby", usage: "settings", paste: "lobby", system: "lobby", desk: "lobby" };

export function resolveTab(tab: string | undefined | null): OfficeTab {
  if (!tab) return "lobby";
  if (tab === "lobby" || tab === "tasks" || tab === "settings") return tab;
  if ((ADMIN_TEAMS as string[]).includes(tab)) return tab as TeamId;
  return OLD[tab] ?? "lobby";
}

/** The group whose page (and chat) a tab shows; null for home, tasks and settings. */
export function roomTeam(tab: OfficeTab): TeamId | null {
  return (ADMIN_TEAMS as string[]).includes(tab) ? (tab as TeamId) : null;
}

export function tabForTeam(team: TeamId): OfficeTab {
  return (ADMIN_TEAMS as string[]).includes(team) ? team : "lobby";
}
