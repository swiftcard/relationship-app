"use client";

import { useCallback, useEffect, useState } from "react";

// Agent Flow → LinkedIn desk. Paste a post or a profile, get the comment, the
// connection note, the message and the follow-up written around what that
// person said, then tick each step off as you send it on linkedin.com. The desk
// never touches LinkedIn itself — LinkedIn restricts accounts that let a tool
// search or send for them.
// Server side: src/app/api/admin/agents/linkedin/route.ts + lib/linkedin-desk.ts.

type Drafts = { comment?: string[]; note?: string[]; message?: string[]; followup?: string[] };
type Prospect = {
  id: string; code: string; name: string | null; headline: string | null; company: string | null;
  profile_url: string | null; post_url: string | null; hook: string | null; trigger: string; sender: string | null;
  drafts: Drafts; status: string; notes: string | null; clicks: number;
  messaged_at: string | null; followup_sent_at: string | null; created_at: string;
  next: { label: string; due: boolean };
};
type Data = {
  ready: boolean; message?: string;
  settings: { senders: string[]; daily_target: number; followup_days: number };
  triggers: Record<string, string>;
  page_link: string;
  today: Array<{ sender: string; sent: number }>;
  funnel: { added: number; contacted: number; connected: number; messaged: number; replied: number; clicks: number; signups: number };
  prospects: Prospect[];
  closed: number;
};

const API = "/api/admin/agents/linkedin";
const NOTE_MAX = 200;

// The searches worth five minutes a day. Each opens LinkedIn's own search on
// posts from the past week, newest first — the owner reads and picks.
const search = (q: string) => `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(q)}&datePosted=%22past-week%22&sortBy=%22date_posted%22`;
const SEARCHES: Array<[string, string]> = [
  ["New job: realtors", '"starting a new position" realtor'],
  ["New job: loan officers", '"starting a new position" "loan officer"'],
  ["New job: insurance", '"starting a new position" "insurance agent"'],
  ["New job: sales", '"starting a new position" "account executive"'],
  ["Newly licensed agents", '"passed my real estate exam"'],
  ["Brokerages welcoming agents", '"welcome" "newest agent"'],
  ["Going to an event", '"stop by our booth"'],
  ["Talking about digital cards", '"digital business card"'],
];

const ago = (iso: string | null) => {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 5400 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

const STATUS_WORDS: Record<string, string> = {
  new: "Not contacted yet", requested: "Request sent", connected: "Connected", messaged: "Messaged", replied: "Replied", signed_up: "Signed up", closed: "Closed",
};

function Draft({ label, hint, versions, limit }: { label: string; hint: string; versions: string[]; limit?: number }) {
  const [pick, setPick] = useState(0);
  const [copied, setCopied] = useState(false);
  if (!versions.length) return null;
  const text = versions[Math.min(pick, versions.length - 1)];
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the text is selectable */ }
  }
  return (
    <div className="rounded-lg bg-gray-950 border border-gray-800 p-2.5">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <p className="text-gray-200 text-xs font-semibold">{label}</p>
        <p className="text-gray-400 text-[0.6875rem] flex-1 min-w-[120px]">{hint}</p>
        {versions.length > 1 && (
          <button onClick={() => setPick((p) => (p + 1) % versions.length)} className="text-[0.6875rem] text-blue-400 hover:underline">Version {pick + 1} of {versions.length} · switch</button>
        )}
        <button onClick={copy} className="text-[0.6875rem] bg-gray-800 hover:bg-gray-700 text-white px-2.5 py-1 rounded-full">{copied ? "Copied ✓" : "Copy"}</button>
      </div>
      <p className="text-gray-200 text-xs whitespace-pre-wrap select-text">{text}</p>
      {limit && <p className={`text-[0.625rem] mt-1 ${text.length > limit ? "text-red-400" : "text-gray-400"}`}>{text.length} of {limit} characters</p>}
    </div>
  );
}

export default function LinkedInDesk() {
  const [d, setD] = useState<Data | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [name, setName] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [trigger, setTrigger] = useState("");
  const [sender, setSender] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(API, { cache: "no-store" });
      setD(await r.json());
    } catch { setNote("Couldn't load the LinkedIn desk."); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; j: Record<string, unknown> }> {
    setBusy(true);
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) setNote(String(j.error ?? "That didn't save."));
      return { ok: r.ok, j };
    } catch { setNote("Couldn't reach the desk."); return { ok: false, j: {} }; }
    finally { setBusy(false); }
  }

  async function add() {
    setNote("Reading the post and writing the messages…");
    const { ok, j } = await post({ action: "add", pasted, name, profile_url: profileUrl, trigger: trigger || undefined, sender: sender || d?.settings.senders[0] });
    if (!ok) return;
    setPasted(""); setName(""); setProfileUrl(""); setTrigger("");
    setOpen(String((j.prospect as { id?: string } | undefined)?.id ?? ""));
    setNote(j.ai ? "Written. Read it before you send it." : "The writer was unavailable, so these are the plain versions. Press Rewrite to try again.");
    await load();
  }

  async function step(id: string, body: Record<string, unknown>, said: string) {
    const { ok } = await post({ id, ...body });
    if (ok) { setNote(said); await load(); }
  }

  const box = "rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3";
  if (!d) return <div className={box}><p className="text-gray-400 text-xs">Loading the LinkedIn desk…</p></div>;
  if (!d.ready) return <div className={box}><p className="text-white text-sm font-semibold">LinkedIn desk</p><p className="text-amber-500/90 text-xs">{d.message}</p></div>;

  const f = d.funnel;
  const input = "mt-1 w-full bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-2 text-xs text-gray-200";
  const btn = "text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-full";
  const go = "text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-full font-semibold";
  const due = d.prospects.filter((p) => p.next.due);
  const waiting = d.prospects.filter((p) => !p.next.due);

  const card = (p: Prospect) => {
    const isOpen = open === p.id;
    const warm = p.trigger === "warm";
    return (
      <div key={p.id} className="rounded-lg border border-gray-800 bg-gray-950/60">
        <button onClick={() => setOpen(isOpen ? null : p.id)} className="w-full text-left px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-white text-sm font-semibold">{p.name || "Unnamed"}</span>
          <span className="text-gray-400 text-xs truncate max-w-[260px]">{[p.headline, p.company].filter(Boolean).join(" · ")}</span>
          <span className="text-[0.6875rem] px-2 py-0.5 rounded-full border border-gray-700 text-gray-300">{d.triggers[p.trigger] ?? p.trigger}</span>
          <span className={`text-xs ml-auto ${p.status === "signed_up" ? "text-emerald-400 font-semibold" : p.next.due ? "text-amber-300" : "text-gray-400"}`}>{p.next.label}</span>
        </button>
        {isOpen && (
          <div className="px-3 pb-3 space-y-2.5">
            <p className="text-gray-400 text-xs">
              {STATUS_WORDS[p.status] ?? p.status} · added {ago(p.created_at)}{p.sender ? ` · sent from ${p.sender}'s profile` : ""} · {p.clicks} link tap{p.clicks === 1 ? "" : "s"}
              {p.profile_url && <> · <a href={p.profile_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">open profile</a></>}
              {p.post_url && <> · <a href={p.post_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">open post</a></>}
            </p>
            {p.hook && <p className="text-gray-300 text-xs"><span className="text-gray-400">What they said:</span> {p.hook}</p>}

            <Draft label="1. Comment" hint="Under their post, so they recognise the name. No pitch." versions={p.drafts.comment ?? []} />
            <Draft label="2. Connection note" hint="A free account gets only a few notes a month. If you're out, send the request with no note." versions={p.drafts.note ?? []} limit={NOTE_MAX} />
            <Draft label={warm ? "Message" : "3. Message"} hint={warm ? "They already know you. Send it as a normal message." : "After they accept. Carries their own tracked link."} versions={p.drafts.message ?? []} />
            <Draft label={warm ? "Follow-up" : "4. Follow-up"} hint={`If there is no reply after ${d.settings.followup_days} days.`} versions={p.drafts.followup ?? []} />

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {p.status === "new" && !warm && <button disabled={busy} onClick={() => step(p.id, { action: "status", status: "requested" }, "Marked: request sent.")} className={go}>I sent the request</button>}
              {p.status === "requested" && <button disabled={busy} onClick={() => step(p.id, { action: "status", status: "connected" }, "Marked: they accepted. Send the message.")} className={go}>They accepted</button>}
              {(p.status === "connected" || (p.status === "new" && warm)) && <button disabled={busy} onClick={() => step(p.id, { action: "status", status: "messaged" }, "Marked: message sent.")} className={go}>I sent the message</button>}
              {p.status === "messaged" && !p.followup_sent_at && <button disabled={busy} onClick={() => step(p.id, { action: "followup_sent" }, "Marked: follow-up sent.")} className={btn}>I sent the follow-up</button>}
              {(p.status === "messaged" || p.status === "requested" || p.status === "connected") && <button disabled={busy} onClick={() => step(p.id, { action: "status", status: "replied" }, "Marked: they replied.")} className={btn}>They replied</button>}
              <button disabled={busy} onClick={async () => { setNote("Rewriting…"); const { ok, j } = await post({ action: "redraft", id: p.id }); if (ok) { setNote(j.ai ? "Rewritten." : "The writer was unavailable; these are the plain versions."); await load(); } }} className={btn}>Rewrite</button>
              {p.status !== "signed_up" && <button disabled={busy} onClick={() => step(p.id, { action: "status", status: "closed" }, "Closed. They stay on the list so nobody contacts them twice.")} className="text-xs text-gray-400 hover:text-white px-2 py-1.5">Not interested</button>}
            </div>
            <label className="block text-xs text-gray-400">
              Your notes
              <textarea rows={2} defaultValue={p.notes ?? ""} onBlur={(e) => { if (e.target.value !== (p.notes ?? "")) void step(p.id, { action: "notes", notes: e.target.value }, "Note saved."); }} className={input} />
            </label>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3 max-w-3xl">
      <div className={box}>
        <div>
          <p className="text-white text-sm font-semibold">LinkedIn desk — find a person, paste them here, send what it writes</p>
          <p className="text-gray-400 text-xs mt-0.5">
            You do the clicking on LinkedIn; the desk does the writing and the remembering. It never searches or sends on LinkedIn by itself, because LinkedIn restricts accounts that let a tool do that. Every person gets their own link, so a signup is counted against the exact conversation it came from.
          </p>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
          {([["Contacted", f.contacted], ["Connected", f.connected], ["Messaged", f.messaged], ["Replied", f.replied], ["Link taps", f.clicks], ["Signups", f.signups]] as const).map(([label, n]) => (
            <div key={label} className="rounded-lg bg-gray-950 border border-gray-800 py-2">
              <p className="text-white text-lg font-bold tabular-nums">{n}</p>
              <p className="text-gray-400 text-[0.6875rem]">{label}</p>
            </div>
          ))}
        </div>
        <p className="text-gray-400 text-[0.6875rem]">
          Today: {d.today.map((t) => `${t.sender} ${t.sent} of ${d.settings.daily_target}`).join(" · ")}. Signups counts every account that arrived through a LinkedIn link. Link for the Page button and the first comment under Page posts: <code className="text-gray-300 break-all">{d.page_link}</code>
        </p>
      </div>

      <div className={box}>
        <p className="text-white text-sm font-semibold">1. Find people (about five minutes)</p>
        <p className="text-gray-400 text-xs">Each button opens LinkedIn&apos;s own search on posts from the past week. Pick people who fit, and copy the post text.</p>
        <div className="flex flex-wrap gap-1.5">
          {SEARCHES.map(([label, q]) => (
            <a key={label} href={search(q)} target="_blank" rel="noreferrer" className="text-xs px-2.5 py-1.5 rounded-full border border-gray-700 text-gray-200 hover:bg-gray-800">{label} ↗</a>
          ))}
        </div>
      </div>

      <div className={box}>
        <p className="text-white text-sm font-semibold">2. Paste them here</p>
        <label className="block text-xs text-gray-400">
          The post, or the top of their profile (copy it straight off the page)
          <textarea rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="I'm happy to share that I'm starting a new position as…" className={input} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-gray-400">
            Their name (optional, read from the post if left empty)
            <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </label>
          <label className="block text-xs text-gray-400">
            Their profile link (stops the same person being added twice)
            <input value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://www.linkedin.com/in/…" className={input} />
          </label>
          <label className="block text-xs text-gray-400">
            Who they are
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className={input}>
              <option value="">Work it out from the post</option>
              {Object.entries(d.triggers).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="block text-xs text-gray-400">
            Whose LinkedIn sends it
            <select value={sender || d.settings.senders[0]} onChange={(e) => setSender(e.target.value)} className={input}>
              {d.settings.senders.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={add} disabled={busy || pasted.trim().length < 20} className={go}>Write the messages</button>
          {note && <span className="text-xs text-gray-300">{note}</span>}
        </div>
      </div>

      <div className={box}>
        <p className="text-white text-sm font-semibold">3. Do now ({due.length})</p>
        {due.length === 0 ? <p className="text-gray-400 text-xs">Nothing is waiting on you. Add someone above.</p> : <div className="space-y-2">{due.map(card)}</div>}
      </div>

      {waiting.length > 0 && (
        <div className={box}>
          <p className="text-white text-sm font-semibold">Waiting on them ({waiting.length})</p>
          <div className="space-y-2">{waiting.map(card)}</div>
        </div>
      )}

      <div className={box}>
        <p className="text-white text-sm font-semibold">Desk settings</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs text-gray-400">
            Who sends (one name per line)
            <textarea rows={2} defaultValue={d.settings.senders.join("\n")} onBlur={async (e) => { if (e.target.value.trim() !== d.settings.senders.join("\n")) { const { ok } = await post({ settings: { senders: e.target.value.split(/\r?\n/) } }); if (ok) { setNote("Senders saved."); await load(); } } }} className={input} />
          </label>
          <label className="block text-xs text-gray-400">
            New people per sender per day (20 at most)
            <input type="number" min={1} max={20} defaultValue={d.settings.daily_target} onBlur={async (e) => { if (Number(e.target.value) !== d.settings.daily_target) { const { ok } = await post({ settings: { daily_target: Number(e.target.value) } }); if (ok) { setNote("Daily number saved."); await load(); } } }} className={input} />
          </label>
          <label className="block text-xs text-gray-400">
            Days before the follow-up
            <input type="number" min={1} max={14} defaultValue={d.settings.followup_days} onBlur={async (e) => { if (Number(e.target.value) !== d.settings.followup_days) { const { ok } = await post({ settings: { followup_days: Number(e.target.value) } }); if (ok) { setNote("Follow-up timing saved."); await load(); } } }} className={input} />
          </label>
        </div>
        {d.closed > 0 && <p className="text-gray-400 text-[0.6875rem]">{d.closed} closed {d.closed === 1 ? "person is" : "people are"} kept off this screen but stay on the list, so nobody is contacted twice.</p>}
      </div>
    </div>
  );
}
