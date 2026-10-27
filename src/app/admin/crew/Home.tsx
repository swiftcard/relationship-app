import Link from "next/link";
import { JOBS, plainNeeds } from "@/lib/crew/agent-status";
import type { Dashboard } from "@/lib/crew/dashboard";
import { tabForTeam } from "@/lib/crew/office-tabs";
import AgentCard from "./AgentCard";
import ApprovalCard from "./ApprovalCard";
import { GroupSwitch, groupStatus } from "./GroupPage";
import SheetAgents from "./SheetAgents";
import { Chevron, Status, Tile, btn, card, summaryBtn, usd } from "./ui";

// Home: the 10-second view. Pause all; how many are running, done today and
// waiting for you; Start / Stop for every marketing agent (their work is in
// the Sheet); what needs you (the website fixes, pinned first); then the
// website-health agents. Every button is a plain post.

const HOME_APPROVALS = 3;

export function PauseAll({ d, back = "lobby" }: { d: Dashboard; back?: string }) {
  if (d.hardDisabled) return <p className="text-red-200 text-sm">All agents are switched off from the server, so nothing runs. Whoever set up SwiftCard can turn them back on.</p>;
  const paused = d.settings.kill_all;
  return (
    <form method="post" action="/api/admin/crew/settings" className="w-full sm:w-auto">
      <input type="hidden" name="tab" value={back} />
      <input type="hidden" name="action" value={paused ? "unkill" : "kill"} />
      <button className={`${btn} w-full sm:w-auto min-h-12 px-5 text-base font-semibold ${paused ? "bg-emerald-600 text-white hover:bg-emerald-500" : "bg-red-600 text-white hover:bg-red-500"}`}>
        {paused ? "Resume all agents" : "Pause all agents"}
      </button>
    </form>
  );
}

function TopBar({ d }: { d: Dashboard }) {
  const s = d.summary;
  const paused = d.settings.kill_all || d.hardDisabled;
  return (
    <section className="space-y-3" aria-label="Right now">
      <div className={`rounded-2xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${paused ? "border-red-900/60 bg-red-500/10" : "border-gray-800 bg-gray-900"}`}>
        <div className="min-w-0 flex-1">
          <p className={`font-semibold ${paused ? "text-red-200" : "text-white"}`}>{paused ? "All agents are paused" : "Agents are on"}</p>
          <p className="text-gray-400 text-xs mt-0.5">
            {paused ? "Nothing new starts until you tap Resume all." : "Pause all stops every agent at its next step. Nothing is lost."} Spent today: {usd(d.today.total.usd)} of {usd(d.settings.daily_usd_cap)}.
          </p>
        </div>
        <PauseAll d={d} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Running now" value={s.running} tone={s.running ? "blue" : "gray"} href="/admin/crew?tab=tasks&filter=next" />
        <Tile label="Done today" value={s.doneToday} sub={s.decidedToday ? `+${s.decidedToday} you approved` : undefined} tone="green" href="/admin/crew?tab=tasks&filter=done" />
        <Tile label="Needs you" value={s.needsYou} tone={s.needsYou ? "red" : "gray"} href="#needs-you" />
      </div>
    </section>
  );
}

function NeedsYou({ d, edit }: { d: Dashboard; edit?: string }) {
  const waiting = [...d.inbox, ...d.approved];
  const failed = d.agents.filter((a) => a.status.kind === "failed");
  const setup = d.agents.filter((a) => a.status.kind === "setup" && (a.state.enabled || a.def.role !== "manager"));
  return (
    <section id="needs-you" className="space-y-3 scroll-mt-20" aria-labelledby="needs-you-h">
      <h2 id="needs-you-h" className="text-white text-lg font-bold">
        Needs you{waiting.length + failed.length ? ` (${waiting.length + failed.length})` : ""}
      </h2>
      {waiting.length + failed.length === 0 && <p className={`${card} text-gray-300 text-sm`}>Nothing needs you right now. Drafts to approve and anything that broke show up here first.</p>}
      {failed.map((r) => (
        <div key={r.def.id} className={`${card} border-red-900/60 flex flex-col sm:flex-row sm:items-center gap-3`}>
          <div className="min-w-0 flex-1">
            <p className="text-white font-medium">
              <Link href={`/admin/crew/agent/${r.def.id}`} className="hover:underline">
                {r.name}
              </Link>{" "}
              didn&apos;t finish
            </p>
            <p className="text-gray-400 text-sm">Something went wrong on its last run. Retry runs it again now.</p>
          </div>
          <form method="post" action={`/api/admin/crew/agents/${r.def.id}`}>
            <input type="hidden" name="tab" value="lobby" />
            <button name="action" value="run" className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}>
              Retry
            </button>
          </form>
        </div>
      ))}
      {waiting.slice(0, HOME_APPROVALS).map((a) => (
        <ApprovalCard key={a.id} a={a} tab="lobby" here="/admin/crew" editing={edit === a.id} />
      ))}
      {waiting.length > HOME_APPROVALS && (
        <Link href="/admin/crew?tab=tasks&filter=waiting" className={`${btn} w-full bg-gray-900 border border-gray-700 text-white hover:bg-gray-800`}>
          See all {waiting.length} waiting <Chevron />
        </Link>
      )}
      {setup.length > 0 && (
        <details className="rounded-2xl border border-dashed border-gray-800 px-3 py-1">
          <summary className={`${summaryBtn} -mx-3 w-[calc(100%+1.5rem)]`}>
            {setup.length} agents need setting up first <Chevron />
          </summary>
          <ul className="space-y-1 pb-3 text-sm">
            {setup.map((r) => (
              <li key={r.def.id} className="text-gray-400">
                <span className="text-gray-200">{r.name}</span> needs {plainNeeds(r.missing)}
              </li>
            ))}
          </ul>
          <p className="text-gray-500 text-xs pb-3">
            The list is also in <Link href="/admin/crew?tab=settings" className="text-blue-300 hover:underline">Settings</Link>.
          </p>
        </details>
      )}
    </section>
  );
}

function Jobs({ d }: { d: Dashboard }) {
  const now = new Date(d.now);
  return (
    <div className="space-y-6">
      {JOBS.map((job) => (
        <section key={job.id} className="space-y-3" aria-labelledby={`job-${job.id}`}>
          <h2 id={`job-${job.id}`} className="text-white text-lg font-bold border-b border-gray-800 pb-1">
            {job.name}
          </h2>
          {job.teams.map((team) => {
            const room = d.rooms.find((r) => r.team === team);
            if (!room) return null;
            const st = groupStatus(room);
            const tab = tabForTeam(team);
            // Home shows the agents that are on; the rest wait on the group's page.
            const all = [...room.staff, ...(room.manager ? [room.manager] : []), ...room.notHired];
            const shown = all.filter((r) => r.state.enabled);
            const hidden = all.length - shown.length;
            return (
              <div key={team} className="space-y-2" data-group={team}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-gray-100 font-semibold mr-auto">
                    <Link href={`/admin/crew?tab=${tab}`} className="inline-flex items-center gap-1 min-h-10 hover:underline">
                      {room.name} <Chevron />
                    </Link>
                  </h3>
                  {room.row && <Status status={st} />}
                  <GroupSwitch room={room} back="lobby" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {shown.map((r) => (
                    <AgentCard key={r.def.id} r={r} back="lobby" now={now} />
                  ))}
                </div>
                {hidden > 0 && (
                  <Link href={`/admin/crew?tab=${tab}`} className="inline-flex items-center gap-1 min-h-10 text-gray-400 text-sm hover:text-white">
                    {shown.length ? `+ ${hidden} turned off` : `All ${hidden} agents here are off`} · open {room.name} to turn one on <Chevron />
                  </Link>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

export default function Home({ d, edit }: { d: Dashboard; edit?: string }) {
  return (
    <div className="space-y-6">
      <TopBar d={d} />
      <SheetAgents rows={d.sheetAgents} sheetUrl={d.sheetUrl} />
      <NeedsYou d={d} edit={edit} />
      <Jobs d={d} />
      <div className="flex flex-wrap gap-2">
        {d.sheetUrl && (
          <a href={d.sheetUrl} target="_blank" rel="noopener noreferrer" className={`${btn} bg-gray-900 border border-gray-700 text-white hover:bg-gray-800`}>
            Open the SwiftCard Leads sheet
          </a>
        )}
        <Link href="/admin/crew?tab=settings" className={`${btn} bg-gray-900 border border-gray-700 text-white hover:bg-gray-800`}>
          Settings
        </Link>
      </div>
    </div>
  );
}
