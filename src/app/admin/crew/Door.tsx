import { describeHours, minutesLabel } from "@/lib/crew/doors";
import type { Room } from "@/lib/crew/dashboard";
import { DoorIcon, LockIcon, btn, input, summaryBtn } from "./ui";

// The door switch and the opening-hours form for one room. Plain posts, so a
// tap works before the page has loaded its JavaScript.

export function DoorSwitch({ room, tab, compact = false }: { room: Room; tab: string; compact?: boolean }) {
  // The team's own door: while the whole office is locked it keeps its state.
  const teamOpen = room.ownDoor.open;
  return (
    <form method="post" action={`/api/admin/crew/teams/${room.team}`}>
      <input type="hidden" name="tab" value={tab} />
      <input type="hidden" name="action" value="toggle" />
      <button
        className={`${btn} ${compact ? "" : "w-full sm:w-auto"} ${teamOpen ? "bg-gray-800 text-white hover:bg-gray-700" : "bg-emerald-600 text-white hover:bg-emerald-500"}`}
        aria-label={`${teamOpen ? "Lock" : "Open"} the ${room.name} door`}
      >
        {teamOpen ? <LockIcon /> : <DoorIcon />}
        {teamOpen ? "Lock the door" : "Open the door"}
      </button>
    </form>
  );
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

export function HoursForm({ room, tab }: { room: Room; tab: string }) {
  const h = room.row?.hours ?? null;
  const days = h?.days ?? [1, 2, 3, 4, 5];
  return (
    <details className="group">
      <summary className={summaryBtn}>
        <span className="text-gray-500">Opening hours:</span> <span className="text-gray-200">{h ? `${describeHours(h)} (New York)` : "none, you open and lock by hand"}</span>
      </summary>
      <form method="post" action={`/api/admin/crew/teams/${room.team}`} className="mt-2 space-y-3 rounded-xl border border-gray-800 bg-gray-900/40 p-3">
        <input type="hidden" name="tab" value={tab} />
        <p className="text-gray-400 text-xs">The door opens and locks by itself at these times. Tapping the door still works; it lasts until the next change.</p>
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
            <span>Opens</span>
            <select name="open" defaultValue={String(h?.open ?? 540)} className={input}>
              {TIMES.slice(0, 48).map((m) => (
                <option key={m} value={m}>
                  {minutesLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-300 space-y-1">
            <span>Locks</span>
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
    </details>
  );
}
