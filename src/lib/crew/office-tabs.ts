import { DOOR_TEAMS } from "./store";
import type { TeamId } from "./types";

// ── The office's tabs (?tab= on /admin/crew) ────────────────────────────────
// One tab per room plus the lobby, your desk and settings. Old tab names from
// before the office (links in emails, bookmarks) land somewhere sensible.

export type OfficeTab = "lobby" | TeamId | "desk" | "settings";

const OLD: Record<string, OfficeTab> = { inbox: "lobby", teams: "lobby", reports: "lobby", usage: "settings", paste: "desk", system: "desk" };

export function resolveTab(tab: string | undefined | null): OfficeTab {
  if (!tab) return "lobby";
  if (tab === "lobby" || tab === "desk" || tab === "settings") return tab;
  if ((DOOR_TEAMS as string[]).includes(tab)) return tab as TeamId;
  return OLD[tab] ?? "lobby";
}

/** The team whose room (and chat) a tab shows; null for the lobby, desk and settings. */
export function roomTeam(tab: OfficeTab): TeamId | null {
  return (DOOR_TEAMS as string[]).includes(tab) ? (tab as TeamId) : null;
}

export function tabForTeam(team: TeamId): OfficeTab {
  return team === "system" ? "desk" : team;
}
