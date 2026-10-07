import { getAdminSupabase } from "./supabase-admin";
import { isPaidPlan } from "./plan";
import { isZapierWebhookUrl } from "./safe-fetch";
import { isCardInScope, parseCardScope } from "./crm-scope";
import { resolveOfficeContext } from "./office-roles";
import { syncLeadToGoogle } from "./sync-google";
import { syncLeadToHubSpot } from "./sync-hubspot";
import { syncLeadToPipedrive } from "./sync-pipedrive";
import { syncLeadToHighLevel } from "./sync-highlevel";
import { syncLeadToSalesforce } from "./sync-salesforce";
import type { CrmLead, CrmSyncOptions } from "./crm-connection";
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

/**
 * Send one contact to every connected CRM. Each provider resolves its own
 * destination (an Office sub-user inherits the owner's), applies its own card
 * scope and reports its own failures to Settings — this only fans out.
 * allSettled, not all: one provider being down must not cancel the others.
 */
export async function syncLeadToAllCrms(lead: CrmLead, capturedBy: string, opts?: CrmSyncOptions): Promise<void> {
  // THE PLAN IS CHECKED HERE TOO (2026-10-06). Every caller already re-checks
  // it at send time, but a native CRM token survives a downgrade and a lead
  // carries its location ("Met: … · Austin, TX"). One forgotten check in a
  // future caller would keep streaming a Free account's contacts — places
  // included — into a Pro-only destination. Same rule as Zapier, which has
  // always checked inside resolveZapierTarget. Unknown plan → don't send.
  try {
    const { data } = await getAdminSupabase().from("profiles").select(PLAN_COLUMNS).eq("id", capturedBy).maybeSingle();
    if (!isPaidProfile(data)) return;
  } catch {
    return;
  }
  const run = (label: string, p: Promise<void>) => p.catch((e) => console.error(`[crm-sync] ${label} sync error:`, e));
  await Promise.allSettled([
    run("Google", syncLeadToGoogle(lead, capturedBy, opts)),
    run("HubSpot", syncLeadToHubSpot(lead, capturedBy, opts)),
    run("Pipedrive", syncLeadToPipedrive(lead, capturedBy, opts)),
    run("HighLevel", syncLeadToHighLevel(lead, capturedBy, opts)),
    run("Salesforce", syncLeadToSalesforce(lead, capturedBy, opts)),
  ]);
}

export type ZapierTarget = {
  url: string;
  /** The per-event switches of whoever OWNS the webhook (views, notifications). */
  prefs: { notifications?: boolean; views?: boolean };
  /** True when this is the office owner's webhook serving a sub-user. */
  inherited: boolean;
};

type ZapierProfile = { zapier_webhook_url: string | null; zapier_card_ids: unknown; customization: unknown; plan: string | null };
const ZAPIER_COLS = "zapier_webhook_url, zapier_card_ids, customization, plan";

function prefsOf(p: ZapierProfile): ZapierTarget["prefs"] {
  return ((p.customization as { crm?: ZapierTarget["prefs"] } | null)?.crm) ?? {};
}

/**
 * Where this user's Zapier events go, or null for nowhere.
 *
 * Same rule as the native CRMs (resolveCrmOwnerId), for the same reason — an
 * Office is one business. An agency whose CRM is only reachable through Zapier
 * (Follow Up Boss, kvCORE, a Google Sheet…) set its webhook up once, and every
 * agent's leads have to arrive there too. Before this only the owner's own
 * cards ever reached it.
 *
 *   1. The user's OWN webhook, if they saved one — even if it is currently
 *      unusable (lapsed plan, out of scope). Presence wins, exactly like a
 *      broken own CRM connection: never quietly reroute someone's contacts.
 *   2. Otherwise, for an Office SUB-USER, the owner's webhook — while the owner
 *      is still on a paid plan. The owner's card scope is not applied: it only
 *      lists the owner's own cards, so no team card could ever be in it.
 *   3. Otherwise nowhere.
 *
 * Every URL is re-checked against the Zapier allowlist here, at send time: a
 * URL stored before validation existed must never receive lead PII.
 */
export async function resolveZapierTarget(userId: string, cardId: string | null | undefined): Promise<ZapierTarget | null> {
  const admin = getAdminSupabase();
  const { data: own } = await admin.from("profiles").select(ZAPIER_COLS).eq("id", userId).maybeSingle<ZapierProfile>();
  if (!own || !isPaidPlan(own.plan)) return null;

  if (own.zapier_webhook_url) {
    if (!isZapierWebhookUrl(own.zapier_webhook_url)) return null;
    if (!isCardInScope(parseCardScope(own.zapier_card_ids), cardId ?? null)) return null;
    return { url: own.zapier_webhook_url, prefs: prefsOf(own), inherited: false };
  }

  const ctx = await resolveOfficeContext(userId);
  if (!ctx || ctx.isOwner || !ctx.ownerId) return null;
  const { data: owner } = await admin.from("profiles").select(ZAPIER_COLS).eq("id", ctx.ownerId).maybeSingle<ZapierProfile>();
  if (!owner?.zapier_webhook_url || !isPaidPlan(owner.plan) || !isZapierWebhookUrl(owner.zapier_webhook_url)) return null;
  return { url: owner.zapier_webhook_url, prefs: prefsOf(owner), inherited: true };
}

/** The lead.created payload. One builder, so the real send, the manual add
 *  and Settings' "Test" button can never disagree about which fields exist —
 *  a Zap is built from the TEST payload, and a field missing there can't be
 *  mapped. */
export function zapierLeadPayload(lead: CrmLead & { created_at?: string; test?: boolean }): Record<string, unknown> {
  return {
    type: "lead.created",
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

/** Fire lead.created at this user's Zapier destination, if they have one. */
export async function sendLeadToZapier(lead: CrmLead, capturedBy: string): Promise<void> {
  try {
    const target = await resolveZapierTarget(capturedBy, lead.capturedByCardId);
    if (!target) return;
    const res = await fetch(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(zapierLeadPayload(lead)),
      // Bounded: after() keeps the function alive until this settles, so an
      // unanswering webhook would otherwise pin the instance on every lead.
      signal: AbortSignal.timeout(CRM_WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) console.warn("[crm-sync] Zapier webhook answered", res.status);
  } catch (e) {
    await reportError("crm.zapier", e).catch(() => {});
  }
}
