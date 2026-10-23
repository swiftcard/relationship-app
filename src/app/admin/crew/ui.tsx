import type { StaffStatusKind } from "@/lib/crew/staff";
import { TEAM_COLOR } from "@/lib/crew/staff";
import type { TeamId } from "@/lib/crew/types";

// ── Shared pieces for the office (server components) ───────────────────────

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

const PILL: Record<StaffStatusKind, string> = {
  working: "bg-emerald-500/10 text-emerald-300 border-emerald-800/40",
  break: "bg-sky-500/10 text-sky-200 border-sky-800/40",
  paused: "bg-amber-500/10 text-amber-200 border-amber-800/40",
  locked: "bg-gray-800 text-gray-300 border-gray-700",
  setup: "bg-amber-500/10 text-amber-200 border-amber-800/40",
  off: "bg-gray-900 text-gray-400 border-gray-800",
  not_hired: "bg-gray-900 text-gray-500 border-gray-800",
};

export function StatusPill({ kind, label }: { kind: StaffStatusKind; label: string }) {
  return <span className={`inline-flex items-center gap-1 text-[0.6875rem] px-2 py-0.5 rounded-full border ${PILL[kind]}`}>{label}</span>;
}

/** Green "Open" / gray "Locked" pill for a door. */
export function DoorPill({ open, label }: { open: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${open ? "bg-emerald-500/10 text-emerald-300 border-emerald-800/40" : "bg-gray-800 text-gray-300 border-gray-700"}`}>
      {open ? <DoorIcon /> : <LockIcon />}
      {label}
    </span>
  );
}

export function DoorIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3 14.5h10M4.5 14.5V2.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v12" />
      <circle cx="9.5" cy="8.5" r=".75" fill="currentColor" stroke="none" />
    </svg>
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
