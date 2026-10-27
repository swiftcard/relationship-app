import type { SheetAgentRow } from "@/lib/crew/sheet-agents";
import { Status, btn, card } from "./ui";

// The Start / Stop list: one row per agent whose work lands in the SwiftCard
// Leads sheet, named after its tab. Start = on and working right away (then
// on its own until today's limit, every day); Stop = off at its next step.
// Plain <form method="post"> buttons, so they work before hydration.

export default function SheetAgents({ rows, sheetUrl, back = "lobby" }: { rows: SheetAgentRow[]; sheetUrl: string | null; back?: string }) {
  const on = rows.filter((r) => r.running).length;
  return (
    <section id="sheet-agents" className="space-y-3 scroll-mt-20" aria-labelledby="sheet-agents-h">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-gray-800 pb-1">
        <h2 id="sheet-agents-h" className="text-white text-lg font-bold">
          Marketing agents
        </h2>
        <span className="text-gray-400 text-sm">{on ? `${on} running` : "All stopped"}</span>
      </div>
      <p className="text-gray-400 text-sm">
        Press Start and the agent keeps adding rows to its own tab in the{" "}
        {sheetUrl ? (
          <a href={sheetUrl} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline">
            SwiftCard Leads sheet
          </a>
        ) : (
          "SwiftCard Leads sheet"
        )}
        : a person, a message written for them, and the exact link to send it. It stops when you press Stop.
      </p>
      <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {rows.map((r) => (
          <li key={r.id} id={`s-${r.id}`} className={`${card} flex flex-col gap-2 scroll-mt-20`} data-sheet-agent={r.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-white font-semibold break-words">{r.name}</p>
                <p className="text-gray-500 text-xs mt-0.5">{r.pace}</p>
              </div>
              <Status status={r} />
            </div>
            <p className="text-gray-300 text-sm break-words">{r.purpose}</p>
            <p className="text-gray-400 text-xs">
              {r.line} {r.addedToday ? <span className="text-gray-200">{r.addedToday} added today.</span> : null}
            </p>
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
              <form method="post" action={`/api/admin/crew/agents/${r.id}`}>
                <input type="hidden" name="tab" value={back} />
                {r.running ? (
                  <button name="action" value="stop" className={`${btn} min-w-24 bg-gray-800 text-white hover:bg-gray-700`} aria-label={`Stop ${r.name}`}>
                    Stop
                  </button>
                ) : (
                  <button name="action" value="start" disabled={!r.canStart} className={`${btn} min-w-24 bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500`} aria-label={`Start ${r.name}`}>
                    Start
                  </button>
                )}
              </form>
              {r.tabUrl && (
                <a href={r.tabUrl} target="_blank" rel="noopener noreferrer" className={`${btn} text-blue-300 hover:text-white`}>
                  Open its tab
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
