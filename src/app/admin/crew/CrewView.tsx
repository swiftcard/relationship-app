import Link from "next/link";
import type { AgentRow, Dashboard } from "@/lib/crew/dashboard";
import { TEAM_NAME } from "@/lib/crew/agents/manager";
import { TIER_LABEL } from "@/lib/crew/models";
import { TEAMS } from "@/lib/crew/registry";
import type { Approval, TeamId } from "@/lib/crew/types";
import CopyOpen from "./CopyOpen";

// ── The Agents tab's view (server component, no data loading) ──────────────
// page.tsx loads the data; this renders it. Split so tests/render can measure
// the real markup with fixture data. Every button is a <form method="post">
// to /api/admin/crew/*, so it works before hydration and with no JavaScript.

const TABS = [
  { id: "inbox", label: "Inbox" },
  { id: "teams", label: "Teams" },
  { id: "usage", label: "Usage" },
  { id: "reports", label: "Reports" },
  { id: "paste", label: "Paste a post" },
  { id: "settings", label: "Settings" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const card = "rounded-2xl border border-gray-800 bg-gray-950/50 p-4";
const btn = "inline-flex items-center justify-center min-h-10 px-3 rounded-lg text-sm font-medium";
const input = "w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-white";

export type CrewViewProps = { data: Dashboard | { ready: false; envNeeded: Dashboard["envNeeded"] }; tab: string | undefined; msg?: string };

export default function CrewView({ data, tab: tabParam, msg }: CrewViewProps) {
  const tab: TabId = (TABS.find((t) => t.id === tabParam)?.id ?? "inbox") as TabId;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Agents</h1>
        <p className="text-gray-500 text-sm mt-1">Your AI teams. They draft, you approve. Nothing goes out without your tap.</p>
      </div>

      {msg && <div className="rounded-xl border border-blue-800/50 bg-blue-500/10 text-blue-200 text-sm px-4 py-3" role="status">{msg}</div>}

      {!data.ready ? (
        <SetupPanel envNeeded={data.envNeeded} />
      ) : (
        <>
          <StatusBar d={data} />
          <nav className="flex gap-1 overflow-x-auto no-scrollbar border-b border-gray-800" aria-label="Agents sections">
            {TABS.map((t) => (
              <Link
                key={t.id}
                href={`/admin/crew?tab=${t.id}`}
                className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${t.id === tab ? "border-blue-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}
              >
                {t.label}
                {t.id === "inbox" && data.inbox.length + data.approved.length > 0 ? ` (${data.inbox.length + data.approved.length})` : ""}
              </Link>
            ))}
          </nav>
          {tab === "inbox" && <Inbox d={data} />}
          {tab === "teams" && <Teams d={data} />}
          {tab === "usage" && <Usage d={data} />}
          {tab === "reports" && <Reports d={data} />}
          {tab === "paste" && <Paste />}
          {tab === "settings" && <SettingsForm d={data} />}
        </>
      )}
    </div>
  );
}

function SetupPanel({ envNeeded }: { envNeeded: { key: string; help: string; agents: string[] }[] }) {
  return (
    <div className={`${card} space-y-3`}>
      <p className="text-white font-semibold">One step first</p>
      <p className="text-gray-300 text-sm">
        Run <code className="text-blue-300">supabase/crew.sql</code> in the Supabase SQL editor. It only adds new tables. Then come back here.
      </p>
      <EnvList envNeeded={envNeeded} />
    </div>
  );
}

function EnvList({ envNeeded }: { envNeeded: { key: string; help: string; agents: string[] }[] }) {
  if (!envNeeded.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-gray-400 text-sm">Keys still missing (add them in Vercel → Settings → Environment Variables):</p>
      <ul className="space-y-1.5">
        {envNeeded.map((e) => (
          <li key={e.key} className="text-sm">
            <code className="text-amber-200 break-all">{e.key}</code> <span className="text-gray-400">{e.help}</span>{" "}
            <span className="text-gray-600">Used by {e.agents.slice(0, 4).join(", ")}{e.agents.length > 4 ? ` and ${e.agents.length - 4} more` : ""}.</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBar({ d }: { d: Dashboard }) {
  const stopped = d.settings.kill_all || d.hardDisabled;
  const on = d.agents.filter((a) => a.state.enabled).length;
  const pct = Math.min(100, Math.round((d.today.total.usd / Math.max(0.01, d.settings.daily_usd_cap)) * 100));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className={card}>
        <p className="text-gray-500 text-xs">Status</p>
        <p className={`text-lg font-bold mt-1 ${stopped ? "text-red-300" : "text-emerald-300"}`}>{stopped ? "Stopped" : `${on} agent${on === 1 ? "" : "s"} on`}</p>
        {d.hardDisabled && <p className="text-gray-500 text-xs mt-1">CREW_DISABLED is set in Vercel.</p>}
        <form method="post" action="/api/admin/crew/settings" className="mt-2">
          <input type="hidden" name="tab" value="inbox" />
          <input type="hidden" name="action" value={d.settings.kill_all ? "unkill" : "kill"} />
          <button className={`${btn} ${d.settings.kill_all ? "bg-gray-800 text-white" : "bg-red-600 text-white hover:bg-red-500"}`}>{d.settings.kill_all ? "Let agents run again" : "Stop every agent"}</button>
        </form>
      </div>
      <div className={card}>
        <p className="text-gray-500 text-xs">Spent today</p>
        <p className="text-white text-lg font-bold mt-1">
          ${d.today.total.usd.toFixed(2)} <span className="text-gray-500 text-sm font-normal">of ${d.settings.daily_usd_cap.toFixed(2)}</span>
        </p>
        <div className="h-2 rounded-full bg-gray-800 mt-2 overflow-hidden" aria-hidden>
          <div className={`h-full ${pct >= 90 ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className={card}>
        <p className="text-gray-500 text-xs">Waiting for you</p>
        <p className="text-white text-lg font-bold mt-1">{d.inbox.length} to decide</p>
        <p className="text-gray-500 text-xs mt-1">{d.approved.length} approved, waiting to be posted</p>
      </div>
    </div>
  );
}

function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "blue" | "amber" | "green" | "red" }) {
  const t = {
    gray: "bg-gray-800 text-gray-300 border-gray-700",
    blue: "bg-blue-500/10 text-blue-300 border-blue-800/40",
    amber: "bg-amber-500/10 text-amber-200 border-amber-800/40",
    green: "bg-emerald-500/10 text-emerald-300 border-emerald-800/40",
    red: "bg-red-500/10 text-red-300 border-red-900/40",
  }[tone];
  return <span className={`inline-block text-[0.6875rem] px-2 py-0.5 rounded-full border ${t}`}>{children}</span>;
}

const KIND_LABEL: Record<string, string> = {
  reply: "Reply",
  comment: "Comment",
  dm: "DM",
  connect_note: "Connect note",
  post: "Social post",
  blog_post: "Blog post",
  code_fix: "Fix",
  email_list_export: "Lead list",
  spend: "Spend",
  ask: "Question",
};

function agentName(d: Dashboard, id: string) {
  return d.agents.find((a) => a.def.id === id)?.def.name ?? id;
}

function Inbox({ d }: { d: Dashboard }) {
  if (!d.inbox.length && !d.approved.length) {
    return (
      <div className={card}>
        <p className="text-white font-semibold">Nothing to decide</p>
        <p className="text-gray-400 text-sm mt-1">When an agent drafts something, it shows up here. Switch agents on in the Teams tab.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {d.approved.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-white font-semibold text-sm">Approved, waiting for you to post</h2>
          {d.approved.map((a) => (
            <ApprovalCard key={a.id} a={a} d={d} />
          ))}
        </section>
      )}
      {d.inbox.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-white font-semibold text-sm">To decide</h2>
          {d.inbox.map((a) => (
            <ApprovalCard key={a.id} a={a} d={d} />
          ))}
        </section>
      )}
    </div>
  );
}

function ApprovalCard({ a, d }: { a: Approval; d: Dashboard }) {
  const action = `/api/admin/crew/approvals/${a.id}`;
  const editable = a.status === "pending" && a.kind !== "code_fix" && a.kind !== "ask";
  const tierWhy = typeof a.meta?.tier_why === "string" ? a.meta.tier_why : null;
  const prUrl = typeof (a.meta?.result as { pr_url?: string } | undefined)?.pr_url === "string" ? (a.meta.result as { pr_url: string }).pr_url : null;
  return (
    <article className={`${card} space-y-3`} data-approval={a.id}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="blue">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
        {a.platform && <Badge>{a.platform}</Badge>}
        <Badge>{agentName(d, a.agent_id)}</Badge>
        {a.status === "approved" && <Badge tone="green">Approved</Badge>}
      </div>
      <div>
        <p className="text-white font-semibold text-[0.9375rem] break-words">{a.title}</p>
        <p className="text-gray-300 text-sm mt-1 whitespace-pre-line break-words">{a.summary}</p>
        {a.target_url && (
          <a href={a.target_url} target="_blank" rel="noopener noreferrer" className="text-blue-300 text-xs break-all hover:underline">
            {a.target_url}
          </a>
        )}
      </div>
      {a.debate && <p className="text-gray-400 text-xs">{a.debate.line}</p>}
      {tierWhy && <p className="text-amber-200/80 text-xs">{tierWhy}</p>}
      {prUrl && (
        <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-blue-300 text-sm hover:underline">
          Open the fix on GitHub
        </a>
      )}

      {a.status === "pending" ? (
        <>
          <form method="post" action={action} className="space-y-2">
            <input type="hidden" name="tab" value="inbox" />
            {editable ? (
              <textarea name="body" defaultValue={a.body} rows={Math.min(14, Math.max(4, Math.ceil(a.body.length / 70)))} className={input} aria-label="Draft" />
            ) : (
              a.body && <pre className="text-gray-300 text-xs whitespace-pre-wrap break-words bg-gray-900 rounded-lg p-3 max-h-72 overflow-auto">{a.body}</pre>
            )}
            <button name="action" value="approve" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500 w-full sm:w-auto`}>
              Approve
            </button>
          </form>
          <form method="post" action={action} className="flex flex-col sm:flex-row gap-2">
            <input type="hidden" name="tab" value="inbox" />
            <input type="hidden" name="action" value="reject" />
            <select name="reason" className={`${input} sm:w-56`} aria-label="Why reject" defaultValue="">
              <option value="">Why? (optional)</option>
              <option>Too salesy</option>
              <option>Wrong person</option>
              <option>Wrong facts</option>
              <option>Sounds like a bot</option>
              <option>Not worth it</option>
            </select>
            <button className={`${btn} bg-gray-800 text-white hover:bg-gray-700`}>Reject</button>
          </form>
        </>
      ) : (
        <div className="space-y-2">
          {a.body && <pre className="text-gray-300 text-sm whitespace-pre-wrap break-words bg-gray-900 rounded-lg p-3">{a.body}</pre>}
          <div className="flex flex-wrap gap-2">
            <CopyOpen text={a.body} href={a.target_url} />
            <form method="post" action={action}>
              <input type="hidden" name="tab" value="inbox" />
              <button name="action" value="posted" className={`${btn} bg-gray-800 text-white hover:bg-gray-700`}>
                I posted it
              </button>
            </form>
            <form method="post" action={action}>
              <input type="hidden" name="tab" value="inbox" />
              <input type="hidden" name="reason" value="Changed my mind" />
              <button name="action" value="reject" className={`${btn} text-gray-400 hover:text-white`}>
                Didn&apos;t post it
              </button>
            </form>
          </div>
        </div>
      )}
    </article>
  );
}

function Teams({ d }: { d: Dashboard }) {
  const groups = TEAMS.map((t) => ({ team: t, rows: d.agents.filter((a) => a.def.team === t) })).filter((g) => g.rows.length);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.team} className={`${card} space-y-3`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-white font-semibold">{TEAM_NAME[g.team as TeamId]}</h2>
            <span className="text-gray-500 text-xs">${(d.today.byTeam[g.team]?.usd ?? 0).toFixed(2)} today</span>
          </div>
          <div className="divide-y divide-gray-800">
            {g.rows.map((r) => (
              <AgentLine key={r.def.id} r={r} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AgentLine({ r }: { r: AgentRow }) {
  const action = `/api/admin/crew/agents/${r.def.id}`;
  const blocked = r.def.locked ?? (r.missing.length ? `Needs: ${r.missing.join(", ")}` : null);
  return (
    <div className="py-3 space-y-2" data-agent={r.def.id}>
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-white text-sm font-medium mr-1">{r.def.name}</p>
        <Badge tone={r.state.enabled ? "green" : "gray"}>{r.state.enabled ? "On" : "Off"}</Badge>
        <Badge>{TIER_LABEL[r.state.model_override ?? r.def.tier]}</Badge>
        <Badge>{r.schedule}</Badge>
      </div>
      <p className="text-gray-400 text-xs">{r.def.purpose}</p>
      {blocked && <p className="text-amber-200 text-xs break-words">{blocked}</p>}
      {r.state.status_note && r.state.status_note !== blocked && <p className="text-gray-400 text-xs break-words">{r.state.status_note}</p>}
      {r.lastRun && (
        <p className="text-gray-500 text-xs break-words">
          Last run {new Date(r.lastRun.started_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}: {r.lastRun.summary ?? r.lastRun.status}
        </p>
      )}
      <p className="text-gray-500 text-xs">
        ${r.today.usd.toFixed(2)} of ${r.cap.toFixed(2)} today
      </p>
      <div className="flex flex-wrap gap-2">
        <form method="post" action={action}>
          <input type="hidden" name="tab" value="teams" />
          <button name="action" value={r.state.enabled ? "disable" : "enable"} disabled={!r.state.enabled && !!blocked} className={`${btn} ${r.state.enabled ? "bg-gray-800 text-white" : "bg-blue-600 text-white hover:bg-blue-500"} disabled:opacity-40`}>
            {r.state.enabled ? "Switch off" : "Switch on"}
          </button>
        </form>
        {r.state.enabled && (
          <form method="post" action={action}>
            <input type="hidden" name="tab" value="teams" />
            <button name="action" value="run" className={`${btn} bg-gray-800 text-white hover:bg-gray-700`}>
              Run now
            </button>
          </form>
        )}
        <form method="post" action={action} className="flex gap-2">
          <input type="hidden" name="tab" value="teams" />
          <input type="hidden" name="action" value="cap" />
          <label className="sr-only" htmlFor={`cap-${r.def.id}`}>Daily limit in dollars</label>
          <input id={`cap-${r.def.id}`} name="usd" inputMode="decimal" placeholder={`$${r.def.dailyUsd}`} defaultValue={r.state.daily_usd_cap ?? ""} className={`${input} w-24`} />
          <button className={`${btn} text-gray-300 hover:text-white`}>Set limit</button>
        </form>
      </div>
    </div>
  );
}

function Usage({ d }: { d: Dashboard }) {
  const rows = d.agents.filter((a) => (d.week.byAgent[a.def.id]?.usd ?? 0) > 0 || a.today.usd > 0).sort((x, y) => (d.week.byAgent[y.def.id]?.usd ?? 0) - (d.week.byAgent[x.def.id]?.usd ?? 0));
  const cachePct = d.today.total.input ? Math.round((d.today.total.cacheRead / d.today.total.input) * 100) : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { k: "Today", v: `$${d.today.total.usd.toFixed(2)}` },
          { k: "Last 7 days", v: `$${d.week.total.usd.toFixed(2)}` },
          { k: "Tokens today", v: d.today.total.tokens.toLocaleString("en-US") },
          { k: "From cache", v: `${cachePct}%` },
        ].map((c) => (
          <div key={c.k} className={card}>
            <p className="text-gray-500 text-xs">{c.k}</p>
            <p className="text-white text-xl font-bold mt-1">{c.v}</p>
          </div>
        ))}
      </div>
      <div className={card}>
        <p className="text-white font-semibold text-sm mb-3">By agent</p>
        {rows.length === 0 ? (
          <p className="text-gray-500 text-sm">No spending yet.</p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r) => {
              const pct = Math.min(100, Math.round((r.today.usd / Math.max(0.01, r.cap)) * 100));
              return (
                <div key={r.def.id}>
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="text-gray-300 truncate">{r.def.name}</span>
                    <span className="text-gray-400 shrink-0">
                      ${r.today.usd.toFixed(2)} today · ${(d.week.byAgent[r.def.id]?.usd ?? 0).toFixed(2)} week
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-800 mt-1 overflow-hidden" aria-hidden>
                    <div className={`h-full ${pct >= 90 ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Reports({ d }: { d: Dashboard }) {
  if (!d.reports.length) return <div className={card}><p className="text-gray-400 text-sm">No reports yet. Managers write one every morning once their team has done something.</p></div>;
  return (
    <div className="space-y-3">
      {d.reports.map((r) => (
        <article key={r.id} className={card}>
          <p className="text-gray-500 text-xs mb-2">{r.day} · {agentName(d, r.agent_id)}</p>
          <pre className="text-gray-200 text-sm whitespace-pre-wrap break-words font-sans">{r.body}</pre>
        </article>
      ))}
    </div>
  );
}

function Paste() {
  return (
    <form method="post" action="/api/admin/crew/paste" className={`${card} space-y-3`}>
      <p className="text-white font-semibold">Paste a post or profile</p>
      <p className="text-gray-400 text-sm">For places our agents can&apos;t read on their own (Facebook groups, Alignable, Instagram and LinkedIn posts). Paste what you saw and the right agent drafts from it.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm text-gray-300 space-y-1">
          <span>Where is it from?</span>
          <select name="platform" className={input} defaultValue="facebook">
            <option value="facebook">Facebook group</option>
            <option value="alignable">Alignable</option>
            <option value="instagram">Instagram</option>
            <option value="linkedin">LinkedIn</option>
            <option value="threads">Threads</option>
            <option value="quora">Quora</option>
            <option value="indiehackers">Indie Hackers</option>
            <option value="reddit">Reddit</option>
            <option value="web">Somewhere else</option>
          </select>
        </label>
        <label className="text-sm text-gray-300 space-y-1">
          <span>What is it?</span>
          <select name="kind" className={input} defaultValue="post">
            <option value="post">A post</option>
            <option value="profile">A person&apos;s profile</option>
            <option value="page">A business page</option>
          </select>
        </label>
      </div>
      <label className="block text-sm text-gray-300 space-y-1">
        <span>Link (optional)</span>
        <input name="url" type="url" inputMode="url" className={input} placeholder="https://" />
      </label>
      <label className="block text-sm text-gray-300 space-y-1">
        <span>The text</span>
        <textarea name="text" rows={7} required minLength={20} className={input} placeholder="Paste the post, including the person's name or handle" />
      </label>
      <button className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}>Send to the agents</button>
    </form>
  );
}

function SettingsForm({ d }: { d: Dashboard }) {
  return (
    <div className="space-y-4">
      <form method="post" action="/api/admin/crew/settings" className={`${card} space-y-4`}>
        <input type="hidden" name="action" value="save" />
        <label className="block text-sm text-gray-300 space-y-1">
          <span>Daily limit for all agents together ($)</span>
          <input name="daily_usd_cap" inputMode="decimal" defaultValue={d.settings.daily_usd_cap} className={`${input} w-32`} />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm text-gray-300">Daily limit per team ($, blank = none)</legend>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TEAMS.map((t) => (
              <label key={t} className="text-xs text-gray-400 space-y-1">
                <span>{TEAM_NAME[t]}</span>
                <input name={`team_cap_${t}`} inputMode="decimal" defaultValue={d.settings.team_caps[t]?.usd ?? ""} className={input} />
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" name="disclosure_on" defaultChecked={d.settings.disclosure_on} className="h-4 w-4" />
          Add a disclosure line to anything that mentions SwiftCard (recommended; the FTC and most platforms require it)
        </label>
        <label className="block text-sm text-gray-300 space-y-1">
          <span>Disclosure line</span>
          <input name="disclosure" defaultValue={d.settings.disclosure} className={input} maxLength={200} />
        </label>
        <button className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}>Save settings</button>
      </form>
      <div className={card}>
        <EnvList envNeeded={d.envNeeded} />
        {!d.envNeeded.length && <p className="text-gray-400 text-sm">Every key the agents use is set.</p>}
      </div>
    </div>
  );
}
