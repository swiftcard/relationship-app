import Link from "next/link";
import { askLine, nextRunLabel, pastTime, plainResult } from "@/lib/crew/agent-status";
import type { AgentRow } from "@/lib/crew/dashboard";
import { isPaused } from "@/lib/crew/doors";
import { LockIcon, Status, btn, card } from "./ui";

// One agent: what it does, its status, when it last ran and runs next, what
// the last run did, and the buttons. Every button is a plain post.

const ACTION_BTN = {
  primary: `${btn} bg-blue-600 text-white hover:bg-blue-500`,
  quiet: `${btn} bg-gray-800 text-white hover:bg-gray-700`,
  warn: `${btn} bg-amber-600 text-white hover:bg-amber-500`,
  stop: `${btn} bg-gray-900 text-red-200 border border-red-900/60 hover:bg-red-950`,
};

function Btn({ id, back, action, label, tone }: { id: string; back: string; action: string; label: string; tone: keyof typeof ACTION_BTN }) {
  return (
    <form method="post" action={`/api/admin/crew/agents/${id}`}>
      <input type="hidden" name="tab" value={back} />
      <button name="action" value={action} className={ACTION_BTN[tone]}>
        {label}
      </button>
    </form>
  );
}

/** Run now / Retry · Pause or Resume · Stop, or Turn on. */
export function AgentControls({ r, back, now }: { r: AgentRow; back: string; now: Date }) {
  const k = r.status.kind;
  if (k === "unavailable" || k === "setup") return null;
  const id = r.def.id;
  if (!r.state.enabled) return <Btn id={id} back={back} action="enable" label="Turn on" tone="primary" />;
  const ownPause = isPaused(r.state, now);
  return (
    <div className="flex flex-wrap gap-2">
      {k !== "running" && k !== "paused" && <Btn id={id} back={back} action="run" label={k === "failed" ? "Retry" : "Run now"} tone="primary" />}
      {ownPause ? <Btn id={id} back={back} action="resume" label="Resume" tone="warn" /> : <Btn id={id} back={back} action="pause" label="Pause" tone="quiet" />}
      <Btn id={id} back={back} action="stop" label="Stop" tone="stop" />
    </div>
  );
}

export function AskLine({ r }: { r: AgentRow }) {
  const a = askLine(r.def);
  return (
    <p className={`flex items-center gap-1.5 text-xs ${a.locked ? "text-emerald-300/90" : "text-gray-500"}`}>
      {a.locked && <LockIcon className="h-3 w-3 shrink-0" />}
      {a.text}
    </p>
  );
}

export function Facts({ r, now }: { r: AgentRow; now: Date }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
      <div className="min-w-0">
        <dt className="text-gray-500">Last run</dt>
        <dd className="text-gray-200">{pastTime(r.state.last_run_at ?? r.lastRun?.started_at ?? null, now)}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-gray-500">Next run</dt>
        <dd className="text-gray-200">{nextRunLabel(r.rule, r.state, now)}</dd>
      </div>
      <div className="col-span-2 min-w-0">
        <dt className="text-gray-500">Last result</dt>
        <dd className="text-gray-200 break-words">{plainResult(r.lastRun)}</dd>
      </div>
    </dl>
  );
}

export default function AgentCard({ r, back, now }: { r: AgentRow; back: string; now: Date }) {
  return (
    <article id={`s-${r.def.id}`} className={`${card} flex flex-col gap-3 scroll-mt-20`} data-agent={r.def.id}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-white font-semibold leading-tight">
            <Link href={`/admin/crew/agent/${r.def.id}`} className="hover:underline">
              {r.name}
            </Link>
          </h4>
          <p className="text-gray-400 text-sm mt-1 line-clamp-2">{r.def.purpose}</p>
        </div>
        <Status status={r.status} />
      </div>
      {r.status.kind !== "scheduled" && <p className="text-gray-300 text-xs">{r.status.line}</p>}
      {r.status.kind !== "unavailable" && <Facts r={r} now={now} />}
      <AskLine r={r} />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <AgentControls r={r} back={back} now={now} />
        <Link href={`/admin/crew/agent/${r.def.id}`} className={`${btn} text-gray-300 hover:text-white ml-auto`}>
          Details →
        </Link>
      </div>
    </article>
  );
}
