import { getAdminSupabase } from "./supabase-admin";
import {
  getCrmConnection,
  resolveCrmOwnerId,
  setSyncError,
  markSynced,
  RefreshUnavailableError,
  connectionErrorMessage,
  type CrmLead,
  type CrmProvider,
  type CrmProviderKey,
  type CrmSyncOptions,
  type PushResult,
} from "./crm-connection";
import { newCrmBudget } from "./crm-http";
import { enqueueCrmRetry, waitsForReconnect } from "./crm-outbox";
import { reportError } from "./report-error";

// ── One contact, one CRM, start to finish ────────────────────────────────────
//
// Every provider's push only talks to its CRM. Everything around that — whose
// connection it is, whether this card is in scope, refreshing a token, what to
// remember and what to tell the user — happens here, identically for all five,
// so the Settings banner, "Last contact sent", the remembered record and the
// retry queue can never behave differently from one CRM to the next.

export type SyncOutcome =
  /** Nothing to do: not connected, card out of scope, or an Office card rule. */
  | { status: "skipped"; provider: CrmProviderKey }
  | { status: "sent"; provider: CrmProviderKey; action: "created" | "updated" | "logged"; recordUrl?: string }
  | { status: "failed"; provider: CrmProviderKey; status_code: number | null; retryable: boolean; queued: boolean; message: string };

/** The record this lead was written to in this destination, if we kept it. */
export async function readCrmLink(leadId: string, provider: CrmProviderKey, ownerId: string): Promise<{ id: string; kind: string | null } | null> {
  try {
    const { data } = await getAdminSupabase()
      .from("crm_links")
      .select("record_id, record_kind")
      .eq("lead_id", leadId)
      .eq("provider", provider)
      .eq("owner_id", ownerId)
      .maybeSingle();
    return data?.record_id ? { id: data.record_id as string, kind: (data.record_kind as string | null) ?? null } : null;
  } catch {
    return null; // table not migrated yet — providers fall back to searching
  }
}

async function saveCrmLink(leadId: string, provider: CrmProviderKey, ownerId: string, recordId: string, kind: string | undefined): Promise<void> {
  try {
    await getAdminSupabase().from("crm_links").upsert(
      { lead_id: leadId, provider, owner_id: ownerId, record_id: recordId, record_kind: kind ?? null, updated_at: new Date().toISOString() },
      { onConflict: "lead_id,provider,owner_id" },
    );
  } catch { /* a missing link only costs a search next time */ }
}

export async function runCrmSync(
  provider: CrmProvider,
  lead: CrmLead,
  capturedBy: string,
  opts: CrmSyncOptions = {},
): Promise<SyncOutcome> {
  const key = provider.key;
  const budget = newCrmBudget();
  // The Settings test always uses the presser's OWN connection.
  const ownerId = opts.test ? capturedBy : await resolveCrmOwnerId(key, capturedBy);

  const failed = (r: Extract<PushResult, { ok: false }>, queued: boolean): SyncOutcome => ({
    status: "failed", provider: key, status_code: r.status, retryable: r.retryable, queued, message: r.message,
  });

  let conn;
  try {
    conn = await getCrmConnection(key, provider.label, ownerId, lead.capturedByCardId, capturedBy, provider.refresh?.(), { skipScope: opts.test });
  } catch (e) {
    if (!(e instanceof RefreshUnavailableError)) throw e;
    const r = { ok: false as const, status: null, retryable: true, message: connectionErrorMessage(provider.label, null) };
    return failed(r, await queueIfPossible(key, lead, capturedBy, ownerId, opts, r));
  }
  if (!conn) return { status: "skipped", provider: key };

  const knownRecord = lead.leadId ? await readCrmLink(lead.leadId, key, ownerId) : null;

  let result: PushResult;
  try {
    result = await provider.push(conn, lead, { ...opts, budget, knownRecord });
    // A 401 on an OAuth connection is very often just an access token that
    // died before the expiry we assumed (Salesforce never says how long they
    // live). One forced refresh, one more try — before anyone is told to
    // reconnect something that still works.
    if (!result.ok && result.status === 401 && provider.refresh) {
      let refreshDown = false;
      const fresh = await getCrmConnection(key, provider.label, ownerId, lead.capturedByCardId, capturedBy, provider.refresh(), { skipScope: true, forceRefresh: true })
        .catch((e) => { refreshDown = e instanceof RefreshUnavailableError; return null; });
      if (fresh) {
        conn = fresh;
        result = await provider.push(fresh, lead, { ...opts, budget, knownRecord });
      } else if (refreshDown) {
        // The token couldn't be renewed HERE — the sign-in server was down, or
        // this deployment has no client secret (audit I-04). Not the user's
        // connection: queued, no "reconnect" banner.
        result = { ok: false, status: null, retryable: true, message: connectionErrorMessage(provider.label, null) };
      }
    }
  } catch (e) {
    // A bug in a provider, not a CRM answer. Reported so we hear about it, and
    // the contact is queued so it isn't lost to our own mistake.
    await reportError(`crm.${key}`, e).catch(() => {});
    result = { ok: false, status: null, retryable: true, message: connectionErrorMessage(provider.label, null) };
  }

  if (result.ok) {
    await Promise.all([
      conn.syncError ? setSyncError(key, ownerId, null) : null,
      markSynced(key, ownerId),
      lead.leadId && result.recordId ? saveCrmLink(lead.leadId, key, ownerId, result.recordId, result.recordKind) : null,
    ]);
    return { status: "sent", provider: key, action: result.action, recordUrl: result.recordUrl };
  }

  console.warn(`[crm:${key}] send failed:`, result.status, result.message);
  if (result.retryable) {
    // A busy or unreachable CRM is not the user's problem to fix, so no
    // banner — the contact waits in the queue and Settings says how many are
    // waiting. Only a contact that CAN'T be queued (no lead id) gets the banner.
    const queued = await queueIfPossible(key, lead, capturedBy, ownerId, opts, result);
    return failed(result, queued);
  }
  await setSyncError(key, ownerId, result.message);
  // Refused SwiftCard itself (401/403): only reconnecting fixes that, and the
  // banner says so — but the contact keeps its place for when they do, and is
  // sent the moment they reconnect (audit I-02). It used to be lost.
  if (waitsForReconnect(result.status) && lead.leadId && !opts.test && !opts.fromOutbox) {
    const queued = await enqueueCrmRetry({ leadId: lead.leadId, provider: key, capturedBy, ownerId, mode: opts.mode ?? "capture", error: result.message });
    return failed(result, queued);
  }
  return failed(result, false);
}

async function queueIfPossible(
  key: CrmProviderKey,
  lead: CrmLead,
  capturedBy: string,
  ownerId: string,
  opts: CrmSyncOptions,
  result: Extract<PushResult, { ok: false }>,
): Promise<boolean> {
  if (opts.test || opts.fromOutbox) return false;
  if (lead.leadId) {
    const queued = await enqueueCrmRetry({
      leadId: lead.leadId,
      provider: key,
      capturedBy,
      ownerId,
      mode: opts.mode ?? "capture",
      error: result.message,
    });
    if (queued) return true;
  }
  await setSyncError(key, ownerId, result.message);
  return false;
}
