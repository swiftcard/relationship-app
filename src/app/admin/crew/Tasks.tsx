import Link from "next/link";
import { nextRunLabel, pastTime, plainResult } from "@/lib/crew/agent-status";
import type { Dashboard } from "@/lib/crew/dashboard";
import { TASK_FILTERS, buildTasks, type TaskFilter } from "@/lib/crew/tasks";
import ApprovalCard from "./ApprovalCard";
import { Status, btn, card } from "./ui";

// The task list: Waiting on me / Up next / Done / Failed (with Retry).
// The filters are plain links, so they work before the page's JavaScript.

function AgentLink({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/admin/crew/agent/${id}`} className="text-white font-medium hover:underline">
      {name}
    </Link>
  );
}

export default function Tasks({ d, filter, edit }: { d: Dashboard; filter: TaskFilter; edit?: string }) {
  const t = buildTasks(d);
  const now = new Date(d.now);
  const count: Record<TaskFilter, number> = { waiting: t.waiting.length, next: t.next.length, done: t.done.length, failed: t.failed.length };
  const here = `/admin/crew?tab=tasks&filter=${filter}`;
  const back = `tasks:${filter}`;
  return (
    <div className="space-y-4">
      <nav className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Tasks">
        {TASK_FILTERS.map((f) => (
          <Link
            key={f.id}
            href={`/admin/crew?tab=tasks&filter=${f.id}`}
            aria-current={f.id === filter ? "page" : undefined}
            className={`flex items-center justify-between gap-2 min-h-11 rounded-xl border px-3 text-sm ${f.id === filter ? "border-blue-500 bg-blue-500/10 text-white" : "border-gray-800 bg-gray-900 text-gray-300 hover:border-gray-600"}`}
          >
            {f.label}
            <span className={`rounded-full px-1.5 text-xs ${f.id === "failed" && count.failed ? "bg-red-500/20 text-red-200" : "bg-gray-800 text-gray-300"}`}>{count[f.id]}</span>
          </Link>
        ))}
      </nav>

      {filter === "waiting" &&
        (t.waiting.length ? t.waiting.map((a) => <ApprovalCard key={a.id} a={a} tab={back} here={here} editing={edit === a.id} />) : <p className={`${card} text-gray-400 text-sm`}>Nothing is waiting on you.</p>)}

      {filter === "next" &&
        (t.next.length ? (
          <ul className={`${card} divide-y divide-gray-800 py-1`}>
            {t.next.map((r) => (
              <li key={r.def.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1">
                  <AgentLink id={r.def.id} name={r.name} />
                  <span className="block text-gray-400 text-xs">{r.status.kind === "running" ? "Running now" : nextRunLabel(r.rule, r.state, now)}</span>
                </span>
                <Status status={r.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={`${card} text-gray-400 text-sm`}>No agent is scheduled. Turn one on from Home or its group.</p>
        ))}

      {filter === "done" &&
        (t.done.length ? (
          <ul className={`${card} divide-y divide-gray-800 py-1`}>
            {t.done.map((x) => (
              <li key={x.key} className="py-2.5 text-sm">
                <p className="text-gray-500 text-xs">
                  {pastTime(x.at, now)}
                  {x.agent ? " · " : ""}
                  {x.agent && <AgentLink id={x.agent.def.id} name={x.agent.name} />}
                </p>
                <p className="text-gray-200 break-words">{x.text}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`${card} text-gray-400 text-sm`}>Nothing finished yet.</p>
        ))}

      {filter === "failed" &&
        (t.failed.length ? (
          t.failed.map(({ agent: r, run }) => (
            <div key={r.def.id} className={`${card} border-red-900/60 flex flex-col sm:flex-row sm:items-center gap-3`}>
              <div className="min-w-0 flex-1">
                <AgentLink id={r.def.id} name={r.name} />
                <p className="text-gray-400 text-sm">
                  {pastTime(run?.finished_at ?? run?.started_at ?? r.state.last_run_at, now)}: {plainResult(run ?? { status: "error", summary: null })}
                </p>
              </div>
              <form method="post" action={`/api/admin/crew/agents/${r.def.id}`}>
                <input type="hidden" name="tab" value="tasks:failed" />
                <button name="action" value="run" className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}>
                  Retry
                </button>
              </form>
            </div>
          ))
        ) : (
          <p className={`${card} text-gray-400 text-sm`}>Nothing has failed.</p>
        ))}
    </div>
  );
}
