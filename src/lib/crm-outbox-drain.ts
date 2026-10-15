import { getAdminSupabase } from "./supabase-admin";
import { CRM_PROVIDERS, sendLeadToZapier } from "./crm-sync";
import { runCrmSync } from "./crm-run";
import { setSyncError, type CrmProviderKey } from "./crm-connection";
import { loadCrmLead } from "./crm-lead";
import { isPaidProfile, PLAN_COLUMNS } from "./effective-plan";
import type { OutboxProvider } from "./crm-outbox";

// ── The daily catch-up ───────────────────────────────────────────────────────
//
// Runs from /api/reminders (the daily cron). Each queued contact is re-read
// from the database — so it goes as it is NOW, edits included — and sent
// through exactly the code a new capture uses. Delivered, skipped (the
// connection was removed, the plan lapsed, the lead was deleted) or refused
// for good: the row goes. Still busy or down: it waits for tomorrow, for up to
// GIVE_UP_AFTER_MS, after which the connection's Settings line says how many
// contacts could not be delivered, so nobody assumes they arrived.

const GIVE_UP_AFTER_MS = 5 * 24 * 60 * 60 * 1000;
const NEXT_TRY_MS = 20 * 60 * 60 * 1000;
const BATCH = 300;

const LABELS: Record<OutboxProvider, string> = {
  google: "Google Contacts",
  hubspot: "HubSpot",
  pipedrive: "Pipedrive",
  highlevel: "HighLevel",
  salesforce: "Salesforce",
  zapier: "Zapier",
};

type Row = { id: string; lead_id: string; provider: OutboxProvider; user_id: string; owner_id: string; mode: string; attempts: number | null; created_at: string };

export type DrainResult = { tried: number; sent: number; dropped: number; waiting: number; gaveUp: number };

export async function drainCrmOutbox(opts: { deadlineMs?: number; ownerId?: string } = {}): Promise<DrainResult> {
  const result: DrainResult = { tried: 0, sent: 0, dropped: 0, waiting: 0, gaveUp: 0 };
  const deadline = Date.now() + (opts.deadlineMs ?? 120_000);
  const admin = getAdminSupabase();

  let q = admin
    .from("crm_sync_outbox")
    .select("id, lead_id, provider, user_id, owner_id, mode, attempts, created_at")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (opts.ownerId) q = q.eq("owner_id", opts.ownerId);
  const { data, error } = await q;
  if (error || !data) return result; // table not migrated yet

  const gaveUpBy = new Map<string, number>(); // `${owner}|${provider}` → count

  for (const row of data as Row[]) {
    if (Date.now() > deadline) break;
    result.tried++;
    const drop = () => admin.from("crm_sync_outbox").delete().eq("id", row.id);

    const loaded = await loadCrmLead(row.lead_id).catch(() => null);
    if (!loaded) {
      await drop();
      result.dropped++;
      continue;
    }

    let delivered = false;
    let retryable = false;
    if (row.provider === "zapier") {
      const out = await sendLeadToZapier(loaded.lead, loaded.capturedBy, { fromOutbox: true });
      delivered = out.status === "sent" || out.status === "skipped";
      retryable = out.status === "failed" && out.retryable;
    } else {
      const provider = CRM_PROVIDERS[row.provider as CrmProviderKey];
      if (!provider) {
        await drop();
        result.dropped++;
        continue;
      }
      // The plan is checked at send time like every other send — a lapsed
      // account's queued contacts don't go out after the fact.
      const { data: plan } = await admin.from("profiles").select(PLAN_COLUMNS).eq("id", loaded.capturedBy).maybeSingle();
      if (!isPaidProfile(plan)) {
        await drop();
        result.dropped++;
        continue;
      }
      const out = await runCrmSync(provider, loaded.lead, loaded.capturedBy, { mode: row.mode === "update" ? "update" : "capture", fromOutbox: true });
      delivered = out.status === "sent" || out.status === "skipped";
      retryable = out.status === "failed" && out.retryable;
    }

    if (delivered) {
      await drop();
      result.sent++;
    } else if (retryable && Date.now() - new Date(row.created_at).getTime() < GIVE_UP_AFTER_MS) {
      await admin
        .from("crm_sync_outbox")
        .update({ attempts: (row.attempts ?? 0) + 1, next_attempt_at: new Date(Date.now() + NEXT_TRY_MS).toISOString() })
        .eq("id", row.id);
      result.waiting++;
    } else {
      // Refused for good (the banner is already set by the send), or five
      // days of trying. Either way the row goes; the second needs saying.
      await drop();
      if (retryable) {
        result.gaveUp++;
        const k = `${row.owner_id}|${row.provider}`;
        gaveUpBy.set(k, (gaveUpBy.get(k) ?? 0) + 1);
      } else {
        result.dropped++;
      }
    }
  }

  for (const [k, n] of gaveUpBy) {
    const [owner, provider] = k.split("|") as [string, OutboxProvider];
    const label = LABELS[provider];
    const msg = `${n} contact${n === 1 ? "" : "s"} couldn't be sent to ${label} after 5 days of trying — ${label} kept refusing or wasn't answering. They're still in SwiftCard; export them from Contacts if you need them there.`;
    if (provider === "zapier") {
      await admin.from("profiles").update({ zapier_error: msg }).eq("id", owner).then(() => {}, () => {});
    } else {
      await setSyncError(provider, owner, msg).catch(() => {});
    }
  }

  return result;
}
