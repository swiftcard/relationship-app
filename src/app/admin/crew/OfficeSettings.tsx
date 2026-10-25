import { GROUP_NAME, plainNeeds } from "@/lib/crew/agent-status";
import type { Dashboard } from "@/lib/crew/dashboard";
import { Chevron, Technical, card, btn, input, summaryBtn, usd } from "./ui";

// Settings: the money limits (all agents, each group, each agent), how the
// agents work, and which connections are still missing.

export function EnvList({ envNeeded }: { envNeeded: Dashboard["envNeeded"] }) {
  if (!envNeeded.length) return null;
  const byNeed = new Map<string, string[]>();
  for (const e of envNeeded) byNeed.set(plainNeeds([e.key]), [...new Set([...(byNeed.get(plainNeeds([e.key])) ?? []), ...e.agents])]);
  return (
    <div className="space-y-2">
      <p className="text-white font-semibold text-sm">Still to connect</p>
      <p className="text-gray-400 text-sm">Some agents can&apos;t run until these are set up. Whoever set up SwiftCard can add them; the technical names are below.</p>
      <ul className="space-y-1.5">
        {[...byNeed.entries()].map(([need, agents]) => (
          <li key={need} className="text-sm">
            <span className="text-amber-200">{need.charAt(0).toUpperCase() + need.slice(1)}</span>{" "}
            <span className="text-gray-500">
              for {agents.slice(0, 4).join(", ")}
              {agents.length > 4 ? ` and ${agents.length - 4} more` : ""}
            </span>
          </li>
        ))}
      </ul>
      <Technical>
        {envNeeded.map((e) => (
          <p key={e.key}>
            {e.key}: {e.help}
          </p>
        ))}
        <p>Add them in Vercel → Settings → Environment Variables.</p>
      </Technical>
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
          <div>
            <h2 id="money-h" className="text-white font-semibold">
              Money limits
            </h2>
            <p className="text-gray-400 text-sm mt-1">
              An agent stops for the day when it hits its own limit, its group&apos;s limit, or the limit for all agents, whichever comes first. The limit for all agents always wins.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
            {[
              { k: "Spent today", v: usd(d.today.total.usd) },
              { k: "Last 7 days", v: usd(d.week.total.usd) },
            ].map((c) => (
              <div key={c.k} className="rounded-xl bg-gray-900/60 border border-gray-800 px-3 py-2">
                <p className="text-gray-500 text-xs">{c.k}</p>
                <p className="text-white font-bold mt-0.5">{c.v}</p>
              </div>
            ))}
          </div>
          <label className="block text-sm text-gray-300 space-y-1">
            <span>Daily limit for all agents ($)</span>
            <input name="daily_usd_cap" inputMode="decimal" defaultValue={d.settings.daily_usd_cap} className={`${input} w-32`} />
          </label>
          <div className="space-y-2">
            <p className="text-sm text-gray-300">Each group ($ a day, blank = no group limit)</p>
            {d.rooms.map((r) => {
              const people = [...(r.manager ? [r.manager] : []), ...r.staff, ...r.notHired];
              const names = new Map(d.agents.map((a) => [a.def.id, a.name]));
              return (
                <div key={r.team} className="rounded-xl border border-gray-800 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <label className="flex items-center gap-2 text-sm text-white min-w-0 flex-1" htmlFor={`team-cap-${r.team}`}>
                      {GROUP_NAME[r.team]}
                    </label>
                    <span className="text-gray-500 text-xs">
                      {usd(r.usdToday)} today · {usd(r.usdWeek)} week
                    </span>
                    <input id={`team-cap-${r.team}`} name={`team_cap_${r.team}`} inputMode="decimal" defaultValue={d.settings.team_caps[r.team]?.usd ?? ""} placeholder="none" className={`${input} w-24`} />
                  </div>
                  <details>
                    <summary className={`${summaryBtn} -ml-3 text-xs`}>
                      Each agent in {GROUP_NAME[r.team]} <Chevron />
                    </summary>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {people.map((p) => (
                        <label key={p.def.id} className="flex items-center gap-2 text-xs text-gray-400">
                          <span className="min-w-0 flex-1 truncate">
                            <span className="text-gray-200">{names.get(p.def.id) ?? p.def.name}</span>
                            <span className="block text-gray-600">{usd(p.today.usd)} today</span>
                          </span>
                          <input name={`agent_cap_${p.def.id}`} inputMode="decimal" defaultValue={p.state.daily_usd_cap ?? ""} placeholder={usd(p.def.dailyUsd)} aria-label={`Daily limit for ${names.get(p.def.id) ?? p.def.name} in dollars`} className={`${input} w-24`} />
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
              <span className="text-white">Save money</span> (recommended while you&apos;re starting out). The cheapest AI sorts posts and writes short comments, and the website checks and daily reports use no AI at all.
              Replies, messages and blog posts still get the better AI.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-300">
            <input type="checkbox" name="second_opinion" defaultChecked={d.settings.second_opinion} className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              <span className="text-white">Second reviewer</span>. A second AI checks each draft before it reaches you. It roughly doubles the cost of a draft; leave it off while you approve everything yourself.
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" name="disclosure_on" defaultChecked={d.settings.disclosure_on} className="h-4 w-4" />
            Add an &quot;I work on SwiftCard&quot; line to anything that mentions SwiftCard (recommended; most sites require it)
          </label>
          <label className="block text-sm text-gray-300 space-y-1">
            <span>That line</span>
            <input name="disclosure" defaultValue={d.settings.disclosure} className={input} maxLength={200} />
          </label>
          <p className="flex items-center gap-1.5 text-emerald-300/90 text-sm">Asking you before anything goes out is always on. It can&apos;t be turned off.</p>
        </section>
        <button className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}>Save settings</button>
      </form>
      <section className={`${card} space-y-3`} aria-label="Connections">
        <EnvList envNeeded={d.envNeeded} />
        {!d.envNeeded.length && <p className="text-gray-400 text-sm">Everything the agents use is connected.</p>}
        <Technical>
          <p>AI use today: {d.today.total.tokens.toLocaleString("en-US")} tokens, {cachePct}% from cache.</p>
        </Technical>
      </section>
    </div>
  );
}
