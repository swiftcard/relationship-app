import Link from "next/link";
import { JOBS, scrub } from "@/lib/crew/agent-status";
import type { Dashboard } from "@/lib/crew/dashboard";
import { resolveTab, roomTeam, tabForTeam, type OfficeTab } from "@/lib/crew/office-tabs";
import { resolveFilter } from "@/lib/crew/tasks";
import { Banner } from "./AgentDetail";
import ChatAutoRefresh from "./ChatAutoRefresh";
import GroupPage from "./GroupPage";
import Home from "./Home";
import OfficeSettings, { EnvList } from "./OfficeSettings";
import Tasks from "./Tasks";
import { card } from "./ui";

// ── The Agents tab: a control panel (server component, no data loading) ────
// page.tsx loads the data; this renders it. Split so tests/render can measure
// the real markup with fixture data. Home (what's running, what got done,
// what needs you, every agent by job), the task list, one page per group and
// settings. Every button is a <form method="post"> to /api/admin/crew/*, so
// it works before hydration and with no JavaScript.

export type CrewViewProps = {
  data: Dashboard | { ready: false; envNeeded: Dashboard["envNeeded"] };
  tab: string | undefined;
  msg?: string;
  tone?: string;
  filter?: string;
  edit?: string;
};

export default function CrewView({ data, tab: tabParam, msg, tone, filter, edit }: CrewViewProps) {
  const tab = resolveTab(tabParam);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Agents</h1>
        <p className="text-gray-500 text-sm mt-1">Your AI agents. They draft, you approve. Nothing goes out without your OK.</p>
      </div>

      {msg && <Banner msg={scrub(msg)} tone={tone} />}

      {!data.ready ? (
        <div className={`${card} space-y-3`}>
          <p className="text-white font-semibold">Not set up yet</p>
          <p className="text-gray-300 text-sm">The agents&apos; storage hasn&apos;t been created. Whoever set up SwiftCard needs to run the agents&apos; database step once, then this page fills in.</p>
          <EnvList envNeeded={data.envNeeded} />
        </div>
      ) : (
        <>
          <Nav d={data} tab={tab} />
          <View d={data} tab={tab} filter={filter} edit={edit} />
          <ChatAutoRefresh active={data.summary.running > 0} everyMs={5000} forMs={300_000} />
        </>
      )}
    </div>
  );
}

function View({ d, tab, filter, edit }: { d: Dashboard; tab: OfficeTab; filter?: string; edit?: string }) {
  if (tab === "settings") return <OfficeSettings d={d} />;
  if (tab === "tasks") return <Tasks d={d} filter={resolveFilter(filter)} edit={edit} />;
  const team = roomTeam(tab);
  const room = team ? d.rooms.find((r) => r.team === team) : null;
  if (room) return <GroupPage room={room} d={d} edit={edit} />;
  return <Home d={d} edit={edit} />;
}

function Nav({ d, tab }: { d: Dashboard; tab: OfficeTab }) {
  const waiting = d.inbox.length + d.approved.length;
  const failed = d.agents.filter((a) => a.status.kind === "failed").length;
  const groups = JOBS.flatMap((j) => j.teams)
    .map((t) => d.rooms.find((r) => r.team === t))
    .filter((r): r is NonNullable<typeof r> => !!r);
  const items: { id: OfficeTab; label: string; count?: number; alert?: boolean }[] = [
    { id: "lobby", label: "Home" },
    { id: "tasks", label: "Tasks", count: waiting + failed, alert: failed > 0 },
    ...groups.map((r) => ({ id: tabForTeam(r.team), label: r.name, count: r.pending.length + r.approved.length })),
    { id: "settings", label: "Settings" },
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto no-scrollbar border-b border-gray-800" aria-label="Agents">
      {items.map((t) => (
        <Link
          key={t.id}
          href={`/admin/crew?tab=${t.id}`}
          aria-current={t.id === tab ? "page" : undefined}
          className={`inline-flex items-center gap-1.5 px-3 min-h-10 text-sm whitespace-nowrap border-b-2 -mb-px ${t.id === tab ? "border-blue-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          {t.label}
          {t.count ? <span className={`rounded-full text-[0.6875rem] px-1.5 leading-4 ${t.alert ? "bg-red-500/25 text-red-100" : "bg-blue-500/20 text-blue-200"}`}>{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
