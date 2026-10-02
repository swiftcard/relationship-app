"use client";

import { useCallback, useEffect, useState } from "react";

// Agent Flow → Settings → Instagram bot. The owner's switch for "Comment CARD
// and I'll send you one", the wording it sends, and the one funnel it is judged
// on: keyword comments → links sent → link taps → signups, per post.
// Server side: src/app/api/admin/agents/instagram/route.ts + lib/instagram-bot.ts.

type Settings = {
  enabled: boolean; auto_answers: boolean; keywords: string[]; message: string;
  public_replies: string[]; daily_cap: number; profession: string | null; hashtags: string[];
};
type Post = { media_id: string; permalink: string | null; caption: string | null; media_type: string | null; keyword_comments: number; links_sent: number; clicks: number; signups: number };
type Data = {
  ready: boolean; message?: string;
  settings: Settings; connected: boolean; account: string | null; missing: string[];
  last_tick_at: string | null; last_error: string | null; bio_link: string;
  funnel: { keyword_comments: number; links_sent: number; waiting: number; failed: number; clicks: number; signups: number; trials: number };
  posts: Post[];
  other_sources: Array<{ code: string; signups: number; clicks: number }>;
  recent: Array<{ kind: string; username: string | null; text: string | null; status: string; reason: string | null; created_at: string }>;
};

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

// The connect route redirects to Meta's consent screen — a real navigation, not a page <Link>.
const META = "meta";

const STATUS_WORDS: Record<string, string> = { sent: "sent", queued: "waiting for you", skipped: "no action", failed: "failed", new: "in progress" };

export default function InstagramBotCard() {
  const [d, setD] = useState<Data | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/agents/instagram", { cache: "no-store" });
      setD(await r.json());
    } catch { setNote("Couldn't load the Instagram bot."); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { void load(); }, [load]);

  async function save(patch: Partial<Settings>, ok: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/agents/instagram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: patch }) });
      const j = await r.json();
      setNote(r.ok ? ok : j.error ?? "Couldn't save.");
      if (r.ok) await load();
    } catch { setNote("Couldn't save."); }
    setBusy(false);
  }

  async function runNow() {
    setBusy(true);
    setNote("Checking Instagram…");
    try {
      const r = await fetch("/api/admin/agents/instagram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run_now" }) });
      const j = await r.json();
      setNote(j.ok
        ? `Checked ${j.posts} posts: ${j.comments} comments read, ${j.sent} sent, ${j.queued} waiting for you${j.errors?.length ? ` — ${j.errors[0]}` : ""}`
        : j.reason === "not_connected" ? "Instagram isn't connected yet — connect Meta above." : `Couldn't check: ${j.reason ?? "unknown"}`);
      await load();
    } catch { setNote("Couldn't reach the bot."); }
    setBusy(false);
  }

  const box = "rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3";
  if (!d) return <div className={box}><p className="text-gray-500 text-xs">Loading the Instagram bot…</p></div>;
  if (!d.ready) return <div className={box}><p className="text-white text-sm font-semibold">Instagram bot</p><p className="text-amber-500/90 text-xs">{d.message}</p></div>;

  const s = d.settings;
  const f = d.funnel;
  const input = "mt-1 w-full bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-2 text-xs text-gray-200";

  return (
    <div className={box}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[220px]">
          <p className="text-white text-sm font-semibold">Instagram bot — &ldquo;Comment {s.keywords[0]} and I&apos;ll send you one&rdquo;</p>
          <p className="text-gray-500 text-xs mt-0.5">
            When someone comments the keyword on a SwiftCard post, they get the card link in a private message and a short public reply. It only ever writes to people who wrote to us first. Checked every 10 minutes · last check {ago(d.last_tick_at)}.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
          <input type="checkbox" checked={s.enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? "On — the card link now sends automatically." : "Off — each one waits in the queue for your Approve.")} className="accent-emerald-500 w-4 h-4" />
          <span className={s.enabled ? "text-emerald-400 font-semibold" : "text-gray-400"}>{s.enabled ? "Sending automatically" : "Off — you approve each one"}</span>
        </label>
      </div>

      {!d.connected && <p className="text-amber-500/90 text-xs">Instagram isn&apos;t connected yet. Connect Meta under Connections above, with the SwiftCard Facebook Page and its Instagram account.</p>}
      {d.connected && d.missing.length > 0 && (
        <p className="text-amber-500/90 text-xs">
          Connected as @{d.account}, but without permission to read comments and send messages. <a href={`/api/admin/connect/${META}`} className="underline text-amber-300">Reconnect Meta</a> and leave every box ticked.
        </p>
      )}
      {d.last_error && <p className="text-amber-500/90 text-xs">Instagram said: {d.last_error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
        {([["Keyword comments", f.keyword_comments], ["Links sent", f.links_sent], ["Link taps", f.clicks], ["Signups", f.signups], ["Pro trials", f.trials]] as const).map(([label, n]) => (
          <div key={label} className="rounded-lg bg-gray-950 border border-gray-800 py-2">
            <p className="text-white text-lg font-bold tabular-nums">{n}</p>
            <p className="text-gray-500 text-[0.6875rem]">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-gray-600 text-[0.6875rem]">
        Last 30 days{f.waiting ? ` · ${f.waiting} waiting in the queue for you` : ""}{f.failed ? ` · ${f.failed} failed` : ""}. Bio link: <code className="text-gray-300 break-all">{d.bio_link}</code>
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-xs text-gray-400 md:col-span-2">
          The private message — <code className="text-gray-300">{"{link}"}</code> becomes that post&apos;s own tracked link
          <textarea rows={4} defaultValue={s.message} onBlur={(e) => { if (e.target.value.trim() !== s.message) void save({ message: e.target.value }, "Message saved."); }} className={input} />
        </label>
        <label className="block text-xs text-gray-400">
          Keywords (one per line)
          <textarea rows={3} defaultValue={s.keywords.join("\n")} onBlur={(e) => { if (e.target.value.trim() !== s.keywords.join("\n")) void save({ keywords: e.target.value.split(/\r?\n/) }, "Keywords saved."); }} className={input} />
        </label>
        <label className="block text-xs text-gray-400">
          Public replies under the comment (one per line, rotated)
          <textarea rows={3} defaultValue={s.public_replies.join("\n")} onBlur={(e) => { if (e.target.value.trim() !== s.public_replies.join("\n")) void save({ public_replies: e.target.value.split(/\r?\n/) }, "Public replies saved."); }} className={input} />
        </label>
        <label className="block text-xs text-gray-400">
          Most messages per day
          <input type="number" min={1} max={1000} defaultValue={s.daily_cap} onBlur={(e) => { if (Number(e.target.value) !== s.daily_cap) void save({ daily_cap: Number(e.target.value) }, "Daily limit saved."); }} className={input} />
        </label>
        <label className="block text-xs text-gray-400">
          Hashtags the Radar reads for new professionals (one per line, 30 at most)
          <textarea rows={3} defaultValue={s.hashtags.join("\n")} onBlur={(e) => { if (e.target.value.trim() !== s.hashtags.join("\n")) void save({ hashtags: e.target.value.split(/\r?\n/) }, "Hashtags saved."); }} className={input} />
        </label>
      </div>

      <label className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer select-none">
        <input type="checkbox" checked={s.auto_answers} disabled={busy || !s.enabled} onChange={(e) => save({ auto_answers: e.target.checked }, e.target.checked ? "Questions are now answered automatically." : "Answers go back to drafts in the queue.")} className="accent-emerald-500 w-4 h-4 mt-0.5" />
        <span>
          Also answer questions automatically
          <span className="block text-gray-500">Off: when someone asks a question in a comment or a message, the sales assistant&apos;s answer waits in the queue for your Approve. On: it is sent. Turn this on once you&apos;ve read enough of its drafts to trust them.</span>
        </span>
      </label>

      {d.posts.length > 0 && (
        <div>
          <p className="text-gray-300 text-xs font-semibold mb-1">Posts, best first — which ones bring signups</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-gray-500">
                <tr><th className="py-1 pr-3 font-normal">Post</th><th className="py-1 px-2 font-normal text-right">Comments</th><th className="py-1 px-2 font-normal text-right">Sent</th><th className="py-1 px-2 font-normal text-right">Taps</th><th className="py-1 pl-2 font-normal text-right">Signups</th></tr>
              </thead>
              <tbody>
                {d.posts.slice(0, 10).map((p) => (
                  <tr key={p.media_id} className="border-t border-gray-800 text-gray-300">
                    <td className="py-1.5 pr-3 max-w-[260px] truncate">
                      {p.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">{(p.caption || "Untitled post").slice(0, 60)}</a> : (p.caption || "Untitled post").slice(0, 60)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{p.keyword_comments}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{p.links_sent}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{p.clicks}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums font-semibold text-white">{p.signups}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {d.recent.length > 0 && (
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer text-gray-300">Latest comments and messages it saw</summary>
          <ul className="mt-1.5 space-y-1">
            {d.recent.map((r, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="text-gray-500">{ago(r.created_at)}</span>
                <span className="text-gray-300">{r.username ? `@${r.username}` : r.kind}</span>
                <span className="truncate max-w-[280px]">&ldquo;{(r.text ?? "").slice(0, 80)}&rdquo;</span>
                <span className={r.status === "sent" ? "text-emerald-400" : r.status === "failed" ? "text-red-400" : "text-gray-500"}>{STATUS_WORDS[r.status] ?? r.status}{r.reason ? ` (${r.reason.replace(/_/g, " ")})` : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={runNow} disabled={busy || !d.connected} className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-full">Check Instagram now</button>
        {note && <span className="text-xs text-gray-400">{note}</span>}
      </div>
    </div>
  );
}
