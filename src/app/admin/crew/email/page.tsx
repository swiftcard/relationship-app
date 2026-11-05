import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { LiveGmail } from "@/lib/crew/email/gmail";
import { checkReplies, emailConfig, emailDrafts, readyLeads } from "@/lib/crew/email/outbox";
import { SupabaseEmailSends } from "@/lib/crew/email/sends-supabase";
import { gmailClient } from "@/lib/crew/env";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import EmailView from "./EmailView";

export const metadata = { title: "Email — SwiftCard Admin" };
export const dynamic = "force-dynamic";

/** The request time, read once (a server page renders once per request). */
function clock(): number {
  return Date.now();
}

// Admin → Agents → Email (2026-11-04): read each prepared email, edit it,
// Send it from the SwiftCard mailbox, and see what came back.
export default async function EmailPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const store = new SupabaseStore();
  const sends = new SupabaseEmailSends();
  const config = emailConfig();
  const now = clock();
  const gmail = new LiveGmail();
  const [tableReady, account] = await Promise.all([sends.ready(), gmail.account()]);
  // Replies, bounces and unsubscribes are picked up whenever this page opens
  // (headers only, each sent thread at most every 30 minutes), so an opt-out
  // never waits for a button. A Gmail hiccup changes nothing and the page still loads.
  if (tableReady && account.ok && account.email === config.mailbox) await checkReplies(store, sends, gmail, config.mailbox, new Date(now), 10).catch(() => null);
  const drafts = await emailDrafts(store);
  const [leads, recent, used] = await Promise.all([
    readyLeads(store, drafts),
    tableReady ? sends.list(60) : Promise.resolve([]),
    tableReady ? sends.countSince(new Date(now - 86_400_000).toISOString()) : Promise.resolve(0),
  ]);
  const byApproval = Object.fromEntries(recent.map((s) => [s.approval_id, s]));
  return (
    <EmailView
      config={{ live: config.live, mailbox: config.mailbox, dailyCap: config.dailyCap, postal: !!config.postalAddress, app: !!(gmailClient().id && gmailClient().secret) }}
      account={account}
      tableReady={tableReady}
      drafts={drafts}
      leads={leads}
      sends={recent}
      byApproval={byApproval}
      used={used}
      now={now}
      msg={sp.msg?.slice(0, 300)}
      tone={sp.tone}
      connect={(sp.connected ?? sp.connect_error) ? { ok: !!sp.connected, text: (sp.connected ?? sp.connect_error ?? "").slice(0, 200) } : null}
    />
  );
}
