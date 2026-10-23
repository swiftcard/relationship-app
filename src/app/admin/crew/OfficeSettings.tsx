import type { Dashboard } from "@/lib/crew/dashboard";
import { Chevron, card, btn, input, summaryBtn, usd } from "./ui";

// Settings: every money limit in one form (the office, each team, each
// person), how the agents work, and which keys are still missing.

export function EnvList({ envNeeded }: { envNeeded: Dashboard["envNeeded"] }) {
  if (!envNeeded.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-gray-400 text-sm">Keys still missing (add them in Vercel → Settings → Environment Variables):</p>
      <ul className="space-y-1.5">
        {envNeeded.map((e) => (
          <li key={e.key} className="text-sm">
            <code className="text-amber-200 break-all">{e.key}</code> <span className="text-gray-400">{e.help}</span>{" "}
            <span className="text-gray-600">
              Used by {e.agents.slice(0, 4).join(", ")}
              {e.agents.length > 4 ? ` and ${e.agents.length - 4} more` : ""}.
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function OfficeSettings({ d }: { d: Dashboard }) {
  const cachePct = d.today.total.input ? Math.round((d.today.total.cacheRead / d.today.total.input) * 100) : 0;
  return (
    <div className="space-y-5">
      <form method="post" action="/api/admin/crew/settings" className="space-y-5">
        <input type="hidden" name="action" value="save" />
        <section id="money" className={`${card} space-y-4 scroll-mt-20`} aria-labelledby="money-h">
          <h2 id="money-h" className="text-white font-semibold">
            Money
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { k: "Today", v: usd(d.today.total.usd) },
              { k: "Last 7 days", v: usd(d.week.total.usd) },
              { k: "Tokens today", v: d.today.total.tokens.toLocaleString("en-US") },
              { k: "From cache", v: `${cachePct}%` },
            ].map((c) => (
              <div key={c.k} className="rounded-xl bg-gray-900/60 border border-gray-800 px-3 py-2">
                <p className="text-gray-500 text-xs">{c.k}</p>
                <p className="text-white font-bold mt-0.5">{c.v}</p>
              </div>
            ))}
          </div>
          <label className="block text-sm text-gray-300 space-y-1">
            <span>Daily limit for the whole office ($)</span>
            <input name="daily_usd_cap" inputMode="decimal" defaultValue={d.settings.daily_usd_cap} className={`${input} w-32`} />
          </label>
          <div className="space-y-2">
            <p className="text-sm text-gray-300">Each team ($ a day, blank = no team limit)</p>
            {d.rooms.map((r) => {
              const people = [...(r.manager ? [r.manager] : []), ...r.staff, ...r.notHired];
              return (
                <div key={r.team} className="rounded-xl border border-gray-800 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <label className="flex items-center gap-2 text-sm text-white min-w-0 flex-1" htmlFor={`team-cap-${r.team}`}>
                      {r.name}
                    </label>
                    <span className="text-gray-500 text-xs">
                      {usd(r.usdToday)} today · {usd(r.usdWeek)} week
                    </span>
                    <input id={`team-cap-${r.team}`} name={`team_cap_${r.team}`} inputMode="decimal" defaultValue={d.settings.team_caps[r.team]?.usd ?? ""} placeholder="none" className={`${input} w-24`} />
                  </div>
                  <details>
                    <summary className={`${summaryBtn} -ml-3 text-xs`}>
                      Each person on {r.name} <Chevron />
                    </summary>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {people.map((p) => (
                        <label key={p.def.id} className="flex items-center gap-2 text-xs text-gray-400">
                          <span className="min-w-0 flex-1 truncate">
                            <span className="text-gray-200">{p.person.first}</span> · {p.person.title}
                            <span className="block text-gray-600">{usd(p.today.usd)} today</span>
                          </span>
                          <input name={`agent_cap_${p.def.id}`} inputMode="decimal" defaultValue={p.state.daily_usd_cap ?? ""} placeholder={usd(p.def.dailyUsd)} aria-label={`Daily limit for ${p.person.first} in dollars`} className={`${input} w-24`} />
                        </label>
                      ))}
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        </section>
        <section className={`${card} space-y-4`} aria-labelledby="how-h">
          <h2 id="how-h" className="text-white font-semibold">
            How they work
          </h2>
          <label className="flex items-start gap-2 text-sm text-gray-300">
            <input type="checkbox" name="economy" defaultChecked={d.settings.economy} className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              <span className="text-white">Economy mode</span> (recommended while you&apos;re starting out). The cheapest model (Haiku) sorts posts and writes short comments, the Watchdog and the morning reports use no
              AI at all, managers answer the chat on Sonnet, and Sonnet still writes DMs, replies and blog posts.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-300">
            <input type="checkbox" name="second_opinion" defaultChecked={d.settings.second_opinion} className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              <span className="text-white">Second opinion</span>. ChatGPT checks each draft before it reaches you. Roughly doubles the cost of a draft; leave it off while you approve everything yourself.
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" name="disclosure_on" defaultChecked={d.settings.disclosure_on} className="h-4 w-4" />
            Add a disclosure line to anything that mentions SwiftCard (recommended; the FTC and most platforms require it)
          </label>
          <label className="block text-sm text-gray-300 space-y-1">
            <span>Disclosure line</span>
            <input name="disclosure" defaultValue={d.settings.disclosure} className={input} maxLength={200} />
          </label>
        </section>
        <button className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}>Save settings</button>
      </form>
      <section className={card} aria-label="Keys">
        <EnvList envNeeded={d.envNeeded} />
        {!d.envNeeded.length && <p className="text-gray-400 text-sm">Every key the agents use is set.</p>}
      </section>
    </div>
  );
}
