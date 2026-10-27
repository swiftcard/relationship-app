import { agentName } from "../agent-status";
import { DAILY_LEAD_LIMIT } from "../agents/leads";
import { AGENTS } from "../registry";
import { SCHEDULE_OVERRIDES_KEY, canReschedule, effectiveSchedule, nextRun, plainSchedule, validSchedule, type ScheduleOverrides } from "../schedule";
import { PAUSE_FOREVER } from "../doors";
import type { CrewStore } from "../store";
import type { Platform, Schedule, TeamId } from "../types";
import { SHEET_AGENT_IDS } from "./registry";
import { tabsForAgent } from "./tabs";

// ── The Controls tab ────────────────────────────────────────────────────────
// Every switch the owner may flip from the Sheet, with what the backend does
// when it changes. A dropdown in a spreadsheet is not authorization: the
// backend only honors keys listed here, only values that pass `parse`, and
// writes the last good value back over anything else. The whole-office
// pause and the per-agent switches are the same rows the admin page uses, so
// the two never disagree.

export type ControlDef = {
  key: string;
  label: string;
  what: string;
  allowed: string;
  /** Validate and normalize the cell text; null = refuse (the old value is written back). */
  parse(raw: string): unknown | null;
  /** The cell text for the current backend value. */
  show(v: unknown): string;
  /** Read the current value from the backend. */
  get(store: CrewStore): Promise<unknown>;
  /** Apply a parsed value. */
  set(store: CrewStore, v: unknown, by: string): Promise<void>;
};

const yesNo = (raw: string) => (/^(yes|on|true|1|y)$/i.test(raw.trim()) ? true : /^(no|off|false|0|n)$/i.test(raw.trim()) ? false : null);
const showYesNo = (v: unknown) => (v ? "Yes" : "No");
const startStop = (raw: string) => (/^(start|started|running|run|go)$/i.test(raw.trim()) ? true : /^(stop|stopped|off|pause)$/i.test(raw.trim()) ? false : yesNo(raw));
const showStartStop = (v: unknown) => (v ? "Running" : "Stopped");
/** The agent's tab name is its name in the Sheet and on the admin page's Start / Stop list. */
const agentLabel = (def: { id: string; name: string; team: TeamId; role: "worker" | "manager" }) => tabsForAgent(def.id)[0]?.name ?? agentName(def);
const money = (raw: string) => {
  const n = Number(String(raw).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 && n <= 500 ? Math.round(n * 100) / 100 : null;
};
const count = (max: number) => (raw: string) => {
  const n = Number(String(raw).replace(/[,\s]/g, ""));
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

/** Platforms whose highest permitted tier is more than copy-and-open. */
export const TIER_OPTIONS: Partial<Record<Platform, string[]>> = {
  bluesky: ["Copy & open", "Approval posts it"],
};
export const TIER_PLATFORMS: Platform[] = ["reddit", "x", "linkedin", "instagram", "facebook", "threads", "bluesky", "quora", "indiehackers", "alignable", "hackernews"];

/** Paid services that are off until the owner says yes here (spec §16: $0/day until approved). */
export const PAID_SERVICES: { key: string; label: string; what: string }[] = [
  { key: "paid:x_api", label: "X API (pay per use)", what: "Lets the X Replies agent be built. X charges about $0.005 per post read and $0.015 per post written; about 200 reads + 5 replies a day ≈ $1.10/day ≈ $33/month. Needs X API billing on the SwiftCard developer account." },
  { key: "paid:google_places", label: "Google Places beyond the free tier", what: "Text Search (Pro) is free for the first 5,000 calls a month, then $32 per 1,000. The lead engine stops at 4,500 a month unless this is Yes." },
  { key: "paid:licensed_profile_data", label: "Licensed profile data (Instagram bios)", what: "Instagram gives no API to search bios. A licensed data provider could, at roughly $0.10 to $0.30 per enriched profile. Nothing is bought until this is Yes and a provider is chosen." },
  { key: "paid:email_verification", label: "Email verification service", what: "Mailbox-level checks (does the address really exist) cost about $0.005 to $0.01 per address. Free syntax and MX checks run regardless." },
];

export function controlDefs(): ControlDef[] {
  const defs: ControlDef[] = [
    {
      key: "pause_all",
      label: "Pause all agents",
      what: "Yes stops every agent at its next step: nothing new is searched, drafted, sent or posted. The Sheet keeps syncing and logging. Same switch as the admin page.",
      allowed: "Yes / No",
      parse: yesNo,
      show: showYesNo,
      get: async (s) => (await s.getSettings()).kill_all,
      set: async (s, v) => s.updateSettings({ kill_all: !!v }),
    },
    {
      key: "dry_run",
      label: "Dry run (nothing real goes out)",
      what: "Yes: agents research, draft and fill the Sheet, but no email is sent, no reply is posted, no content is published, no paid service is charged. Switch to No only after the connections are set and you have checked the drafts. Starts as Yes.",
      allowed: "Yes / No",
      parse: yesNo,
      show: showYesNo,
      get: async (s) => (await s.getControls()).dry_run !== false,
      set: async (s, v, by) => s.setControl("dry_run", !!v, by === "admin" ? "admin" : "sheet"),
    },
    {
      key: "daily_usd_cap",
      label: "AI spending limit per day ($)",
      what: "Every agent stops for the day when all agents together have spent this much on AI.",
      allowed: "0 to 500",
      parse: money,
      show: (v) => String(v ?? ""),
      get: async (s) => (await s.getSettings()).daily_usd_cap,
      set: async (s, v) => s.updateSettings({ daily_usd_cap: Number(v) }),
    },
    {
      key: "economy",
      label: "Save money mode",
      what: "Yes uses the cheapest AI for sorting and short comments and no AI for reports. Recommended.",
      allowed: "Yes / No",
      parse: yesNo,
      show: showYesNo,
      get: async (s) => (await s.getSettings()).economy,
      set: async (s, v) => s.updateSettings({ economy: !!v }),
    },
    {
      key: "social_reply_limit",
      label: "Social replies per platform per day (max)",
      what: "A ceiling on drafts per platform per day, on top of each agent's own warm-up cap. 0 = no extra ceiling.",
      allowed: "0 to 50",
      parse: count(50),
      show: (v) => String(v ?? 0),
      get: async (s) => Number((await s.getControls()).social_reply_limit ?? 0),
      set: async (s, v, by) => s.setControl("social_reply_limit", Number(v), by === "admin" ? "admin" : "sheet"),
    },
    {
      key: "daily_lead_limit",
      label: "New leads per day (max)",
      what: "The lead agents stop for the day at this many new leads. The target is 1,000; the ceiling protects the AI budget.",
      allowed: "0 to 5000",
      parse: count(5000),
      show: (v) => String(v ?? DAILY_LEAD_LIMIT),
      get: async (s) => Number((await s.getControls()).daily_lead_limit ?? DAILY_LEAD_LIMIT),
      set: async (s, v, by) => s.setControl("daily_lead_limit", Number(v), by === "admin" ? "admin" : "sheet"),
    },
    {
      key: "cold_email_cap_per_inbox",
      label: "Cold emails per inbox per day",
      what: "Used by the email outreach (next release). 25 is the safe default for a warmed-up inbox.",
      allowed: "0 to 100",
      parse: count(100),
      show: (v) => String(v ?? 25),
      get: async (s) => Number((await s.getControls()).cold_email_cap_per_inbox ?? 25),
      set: async (s, v, by) => s.setControl("cold_email_cap_per_inbox", Number(v), by === "admin" ? "admin" : "sheet"),
    },
  ];

  for (const p of TIER_PLATFORMS) {
    const options = TIER_OPTIONS[p] ?? ["Copy & open"];
    defs.push({
      key: `tier:${p}`,
      label: `${p === "x" ? "X" : p === "hackernews" ? "Hacker News" : p === "indiehackers" ? "Indie Hackers" : p[0].toUpperCase() + p.slice(1)}: how far automation may go`,
      what: options.length === 1 ? "Copy & open is the highest level this platform permits: the agent prepares the message and the exact link; you paste and send." : "Copy & open: you post it. Approval posts it: setting a row's Status to Approved posts the reply from the SwiftCard account (needs the connection, and Dry run off).",
      allowed: options.join(" / "),
      parse: (raw) => options.find((o) => o.toLowerCase() === raw.trim().toLowerCase()) ?? null,
      show: (v) => String(v ?? options[0]),
      get: async (s) => (await s.getControls())[`tier:${p}`] ?? options[0],
      set: async (s, v, by) => s.setControl(`tier:${p}`, String(v), by === "admin" ? "admin" : "sheet"),
    });
  }

  for (const ps of PAID_SERVICES) {
    defs.push({
      key: ps.key,
      label: `Paid: ${ps.label}`,
      what: `${ps.what} No charge happens until this says Yes.`,
      allowed: "Yes / No",
      parse: yesNo,
      show: showYesNo,
      get: async (s) => (await s.getControls())[ps.key] === true,
      set: async (s, v, by) => s.setControl(ps.key, !!v, by === "admin" ? "admin" : "sheet"),
    });
  }

  for (const def of AGENTS.filter((d) => SHEET_AGENT_IDS.has(d.id))) {
    // The same switch as Start / Stop on the admin page's list.
    defs.push({
      key: `agent:${def.id}`,
      label: `${agentLabel(def)}: Start / Stop`,
      what: def.locked ? `Can't be started: ${def.locked}` : `${def.purpose} Start: it begins within 15 minutes (or seconds with the Sheet's script) and keeps adding rows to its tab until Stop.`,
      allowed: def.locked ? "Stop" : "Start / Stop",
      parse: (raw) => (def.locked ? false : startStop(raw)),
      show: showStartStop,
      get: async (s) => (await s.getAgentState(def.id)).enabled,
      set: async (s, v) =>
        s.patchAgentState(def.id, v ? { enabled: true, paused_until: null, pause_note: null, status_note: null, next_run_at: new Date().toISOString() } : { enabled: false, paused_until: PAUSE_FOREVER, pause_note: "Stopped in the Sheet." }),
    });
    if (canReschedule(def)) {
      defs.push({
        key: `schedule:${def.id}`,
        label: `${agentLabel(def)}: schedule`,
        what: `When it runs while it's running (New York time). Default: ${defaultPace(def)}. Write "default" to go back to it.`,
        allowed: '"every 30 min", "every 2 hours", "daily 9:00am", "Mon, Wed 8:00am", "weekdays 9:00am", or "default"',
        parse: (raw) => parseScheduleText(raw),
        show: (v) => (v && v !== "default" ? plainSchedule(v as Schedule) : `Default (${defaultPace(def)})`),
        get: async (s) => ((await s.kvGet<ScheduleOverrides>(SCHEDULE_OVERRIDES_KEY)) ?? {})[def.id] ?? null,
        set: async (s, v) => {
          const all = (await s.kvGet<ScheduleOverrides>(SCHEDULE_OVERRIDES_KEY)) ?? {};
          if (v === "default") delete all[def.id];
          else all[def.id] = v as Schedule;
          await s.kvSet(SCHEDULE_OVERRIDES_KEY, all);
          const sched = v === "default" ? effectiveSchedule(def, {}) : (v as Schedule);
          await s.patchAgentState(def.id, { next_run_at: nextRun(sched, new Date()).toISOString() });
        },
      });
    }
    defs.push({
      key: `cap:${def.id}`,
      label: `${agentLabel(def)}: spending limit per day ($)`,
      what: `Its own AI limit for a day. Default $${def.dailyUsd}.`,
      allowed: "0 to 500, or blank for the default",
      parse: (raw) => (raw.trim() === "" || /^default$/i.test(raw.trim()) ? "default" : money(raw)),
      show: (v) => (v == null ? "" : String(v)),
      get: async (s) => (await s.getAgentState(def.id)).daily_usd_cap,
      set: async (s, v) => s.patchAgentState(def.id, { daily_usd_cap: v === "default" ? null : Number(v) }),
    });
  }
  return defs;
}

/** An agent's own pace with no schedule of yours: the continuous finders run all the time, the others on their day. */
function defaultPace(def: Parameters<typeof effectiveSchedule>[0]): string {
  const s = effectiveSchedule(def, {});
  return def.continuous && s.kind === "every" ? `all the time, every ${s.minutes} minutes` : plainSchedule(s).toLowerCase();
}

const DAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * "every 30 min" | "every 2 hours" | "daily 9:00am" | "Mon, Wed 8:00am" |
 * "weekdays 9am" | "default", and everything the Controls tab itself shows
 * ("Every hour", "Every day at 9:00am", "Mon and Wed at 8:00am",
 * "Default (…)"), so a value the sync wrote always reads back as itself.
 * Null = not understood.
 */
export function parseScheduleText(raw: string): Schedule | "default" | null {
  let t = raw.trim().toLowerCase();
  if (!t || t.startsWith("default")) return "default";
  t = t.replace(/\bat\b/g, " ").replace(/\band\b/g, ",").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
  let m = /^every\s+(\d+)?\s*(min|mins|minutes|m|h|hour|hours)$/.exec(t);
  if (m) {
    const n = Number(m[1] ?? 1) * (m[2].startsWith("h") ? 60 : 1);
    const s: Schedule = { kind: "every", minutes: n };
    return validSchedule(s) ? s : null;
  }
  m = /^(daily|every day|weekdays|weekends|[a-z, ]+?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t);
  if (!m) return null;
  let hour = Number(m[2]);
  const minute = Number(m[3] ?? 0);
  if (m[4] === "pm" && hour < 12) hour += 12;
  if (m[4] === "am" && hour === 12) hour = 0;
  const which = m[1].trim();
  let days: number[] | undefined;
  if (which === "weekdays") days = [1, 2, 3, 4, 5];
  else if (which === "weekends") days = [0, 6];
  else if (which !== "daily" && which !== "every day") {
    days = which.split(/[\s,]+/).map((d) => DAYS[d.slice(0, 3)]).filter((d) => d !== undefined);
    if (!days.length) return null;
    days = [...new Set(days)].sort((a, b) => a - b);
  }
  const s: Schedule = days && days.length < 7 ? { kind: "daily", hour, minute, days } : { kind: "daily", hour, minute };
  return validSchedule(s) ? s : null;
}

export type ControlResult = { ok: true; key: string; value: unknown; shown: string; changed: boolean } | { ok: false; key: string; message: string; shown: string };

/** "Oct 27, 3:05pm" in New York time, for the Controls tab's Last Changed column. */
export function changedStamp(at: Date): string {
  return at.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(/\s*([AP])M$/, (_, x: string) => `${x.toLowerCase()}m`);
}

/**
 * Apply one Controls cell from the Sheet. Unknown keys and bad values are
 * refused, with the current value to write back. A real change is logged and
 * stamped in Last Changed, whichever way it came in (the hook or the sync).
 */
export async function applyControl(store: CrewStore, key: string, raw: string, by: string, now = new Date()): Promise<ControlResult> {
  const def = controlDefs().find((d) => d.key === key);
  if (!def) return { ok: false, key, message: "unknown setting", shown: "" };
  const current = await def.get(store);
  const parsed = def.parse(String(raw ?? ""));
  if (parsed === null || parsed === undefined) return { ok: false, key, message: `"${raw}" isn't allowed (${def.allowed})`, shown: def.show(current) };
  if (def.show(parsed) === def.show(current)) return { ok: true, key, value: current, shown: def.show(current), changed: false };
  await def.set(store, parsed, by);
  await store.setControl(`${key}:changed`, changedStamp(now), by === "admin" ? "admin" : "sheet");
  await store.logActivity({ agent_id: null, platform: null, action: "control", target: key, message: `${def.label}: ${def.show(current)} → ${def.show(parsed)}`, result: "ok", error: null, row_key: null, approved_by: by, simulated: false });
  return { ok: true, key, value: parsed, shown: def.show(parsed), changed: true };
}

/** Is dry run on? (Default yes; the table may not exist yet.) */
export async function dryRun(store: CrewStore): Promise<boolean> {
  return (await store.getControls()).dry_run !== false;
}
