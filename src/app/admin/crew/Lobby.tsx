import Link from "next/link";
import type { Dashboard, Room } from "@/lib/crew/dashboard";
import { tabForTeam } from "@/lib/crew/office-tabs";
import { DoorSwitch } from "./Door";
import { Avatar, Badge, Chevron, DoorIcon, DoorPill, LockIcon, btn, card, usd } from "./ui";

// The lobby: is the office open, what has it cost today, who is working,
// what waits for you, and one door per team.

function OfficeBar({ d }: { d: Dashboard }) {
  const locked = d.settings.kill_all || d.hardDisabled;
  const doors = d.rooms.filter((r) => r.row);
  const open = doors.filter((r) => r.door.open).length;
  const working = d.rooms.flatMap((r) => [...(r.manager ? [r.manager] : []), ...r.staff]).filter((s) => s.status.kind === "working");
  const pct = Math.min(100, Math.round((d.today.total.usd / Math.max(0.01, d.settings.daily_usd_cap)) * 100));
  return (
    <section className={`${card} grid grid-cols-1 sm:grid-cols-3 gap-4`}>
      <div className="space-y-2">
        <p className="text-gray-500 text-xs">The office</p>
        <p className={`text-lg font-bold flex items-center gap-2 ${locked ? "text-red-300" : "text-emerald-300"}`}>
          {locked ? <LockIcon className="h-4 w-4" /> : <DoorIcon className="h-4 w-4" />}
          {locked ? "Locked" : `Open · ${open} of ${doors.length} doors open`}
        </p>
        {d.hardDisabled ? (
          <p className="text-gray-500 text-xs">CREW_DISABLED is set in Vercel, so the office stays locked.</p>
        ) : (
          <form method="post" action="/api/admin/crew/settings">
            <input type="hidden" name="tab" value="lobby" />
            <input type="hidden" name="action" value={d.settings.kill_all ? "unkill" : "kill"} />
            <button className={`${btn} ${d.settings.kill_all ? "bg-emerald-600 text-white hover:bg-emerald-500" : "bg-red-600 text-white hover:bg-red-500"}`}>
              {d.settings.kill_all ? <DoorIcon /> : <LockIcon />}
              {d.settings.kill_all ? "Unlock the office" : "Lock the whole office"}
            </button>
          </form>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-gray-500 text-xs">Spent today</p>
        <p className="text-white text-lg font-bold">
          {usd(d.today.total.usd)} <span className="text-gray-500 text-sm font-normal">of {usd(d.settings.daily_usd_cap)}</span>
        </p>
        <div className="h-2 rounded-full bg-gray-800 overflow-hidden" aria-hidden>
          <div className={`h-full ${pct >= 90 ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
        </div>
        <Link href="/admin/crew?tab=settings#money" className="text-gray-500 text-xs hover:text-gray-300">
          Change limits in Settings
        </Link>
      </div>
      <div className="space-y-2">
        <p className="text-gray-500 text-xs">Working right now</p>
        {working.length === 0 ? (
          <p className="text-gray-400 text-sm">Nobody is on a shift right now.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {working.map((s) => (
              <Link key={s.def.id} href={`/admin/crew?tab=${tabForTeam(s.def.team)}#s-${s.def.id}`} title={`${s.person.first} · ${s.person.title}`} className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 pr-2.5 text-xs text-gray-200">
                <Avatar name={s.person.first} team={s.def.team} size="sm" status="working" />
                {s.person.first}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function WaitingSummary({ d }: { d: Dashboard }) {
  const lines = d.rooms
    .map((r) => ({ r, decide: r.pending.length, post: r.approved.length }))
    .filter((x) => x.decide + x.post > 0);
  return (
    <section className={`${card} space-y-2`} aria-labelledby="waiting-all">
      <h2 id="waiting-all" className="text-white font-semibold">
        Waiting for you
      </h2>
      {lines.length === 0 ? (
        <p className="text-gray-400 text-sm">Nothing right now. When someone drafts something, it waits in their room.</p>
      ) : (
        <ul className="divide-y divide-gray-800">
          {lines.map(({ r, decide, post }) => (
            <li key={r.team}>
              <Link href={`/admin/crew?tab=${tabForTeam(r.team)}#waiting`} className="flex items-center justify-between gap-3 min-h-11 py-1.5 text-sm hover:text-white">
                <span className="text-gray-200">{r.name}</span>
                <span className="flex items-center gap-1.5 text-gray-400">
                  {decide > 0 && <Badge tone="blue">{decide} to decide</Badge>}
                  {post > 0 && <Badge tone="green">{post} to post</Badge>}
                  <Chevron />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DoorCard({ room }: { room: Room }) {
  const people = [...(room.manager ? [room.manager] : []), ...room.staff];
  const shown = people.slice(0, 7);
  const onTeam = room.staff.filter((s) => s.state.enabled).length;
  const waiting = room.pending.length + room.approved.length;
  const tab = tabForTeam(room.team);
  return (
    <article className={`${card} flex flex-col gap-3`} data-door={room.team}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-white font-semibold">{room.name}</h3>
          <p className="text-gray-500 text-xs mt-0.5">
            {room.manager ? `${room.manager.person.first} manages · ` : ""}
            {onTeam} of {room.staff.length} on the team
          </p>
        </div>
        {waiting > 0 && <Badge tone="blue">{waiting} waiting</Badge>}
      </div>
      <div>
        <DoorPill open={room.door.open} label={room.door.label} />
      </div>
      <div className="flex items-center -space-x-1.5" aria-label={`${room.name} staff`}>
        {shown.map((s) => (
          <Avatar key={s.def.id} name={s.person.first} team={s.def.team} status={s.status.kind} size="sm" />
        ))}
        {people.length > shown.length && <span className="pl-3 text-xs text-gray-500">+{people.length - shown.length}</span>}
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <DoorSwitch room={room} tab="lobby" compact />
        <Link href={`/admin/crew?tab=${tab}`} className={`${btn} bg-gray-900 text-white hover:bg-gray-800 border border-gray-700`}>
          Enter room <Chevron />
        </Link>
      </div>
    </article>
  );
}

export default function Lobby({ d }: { d: Dashboard }) {
  const desk = d.rooms.find((r) => r.team === "system");
  const hannah = desk?.staff.find((s) => s.def.id === "head");
  const asks = desk ? desk.pending.length + desk.approved.length : 0;
  return (
    <div className="space-y-5">
      <OfficeBar d={d} />
      <WaitingSummary d={d} />
      <section className="space-y-3" aria-labelledby="doors">
        <h2 id="doors" className="text-white font-semibold">
          The teams
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.rooms
            .filter((r) => r.row)
            .map((r) => (
              <DoorCard key={r.team} room={r} />
            ))}
        </div>
      </section>
      {desk && (
        <Link href="/admin/crew?tab=desk" className={`${card} flex items-center gap-3 hover:border-gray-700`}>
          {hannah && <Avatar name={hannah.person.first} team="system" status={hannah.status.kind} />}
          <span className="min-w-0 flex-1">
            <span className="block text-white font-semibold">Your desk</span>
            <span className="block text-gray-400 text-sm">
              {hannah ? `${hannah.person.first}'s plan for tomorrow` : "The plan for tomorrow"}
              {asks ? ` · ${asks} question${asks === 1 ? "" : "s"} for you` : ""} · hand something to the team
            </span>
          </span>
          <Chevron />
        </Link>
      )}
    </div>
  );
}
