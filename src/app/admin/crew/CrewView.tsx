import Link from "next/link";
import type { Dashboard } from "@/lib/crew/dashboard";
import { resolveTab, roomTeam, tabForTeam, type OfficeTab } from "@/lib/crew/office-tabs";
import FrontDesk from "./FrontDesk";
import Lobby from "./Lobby";
import OfficeSettings, { EnvList } from "./OfficeSettings";
import TeamRoom from "./TeamRoom";
import { card } from "./ui";

// ── The Agents tab: an office (server component, no data loading) ──────────
// page.tsx loads the data; this renders it. Split so tests/render can measure
// the real markup with fixture data. The lobby, one room per team (door,
// what waits for you, the chat with the manager, the staff), your desk and
// settings. Every button is a <form method="post"> to /api/admin/crew/*, so
// it works before hydration and with no JavaScript.

export type CrewViewProps = { data: Dashboard | { ready: false; envNeeded: Dashboard["envNeeded"] }; tab: string | undefined; msg?: string };

export default function CrewView({ data, tab: tabParam, msg }: CrewViewProps) {
  const tab = resolveTab(tabParam);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Your office</h1>
        <p className="text-gray-500 text-sm mt-1">Your AI teams at work. They draft, you approve. Nothing goes out without your tap.</p>
      </div>

      {msg && (
        <div className="rounded-xl border border-blue-800/50 bg-blue-500/10 text-blue-200 text-sm px-4 py-3" role="status">
          {msg}
        </div>
      )}

      {!data.ready ? (
        <div className={`${card} space-y-3`}>
          <p className="text-white font-semibold">One step first</p>
          <p className="text-gray-300 text-sm">
            Run <code className="text-blue-300">supabase/crew.sql</code> in the Supabase SQL editor. It only adds new tables. Then come back here.
          </p>
          <EnvList envNeeded={data.envNeeded} />
        </div>
      ) : (
        <>
          <OfficeNav d={data} tab={tab} />
          <Room d={data} tab={tab} />
        </>
      )}
    </div>
  );
}

function Room({ d, tab }: { d: Dashboard; tab: OfficeTab }) {
  if (tab === "settings") return <OfficeSettings d={d} />;
  if (tab === "desk") {
    const desk = d.rooms.find((r) => r.team === "system");
    return desk ? <FrontDesk d={d} room={desk} /> : null;
  }
  const team = roomTeam(tab);
  const room = team ? d.rooms.find((r) => r.team === team) : null;
  if (room) return <TeamRoom room={room} d={d} tab={tab} />;
  return <Lobby d={d} />;
}

function OfficeNav({ d, tab }: { d: Dashboard; tab: OfficeTab }) {
  const waiting = (team: string) => {
    const r = d.rooms.find((x) => x.team === team);
    return r ? r.pending.length + r.approved.length : 0;
  };
  const items: { id: OfficeTab; label: string; dot?: boolean; count?: number }[] = [
    { id: "lobby", label: "Lobby" },
    ...d.rooms.filter((r) => r.row).map((r) => ({ id: tabForTeam(r.team), label: r.name, dot: r.door.open, count: waiting(r.team) })),
    { id: "desk", label: "Your desk", count: waiting("system") },
    { id: "settings", label: "Settings" },
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto no-scrollbar border-b border-gray-800" aria-label="Office rooms">
      {items.map((t) => (
        <Link
          key={t.id}
          href={`/admin/crew?tab=${t.id}`}
          aria-current={t.id === tab ? "page" : undefined}
          className={`inline-flex items-center gap-1.5 px-3 min-h-10 text-sm whitespace-nowrap border-b-2 -mb-px ${t.id === tab ? "border-blue-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          {t.dot !== undefined && <span className={`h-1.5 w-1.5 rounded-full ${t.dot ? "bg-emerald-400" : "bg-gray-600"}`} aria-label={t.dot ? "door open" : "door locked"} />}
          {t.label}
          {t.count ? <span className="rounded-full bg-blue-500/20 text-blue-200 text-[0.6875rem] px-1.5 leading-4">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
