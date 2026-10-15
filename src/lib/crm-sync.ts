import { getAdminSupabase } from "./supabase-admin";
import { isZapierWebhookUrl } from "./safe-fetch";
import { isCardInScope, parseCardScope } from "./crm-scope";
import { resolveOfficeContext } from "./office-roles";
import { googleProvider } from "./sync-google";
import { hubspotProvider } from "./sync-hubspot";
import { pipedriveProvider } from "./sync-pipedrive";
import { highlevelProvider } from "./sync-highlevel";
import { salesforceProvider } from "./sync-salesforce";
import type { CrmLead, CrmProvider, CrmProviderKey, CrmSyncOptions } from "./crm-connection";
import { runCrmSync, type SyncOutcome } from "./crm-run";
import { enqueueCrmRetry } from "./crm-outbox";
import { isRetryableStatus } from "./crm-http";
import { reportError } from "./report-error";
import { isPaidProfile, PLAN_COLUMNS } from "./effective-plan";

// ── One way out to every CRM destination ─────────────────────────────────────
//
// Contacts are created in three places — the public share form, "Add contact"
// (typed in, or read off a scanned paper business card), and edits — and each
// used to decide for itself which destinations it fed. Only the share form fed
// any: a business card scanned at a trade show, the single most CRM-bound
// contact there is, never reached the CRM at all. Every path now calls these
// two functions, so a destination added here reaches all of them at once.
//
// Both are best-effort by contract and never throw: the contact is already
// saved in SwiftCard before either runs, and a CRM being down must never turn
// into "something went wrong" for the person who just shared their details.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

/** How long a CRM webhook may hold a view or lead request open. */
export const CRM_WEBHOOK_TIMEOUT_MS = 5000;

/** Every native CRM, in the order Settings lists them. */
export const CRM_PROVIDERS: Record<CrmProviderKey, CrmProvider> = {
  salesforce: salesforceProvider,
  highlevel: highlevelProvider,
  pipedrive: pipedriveProvider,
  hubspot: hubspotProvider,
  google: googleProvider,
};

/**
 * Send one contact to every connected CRM. Each provider resolves its own
 * destination (an Office sub-user inherits the owner's), applies its own card
 * scope and reports its own failures to Settings — this only fans out.
 * allSettled, not all: one provider being down must not cancel the others.
 */
export async function syncLeadToAllCrms(lead: CrmLead, capturedBy: string, opts?: CrmSyncOptions): Promise<SyncOutcome[]> {
  // THE PLAN IS CHECKED HERE TOO (2026-10-06). Every caller already re-checks
  // it at send time, but a native CRM token survives a downgrade and a lead
  // carries its location ("Met: … · Austin, TX"). One forgotten check in a
  // future caller would keep streaming a Free account's contacts — places
  // included — into a Pro-only destination. Same rule as Zapier, which has
  // always checked inside resolveZapierTarget. Unknown plan → don't send.
  try {
    const { data } = await getAdminSupabase().from("profiles").select(PLAN_COLUMNS).eq("id", capturedBy).maybeSingle();
    if (!isPaidProfile(data)) return [];
  } catch {
    return [];
  }
  const settled = await Promise.allSettled(
    Object.values(CRM_PROVIDERS).map((p) =>
      runCrmSync(p, lead, capturedBy, opts).catch((e) => {
        console.error(`[crm-sync] ${p.label} sync error:`, e);
        throw e;
      }),
    ),
  );
  return settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
}

export type ZapierTarget = {
  url: string;
  /** The per-event switches of whoever OWNS the webhook (views, notifications). */
  prefs: { notifications?: boolean; views?: boolean };
  /** True when this is the office owner's webhook serving a sub-user. */
  inherited: boolean;
  /** Whose webhook it is — where a delivery failure is reported. */
  ownerId: string;
  /** The failure line Settings is showing right now, so a success can clear it. */
  error: string | null;
};

type ZapierProfile = {
  id: string;
  zapier_webhook_url: string | null;
  zapier_card_ids: unknown;
  zapier_error?: string | null;
  customization: unknown;
  plan: string | null;
  plan_expires_at?: string | null;
  stripe_subscription_id?: string | null;
};
const ZAPIER_COLS = `id, zapier_webhook_url, zapier_card_ids, ${PLAN_COLUMNS}`;

function prefsOf(p: ZapierProfile): ZapierTarget["prefs"] {
  return ((p.customization as { crm?: ZapierTarget["prefs"] } | null)?.crm) ?? {};
}

/** The stored Zapier failure line — read separately so a database without the column still sends. */
async function zapierErrorOf(userId: string): Promise<string | null> {
  try {
    const { data } = await getAdminSupabase().from("profiles").select("zapier_error").eq("id", userId).maybeSingle();
    return ((data as { zapier_error?: string | null } | null)?.zapier_error) ?? null;
  } catch {
    return null;
  }
}

/**
 * Where this user's Zapier events go, or null for nowhere.
 *
 * Same rule as the native CRMs (resolveCrmOwnerId), for the same reason — an
 * Office is one business. An agency whose CRM is only reachable through Zapier
 * (Follow Up Boss, kvCORE, a Google Sheet…) set its webhook up once, and every
 * agent's leads have to arrive there too.
 *
 *   1. The user's OWN webhook, if they saved one — even if it is currently
 *      unusable (lapsed plan, out of scope). Presence wins, exactly like a
 *      broken own CRM connection: never quietly reroute someone's contacts.
 *   2. Otherwise, for an Office SUB-USER, the owner's webhook — while the owner
 *      is still on a paid plan, and only for the member's COMPANY card. The
 *      owner's card scope is not applied: it only lists the owner's own cards.
 *   3. Otherwise nowhere.
 *
 * Paid means paid NOW (isPaidProfile): an expired timed grant is Free even
 * before the daily job rewrites the plan column — the rule the native CRMs
 * already used, which Zapier didn't, so an expired grant kept firing Zaps.
 *
 * Every URL is re-checked against the Zapier allowlist here, at send time: a
 * URL stored before validation existed must never receive lead PII.
 */
export async function resolveZapierTarget(userId: string, cardId: string | null | undefined): Promise<ZapierTarget | null> {
  const admin = getAdminSupabase();
  const { data: own } = await admin.from("profiles").select(ZAPIER_COLS).eq("id", userId).maybeSingle<ZapierProfile>();
  if (!own || !isPaidProfile(own)) return null;

  if (own.zapier_webhook_url) {
    if (!isZapierWebhookUrl(own.zapier_webhook_url)) return null;
    if (!isCardInScope(parseCardScope(own.zapier_card_ids), cardId ?? null)) return null;
    return { url: own.zapier_webhook_url, prefs: prefsOf(own), inherited: false, ownerId: userId, error: await zapierErrorOf(userId) };
  }

  const ctx = await resolveOfficeContext(userId);
  if (!ctx || ctx.isOwner || !ctx.ownerId) return null;
  const { data: owner } = await admin.from("profiles").select(ZAPIER_COLS).eq("id", ctx.ownerId).maybeSingle<ZapierProfile>();
  if (!owner?.zapier_webhook_url || !isPaidProfile(owner) || !isZapierWebhookUrl(owner.zapier_webhook_url)) return null;
  // The agency's webhook hears about the member's company card only — see
  // getCrmConnection for why a member's own pre-existing cards are theirs.
  if (!cardId) return null;
  const { data: card } = await admin.from("cards").select("is_office_card").eq("id", cardId).maybeSingle();
  if (!(card as { is_office_card?: boolean } | null)?.is_office_card) return null;
  return { url: owner.zapier_webhook_url, prefs: prefsOf(owner), inherited: true, ownerId: ctx.ownerId, error: await zapierErrorOf(ctx.ownerId) };
}

/** The lead.created payload. One builder, so the real send, the manual add
 *  and Settings' "Test" button can never disagree about which fields exist —
 *  a Zap is built from the TEST payload, and a field missing there can't be
 *  mapped. */
export function zapierLeadPayload(lead: CrmLead & { created_at?: string; test?: boolean }): Record<string, unknown> {
  return {
    type: "lead.created",
    // Stable ids, so a Zap can update the row it created instead of matching
    // on an email that may change (or not exist).
    lead_id: lead.leadId ?? null,
    card_id: lead.capturedByCardId ?? null,
    name: lead.name,
    email: lead.email || null,
    phone: lead.phone || null,
    company: lead.company || null,
    message: lead.message || null,
    notes: lead.notes || null,
    where_met: lead.whereMet || null,
    location: lead.location || null,
    source: lead.source || null,
    card_owner: lead.capturedByCard || null,
    // Which card, by the name on it — in an Office, the rep who met them.
    card_name: lead.capturedByName || null,
    card_url: lead.capturedByCard ? `${APP_URL}/${lead.capturedByCard}` : null,
    tags: lead.tags?.length ? lead.tags : null,
    created_at: lead.created_at ?? new Date().toISOString(),
    ...(lead.test ? { _test: true } : {}),
  };
}

/**
 * What Zapier's answer means, in words for Settings. A Catch Hook answers 200
 * when it's on; a Zap that was turned off or deleted answers 410 (or 404) to
 * every request until someone turns it back on — the failure that used to
 * look exactly like success.
 */
export function zapierStatusMessage(status: number | null): { ok: boolean; retryable: boolean; message: string | null } {
  if (status !== null && status >= 200 && status < 300) return { ok: true, retryable: false, message: null };
  if (status === 410 || status === 404) {
    return { ok: false, retryable: false, message: "Zapier says this Zap is turned off or was deleted — turn it on in Zapier, or paste the new webhook URL." };
  }
  if (isRetryableStatus(status)) {
    return { ok: false, retryable: true, message: status === null ? "Zapier didn't answer — SwiftCard will try again." : `Zapier was busy (${status}) — SwiftCard will try again.` };
  }
  return { ok: false, retryable: false, message: `Zapier didn't accept the last contact (${status}). Check the Zap's webhook step.` };
}

/** Record how the last delivery went — only writing when something changed. */
async function recordZapier(target: ZapierTarget, outcome: { ok: boolean; message: string | null }, stampSent: boolean): Promise<void> {
  try {
    const patch: Record<string, unknown> = {};
    if (outcome.ok && target.error) patch.zapier_error = null;
    if (!outcome.ok && outcome.message && outcome.message !== target.error) patch.zapier_error = outcome.message;
    if (outcome.ok && stampSent) patch.zapier_last_sent_at = new Date().toISOString();
    if (Object.keys(patch).length) await getAdminSupabase().from("profiles").update(patch).eq("id", target.ownerId);
  } catch { /* display-only columns */ }
}

export type ZapierOutcome =
  | { status: "skipped" }
  | { status: "sent" }
  | { status: "failed"; retryable: boolean; queued: boolean; message: string };

/** Fire lead.created at this user's Zapier destination, if they have one. */
export async function sendLeadToZapier(lead: CrmLead, capturedBy: string, opts: { fromOutbox?: boolean } = {}): Promise<ZapierOutcome> {
  try {
    const target = await resolveZapierTarget(capturedBy, lead.capturedByCardId);
    if (!target) return { status: "skipped" };
    let status: number | null = null;
    try {
      const res = await fetch(target.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(zapierLeadPayload(lead)),
        // Bounded: after() keeps the function alive until this settles, so an
        // unanswering webhook would otherwise pin the instance on every lead.
        signal: AbortSignal.timeout(CRM_WEBHOOK_TIMEOUT_MS),
      });
      status = res.status;
      await res.body?.cancel().catch(() => {});
    } catch { /* no answer — status stays null */ }

    const outcome = zapierStatusMessage(status);
    if (outcome.ok) {
      await recordZapier(target, outcome, true);
      return { status: "sent" };
    }
    console.warn("[crm-sync] Zapier webhook answered", status);
    let queued = false;
    if (outcome.retryable && !opts.fromOutbox && lead.leadId) {
      queued = await enqueueCrmRetry({ leadId: lead.leadId, provider: "zapier", capturedBy, ownerId: target.ownerId, mode: "capture", error: outcome.message ?? "" });
    }
    // A queued blip is not worth a red line in Settings; anything else is.
    if (!queued) await recordZapier(target, outcome, false);
    return { status: "failed", retryable: outcome.retryable, queued, message: outcome.message ?? "" };
  } catch (e) {
    await reportError("crm.zapier", e).catch(() => {});
    return { status: "failed", retryable: true, queued: false, message: "Zapier send failed." };
  }
}

/**
 * Record a Zapier EVENT delivery (views, notifications). Events aren't queued
 * — a card view replayed a day late is noise — but a Zap that's switched off
 * fails these too, and Settings should say so the first time it happens.
 */
export async function recordZapierEventDelivery(target: ZapierTarget, status: number | null): Promise<void> {
  const outcome = zapierStatusMessage(status);
  // A busy blip on a view isn't worth a red line; a dead Zap is.
  if (!outcome.ok && outcome.retryable) return;
  await recordZapier(target, outcome, false);
}
