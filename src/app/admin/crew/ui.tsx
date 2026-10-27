import type { AgentStatus, Tone } from "@/lib/crew/agent-status";
import type { StaffStatusKind } from "@/lib/crew/staff";
import { TEAM_COLOR } from "@/lib/crew/staff";
import type { TeamId } from "@/lib/crew/types";

// ── Shared pieces for the Agents tab (server components) ────────────────────

export const card = "rounded-2xl border border-gray-800 bg-gray-950/50 p-4";
export const btn = "inline-flex items-center justify-center gap-1.5 min-h-10 px-3 rounded-lg text-sm font-medium";
export const input = "w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-white";
/** A <summary> that looks like a quiet button and is a real tap target. */
export const summaryBtn = "list-none [&::-webkit-details-marker]:hidden cursor-pointer inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-gray-900";

export function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "blue" | "amber" | "green" | "red" }) {
  const t = {
    gray: "bg-gray-800 text-gray-300 border-gray-700",
    blue: "bg-blue-500/10 text-blue-300 border-blue-800/40",
    amber: "bg-amber-500/10 text-amber-200 border-amber-800/40",
    green: "bg-emerald-500/10 text-emerald-300 border-emerald-800/40",
    red: "bg-red-500/10 text-red-300 border-red-900/40",
  }[tone];
  return <span className={`inline-block text-[0.6875rem] px-2 py-0.5 rounded-full border ${t}`}>{children}</span>;
}

const STATUS_DOT: Record<StaffStatusKind, string> = {
  working: "bg-emerald-400",
  break: "bg-sky-400",
  paused: "bg-amber-400",
  locked: "bg-gray-500",
  setup: "bg-amber-400",
  off: "bg-gray-700",
  not_hired: "bg-gray-700",
};

/** A round initial in the team's colour, with a status dot. */
export function Avatar({ name, team, status, size = "md" }: { name: string; team: TeamId; status?: StaffStatusKind; size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? "h-12 w-12 text-lg" : size === "sm" ? "h-7 w-7 text-xs" : "h-10 w-10 text-sm";
  const dot = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ${TEAM_COLOR[team].avatar} ${dim}`} aria-hidden>
      {(name[0] ?? "?").toUpperCase()}
      {status && <span className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-gray-950 ${dot} ${STATUS_DOT[status]}`} />}
    </span>
  );
}

export function LockIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

export function Chevron({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  );
}

export function usd(n: number) {
  return `$${n.toFixed(2)}`;
}

/** "Oct 20, 3:05pm" in New York time. */
export function nyTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(" AM", "am").replace(" PM", "pm");
}

// ── The control panel's pieces ──────────────────────────────────────────────

const TONE: Record<Tone, { pill: string; dot: string }> = {
  blue: { pill: "bg-blue-500/15 text-blue-200 border-blue-700/50", dot: "bg-blue-400 animate-pulse" },
  green: { pill: "bg-emerald-500/10 text-emerald-300 border-emerald-800/50", dot: "bg-emerald-400" },
  amber: { pill: "bg-amber-500/10 text-amber-200 border-amber-800/50", dot: "bg-amber-400" },
  violet: { pill: "bg-violet-500/15 text-violet-200 border-violet-700/50", dot: "bg-violet-400" },
  red: { pill: "bg-red-500/15 text-red-200 border-red-800/60", dot: "bg-red-400" },
  gray: { pill: "bg-gray-800/80 text-gray-300 border-gray-700", dot: "bg-gray-500" },
};

/** The status word with its colour dot: Running, On schedule, Paused, Needs you, Failed, Off… */
export function Status({ status }: { status: Pick<AgentStatus, "word" | "tone"> }) {
  const t = TONE[status.tone];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${t.pill}`} data-status={status.word}>
      <span className={`h-2 w-2 rounded-full ${t.dot}`} aria-hidden />
      {status.word}
    </span>
  );
}

/** One big number on the home screen. */
export function Tile({ label, value, sub, tone = "gray", href }: { label: string; value: number | string; sub?: string; tone?: "gray" | "blue" | "red" | "green"; href?: string }) {
  const color = { gray: "text-white", blue: "text-blue-300", red: "text-red-300", green: "text-emerald-300" }[tone];
  const body = (
    <>
      <span className="block text-gray-400 text-xs leading-tight">{label}</span>
      <span className={`block text-2xl font-bold leading-tight mt-0.5 ${color}`}>{value}</span>
      {sub && <span className="block text-gray-500 text-[0.6875rem] leading-tight mt-0.5 truncate">{sub}</span>}
    </>
  );
  const cls = "block min-w-0 rounded-2xl border border-gray-800 bg-gray-900 px-3 py-2.5";
  return href ? (
    <a href={href} className={`${cls} hover:border-gray-600`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Raw records, folded away. Everything inside is excluded from the plain-language check. */
export function Technical({ children, label = "Show technical details" }: { children: React.ReactNode; label?: string }) {
  return (
    <details data-technical className="rounded-xl border border-gray-800 bg-gray-950">
      <summary className={`${summaryBtn} w-full`}>
        {label} <Chevron />
      </summary>
      <div className="px-3 pb-3 text-xs text-gray-400 space-y-2 font-mono break-words">{children}</div>
    </details>
  );
}
