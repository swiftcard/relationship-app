import Link from "next/link";
import { scrub } from "@/lib/crew/agent-status";
import type { GmailAccount } from "@/lib/crew/email/gmail";
import { followUpDue, type LeadRow } from "@/lib/crew/email/outbox";
import type { EmailSend } from "@/lib/crew/email/sends";
import type { Approval } from "@/lib/crew/types";
import { writingProblems } from "@/lib/crew/writing-check";
import { Badge, btn, card, input } from "../ui";

// ── The Email page ──────────────────────────────────────────────────────────
// Top to bottom: is the mailbox ready, emails waiting for you (read, edit,
// Send), Web Leads ready to email (Review as email), and what was
// sent with what came back. Every button is a plain form post, so it works
// before hydration and nothing lands in a URL.

const SEND = (id: string) => `/api/admin/crew/approvals/${id}`;
const FORM = "/api/admin/crew/email";
const CONNECT = "/api/admin/connect/google_gmail";

type Config = { live: boolean; mailbox: string; dailyCap: number; postal: boolean; app?: boolean };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

const STATUS: Record<EmailSend["status"], { label: string; tone: "gray" | "blue" | "amber" | "green" | "red" }> = {
  sending: { label: "Sending", tone: "blue" },
  sent: { label: "Sent", tone: "green" },
  failed: { label: "Failed, nothing sent", tone: "red" },
  unknown: { label: "No answer from Gmail", tone: "amber" },
  simulated: { label: "Dry run only", tone: "gray" },
};

function Setup({ config, account, tableReady, used }: { config: Config; account: GmailAccount; tableReady: boolean; used: number }) {
  const connected = account.ok && account.email === config.mailbox;
  const steps: { ok: boolean; text: string }[] = [
    { ok: tableReady, text: tableReady ? "Send records are ready." : "Run supabase/crew-email.sql in Supabase (one table)." },
    { ok: config.app !== false, text: config.app !== false ? "Mailbox app (Internal Google client) is set." : "Set CREW_GMAIL_CLIENT_ID and CREW_GMAIL_CLIENT_SECRET in Vercel (the Internal Google Cloud project's OAuth client)." },
    {
      ok: connected,
      text: connected ? `Mailbox connected and answering: Gmail confirmed ${config.mailbox} just now.` : account.ok ? `Connected as ${account.email}, which isn't ${config.mailbox}. Connect again as ${config.mailbox}.` : `Connect ${config.mailbox} (${account.reason === "not_connected" ? "not connected yet" : `needs attention: ${account.reason}${account.detail ? `, ${account.detail}` : ""}`}).`,
    },
    { ok: config.postal, text: config.postal ? "Postal address set for the footer." : "Set CREW_EMAIL_POSTAL_ADDRESS in Vercel (US law wants it in outreach email)." },
    { ok: config.live, text: config.live ? "Live: Send really sends." : "Dry run: Send records what would go and sends nothing. CREW_EMAIL_LIVE=1 turns sending on." },
  ];
  return (
    <section className={`${card} space-y-3`} aria-labelledby="email-setup">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="email-setup" className="text-white font-semibold">
          Sending from {config.mailbox}
        </h2>
        <Badge tone={config.live ? "green" : "amber"}>{config.live ? "Live" : "Dry run"}</Badge>
      </div>
      <ul className="space-y-1.5 text-sm">
        {steps.map((s) => (
          <li key={s.text} className={s.ok ? "text-gray-300" : "text-amber-200"}>
            {s.ok ? "✓" : "•"} {s.text}
          </li>
        ))}
      </ul>
      <p className="text-gray-400 text-xs">
        {used} of {config.dailyCap} sent in the last 24 hours. One email per company a day, and never twice to the same address.
      </p>
      {!connected && config.app !== false && (
        <a href={CONNECT} className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}>
          Connect {config.mailbox}
        </a>
      )}
    </section>
  );
}

function DraftCard({ a, send, config }: { a: Approval; send?: EmailSend; config: Config }) {
  // Checked on the text as it stands now, so an edit that fixes it clears it.
  const problems = writingProblems(a.body, { kind: "cold_email", platform: "email" });
  const err = typeof a.meta?.send_error === "string" ? scrub(a.meta.send_error) : null;
  const retry = send && (send.status === "failed" || send.status === "unknown");
  return (
    <article id={`a-${a.id}`} className={`${card} space-y-3 scroll-mt-20`} data-email-draft={a.id}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="blue">Email</Badge>
        {a.status === "approved" && <Badge tone="green">Approved</Badge>}
        {send && <Badge tone={STATUS[send.status].tone}>{STATUS[send.status].label}</Badge>}
        {problems.length > 0 && <Badge tone="amber">Needs a look</Badge>}
        {a.meta?.starter === true && <Badge tone="amber">Starter: make it yours</Badge>}
      </div>
      <div>
        <p className="text-white font-semibold text-[0.9375rem] break-words">{scrub(a.title)}</p>
        <p className="text-gray-300 text-sm mt-1 break-all">To: {String(a.meta.email)}</p>
        {typeof a.meta.source_url === "string" && (
          <a href={a.meta.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-300 text-xs break-all hover:underline">
            Their website ↗
          </a>
        )}
      </div>
      {problems.length > 0 && <p className="text-amber-200 text-xs">The writing check flagged: {problems.join("; ")}.</p>}
      {err && <p className="rounded-lg bg-red-500/10 border border-red-900/40 text-red-200 text-sm px-3 py-2">Last try: {err}</p>}
      <form method="post" action={SEND(a.id)} className="space-y-2">
        <input type="hidden" name="tab" value="email" />
        <label className="block text-gray-500 text-[0.6875rem]" htmlFor={`body-${a.id}`}>
          The email (first line is the subject). A short line to say no and the postal address are added under it.
        </label>
        <textarea id={`body-${a.id}`} name="body" defaultValue={a.body} rows={12} className={`${input} font-sans leading-relaxed`} />
        <div className="flex flex-wrap gap-2">
          <button name="action" value="send_email" className={`${btn} ${config.live ? "bg-emerald-600 hover:bg-emerald-500" : "bg-gray-700 hover:bg-gray-600"} text-white`}>
            {config.live ? (retry ? "Retry send" : `Send from ${config.mailbox}`) : "Dry run send (nothing goes out)"}
          </button>
          <button name="action" value="edit" className={`${btn} text-gray-300 hover:text-white hover:bg-gray-900`} disabled={a.status !== "pending"}>
            Save edit
          </button>
        </div>
      </form>
      <form method="post" action={SEND(a.id)}>
        <input type="hidden" name="tab" value="email" />
        <input type="hidden" name="reason" value="skipped on the Email page" />
        <button name="action" value="reject" className={`${btn} text-gray-400 hover:text-white hover:bg-gray-900`}>
          Skip this one
        </button>
      </form>
    </article>
  );
}

function LeadCard({ l }: { l: LeadRow }) {
  const subject = /^\s*subject:[ \t]*(.+)/i.exec(String(l.message ?? ""))?.[1] ?? "";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-gray-800 last:border-0">
      <div className="min-w-0">
        <p className="text-white text-sm font-medium break-words">{[l.name, l.company].filter(Boolean).join(", ") || l.email}</p>
        <p className="text-gray-400 text-xs break-words">
          {l.email} · {subject || "starter email around the detail from their site"}
        </p>
      </div>
      <form method="post" action={FORM}>
        <input type="hidden" name="action" value="draft_lead" />
        <input type="hidden" name="lead" value={l.id} />
        <button className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}>Review as email</button>
      </form>
    </li>
  );
}

function SentRow({ s, now, mailbox }: { s: EmailSend; now: number; mailbox: string }) {
  const due = followUpDue(s, new Date(now));
  const gmail = s.thread_id ? `https://mail.google.com/mail/u/${encodeURIComponent(mailbox)}/#all/${encodeURIComponent(s.thread_id)}` : null;
  return (
    <li className="py-3 border-b border-gray-800 last:border-0 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
        {s.reply_state === "replied" && <Badge tone="green">Replied</Badge>}
        {s.reply_state === "bounced" && <Badge tone="red">Bounced (address suppressed)</Badge>}
        {s.reply_state === "unsubscribed" && <Badge tone="gray">Asked to stop (never contacted again)</Badge>}
        {due && <Badge tone="amber">Follow up</Badge>}
        <span className="text-gray-500 text-xs">{when(s.sent_at ?? s.updated_at)}</span>
      </div>
      <p className="text-white text-sm break-all">
        {s.to_email} · {s.subject}
      </p>
      {s.error && <p className="text-red-200 text-xs">{scrub(s.error)}</p>}
      <div className="flex flex-wrap gap-2">
        {gmail && (
          <a href={gmail} target="_blank" rel="noopener noreferrer" className={`${btn} text-blue-300 hover:bg-gray-900`}>
            Open in Gmail ↗
          </a>
        )}
        {s.reply_state === "replied" && (
          <form method="post" action={FORM}>
            <input type="hidden" name="action" value="opt_out" />
            <input type="hidden" name="email" value={s.to_email} />
            <button className={`${btn} text-gray-300 hover:text-white hover:bg-gray-900`}>They said no: never contact again</button>
          </form>
        )}
      </div>
    </li>
  );
}

export default function EmailView(p: {
  config: Config;
  account: GmailAccount;
  tableReady: boolean;
  drafts: Approval[];
  leads: LeadRow[];
  sends: EmailSend[];
  byApproval: Record<string, EmailSend>;
  used: number;
  now: number;
  msg?: string;
  tone?: string;
  connect: { ok: boolean; text: string } | null;
}) {
  const sent = p.sends.filter((s) => s.status !== "simulated");
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-white text-xl font-bold">Email</h1>
        <Link href="/admin/crew" className="text-blue-300 text-sm hover:underline">
          Back to Agents
        </Link>
      </div>
      {p.msg && <p className={`rounded-lg px-3 py-2 text-sm ${p.tone === "err" ? "bg-red-500/10 text-red-200" : "bg-emerald-500/10 text-emerald-200"}`}>{p.msg}</p>}
      {p.connect && <p className={`rounded-lg px-3 py-2 text-sm ${p.connect.ok ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"}`}>{p.connect.ok ? `Connected: ${p.connect.text.replace(/^google_gmail:/, "")}` : p.connect.text.replace(/^google_gmail:\s*/, "")}</p>}

      <Setup config={p.config} account={p.account} tableReady={p.tableReady} used={p.used} />

      <section className="space-y-3" aria-labelledby="email-waiting">
        <h2 id="email-waiting" className="text-white font-semibold">
          Waiting for you ({p.drafts.length})
        </h2>
        {p.drafts.length === 0 ? <p className="text-gray-400 text-sm">No email drafts right now. Office drafts arrive here, and any Web Lead below can become one.</p> : p.drafts.map((a) => <DraftCard key={a.id} a={a} send={p.byApproval[a.id]} config={p.config} />)}
      </section>

      <section className={`${card} space-y-2`} aria-labelledby="email-leads">
        <h2 id="email-leads" className="text-white font-semibold">
          Web Leads ready to email ({p.leads.length})
        </h2>
        <p className="text-gray-400 text-xs">Review as email makes a draft you can read and edit. Nothing is sent until you press Send on it.</p>
        {p.leads.length === 0 ? <p className="text-gray-400 text-sm">None right now.</p> : <ul>{p.leads.map((l) => <LeadCard key={l.id} l={l} />)}</ul>}
      </section>

      <section className={`${card} space-y-2`} aria-labelledby="email-sent">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="email-sent" className="text-white font-semibold">
            Sent ({sent.length})
          </h2>
          <form method="post" action={FORM}>
            <input type="hidden" name="action" value="check_replies" />
            <button className={`${btn} text-gray-300 hover:text-white hover:bg-gray-900`}>Check replies</button>
          </form>
        </div>
        <p className="text-gray-400 text-xs">Replies, bounces and &quot;unsubscribe&quot; emails are read from headers only, each time this page opens and when you press Check replies. Answer replies in Gmail. If someone says no in a reply, press &quot;They said no&quot;. Follow up shows after 4 days with no reply.</p>
        {sent.length === 0 ? <p className="text-gray-400 text-sm">Nothing sent yet.</p> : <ul>{sent.map((s) => <SentRow key={s.id} s={s} now={p.now} mailbox={p.config.mailbox} />)}</ul>}
      </section>
    </main>
  );
}
