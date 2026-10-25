import type { Schedule } from "./types";

// ── When an agent runs next ─────────────────────────────────────────────────
// The clock is GitHub Actions (crew-tick.yml, every 15 min), which can lag, so
// every schedule means "at or after", never "exactly at". Daily times are New
// York wall-clock, DST included.

const TZ = "America/New_York";

type NyParts = { y: number; m: number; d: number; h: number; min: number; dow: number };

export function nyParts(date: Date): NyParts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour) % 24,
    min: Number(p.minute),
    dow: dows.indexOf(String(p.weekday)),
  };
}

/** The UTC instant for a New York wall-clock time. */
export function fromNy(y: number, m: number, d: number, h: number, min: number): Date {
  // Guess as if UTC, then correct by the offset NY had at that instant (twice,
  // so a guess that lands across a DST change still converges).
  let t = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = nyParts(new Date(t));
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    t += Date.UTC(y, m - 1, d, h, min) - asUtc;
  }
  return new Date(t);
}

/** The New York calendar day ("YYYY-MM-DD") an instant falls on. */
export function nyDay(date: Date): string {
  const p = nyParts(date);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** UTC instant of the most recent New York midnight at or before `date`. */
export function nyDayStart(date: Date): Date {
  const p = nyParts(date);
  return fromNy(p.y, p.m, p.d, 0, 0);
}

export function nextRun(s: Schedule, after: Date): Date {
  if (s.kind === "every") return new Date(after.getTime() + s.minutes * 60_000);
  if (s.kind === "on_input") return new Date(after.getTime() + 15 * 60_000);
  const p = nyParts(after);
  for (let add = 0; add <= 8; add++) {
    const base = new Date(Date.UTC(p.y, p.m - 1, p.d + add, 12));
    const cand = fromNy(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), s.hour, s.minute ?? 0);
    const dow = nyParts(cand).dow;
    if (cand.getTime() > after.getTime() && (!s.days || s.days.includes(dow))) return cand;
  }
  return new Date(after.getTime() + 24 * 3600_000);
}

/** Due when never run, or when its stored next run time has passed. */
export function isDue(nextRunAt: string | null, now: Date): boolean {
  return !nextRunAt || new Date(nextRunAt).getTime() <= now.getTime();
}

export function describeSchedule(s: Schedule): string {
  if (s.kind === "every") return s.minutes % 60 === 0 ? `every ${s.minutes / 60} h` : `every ${s.minutes} min`;
  if (s.kind === "on_input") return "when you paste something in";
  const t = `${((s.hour + 11) % 12) + 1}:${String(s.minute ?? 0).padStart(2, "0")}${s.hour < 12 ? "am" : "pm"}`;
  if (!s.days) return `daily ${t}`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${s.days.map((d) => names[d]).join(" + ")} ${t}`;
}

// ── Your own schedule for an agent ──────────────────────────────────────────
// The Agents tab can change when an agent runs. The change is stored in one
// crew_kv row ({agentId: Schedule}), not in the agent's config, so a run that
// rewrites its own config can never wipe it. Nothing faster than every 15
// minutes (the clock only ticks that often), and agents that run on pasted
// input keep their trigger.

export const SCHEDULE_OVERRIDES_KEY = "schedule_overrides";
export type ScheduleOverrides = Record<string, Schedule>;

export const EVERY_CHOICES = [15, 30, 60, 120, 360, 720] as const;
const MINUTE_CHOICES = [0, 15, 30, 45];

export function validSchedule(s: unknown): s is Schedule {
  if (!s || typeof s !== "object") return false;
  const x = s as Record<string, unknown>;
  if (x.kind === "every") return (EVERY_CHOICES as readonly number[]).includes(Number(x.minutes));
  if (x.kind !== "daily") return false;
  if (!Number.isInteger(x.hour) || (x.hour as number) < 0 || (x.hour as number) > 23) return false;
  if (x.minute !== undefined && !MINUTE_CHOICES.includes(x.minute as number)) return false;
  if (x.days === undefined) return true;
  return Array.isArray(x.days) && x.days.length > 0 && x.days.length <= 7 && new Set(x.days).size === x.days.length && x.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

/** Whether the owner may change this agent's schedule. */
export function canReschedule(def: { schedule: Schedule; locked?: string }): boolean {
  return !def.locked && def.schedule.kind !== "on_input";
}

/** The schedule an agent actually runs on: yours if you set one, else its default. */
export function effectiveSchedule(def: { id: string; schedule: Schedule; locked?: string }, overrides: ScheduleOverrides | null | undefined): Schedule {
  const o = overrides?.[def.id];
  return canReschedule(def) && validSchedule(o) ? o : def.schedule;
}

/** The schedule form: `mode` = every | daily | days, `every` (minutes), `time` ("HH:MM"), `day_0`…`day_6`. A string is an error to show. */
export function parseScheduleForm(get: (k: string) => string): Schedule | string {
  const mode = get("mode");
  if (mode === "every") {
    const minutes = Number(get("every"));
    return (EVERY_CHOICES as readonly number[]).includes(minutes) ? { kind: "every", minutes } : "Pick how often.";
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(get("time"));
  if (!m) return "Pick a time.";
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || !MINUTE_CHOICES.includes(minute)) return "Pick a time.";
  if (mode === "daily") return { kind: "daily", hour, minute };
  if (mode === "days") {
    const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => get(`day_${d}`) === "on");
    if (!days.length) return "Pick at least one day.";
    return days.length === 7 ? { kind: "daily", hour, minute } : { kind: "daily", hour, minute, days };
  }
  return "Pick how often.";
}

function clock(hour: number, minute = 0) {
  return `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, "0")}${hour < 12 ? "am" : "pm"}`;
}

/** "Every 15 minutes", "Every 2 hours", "Every day at 9:00am", "Weekdays at 9:00am", "Wed and Sun at 8:00am". */
export function plainSchedule(s: Schedule): string {
  if (s.kind === "on_input") return "When you hand it something";
  if (s.kind === "every") {
    if (s.minutes < 60) return `Every ${s.minutes} minutes`;
    const h = s.minutes / 60;
    return h === 1 ? "Every hour" : `Every ${h} hours`;
  }
  const t = clock(s.hour, s.minute ?? 0);
  if (!s.days || s.days.length === 7) return `Every day at ${t}`;
  const days = [...s.days].sort((a, b) => a - b);
  if (days.join() === "1,2,3,4,5") return `Weekdays at ${t}`;
  if (days.join() === "0,6") return `Weekends at ${t}`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const list = days.map((d) => names[d]);
  return `${list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0]} at ${t}`;
}
