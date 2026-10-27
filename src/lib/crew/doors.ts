import type { AgentDef } from "./agent-def";
import { defaultTeam } from "./store";
import { fromNy, nyDay, nyParts } from "./schedule";
import { isAdminTeam } from "./teams";
import type { AgentState, OfficeHours, Settings, TeamId, TeamRow } from "./types";

// ── The office doors ────────────────────────────────────────────────────────
// Each team has a door. Open = its workers may start a shift; locked = they
// wait. A door is either set by hand (one tap) or follows opening hours in New
// York time; a tap while hours are set overrides them only until the next
// scheduled change. "Lock the whole office" (settings.kill_all) beats every
// door. The Watchdog manager's morning report only stops for the whole-office
// lock. Since 2026-10-27 only the Watchdog's door gates anything (teams.ts).
// Pure functions, so tests pin every branch.

export type DoorState = {
  open: boolean;
  /** "Open until 6:00pm", "Locked · opens Mon 9:00am", "The whole office is locked". */
  label: string;
  reason: "office" | "desk" | "override" | "hours" | "manual";
  nextChange: Date | null;
};

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function minutesLabel(min: number): string {
  const h = Math.floor(min / 60) % 24;
  return `${((h + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** "6:00pm" today, "tomorrow 9:00am", else "Mon 9:00am" (New York). */
export function whenLabel(at: Date, now: Date): string {
  const p = nyParts(at);
  const t = minutesLabel(p.h * 60 + p.min);
  if (nyDay(at) === nyDay(now)) return t;
  if (nyDay(at) === nyDay(new Date(now.getTime() + 24 * 3600_000))) return `tomorrow ${t}`;
  return `${DAY[p.dow]} ${t}`;
}

export function withinHours(h: OfficeHours, now: Date): boolean {
  const p = nyParts(now);
  const m = p.h * 60 + p.min;
  return h.days.includes(p.dow) && m >= h.open && m < h.close;
}

/** The next scheduled open or close after `now` (searched up to 8 days ahead, DST-safe). */
export function nextBoundary(h: OfficeHours, now: Date, which: "open" | "close" | "any" = "any"): Date | null {
  const p = nyParts(now);
  for (let add = 0; add <= 8; add++) {
    const base = new Date(Date.UTC(p.y, p.m - 1, p.d + add, 12));
    const [y, m, d] = [base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()];
    const dow = nyParts(fromNy(y, m, d, 12, 0)).dow;
    if (!h.days.includes(dow)) continue;
    const marks = [
      { k: "open" as const, at: fromNy(y, m, d, Math.floor(h.open / 60), h.open % 60) },
      { k: "close" as const, at: fromNy(y, m, d, Math.floor(h.close / 60), h.close % 60) },
    ];
    for (const x of marks) if ((which === "any" || which === x.k) && x.at.getTime() > now.getTime()) return x.at;
  }
  return null;
}

export function doorState(row: TeamRow | undefined, o: { team: TeamId; settings: Settings; hardDisabled: boolean }, now: Date): DoorState {
  if (o.hardDisabled || o.settings.kill_all) return { open: false, label: "The whole office is locked", reason: "office", nextChange: null };
  if (o.team === "system") return { open: true, label: "Open", reason: "desk", nextChange: null };
  return teamDoor(row ?? defaultTeam(o.team), now);
}

/** The team's own door, ignoring the whole-office lock. */
export function teamDoor(row: TeamRow, now: Date): DoorState {
  if (row.override_open != null && row.override_until && new Date(row.override_until).getTime() > now.getTime()) {
    const at = new Date(row.override_until);
    return row.override_open
      ? { open: true, label: `Open until ${whenLabel(at, now)}`, reason: "override", nextChange: at }
      : { open: false, label: `Locked until ${whenLabel(at, now)}`, reason: "override", nextChange: at };
  }
  if (row.hours) {
    const open = withinHours(row.hours, now);
    const next = nextBoundary(row.hours, now);
    const when = next ? whenLabel(next, now) : null;
    return open
      ? { open, label: when ? `Open until ${when}` : "Open", reason: "hours", nextChange: next }
      : { open, label: when ? `Locked · opens ${when}` : "Locked", reason: "hours", nextChange: next };
  }
  return { open: row.door_open, label: row.door_open ? "Open" : "Locked", reason: "manual", nextChange: null };
}

/** What one tap on the door writes. With hours set it overrides only until the next scheduled change. */
export function togglePatch(row: TeamRow, now: Date): Partial<Omit<TeamRow, "team">> {
  const target = !teamDoor(row, now).open;
  if (!row.hours) return { door_open: target, override_open: null, override_until: null };
  if (withinHours(row.hours, now) === target) return { override_open: null, override_until: null };
  const until = nextBoundary(row.hours, now);
  return { override_open: target, override_until: until ? until.toISOString() : null };
}

export function describeHours(h: OfficeHours): string {
  const days = [...h.days].sort((a, b) => a - b);
  const run = (from: number, to: number) => days.length === to - from + 1 && days.every((d, i) => d === from + i);
  const dayText = days.length === 7 ? "Every day" : run(1, 5) ? "Mon–Fri" : run(1, 6) ? "Mon–Sat" : days.map((d) => DAY[d]).join(", ");
  return `${dayText} ${minutesLabel(h.open)}–${h.close === 1440 ? "midnight" : minutesLabel(h.close)}`;
}

/** Day checkboxes `day_0`…`day_6` plus `open` / `close` in minutes. A string is an error to show. */
export function parseHoursForm(get: (k: string) => string): OfficeHours | string {
  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => get(`day_${d}`) === "on");
  const open = Number(get("open"));
  const close = Number(get("close"));
  if (!days.length) return "Pick at least one day.";
  if (![open, close].every((n) => Number.isInteger(n) && n >= 0 && n <= 1440 && n % 30 === 0)) return "Pick an opening and a closing time.";
  if (close <= open) return "Closing time has to be after opening time.";
  return { days, open, close };
}

/** "Until resumed" is stored as a far-off date, so a pause always has an end the tick can compare. */
export const PAUSE_FOREVER = "2099-12-31T00:00:00.000Z";

export function isPaused(state: AgentState, now: Date): boolean {
  return !!state.paused_until && new Date(state.paused_until).getTime() > now.getTime();
}

/** "until 11:59pm", "until tomorrow 9:00am", "until you say go". */
export function pauseLabel(until: string, now: Date): string {
  const at = new Date(until);
  if (at.getTime() - now.getTime() > 60 * 86400_000) return "until you say go";
  return `until ${whenLabel(at, now)}`;
}

/** Why a worker can't start a shift right now, or null. Managers and the desk only stop for the whole office. */
export function blockedBy(def: AgentDef, state: AgentState, door: DoorState, now: Date): string | null {
  if (door.reason === "office" && !door.open) return "the whole office is locked";
  if (isPaused(state, now)) return `paused ${pauseLabel(state.paused_until!, now)}`;
  // Only the admin page's groups still have a door you can see and open; the
  // Sheet agents are started and stopped one by one (teams.ts).
  if (def.role === "worker" && !door.open && isAdminTeam(def.team)) return "door locked";
  return null;
}
