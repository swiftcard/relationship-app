import type { AgentRow } from "@/lib/crew/dashboard";
import { EVERY_CHOICES, canReschedule, plainSchedule } from "@/lib/crew/schedule";
import { btn, card, input } from "./ui";

// When an agent runs, in plain words, and a form to change it. Three choices:
// every so often, every day at a time, or chosen days at a time (New York
// time). A radio picks which one counts, so it works with no JavaScript.

const DAYS = [
  { d: 1, l: "Mon" },
  { d: 2, l: "Tue" },
  { d: 3, l: "Wed" },
  { d: 4, l: "Thu" },
  { d: 5, l: "Fri" },
  { d: 6, l: "Sat" },
  { d: 0, l: "Sun" },
];
const TIMES = Array.from({ length: 96 }, (_, i) => ({ v: `${Math.floor(i / 4)}:${String((i % 4) * 15).padStart(2, "0")}`, h: Math.floor(i / 4), m: (i % 4) * 15 }));

function timeLabel(h: number, m: number) {
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

function everyLabel(min: number) {
  return min < 60 ? `${min} minutes` : min === 60 ? "hour" : `${min / 60} hours`;
}

export default function ScheduleForm({ r, back }: { r: AgentRow; back: string }) {
  const s = r.rule;
  if (!canReschedule(r.def)) {
    return (
      <section className={`${card} space-y-1`} aria-labelledby="schedule-h">
        <h3 id="schedule-h" className="text-white font-semibold">
          When it runs
        </h3>
        <p className="text-gray-200 text-sm">{plainSchedule(s)}</p>
        <p className="text-gray-500 text-xs">{r.def.locked ? "This agent can't run." : "It starts by itself whenever you hand it something, so there is no schedule to change."}</p>
      </section>
    );
  }
  const mode = s.kind === "every" ? "every" : s.kind === "daily" && s.days && s.days.length < 7 ? "days" : "daily";
  const time = s.kind === "daily" ? `${s.hour}:${String(s.minute ?? 0).padStart(2, "0")}` : "9:00";
  const days = s.kind === "daily" && s.days ? s.days : [1, 2, 3, 4, 5];
  const radio = "h-4 w-4 shrink-0";
  return (
    <section className={`${card} space-y-3`} aria-labelledby="schedule-h">
      <div>
        <h3 id="schedule-h" className="text-white font-semibold">
          When it runs
        </h3>
        <p className="text-gray-200 text-sm mt-0.5">
          {plainSchedule(s)}
          {r.customSchedule ? <span className="text-gray-500"> (you changed this; normally {plainSchedule(r.def.schedule).toLowerCase()})</span> : null}
        </p>
        <p className="text-gray-500 text-xs mt-1">Times are New York time. Agents start within 15 minutes of the time you pick.</p>
      </div>
      <details>
        <summary className={`${btn} list-none [&::-webkit-details-marker]:hidden cursor-pointer bg-gray-800 text-white hover:bg-gray-700`}>Change schedule</summary>
        <form method="post" action={`/api/admin/crew/agents/${r.def.id}`} className="mt-3 space-y-3">
          <input type="hidden" name="tab" value={back} />
          <label className="flex flex-wrap items-center gap-2 text-sm text-gray-200">
            <input type="radio" name="mode" value="every" defaultChecked={mode === "every"} className={radio} />
            <span>Every</span>
            <select name="every" defaultValue={String(s.kind === "every" ? s.minutes : 60)} className={`${input} w-auto`} aria-label="How often">
              {EVERY_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {everyLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm text-gray-200">
            <input type="radio" name="mode" value="daily" defaultChecked={mode === "daily"} className={radio} />
            <span>Every day</span>
          </label>
          <div className="space-y-2">
            <label className="flex flex-wrap items-center gap-2 text-sm text-gray-200">
              <input type="radio" name="mode" value="days" defaultChecked={mode === "days"} className={radio} />
              <span>Only on these days</span>
            </label>
            <div className="flex flex-wrap gap-1.5 pl-6">
              {DAYS.map((x) => (
                <label key={x.d} className="inline-flex items-center gap-1.5 min-h-10 px-2.5 rounded-lg border border-gray-800 bg-gray-950 text-sm text-gray-200 has-[:checked]:border-emerald-700 has-[:checked]:bg-emerald-500/10">
                  <input type="checkbox" name={`day_${x.d}`} defaultChecked={days.includes(x.d)} className="h-4 w-4" />
                  {x.l}
                </label>
              ))}
            </div>
          </div>
          <label className="flex flex-wrap items-center gap-2 text-sm text-gray-300 pl-6">
            <span>At</span>
            <select name="time" defaultValue={time} className={`${input} w-auto`} aria-label="Time of day">
              {TIMES.map((t) => (
                <option key={t.v} value={t.v}>
                  {timeLabel(t.h, t.m)}
                </option>
              ))}
            </select>
            <span className="text-gray-500 text-xs">(for &quot;every day&quot; and &quot;only on these days&quot;)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button name="action" value="schedule" className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}>
              Save schedule
            </button>
            {r.customSchedule && (
              <button name="action" value="reset_schedule" className={`${btn} text-gray-300 hover:text-white`}>
                Back to normal
              </button>
            )}
          </div>
        </form>
      </details>
    </section>
  );
}
