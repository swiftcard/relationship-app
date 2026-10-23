import type { Dashboard, Room } from "@/lib/crew/dashboard";
import { whenLabel } from "@/lib/crew/doors";
import { AGENTS } from "@/lib/crew/registry";
import { staffFor } from "@/lib/crew/staff";
import ApprovalCard from "./ApprovalCard";
import { DoorSwitch, HoursForm } from "./Door";
import { ColdEmailRules, Findings, LeadsList } from "./Outputs";
import { ManagerCard, StaffBoard } from "./Staff";
import TeamChat from "./TeamChat";
import { DoorPill, btn, card, usd } from "./ui";

// One team's room: the door, what waits for you, the chat with the manager,
// the manager and the staff board, and whatever the team produces.

export function whoFor(agentId: string) {
  const d = AGENTS.find((a) => a.id === agentId);
  return d ? { ...staffFor(d), team: d.team } : null;
}

export function Waiting({ room, tab }: { room: Room; tab: string }) {
  const n = room.pending.length + room.approved.length;
  return (
    <section id="waiting" className="space-y-3 scroll-mt-20" aria-labelledby={`waiting-${room.team}`}>
      <h2 id={`waiting-${room.team}`} className="text-white font-semibold">
        Waiting for you{n ? ` (${n})` : ""}
      </h2>
      {n === 0 && <p className={`${card} text-gray-400 text-sm`}>Nothing waiting. When someone on the team drafts something, it shows up here.</p>}
      {room.approved.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-gray-300 text-sm">Approved, waiting for you to post</h3>
          {room.approved.map((a) => (
            <ApprovalCard key={a.id} a={a} tab={tab} who={whoFor(a.agent_id)} />
          ))}
        </div>
      )}
      {room.pending.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-gray-300 text-sm">To decide</h3>
          {room.pending.map((a) => (
            <ApprovalCard key={a.id} a={a} tab={tab} who={whoFor(a.agent_id)} />
          ))}
        </div>
      )}
    </section>
  );
}

function RoomHeader({ room, d, tab }: { room: Room; d: Dashboard; tab: string }) {
  const officeLocked = room.door.reason === "office";
  const now = new Date(d.now);
  return (
    <header id="door" className={`${card} space-y-3 scroll-mt-20`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-white text-lg font-bold">{room.name}</h2>
          <p className="text-gray-400 text-sm mt-0.5">{room.job}</p>
        </div>
        <DoorPill open={room.door.open} label={room.door.label} />
      </div>
      {officeLocked && <p className="rounded-lg bg-red-500/10 border border-red-900/40 text-red-200 text-sm px-3 py-2">The whole office is locked, so nobody here starts a shift. Unlock it in the Lobby.</p>}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <DoorSwitch room={room} tab={tab} />
        <HoursForm room={room} tab={tab} />
      </div>
      <p className="text-gray-500 text-xs">
        Spent {usd(room.usdToday)} today · {usd(room.usdWeek)} this week. When the door opens, anyone who missed a shift starts right away.
      </p>
      {room.focus && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-blue-800/50 bg-blue-500/10 px-3 py-2">
          <p className="text-blue-100 text-sm min-w-0 flex-1 break-words">
            <span className="font-medium">Focus:</span> {room.focus.text}
            <span className="text-blue-200/70">
              {" "}
              (set by {room.focus.by ?? "the manager"}
              {room.focus.until ? `, until ${whenLabel(new Date(room.focus.until), now)}` : ""})
            </span>
          </p>
          <form method="post" action={`/api/admin/crew/teams/${room.team}`}>
            <input type="hidden" name="tab" value={tab} />
            <button name="action" value="clear_focus" className={`${btn} text-blue-200 hover:text-white`}>
              Clear
            </button>
          </form>
        </div>
      )}
    </header>
  );
}

/** Jump links inside a room, so the chat and the team are one tap away on a phone. */
function RoomJumps({ room }: { room: Room }) {
  const n = room.pending.length + room.approved.length;
  const links = [
    { href: "#waiting", label: n ? `Waiting for you (${n})` : "Waiting for you" },
    { href: "#chat-end", label: `Chat with ${room.manager?.person.first ?? "the manager"}` },
    { href: "#staff", label: "The team" },
  ];
  return (
    <nav className="flex gap-1.5 overflow-x-auto no-scrollbar lg:hidden" aria-label={`In the ${room.name} room`}>
      {links.map((l) => (
        <a key={l.href} href={l.href} className="shrink-0 inline-flex items-center min-h-10 rounded-full border border-gray-700 px-3.5 text-sm text-gray-200 hover:border-gray-500">
          {l.label}
        </a>
      ))}
    </nav>
  );
}

export default function TeamRoom({ room, d, tab }: { room: Room; d: Dashboard; tab: string }) {
  return (
    <div className="space-y-5">
      <RoomHeader room={room} d={d} tab={tab} />
      <RoomJumps room={room} />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Waiting room={room} tab={tab} />
          <TeamChat room={room} timeline={d.timeline} tab={tab} />
        </div>
        <div id="staff" className="space-y-5 min-w-0 scroll-mt-20">
          <ManagerCard room={room} tab={tab} />
          <StaffBoard room={room} tab={tab} economy={d.settings.economy} />
        </div>
      </div>
      {room.team === "leads" && (
        <div className="space-y-4">
          <ColdEmailRules />
          <LeadsList list="cold" title="Cold email list" today={d.leads.todayBySource} rows={d.leads.recent} />
        </div>
      )}
      {room.team === "office" && <LeadsList list="office" title="Office prospects (to call)" today={d.leads.officeToday} rows={d.leads.office} />}
      {room.team === "watchdog" && <Findings d={d} />}
    </div>
  );
}
