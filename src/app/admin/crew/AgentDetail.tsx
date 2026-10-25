import Link from "next/link";
import type { AgentDetail as Detail } from "@/lib/crew/agent-detail";
import { GROUP_NAME, pastTime } from "@/lib/crew/agent-status";
import { tabForTeam } from "@/lib/crew/office-tabs";
import { AgentControls, AskLine, Facts } from "./AgentCard";
import ApprovalCard from "./ApprovalCard";
import ChatAutoRefresh from "./ChatAutoRefresh";
import ScheduleForm from "./ScheduleForm";
import { Status, Technical, card, nyTime, usd } from "./ui";

// One agent's page: status and buttons, when it runs, what waits for you,
// what it did this week in plain words, what it made, and (folded away) the
// raw run records.

const DOT = { ok: "bg-emerald-400", info: "bg-blue-400", warn: "bg-amber-400", bad: "bg-red-400" };

export default function AgentDetail({ x, edit, msg, tone }: { x: Detail; edit?: string; msg?: string; tone?: string }) {
  const { row: r, dash: d } = x;
  const now = new Date(d.now);
  const back = `agent:${r.def.id}`;
  const here = `/admin/crew/agent/${r.def.id}`;
  const waiting = [...d.inbox, ...d.approved].filter((a) => a.agent_id === r.def.id);
  const groupTab = tabForTeam(r.def.team);
  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-gray-400" aria-label="Breadcrumb">
        <Link href="/admin/crew" className="inline-flex items-center min-h-10 hover:text-white">
          Agents
        </Link>
        <span aria-hidden>›</span>
        <Link href={`/admin/crew?tab=${groupTab}`} className="inline-flex items-center min-h-10 hover:text-white">
          {GROUP_NAME[r.def.team]}
        </Link>
      </nav>
      {msg && <Banner msg={msg} tone={tone} />}

      <header className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-white text-xl font-bold">{r.name}</h1>
            <p className="text-gray-300 text-sm mt-1">{r.def.purpose}</p>
          </div>
          <Status status={r.status} />
        </div>
        <p className="text-gray-300 text-sm">{r.status.line}</p>
        {r.status.kind !== "unavailable" && <Facts r={r} now={now} />}
        <AskLine r={r} />
        <AgentControls r={r} back={back} now={now} />
        {(r.status.kind === "running" || r.status.kind === "paused") && (
          <p className="text-gray-500 text-xs">Pause and Stop take effect at its next step: a step already under way finishes first.</p>
        )}
      </header>

      <ScheduleForm r={r} back={back} />

      {waiting.length > 0 && (
        <section className="space-y-3" aria-labelledby="waiting-h">
          <h2 id="waiting-h" className="text-white font-semibold">
            Waiting for you ({waiting.length})
          </h2>
          {waiting.map((a) => (
            <ApprovalCard key={a.id} a={a} tab={back} here={here} editing={edit === a.id} />
          ))}
        </section>
      )}

      <section className={`${card} space-y-3`} aria-labelledby="activity-h">
        <h2 id="activity-h" className="text-white font-semibold">
          What it did this week
        </h2>
        {x.activity.length === 0 ? (
          <p className="text-gray-400 text-sm">Nothing this week yet.</p>
        ) : (
          <ol className="space-y-2.5">
            {x.activity.slice(0, 40).map((it) => (
              <li key={it.key} className="flex gap-2.5 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[it.tone]}`} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-gray-500 text-xs">{pastTime(it.at, now)}</span>
                  <span className="text-gray-200 break-words">
                    {it.text}
                    {it.href && (
                      <>
                        {" "}
                        <a href={it.href} className="text-blue-300 hover:underline whitespace-nowrap">
                          See it
                        </a>
                      </>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={`${card} space-y-2`} aria-labelledby="outputs-h">
        <h2 id="outputs-h" className="text-white font-semibold">
          What it made
        </h2>
        {x.outputs.length === 0 && !x.report ? (
          <p className="text-gray-400 text-sm">Nothing to show yet.</p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {x.outputs.map((o) => (
              <li key={o.key} className="py-2 text-sm flex flex-wrap items-baseline justify-between gap-x-3">
                {o.href ? (
                  <a href={o.href} target={o.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="text-blue-300 hover:underline break-words min-w-0">
                    {o.label}
                  </a>
                ) : (
                  <span className="text-gray-200 break-words min-w-0">{o.label}</span>
                )}
                <span className="text-gray-500 text-xs">{o.note}</span>
              </li>
            ))}
          </ul>
        )}
        {x.report && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-3 py-2.5">
            <p className="text-gray-500 text-xs mb-1">Latest report · {nyTime(x.report.created_at)}</p>
            <pre className="text-gray-200 text-sm whitespace-pre-wrap break-words font-sans">{x.report.body}</pre>
          </div>
        )}
      </section>

      <Technical label="Show technical details (raw logs)">
        <p>
          id {r.def.id} · team {r.def.team} · role {r.def.role} · model {r.state.model_override ?? r.def.tier} · today {usd(r.today.usd)} of {usd(r.cap)} · {r.today.tokens} tokens
        </p>
        {r.state.status_note && <p>note: {r.state.status_note}</p>}
        {r.missing.length > 0 && <p>missing: {r.missing.join(", ")}</p>}
        {x.runs.length === 0 && <p>No runs recorded.</p>}
        {x.runs.map((run) => (
          <div key={run.id} className="border-t border-gray-800 pt-2">
            <p>
              {run.started_at} → {run.finished_at ?? "…"} · {run.status}
            </p>
            {run.summary && <p>{run.summary}</p>}
            {run.error && <p className="text-red-300">{run.error}</p>}
            {Object.keys(run.stats ?? {}).length > 0 && <p>{Object.entries(run.stats).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
          </div>
        ))}
      </Technical>
      <ChatAutoRefresh active={r.status.kind === "running"} everyMs={5000} forMs={300_000} />
    </div>
  );
}

export function Banner({ msg, tone }: { msg: string; tone?: string }) {
  const bad = tone === "err";
  return (
    <div className={`rounded-xl border text-sm px-4 py-3 ${bad ? "border-red-800/60 bg-red-500/10 text-red-200" : "border-emerald-800/50 bg-emerald-500/10 text-emerald-100"}`} role={bad ? "alert" : "status"}>
      {msg}
    </div>
  );
}
