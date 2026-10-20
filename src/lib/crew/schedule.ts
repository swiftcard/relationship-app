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
