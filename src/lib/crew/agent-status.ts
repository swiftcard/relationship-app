import type { AgentDef } from "./agent-def";
import { pauseLabel, whenLabel, type DoorState } from "./doors";
import { nyDay, nyParts, plainSchedule } from "./schedule";
import { STAFF, staffStatus } from "./staff";
import type { RunRow } from "./store";
import type { AgentState, EnvKey, Schedule, TeamId } from "./types";

// ── What the Agents tab says about each agent, in plain words ──────────────
// One status word with a colour, when it last ran and runs next, what its last
// run did, and what it may do in public. Pure, so tests pin every wording. The
// gating logic stays in staff.ts / doors.ts; this only words it.

export type Tone = "blue" | "green" | "amber" | "violet" | "red" | "gray";
export type AgentStatusKind = "running" | "scheduled" | "paused" | "needs_you" | "failed" | "off" | "setup" | "unavailable";
export type AgentStatus = { kind: AgentStatusKind; word: string; tone: Tone; line: string };

export const STATUS_TONE: Record<AgentStatusKind, Tone> = {
  running: "blue",
  scheduled: "green",
  paused: "amber",
  needs_you: "violet",
  failed: "red",
  off: "gray",
  setup: "gray",
  unavailable: "gray",
};

/** The jobs on the Agents tab, in the order they show, and the groups (teams) inside each. */
export const JOBS: { id: string; name: string; teams: TeamId[] }[] = [
  { id: "dev", name: "Dev", teams: ["watchdog"] },
  { id: "sales", name: "Sales", teams: ["office", "leads"] },
  { id: "outreach", name: "Outreach", teams: ["replies", "contact"] },
  { id: "marketing", name: "Marketing", teams: ["marketing"] },
  { id: "planning", name: "Planning", teams: ["system"] },
];

export const GROUP_NAME: Record<TeamId, string> = {
  watchdog: "Website health",
  office: "Office prospects",
  leads: "Email leads",
  replies: "Replies",
  contact: "Messages",
  marketing: "Marketing",
  system: "Planning",
};

export const GROUP_JOB: Record<TeamId, string> = {
  watchdog: "Watches the website, the app and payments, and writes up anything broken.",
  office: "Finds offices and teams that could buy SwiftCard for everyone, for you to call.",
  leads: "Builds a list of business emails from public websites. It never sends email.",
  replies: "Finds people asking about cards or link pages and drafts replies for you to post.",
  contact: "Drafts first messages and connection notes for you to send.",
  marketing: "Writes the blog, checks search and AI answers, plans social posts, watches competitors.",
  system: "Writes tomorrow's plan from every group's report, plus a practice agent.",
};

const NAME: Record<string, string> = { head: "Tomorrow's plan", "system-test": "Practice agent" };

/** The agent's plain name: "Reddit replies", "Website health daily report". */
export function agentName(def: Pick<AgentDef, "id" | "name" | "team" | "role">): string {
  if (NAME[def.id]) return NAME[def.id];
  if (def.role === "manager") return `${GROUP_NAME[def.team]} daily report`;
  return STAFF[def.id]?.title ?? def.name;
}

const NEEDS: Record<EnvKey, string> = {
  CREW_ANTHROPIC_API_KEY: "the Claude connection",
  CREW_OPENAI_API_KEY: "the ChatGPT connection",
  CREW_OPENAI_MODEL: "the ChatGPT connection",
  CREW_TICK_SECRET: "the agent clock",
  CREW_GITHUB_TOKEN: "the GitHub connection",
  CREW_STRIPE_READ_KEY: "the Stripe connection",
  VERCEL_TOKEN: "the Vercel connection",
  REDDIT_CLIENT_ID: "the Reddit connection",
  REDDIT_CLIENT_SECRET: "the Reddit connection",
  REDDIT_USER_AGENT: "the Reddit connection",
  GOOGLE_SHEETS_SA_JSON: "the Google Sheets connection",
  CREW_LEADS_SHEET_ID: "the Google Sheets connection",
  CREW_OFFICE_SHEET_ID: "the Google Sheets connection",
};

/** Missing settings, as words: "the Stripe connection", "the Reddit connection and the Claude connection". */
export function plainNeeds(keys: EnvKey[]): string {
  const words = [...new Set(keys.map((k) => NEEDS[k] ?? "a connection"))];
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Agent text written for the old screens can carry setting names or model
 * names ("email not sent: RESEND_API_KEY missing", "Upgraded to Opus"). This
 * keeps the meaning and drops the jargon.
 */
export function scrub(text: string): string {
  return text
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (k) => NEEDS[k as EnvKey] ?? "a setting")
    .replace(/\b(?:Claude\s+)?(?:Haiku|Sonnet|Opus|Fable)(?:\s+\d(?:\.\d)?)?\b/g, "the AI")
    .replace(/\bChatGPT\b/g, "a second reviewer")
    .replace(/\btokens?\b/gi, "AI use")
    .replace(/\s+/g, " ")
    .trim();
}

/** A failed run's note in crew_agents.status_note starts with this (tick.ts). */
export const FAILED_NOTE = "Last run failed";

export function lastRunFailed(state: Pick<AgentState, "status_note">, lastRun: RunRow | null): boolean {
  if (lastRun && lastRun.status !== "running") return lastRun.status === "error";
  return !!state.status_note?.startsWith(FAILED_NOTE);
}

export function agentStatus(o: { def: AgentDef; state: AgentState; missing: EnvKey[]; door: DoorState; now: Date; lastRun: RunRow | null; waiting: number; schedule: Schedule }): AgentStatus {
  const base = staffStatus({ def: o.def, state: o.state, missing: o.missing, door: o.door, now: o.now });
  const s = (kind: AgentStatusKind, word: string, line: string): AgentStatus => ({ kind, word, tone: STATUS_TONE[kind], line });
  switch (base.kind) {
    case "not_hired":
      return s("unavailable", "Not available", scrub(o.def.locked ?? "This one can't be turned on."));
    case "working":
      return s("running", "Running", "Working on it right now.");
    case "setup":
      return s("setup", "Needs setup", `Needs ${plainNeeds(o.missing)} before it can run.`);
    case "off":
      return s("off", "Off", "Turned off. Tap Turn on to start it.");
    case "paused":
      return s("paused", "Paused", `Paused ${pauseLabel(o.state.paused_until!, o.now)}.`);
    case "locked":
      return s("paused", "Paused", o.door.reason === "office" ? "All agents are paused." : "Its whole group is paused.");
  }
  if (lastRunFailed(o.state, o.lastRun)) return s("failed", "Failed", "The last run didn't finish. Tap Retry to try again.");
  if (o.waiting > 0) return s("needs_you", "Needs you", `${o.waiting} ${o.waiting === 1 ? "item waits" : "items wait"} for your OK.`);
  return s("scheduled", "On schedule", `Next run: ${nextRunLabel(o.schedule, o.state, o.now)}.`);
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Today 3:00pm", "Tomorrow 9:00am", "Mon 9:00am" (New York). */
export function dayTime(at: Date, now: Date): string {
  const w = whenLabel(at, now);
  return nyDay(at) === nyDay(now) ? `Today ${w}` : cap(w);
}

/** A time in the past: "Today 2:15pm", "Yesterday 7:00am", "Oct 20, 3:05pm". */
export function pastTime(iso: string | null, now: Date): string {
  if (!iso) return "Never";
  const at = new Date(iso);
  const p = nyParts(at);
  const t = `${((p.h + 11) % 12) + 1}:${String(p.min).padStart(2, "0")}${p.h < 12 ? "am" : "pm"}`;
  if (nyDay(at) === nyDay(now)) return `Today ${t}`;
  if (nyDay(at) === nyDay(new Date(now.getTime() - 86400_000))) return `Yesterday ${t}`;
  return `${at.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}, ${t}`;
}

export function nextRunLabel(schedule: Schedule, state: Pick<AgentState, "enabled" | "next_run_at">, now: Date): string {
  if (!state.enabled) return "Not scheduled (turned off)";
  if (schedule.kind === "on_input") return "When you hand it something";
  const next = state.next_run_at ? new Date(state.next_run_at) : null;
  if (!next || next.getTime() <= now.getTime()) return "Within 15 minutes";
  return dayTime(next, now);
}

/** What the last run did, in one sentence. */
export function plainResult(run: Pick<RunRow, "status" | "summary"> | null): string {
  if (!run) return "Hasn't run yet.";
  switch (run.status) {
    case "running":
      return "Still working on it.";
    case "budget":
      return "Stopped early: it reached today's money limit.";
    case "locked":
      return "Stopped because it was paused.";
    case "error":
      return "Something went wrong, so it stopped. Tap Retry to try again.";
  }
  const text = scrub(run.summary ?? "");
  if (!text) return "Finished.";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** What the agent may do in public, and that it always asks first. */
export function askLine(def: Pick<AgentDef, "approvalKind" | "team" | "role">): { locked: boolean; text: string } {
  if (def.role === "manager") return { locked: false, text: "Writes a daily report for you. Never posts anything." };
  if (def.team === "leads") return { locked: false, text: "Saves leads to your list. Never sends email." };
  if (!def.approvalKind) return { locked: false, text: "Never does anything public." };
  if (def.approvalKind === "ask") return { locked: false, text: "Only asks you questions. Never posts anything." };
  return { locked: true, text: "Asks you before anything goes out: always on" };
}

export { plainSchedule };

/** A problem the website-health agents found, without the raw error text (which stays behind "technical details"). */
export function plainFinding(f: { kind: string; title: string; count: number }): string {
  const times = f.count > 1 ? ` (seen ${f.count} times)` : "";
  if (f.kind === "bug") {
    const page = /\bon (\/[^\s]*)/.exec(f.title)?.[1];
    return `Something broke for visitors${page ? ` on ${page.length > 48 ? `${page.slice(0, 47)}…` : page}` : " on the website"}${times}.`;
  }
  return `${scrub(f.title).replace(/[.]$/, "")}${times}.`;
}
