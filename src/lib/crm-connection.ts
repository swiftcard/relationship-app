import { getAdminSupabase } from "./supabase-admin";
import { encryptToken, decryptToken } from "./token-crypto";
import { resolveOfficeContext } from "./office-roles";
import { isCardInScope, parseCardScope } from "./crm-scope";
import { isPaidProfile, PLAN_COLUMNS } from "./effective-plan";
import { crmFetch, isRetryableStatus, type CrmBudget } from "./crm-http";

// ── Shared plumbing for every CRM connection ─────────────────────────────────
//
// Fetching the stored token, refreshing it before expiry, and reporting a dead
// connection is identical for every provider — only the token URL, the env var
// names and the label in the message differ. sync-google and sync-hubspot each
// carried their own copy, which is how a fix landed in one and not the other:
// the "surface API failures, not just refresh failures" change had to be made
// twice, by hand, in files that were already near-duplicates. A third and
// fourth provider would have made that four copies.
//
// What stays per-provider is the part that genuinely differs: the endpoint, the
// field mapping, and how each API signals a duplicate. That belongs in
// sync-<provider>.ts, not here.

export type CrmProviderKey = "google" | "hubspot" | "pipedrive" | "highlevel" | "salesforce";

// Providers whose token never expires (Pipedrive personal API tokens, HighLevel
// Private Integration tokens) simply omit this — expires_at is null for them, so
// the refresh branch never runs.
export type RefreshConfig = {
  tokenUrl: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
};

/**
 * A captured lead, with the context that makes it worth more than a name.
 *
 * The first four fields are all Google and HubSpot ever sent. Everything below
 * them is what SwiftCard uniquely knows — where the meeting happened, how the
 * card was tapped, which card (so which rep) captured it — and is the whole
 * reason a native integration beats a generic Zapier hop. Providers that can't
 * express a field simply ignore it.
 */
export type CrmLead = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  whereMet?: string | null;
  location?: string | null;
  /** Human-readable capture channel, e.g. "QR code" — already run through getSourceLabel. */
  source?: string | null;
  notes?: string | null;
  message?: string | null;
  /** Card slug that captured it. In an Office this identifies the rep. */
  capturedByCard?: string | null;
  /**
   * The name on the capturing card — the rep, in an Office. A slug alone
   * ("swiftcard.me/jsmith-2") makes a sales manager open a link to learn who
   * met this person; the name answers it on the record itself.
   */
  capturedByName?: string | null;
  /** The contact's tags at sync time — CRM-visible segmentation. */
  tags?: string[] | null;
  /**
   * cards.id of the capturing card — the key per-card CRM scoping is checked
   * against. Separate from capturedByCard because that one is the SLUG, which
   * the owner can rename at will; an id can't drift out from under a scope.
   * Undefined only for a legacy profile-card with no cards row, which
   * isCardInScope treats as out-of-scope whenever a scope is set.
   */
  capturedByCardId?: string | null;
  /**
   * leads.id in SwiftCard. What the CRM record we create is remembered against
   * (crm_links), so a later edit updates THAT record — even after the email it
   * was matched on has changed — and what a failed send is queued under.
   * Absent only for the Settings test contact, which is not a real lead.
   */
  leadId?: string | null;
};

/** "Maya" → { first: "Maya", last: null }; "Maya de la Cruz" → { first: "Maya", last: "de la Cruz" }. */
export function splitName(name: string | null | undefined): { first: string; last: string | null } {
  const [first = "", ...rest] = (name ?? "").trim().split(/\s+/);
  return { first, last: rest.length ? rest.join(" ") : null };
}

/** Digits only, for comparing phone numbers typed in different formats. */
export const phoneDigits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/**
 * Two phone numbers are the same number when their digits match, allowing for
 * one carrying a country code the other leaves off ("+1 415 555 0148" and
 * "(415) 555-0148"). Seven digits minimum, so short codes and extensions can't
 * match unrelated people.
 */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = phoneDigits(a);
  const y = phoneDigits(b);
  if (x.length < 7 || y.length < 7) return false;
  return x === y || x.endsWith(y) || y.endsWith(x);
}

/**
 * Render the capture context as a short human note.
 *
 * Deliberately prose, not JSON: this lands on a timeline a salesperson reads
 * for ten seconds before dialling, so it has to be skimmable. Returns null when
 * there's nothing worth saying, so we never attach an empty note.
 */
export function describeCapture(lead: CrmLead): string | null {
  const lines: string[] = [];
  const met = [lead.whereMet, lead.location].filter(Boolean).join(" · ");
  if (met) lines.push(`Met: ${met}`);
  if (lead.source) lines.push(`Captured via: ${lead.source}`);
  if (lead.capturedByCard) {
    const url = `${process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me"}/${lead.capturedByCard}`;
    const who = lead.capturedByName?.trim();
    lines.push(`Card: ${url}${who ? ` (${who})` : ""}`);
  }
  if (lead.tags?.length) lines.push(`Tags: ${lead.tags.join(", ")}`);
  if (lead.company) lines.push(`Company: ${lead.company}`);
  if (lead.message) lines.push(`They wrote: ${lead.message}`);
  if (lead.notes) lines.push(`Notes: ${lead.notes}`);
  if (!lines.length) return null;
  return `${lines.join("\n")}\n\n${CAPTURE_NOTE_SIGNATURE}`;
}

/**
 * The last line of every note describeCapture writes. It is how a sync tells
 * a field it wrote itself (safe to refresh) from one a salesperson typed into
 * (never overwrite).
 */
export const CAPTURE_NOTE_SIGNATURE = "— captured with SwiftCard";

/**
 * Why a sync is running, which decides what it may write.
 *
 *   capture — a new contact. Create the record (or update the one that already
 *             has this email) and attach the capture note.
 *   update  — the owner edited a contact that was already sent. Update the
 *             record in place. A note is added only when `attachNote` says the
 *             edit changed something a note carries (their notes or message):
 *             re-attaching the same note on every rename or tag change stacked
 *             a fresh copy on the CRM timeline for each edit.
 */
export type CrmSyncOptions = {
  mode?: "capture" | "update";
  attachNote?: boolean;
  /**
   * Update mode only: which contact fields the owner actually changed in this
   * edit. Only those are written over what the CRM holds — editing a note must
   * not overwrite the company a salesperson corrected in Salesforce. Absent
   * means "not known" (a queued retry, a returning visitor filling a blank),
   * and then a field is only written where the CRM record has it empty.
   */
  changedFields?: readonly ContactField[];
  /**
   * The email the contact had BEFORE this edit. A record we never stored an id
   * for (synced before crm_links existed) is still found by its old email
   * instead of being duplicated under the new one.
   */
  previousEmail?: string | null;
  /** The phone BEFORE this edit — replaced in place in CRMs that keep a list of numbers. */
  previousPhone?: string | null;
  /** Set by the outbox drain, so a send that fails again isn't queued twice. */
  fromOutbox?: boolean;
  /**
   * The Settings "Send test contact" button. Ignores card scope (there is no
   * card) and is never queued: the person pressing it wants the answer now.
   */
  test?: boolean;
};

export type ContactField = "name" | "email" | "phone" | "company";

export function shouldAttachNote(opts: CrmSyncOptions | undefined): boolean {
  return (opts?.mode ?? "capture") === "capture" || opts?.attachNote === true;
}

/**
 * May this sync write `field` over a value the CRM record already holds?
 *
 *   capture — no. The CRM is the salesperson's system of record; a returning
 *             contact fills blanks, never replaces what someone typed there.
 *   update  — only a field the owner just changed in SwiftCard. When the edit
 *             didn't say (changedFields absent), nothing is overwritten.
 */
export function mayOverwrite(field: ContactField, opts: CrmSyncOptions | undefined): boolean {
  if ((opts?.mode ?? "capture") !== "update") return false;
  return !!opts?.changedFields?.includes(field);
}

/**
 * What one sync of one contact to one CRM came to. Every provider returns this
 * and does no database work of its own: recording the outcome (the Settings
 * banner, "Last contact sent", the remembered record id, the retry queue) is
 * lib/crm-run's job, done the same way for all of them.
 */
export type PushResult =
  | {
      ok: true;
      action: "created" | "updated" | "logged";
      /** The CRM's id for the record — remembered so the next edit updates it. */
      recordId?: string;
      /** Which kind of record recordId is, where a CRM has more than one (Salesforce Lead vs Contact). */
      recordKind?: string;
      /** A link that opens the record in the CRM, for the Settings test. */
      recordUrl?: string;
    }
  | {
      ok: false;
      /** HTTP status, or null when the CRM never answered. */
      status: number | null;
      /** Worth trying again later (busy, down, no answer) rather than needing the user. */
      retryable: boolean;
      message: string;
    };

/** A failed push, classified and worded the same way for every provider. */
export function pushFailure(label: string, status: number | null, detail?: string): PushResult {
  return { ok: false, status, retryable: isRetryableStatus(status), message: connectionErrorMessage(label, status, detail) };
}

/** Options every provider's push receives. */
export type PushOptions = CrmSyncOptions & {
  budget: CrmBudget;
  /** The record this lead was last written to in THIS destination, if we know it. */
  knownRecord?: { id: string; kind: string | null } | null;
};

export type CrmConnection = {
  token: string;
  /** Banner currently stored, so a success can clear it without a second read. */
  syncError: string | null;
  /** Non-secret routing detail: Pipedrive api_domain, HighLevel locationId. */
  metadata: Record<string, unknown>;
};

/**
 * Whose CRM connection a captured lead should be written to.
 *
 * Same question `resolveBillingSubjectId` answers for subscriptions, and the
 * answer has the same shape — because an Office is one business, not N loose
 * accounts. A 12-agent agency has ONE HighLevel account and wants every agent's
 * leads landing in it, attributed to the agent who captured them. Requiring all
 * 12 to connect their own CRM would be absurd, and 12 disconnected CRMs is not
 * a product anyone asked for.
 *
 * Order matters, and it is deliberately "own connection first":
 *
 *   1. The capturing user's OWN connection, if they have one. This is what
 *      keeps the change additive — anyone connected today keeps exactly the
 *      destination they have now, including a sub-user who connected their
 *      personal Google Contacts before their office existed.
 *   2. Otherwise, for an office SUB-USER, the office owner's connection. This
 *      is the agency case, and it costs the sub-user no setup at all.
 *   3. Otherwise themselves — no office, or an owner, so nothing to inherit.
 *
 * A BROKEN own-connection deliberately does NOT fall through to the office. The
 * row exists, so this returns the sub-user, getCrmConnection reports the
 * failure against their account, and their contacts stop rather than silently
 * rerouting into the agency's CRM. Quietly sending someone's contacts somewhere
 * they didn't choose is worse than pausing.
 */
export async function resolveCrmOwnerId(
  provider: CrmProviderKey,
  capturedByUserId: string,
): Promise<string> {
  const admin = getAdminSupabase();

  // Presence check only — an existing-but-broken row still counts as "theirs".
  const { data: own } = await admin
    .from("integrations")
    .select("id")
    .eq("user_id", capturedByUserId)
    .eq("provider", provider)
    .maybeSingle();
  if (own) return capturedByUserId;

  const ctx = await resolveOfficeContext(capturedByUserId);
  if (ctx && !ctx.isOwner && ctx.ownerId) {
    // Only while the office is really live. The offices row deliberately
    // outlives a lapsed subscription (so re-subscribing restores the team) —
    // the same reason requireOfficeCapability re-checks the owner's plan. A
    // lapsed owner's own leads already stop syncing; their team's must too.
    // isPaidProfile, not the raw plan column: an owner whose timed grant has
    // run out is Free now, even before the daily job rewrites the column. The
    // capture path already stops their OWN leads on exactly this rule.
    const { data: owner } = await admin.from("profiles").select(PLAN_COLUMNS).eq("id", ctx.ownerId).maybeSingle();
    if (isPaidProfile(owner)) return ctx.ownerId;
  }

  return capturedByUserId;
}

/**
 * Write (or clear) the banner Settings shows next to "Connected".
 *
 * Writing it is what turns a silently-dead integration into a visible one.
 * Clearing it on the next success stops a one-off blip nagging forever.
 */
export async function setSyncError(
  provider: CrmProviderKey,
  userId: string,
  message: string | null,
): Promise<void> {
  await getAdminSupabase()
    .from("integrations")
    .update({ sync_error: message })
    .eq("user_id", userId)
    .eq("provider", provider);
}

/**
 * Stamp "Last contact sent" on a connection. Best-effort: the column is
 * display-only, and a database without it (supabase/crm-sync-reliability.sql
 * unapplied) must never turn a delivered contact into a reported failure.
 */
export async function markSynced(provider: CrmProviderKey, userId: string): Promise<void> {
  try {
    await getAdminSupabase()
      .from("integrations")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("provider", provider);
  } catch { /* display-only */ }
}

export type ConnectionOptions = {
  /** The Settings test: there is no card, so card scope can't apply. */
  skipScope?: boolean;
  /**
   * Refresh even though the stored expiry says the token is still good. Used
   * once, after a provider answered 401: Salesforce never tells us how long a
   * token lives (we assume 90 minutes), and an org whose session timeout is
   * shorter rejects it early. Refreshing is the fix; "reconnect" was not.
   */
  forceRefresh?: boolean;
};

/**
 * Load a usable token for `provider`, refreshing it first if it's about to
 * expire. Returns null when there is no connection, when the card is out of
 * this connection's scope, or when the connection is broken in a way the user
 * has to fix — in which case the banner is already set.
 *
 * PER-CARD SCOPING IS ENFORCED HERE, and here only, on purpose. Every provider
 * has to come through this function to get a token, so one check covers all of
 * them and a fifth provider cannot be added with the gate missing. Putting it
 * in the lead route instead would have been wrong as well as fragile: each sync
 * resolves its OWN destination account via resolveCrmOwnerId (an Office
 * sub-user inherits the owner's CRM), so the route doesn't yet know whose
 * integration row — and therefore whose scope — is about to be used.
 *
 * `cardId` is required rather than optional so the compiler, not a reviewer,
 * is what stops a future call site from forgetting it.
 *
 * `capturedBy` is who captured the lead. When it differs from `userId` the
 * connection is INHERITED — an Office sub-user's lead going to the owner's
 * CRM — and the owner's card scope does not apply to it. That scope is the
 * owner's answer to "which of MY cards feed this?": the picker only ever
 * lists the owner's own cards, so no team card could be in it. Applying it
 * anyway meant an owner who picked "only my work card" silently cut every
 * agent's leads off from the agency CRM, while each agent's Settings said
 * their contacts "go there automatically".
 *
 * What an inherited connection DOES require is that the lead came in on the
 * member's COMPANY card (cards.is_office_card). That card is the seat the
 * office pays for and the reason the agency's CRM should hear about it; a
 * card the member kept from before they joined is theirs, and its contacts
 * are not the employer's to receive.
 */
export async function getCrmConnection(
  provider: CrmProviderKey,
  label: string,
  userId: string,
  cardId: string | null | undefined,
  capturedBy: string,
  refresh?: RefreshConfig,
  opts: ConnectionOptions = {},
): Promise<CrmConnection | null> {
  const admin = getAdminSupabase();
  const { data } = await admin
    .from("integrations")
    // sync_error rides along so a later success can clear a stale banner without
    // an extra read — and without writing on every captured lead when it's
    // already null, which would be a pointless round trip per capture.
    // card_ids rides along for the same reason: the scope check costs no extra
    // query, it is just one more column on a row we were already reading.
    .select("access_token, refresh_token, expires_at, sync_error, metadata, card_ids, updated_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (!data) return null;

  // Scope check BEFORE anything else: no token refresh, no network call, and
  // above all no setSyncError. A card the owner deliberately left out is not a
  // broken connection, so it must not raise a banner telling them to fix
  // something that is working as configured.
  //
  // `card_ids` is absent (undefined) on a pre-migration database, which
  // parseCardScope reads as null — all cards — so this is a no-op until someone
  // actually sets a scope.
  const inherited = capturedBy !== userId;
  if (!opts.skipScope) {
    if (inherited) {
      if (!cardId) return null;
      const { data: card } = await admin.from("cards").select("is_office_card").eq("id", cardId).maybeSingle();
      if (!(card as { is_office_card?: boolean } | null)?.is_office_card) return null;
    } else if (!isCardInScope(parseCardScope((data as { card_ids?: unknown }).card_ids), cardId)) {
      return null;
    }
  }

  const now = Date.now();
  const accessToken = decryptToken(data.access_token);
  const storedError = (data.sync_error as string | null) ?? null;
  const metadata = (data.metadata as Record<string, unknown> | null) ?? {};

  // Static-token providers have no expires_at (and no refresh config), so this
  // whole branch is skipped and the stored token is used as-is.
  const dueForRefresh = !!data.expires_at && now > (data.expires_at as number) - 5 * 60 * 1000;
  if (refresh && (dueForRefresh || opts.forceRefresh)) {
    // A deployment without the app's client secret (a preview build shares the
    // production database) cannot refresh — and must not mark a working
    // production connection as broken for trying. Use the token as it is; if
    // it really has expired, the provider's 401 says so on its own.
    if (!refresh.clientId || !refresh.clientSecret) {
      console.warn(`[crm:${provider}] no client credentials here — skipping token refresh`);
      return { token: accessToken, syncError: storedError, metadata };
    }
    if (!data.refresh_token) {
      await setSyncError(provider, userId, `${label} needs you to reconnect — sign in again from Settings to keep contacts flowing.`);
      return null;
    }

    let res: Response;
    try {
      res = await crmFetch(refresh.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: refresh.clientId,
          client_secret: refresh.clientSecret,
          refresh_token: decryptToken(data.refresh_token),
        }),
      });
    } catch {
      // The sign-in server didn't answer. Not the user's problem and not a
      // dead connection — the caller sees no connection and the contact is
      // retried later, without a banner telling anyone to reconnect.
      throw new RefreshUnavailableError(label);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[crm:${provider}] token refresh failed:`, res.status, detail.slice(0, 300));
      if (isRetryableStatus(res.status)) throw new RefreshUnavailableError(label);
      // 400 invalid_grant: the user revoked access, changed their password
      // (Salesforce), or the grant aged out. Only signing in again fixes it.
      await setSyncError(provider, userId, `${label} signed SwiftCard out — reconnect ${label} to keep contacts flowing.`);
      return null;
    }

    // Some providers rotate the refresh token on every use and some don't —
    // keep the existing one when none comes back, or the NEXT refresh fails.
    const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    // Salesforce returns NO expires_in on refresh (token life is the org's
    // session policy). `now + undefined * 1000` is NaN, which Postgres stores
    // as null — and a null expires_at skips this branch forever, so the token
    // silently ages until every sync 401s. Fall back to the same conservative
    // 90 minutes the Salesforce callback uses.
    //
    // Conditional on updated_at: five providers sync in parallel and several
    // contacts can arrive together, so two refreshes can race. The loser's
    // write is dropped rather than overwriting a refresh token the winner may
    // have just rotated; its own access token is still valid for this call.
    let write = admin
      .from("integrations")
      .update({
        access_token: encryptToken(tokens.access_token),
        refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : data.refresh_token,
        expires_at: now + (typeof tokens.expires_in === "number" ? tokens.expires_in : 90 * 60) * 1000,
        updated_at: new Date().toISOString(),
        sync_error: null,
      })
      .eq("user_id", userId)
      .eq("provider", provider);
    if (data.updated_at) write = write.eq("updated_at", data.updated_at as string);
    await write;

    // The update above already cleared sync_error, so the caller has nothing
    // stale left to clear.
    return { token: tokens.access_token, syncError: null, metadata };
  }

  return { token: accessToken, syncError: storedError, metadata };
}

/**
 * The provider's sign-in server didn't answer, or answered "try later". The
 * connection is fine; the contact goes to the retry queue.
 */
export class RefreshUnavailableError extends Error {
  constructor(label: string) {
    super(`${label} sign-in server unavailable`);
    this.name = "RefreshUnavailableError";
  }
}

/**
 * Turn a provider's HTTP failure into copy the user can act on.
 *
 * Three different situations, and each needs different advice:
 *   • 401/403 — the connection itself: a token revoked or rotated, a scope
 *     never granted, an API not enabled. Retrying will never fix it.
 *   • 400/404/409/422 — this one contact: the CRM refused its details (an
 *     email it considers invalid, a required field). The connection is fine
 *     and the next contact will go through; telling them to reconnect would
 *     send them round in circles.
 *   • 429/5xx/no answer — the CRM was busy or down. It is queued and retried
 *     (lib/crm-outbox), which is what "will try again" promises.
 */
export function connectionErrorMessage(label: string, status: number | null, detail?: string): string {
  if (status === 401 || status === 403) {
    return `${label} refused SwiftCard (${status}) — reconnect ${label} and allow access to contacts.`;
  }
  if (isRetryableStatus(status)) {
    return status === null
      ? `${label} didn't answer — SwiftCard will try again.`
      : `${label} was busy (${status}) — SwiftCard will try again.`;
  }
  const why = detail?.trim() ? `: ${detail.trim().slice(0, 160)}` : "";
  return `${label} didn't accept the last contact (${status})${why}. Your connection is fine — new contacts still go through.`;
}

/**
 * One CRM, as lib/crm-run drives it. `push` talks to the CRM and nothing
 * else — no database reads or writes — so the capture path, the edit path,
 * the retry queue, the Settings test and the live test script all run the
 * very same code against the very same API.
 */
export type CrmProvider = {
  key: CrmProviderKey;
  label: string;
  /** OAuth providers only. Read at call time so env changes need no rebuild. */
  refresh?: () => RefreshConfig;
  push: (conn: CrmConnection, lead: CrmLead, opts: PushOptions) => Promise<PushResult>;
};
