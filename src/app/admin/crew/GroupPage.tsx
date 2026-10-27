import type { Dashboard, Room } from "@/lib/crew/dashboard";
import { describeHours, minutesLabel, whenLabel } from "@/lib/crew/doors";
import { tabForTeam } from "@/lib/crew/office-tabs";
import AgentCard from "./AgentCard";
import ApprovalCard from "./ApprovalCard";
import { Findings } from "./Outputs";
import TeamChat from "./TeamChat";
import { Chevron, Status, btn, card, input, summaryBtn, usd } from "./ui";

// One group's page (since 2026-10-26 only the Watchdog has one): pause or
// resume the whole group, what waits for you, its agents, the problems it
// found, and the chat with its manager. The marketing agents have no group
// page: they are started and stopped one by one on Home, and work into the
// Google Sheet.

/** "Pause group" / "Resume group": the team's door, one tap. Hidden for Planning, which has none. */
export function GroupSwitch({ room, back }: { room: Room; back: string }) {
  if (!room.row) return null;
  const running = room.ownDoor.open;
  return (
    <form method="post" action={`/api/admin/crew/teams/${room.team}`}>
      <input type="hidden" name="tab" value={back} />
      <input type="hidden" name="action" value="toggle" />
      <button className={`${btn} ${running ? "bg-gray-800 text-white hover:bg-gray-700" : "bg-emerald-600 text-white hover:bg-emerald-500"}`} aria-label={`${running ? "Pause" : "Resume"} ${room.name}`}>
        {running ? "Pause group" : "Resume group"}
      </button>
    </form>
  );
}

/** The group's state in words: running, paused by you, paused by its hours, paused with all agents. */
export function groupStatus(room: Room) {
  if (room.door.reason === "office" && !room.door.open) return { word: "Paused", tone: "amber" as const, line: "All agents are paused." };
  const anyOn = [...room.staff, ...room.notHired, ...(room.manager ? [room.manager] : [])].some((a) => a.state.enabled);
  if (room.door.open && !anyOn) return { word: "All off", tone: "gray" as const, line: "Every agent in this group is turned off." };
  if (room.door.open) return { word: "Running", tone: "green" as const, line: room.door.reason === "manual" || room.door.reason === "desk" ? "" : room.door.label.replace(/^Open/, "Running") };
  return { word: "Paused", tone: "amber" as const, line: room.door.reason === "manual" ? "You paused this group." : room.door.label.replace(/^Locked/, "Paused") };
}

const DAYS = [
  { d: 1, l: "Mon" },
  { d: 2, l: "Tue" },
  { d: 3, l: "Wed" },
  { d: 4, l: "Thu" },
  { d: 5, l: "Fri" },
  { d: 6, l: "Sat" },
  { d: 0, l: "Sun" },
];
const TIMES = Array.from({ length: 49 }, (_, i) => i * 30);

/** Working hours: the group runs only inside them (New York time). Folded under "More options". */
export function HoursForm({ room, tab }: { room: Room; tab: string }) {
  const h = room.row?.hours ?? null;
  const days = h?.days ?? [1, 2, 3, 4, 5];
  return (
    <form method="post" action={`/api/admin/crew/teams/${room.team}`} className="space-y-3">
      <input type="hidden" name="tab" value={tab} />
      <p className="text-gray-300 text-sm">
        Working hours: <span className="text-white">{h ? `${describeHours(h)} (New York time)` : "none, the group runs whenever it's not paused"}</span>
      </p>
      <p className="text-gray-500 text-xs">Outside these hours the group pauses by itself. Tapping Pause or Resume still works until the next change.</p>
      <fieldset>
        <legend className="text-sm text-gray-300 mb-1.5">Days</legend>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((x) => (
            <label key={x.d} className="inline-flex items-center gap-1.5 min-h-10 px-2.5 rounded-lg border border-gray-800 bg-gray-950 text-sm text-gray-200 has-[:checked]:border-emerald-700 has-[:checked]:bg-emerald-500/10">
              <input type="checkbox" name={`day_${x.d}`} defaultChecked={days.includes(x.d)} className="h-4 w-4" />
              {x.l}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
        <label className="text-sm text-gray-300 space-y-1">
          <span>Starts</span>
          <select name="open" defaultValue={String(h?.open ?? 540)} className={input}>
            {TIMES.slice(0, 48).map((m) => (
              <option key={m} value={m}>
                {minutesLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-300 space-y-1">
          <span>Stops</span>
          <select name="close" defaultValue={String(h?.close ?? 1080)} className={input}>
            {TIMES.slice(1).map((m) => (
              <option key={m} value={m}>
                {m === 1440 ? "midnight" : minutesLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button name="action" value="hours" className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}>
          Save hours
        </button>
        {h && (
          <button name="action" value="clear_hours" className={`${btn} text-gray-300 hover:text-white`}>
            Turn off hours
          </button>
        )}
      </div>
    </form>
  );
}

export function Waiting({ room, tab, here, edit }: { room: Room; tab: string; here: string; edit?: string }) {
  const n = room.pending.length + room.approved.length;
  return (
    <section id="waiting" className="space-y-3 scroll-mt-20" aria-labelledby={`waiting-${room.team}`}>
      <h3 id={`waiting-${room.team}`} className="text-white font-semibold">
        Waiting for you{n ? ` (${n})` : ""}
      </h3>
      {n === 0 && <p className={`${card} text-gray-400 text-sm`}>Nothing waiting. When an agent here drafts something, it shows up here first.</p>}
      {[...room.pending, ...room.approved].map((a) => (
        <ApprovalCard key={a.id} a={a} tab={tab} here={here} editing={edit === a.id} />
      ))}
    </section>
  );
}

export default function GroupPage({ room, d, edit }: { room: Room; d: Dashboard; edit?: string }) {
  const now = new Date(d.now);
  const tab = tabForTeam(room.team);
  const here = `/admin/crew?tab=${tab}`;
  const st = groupStatus(room);
  const agents = [...room.staff, ...(room.manager ? [room.manager] : [])];
  const unavailable = room.notHired.filter((a) => a.def.locked);
  const extras = room.notHired.filter((a) => !a.def.locked);
  return (
    <div className="space-y-5">
      <header id="door" className={`${card} space-y-3 scroll-mt-20`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-white text-lg font-bold">{room.name}</h2>
            <p className="text-gray-400 text-sm mt-0.5">{room.job}</p>
          </div>
          {room.row && <Status status={st} />}
        </div>
        {st.line && <p className="text-gray-300 text-sm">{st.line}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <GroupSwitch room={room} back={tab} />
          <span className="text-gray-500 text-xs">
            Spent {usd(room.usdToday)} today · {usd(room.usdWeek)} this week
          </span>
        </div>
        {room.focus && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-blue-800/50 bg-blue-500/10 px-3 py-2">
            <p className="text-blue-100 text-sm min-w-0 flex-1 break-words">
              <span className="font-medium">Focus:</span> {room.focus.text}
              <span className="text-blue-200/70">{room.focus.until ? ` (until ${whenLabel(new Date(room.focus.until), now)})` : ""}</span>
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

      <Waiting room={room} tab={tab} here={here} edit={edit} />


      <section className="space-y-3" aria-labelledby={`agents-${room.team}`}>
        <h3 id={`agents-${room.team}`} className="text-white font-semibold">
          Agents in this group
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {agents.map((r) => (
            <AgentCard key={r.def.id} r={r} back={tab} now={now} />
          ))}
        </div>
        {extras.length > 0 && (
          <details className="rounded-2xl border border-dashed border-gray-800 px-3 py-1" data-not-hired>
            <summary className={`${summaryBtn} -mx-3 w-[calc(100%+1.5rem)]`}>
              More agents you can turn on ({extras.length}) <Chevron />
            </summary>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-3">
              {extras.map((r) => (
                <AgentCard key={r.def.id} r={r} back={tab} now={now} />
              ))}
            </div>
          </details>
        )}
        {unavailable.length > 0 && (
          <details className="rounded-2xl border border-dashed border-gray-800 px-3 py-1" data-unavailable>
            <summary className={`${summaryBtn} -mx-3 w-[calc(100%+1.5rem)]`}>
              Not available ({unavailable.length}) <Chevron />
            </summary>
            <ul className="space-y-2 pb-3">
              {unavailable.map((r) => (
                <li key={r.def.id} className="text-sm">
                  <span className="text-gray-300">{r.name}</span> <span className="text-gray-500">· {r.status.line}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {room.team === "watchdog" && <Findings d={d} />}

      {room.row && <TeamChat room={room} timeline={d.timeline} tab={tab} />}

      {room.row && (
        <details className={`${card} p-0`}>
          <summary className={`${summaryBtn} w-full px-4`}>
            More options: working hours <Chevron />
          </summary>
          <div className="px-4 pb-4">
            <HoursForm room={room} tab={tab} />
          </div>
        </details>
      )}
    </div>
  );
}
