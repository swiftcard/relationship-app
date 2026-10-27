import type { AgentDef } from "./agent-def";
import { isPaused, pauseLabel, whenLabel, type DoorState } from "./doors";
import type { AgentState, EnvKey, TeamId } from "./types";

// ── The staff: a name, a job title and a status for every agent ─────────────
// The Agents tab shows the agents as people working in an office. The names
// are only labels (ids, schedules and prompts don't change). An agent marked
// `hired: false` sits in its team's collapsed "Not hired yet" list unless it
// is switched on, so nothing that is running ever disappears from view.

export type Person = { first: string; title: string; hired?: false };

export const STAFF: Record<string, Person> = {
  "watchdog-manager": { first: "Walter", title: "Watchdog manager" },
  "watch-bugs": { first: "Ben", title: "Bug watch" },
  "watch-speed": { first: "Sam", title: "Speed and uptime" },
  "watch-security": { first: "Grace", title: "Website security" },
  "watch-app": { first: "Abby", title: "App watcher" },
  "watch-ui": { first: "Uma", title: "Screen watcher" },
  "watch-flows": { first: "Felix", title: "Daily tester: flows" },
  "watch-probe": { first: "Paula", title: "Daily tester: analytics and alerts" },
  "watch-payments": { first: "Penny", title: "Payments watch" },
  "watch-revenue": { first: "Rita", title: "Revenue check" },
  "watch-scan-cost": { first: "Scott", title: "Scan cost watch", hired: false },

  "replies-reddit": { first: "Maya", title: "Reddit Reply" },
  "replies-threads": { first: "Theo", title: "Threads Replies" },
  "replies-bluesky": { first: "Bella", title: "Bluesky Replies" },
  "replies-facebook": { first: "Fiona", title: "Facebook Groups" },
  "replies-quora": { first: "Quinn", title: "Quora Answers" },
  "replies-indiehackers": { first: "Ian", title: "Indie Hackers" },
  "replies-instagram": { first: "Isla", title: "Instagram Comments" },
  "replies-linkedin": { first: "Liam", title: "LinkedIn Comments" },
  "replies-hackernews": { first: "Hank", title: "Hacker News" },

  "contact-reddit": { first: "Derek", title: "Reddit DMs" },
  "contact-instagram": { first: "Ivy", title: "Instagram DMs" },
  "contact-instagram-linkinbio": { first: "Leo", title: "Instagram LinkedIn Bio" },
  "contact-linkedin": { first: "Nora", title: "LinkedIn Connections" },
  "contact-alignable": { first: "Alan", title: "Alignable" },

  "leads-web": { first: "Owen", title: "Web Leads" },
  "leads-reddit": { first: "Ruby", title: "Reddit Leads" },
  "leads-quora": { first: "Kai", title: "Quora Leads" },
  // Same pasted posts that Fiona (Facebook replies) and Alan (Alignable) already work from.
  "leads-facebook": { first: "Faye", title: "Facebook Group Leads", hired: false },
  "leads-alignable": { first: "Andy", title: "Alignable Leads", hired: false },
  "leads-linkedin": { first: "Lucas", title: "LinkedIn leads", hired: false },

  "office-outreach": { first: "Oscar", title: "Office Prospects" },
  partnerships: { first: "Petra", title: "Partnerships" },

  "marketing-blog": { first: "Ella", title: "Blog Writer" },
  "marketing-seo": { first: "Sean", title: "SEO Opportunities" },
  "marketing-geo": { first: "Gia", title: "GEO Opportunities" },
  "marketing-social": { first: "Sofia", title: "Social Media" },
  "competitor-watch": { first: "Carl", title: "Competitor Intel" },
  events: { first: "Eve", title: "Events" },

  "sheet-sync": { first: "Shea", title: "Sheet sync" },
  "sheet-daily": { first: "Dana", title: "Sheet daily snapshot" },
};

/** What each room is called in the office. */
export const ROOM_NAME: Record<TeamId, string> = {
  watchdog: "Watchdog",
  replies: "Replies",
  contact: "Contact",
  leads: "Leads",
  office: "Office outreach",
  marketing: "Marketing",
  system: "The Sheet",
};

// Literal class strings so Tailwind keeps them.
export const TEAM_COLOR: Record<TeamId, { avatar: string; dot: string }> = {
  watchdog: { avatar: "bg-rose-500/15 text-rose-200 ring-rose-400/30", dot: "bg-rose-400" },
  replies: { avatar: "bg-blue-500/15 text-blue-200 ring-blue-400/30", dot: "bg-blue-400" },
  contact: { avatar: "bg-violet-500/15 text-violet-200 ring-violet-400/30", dot: "bg-violet-400" },
  leads: { avatar: "bg-amber-500/15 text-amber-200 ring-amber-400/30", dot: "bg-amber-400" },
  office: { avatar: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30", dot: "bg-emerald-400" },
  marketing: { avatar: "bg-pink-500/15 text-pink-200 ring-pink-400/30", dot: "bg-pink-400" },
  system: { avatar: "bg-sky-500/15 text-sky-200 ring-sky-400/30", dot: "bg-sky-400" },
};

export function staffFor(def: Pick<AgentDef, "id" | "name">): Person {
  return STAFF[def.id] ?? { first: def.name.split(/\s+/)[0], title: def.name };
}

export function initials(first: string): string {
  return (first[0] ?? "?").toUpperCase();
}

/** In the collapsed "Not hired yet" list: never runnable, or not hired and not switched on. */
export function notHired(def: AgentDef, state: Pick<AgentState, "enabled">): boolean {
  if (def.locked) return true;
  return STAFF[def.id]?.hired === false && !state.enabled;
}

export type StaffStatusKind = "working" | "break" | "locked" | "setup" | "paused" | "off" | "not_hired";
export type StaffStatus = { kind: StaffStatusKind; label: string; line: string };

/** The pill on a staff card and the line under it. */
export function staffStatus(o: { def: AgentDef; state: AgentState; missing: EnvKey[]; door: DoorState; now: Date }): StaffStatus {
  const { def, state, door, now } = o;
  if (def.locked) return { kind: "not_hired", label: "Can't be hired", line: def.locked };
  if (state.lease_until && new Date(state.lease_until).getTime() > now.getTime()) return { kind: "working", label: "Working now", line: "On a shift right now." };
  if (o.missing.length) return { kind: "setup", label: "Needs setup", line: `Needs ${o.missing.join(", ")} in Vercel.` };
  if (!state.enabled) return { kind: "off", label: "Off duty", line: "Not on the team yet." };
  if (isPaused(state, now)) return { kind: "paused", label: `Paused ${pauseLabel(state.paused_until!, now)}`, line: state.pause_note ?? "Paused from the team chat." };
  if (!door.open && (def.role === "worker" || door.reason === "office")) return { kind: "locked", label: "Locked out", line: door.reason === "office" ? "The whole office is locked." : "The door is locked." };
  if (def.schedule.kind === "on_input") return { kind: "break", label: "On a break", line: "Starts when you paste something into the Sheet's Paste a Post tab." };
  const next = state.next_run_at ? new Date(state.next_run_at) : null;
  if (!next || next.getTime() <= now.getTime()) return { kind: "break", label: "On a break", line: "Starts at the next check (within 15 minutes)." };
  return { kind: "break", label: "On a break", line: `Next shift ${whenLabel(next, now)}.` };
}
