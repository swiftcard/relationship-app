import Link from "next/link";
import type { Room, StaffRow } from "@/lib/crew/dashboard";
import { TIER_LABEL } from "@/lib/crew/models";
import { Avatar, Chevron, StatusPill, btn, card, nyTime, summaryBtn, usd } from "./ui";

// The people in a room: the manager on top, the staff board, and the
// collapsed "Not hired yet" list. Every button is a plain post.

function modelLabel(r: StaffRow, economy: boolean) {
  if (economy && r.def.freeInEconomy && !r.state.model_override) return "No AI (free)";
  return TIER_LABEL[r.state.model_override ?? (economy && r.def.economyTier ? r.def.economyTier : r.def.tier)];
}

function Actions({ r, tab, hire = false }: { r: StaffRow; tab: string; hire?: boolean }) {
  const action = `/api/admin/crew/agents/${r.def.id}`;
  const blocked = !!r.def.locked || r.missing.length > 0;
  const canStart = r.state.enabled && !blocked && r.status.kind !== "paused" && r.status.kind !== "locked" && r.status.kind !== "working";
  return (
    <div className="flex flex-wrap gap-2">
      <form method="post" action={action}>
        <input type="hidden" name="tab" value={tab} />
        <button
          name="action"
          value={r.state.enabled ? "disable" : "enable"}
          disabled={!r.state.enabled && blocked}
          className={`${btn} ${r.state.enabled ? "bg-gray-800 text-white hover:bg-gray-700" : "bg-blue-600 text-white hover:bg-blue-500"} disabled:opacity-40`}
        >
          {r.state.enabled ? "Take off the team" : hire ? "Hire" : "Put on the team"}
        </button>
      </form>
      {canStart && (
        <form method="post" action={action}>
          <input type="hidden" name="tab" value={tab} />
          <button name="action" value="run" className={`${btn} bg-gray-800 text-white hover:bg-gray-700`}>
            Start a shift now
          </button>
        </form>
      )}
      {r.status.kind === "paused" && (
        <form method="post" action={action}>
          <input type="hidden" name="tab" value={tab} />
          <button name="action" value="resume" className={`${btn} bg-amber-600 text-white hover:bg-amber-500`}>
            Resume
          </button>
        </form>
      )}
    </div>
  );
}

export function StaffCard({ r, tab, economy }: { r: StaffRow; tab: string; economy: boolean }) {
  return (
    <article id={`s-${r.def.id}`} className={`${card} space-y-2 scroll-mt-20`} data-agent={r.def.id}>
      <div className="flex items-start gap-3">
        <Avatar name={r.person.first} team={r.def.team} status={r.status.kind} />
        <div className="min-w-0 flex-1">
          <p className="text-white font-medium leading-tight">{r.person.first}</p>
          <p className="text-gray-400 text-sm leading-tight mt-0.5 break-words">{r.person.title}</p>
        </div>
        <StatusPill kind={r.status.kind} label={r.status.label} />
      </div>
      <p className="text-gray-400 text-xs break-words">{r.status.line}</p>
      {r.lastRun && (
        <p className="text-gray-500 text-xs break-words">
          Last shift {nyTime(r.lastRun.started_at)}: {r.lastRun.summary ?? r.lastRun.status}
        </p>
      )}
      <Actions r={r} tab={tab} />
      <details>
        <summary className={`${summaryBtn} -ml-3`}>
          What they do <Chevron />
        </summary>
        <div className="space-y-1 pt-1">
          <p className="text-gray-300 text-sm">{r.def.purpose}</p>
          <p className="text-gray-500 text-xs">
            Works {r.schedule} · {modelLabel(r, economy)} · {usd(r.today.usd)} of {usd(r.cap)} today
          </p>
        </div>
      </details>
    </article>
  );
}

export function ManagerCard({ room, tab }: { room: Room; tab: string }) {
  const m = room.manager;
  if (!m) return null;
  return (
    <article id={`s-${m.def.id}`} className={`${card} scroll-mt-20 border-gray-700 bg-gray-900/50`} data-agent={m.def.id}>
      <div className="flex items-start gap-3">
        <Avatar name={m.person.first} team={m.def.team} size="lg" status={m.state.lease_until && new Date(m.state.lease_until) > new Date() ? "working" : "break"} />
        <div className="min-w-0 flex-1">
          <p className="text-white font-semibold leading-tight">{m.person.first}</p>
          <p className="text-gray-400 text-sm mt-0.5">{m.person.title}</p>
          <p className="text-gray-500 text-xs mt-1.5">
            Watches the team, writes your report every morning (even when the door is locked) and answers you in the chat.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <Link href={`/admin/crew?tab=${tab}#chat-end`} className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}>
          Talk to {m.person.first}
        </Link>
        <form method="post" action={`/api/admin/crew/agents/${m.def.id}`}>
          <input type="hidden" name="tab" value={tab} />
          <button name="action" value={m.state.enabled ? "disable" : "enable"} className={`${btn} text-gray-300 hover:text-white`}>
            {m.state.enabled ? "Stop the morning report" : "Start the morning report"}
          </button>
        </form>
      </div>
    </article>
  );
}

export function StaffBoard({ room, tab, economy }: { room: Room; tab: string; economy: boolean }) {
  const working = room.staff.filter((s) => s.state.enabled).length;
  return (
    <section className="space-y-3" aria-labelledby={`staff-${room.team}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={`staff-${room.team}`} className="text-white font-semibold">
          The team
        </h2>
        <span className="text-gray-500 text-xs">
          {working} of {room.staff.length} on the team
        </span>
      </div>
      {room.staff.length === 0 ? (
        <p className="text-gray-500 text-sm">Nobody here yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {room.staff.map((r) => (
            <StaffCard key={r.def.id} r={r} tab={tab} economy={economy} />
          ))}
        </div>
      )}
      {room.notHired.length > 0 && (
        <details className="rounded-2xl border border-dashed border-gray-800 px-3 py-1" data-not-hired>
          <summary className={`${summaryBtn} -mx-3 w-[calc(100%+1.5rem)]`}>
            Not hired yet ({room.notHired.length}) <Chevron />
          </summary>
          <div className="space-y-3 pb-3">
            {room.notHired.map((r) => (
              <article key={r.def.id} id={`s-${r.def.id}`} className="flex items-start gap-3 scroll-mt-20" data-agent={r.def.id}>
                <Avatar name={r.person.first} team={r.def.team} size="sm" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-gray-300 text-sm">
                    {r.person.first} <span className="text-gray-500">· {r.person.title}</span>
                  </p>
                  <p className="text-gray-500 text-xs break-words">{r.def.locked ?? r.def.purpose}</p>
                  {!r.def.locked && <Actions r={r} tab={tab} hire />}
                </div>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
