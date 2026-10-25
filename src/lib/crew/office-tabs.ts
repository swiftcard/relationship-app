import { DOOR_TEAMS } from "./store";
import type { TeamId } from "./types";

// ── The Agents tab's views (?tab= on /admin/crew) ───────────────────────────
// "lobby" is Home, one view per group (team), "desk" is the Planning group,
// the task list and settings. Old tab names (links in emails, bookmarks) land
// somewhere sensible. The ids stay as they were so every old link still works.

export type OfficeTab = "lobby" | TeamId | "desk" | "tasks" | "settings";

const OLD: Record<string, OfficeTab> = { home: "lobby", inbox: "tasks", teams: "lobby", reports: "lobby", usage: "settings", paste: "desk", system: "desk" };

export function resolveTab(tab: string | undefined | null): OfficeTab {
  if (!tab) return "lobby";
  if (tab === "lobby" || tab === "desk" || tab === "tasks" || tab === "settings") return tab;
  if ((DOOR_TEAMS as string[]).includes(tab)) return tab as TeamId;
  return OLD[tab] ?? "lobby";
}

/** The group whose page (and chat) a tab shows; null for home, tasks and settings. */
export function roomTeam(tab: OfficeTab): TeamId | null {
  if (tab === "desk") return "system";
  return (DOOR_TEAMS as string[]).includes(tab) ? (tab as TeamId) : null;
}

export function tabForTeam(team: TeamId): OfficeTab {
  return team === "system" ? "desk" : team;
}
