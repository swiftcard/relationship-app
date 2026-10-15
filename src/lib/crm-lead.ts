import { getAdminSupabase } from "./supabase-admin";
import { getSourceLabel } from "./source-labels";
import { isCrmVisibleTag } from "./lead-tags";
import { LOCKED_LEAD_TAG } from "./plan";
import type { CrmLead, ContactField } from "./crm-connection";

// ── A saved contact, as a CRM sees it ────────────────────────────────────────
//
// The capture routes build their CrmLead from the request they are handling.
// Everything that syncs a contact LATER — an edit, a returning visitor filling
// a blank, the retry queue — reads it back from the database instead, through
// this one function, so none of them can disagree about which fields go out or
// which tags are private.

export const CRM_LEAD_COLUMNS = "id, name, email, phone, company, notes, tags, message, location, source, card_owner, where_met";

/** The contact fields a CRM record holds — what an edit compares to decide whether to sync. */
export const CRM_CONTACT_FIELDS: readonly ContactField[] = ["name", "email", "phone", "company"];

/** Edits to any of these change what the CRM shows (the four fields, or the note). */
export const CRM_NOTE_FIELDS = ["notes", "message", "where_met"] as const;

export type LeadRow = Record<string, unknown>;

/**
 * Never sent: the sample contact every new account starts with (the guided
 * tour has the owner edit it — that edit used to create "Jordan Rivera" in
 * their real CRM), and a contact locked behind the Free cap, which the owner
 * can't see either.
 */
export function isPrivateLead(row: LeadRow | null | undefined): boolean {
  const tags = Array.isArray(row?.tags) ? (row!.tags as string[]) : [];
  return tags.includes("demo") || tags.includes(LOCKED_LEAD_TAG);
}

/** The owner's own tags only — see isCrmVisibleTag. */
export function crmTags(tags: unknown): string[] | null {
  const t = Array.isArray(tags) ? tags.filter(isCrmVisibleTag) : [];
  return t.length ? t : null;
}

/**
 * Read a lead and everything a CRM sync needs about it. Null when the lead is
 * gone, private (isPrivateLead), or its card no longer resolves to an account.
 */
export async function loadCrmLead(leadId: string): Promise<{ lead: CrmLead; capturedBy: string; row: LeadRow } | null> {
  const admin = getAdminSupabase();
  const { data: row } = await admin.from("leads").select(CRM_LEAD_COLUMNS).eq("id", leadId).maybeSingle();
  if (!row?.name || isPrivateLead(row)) return null;

  // Cards first, then a legacy profile-username card — the order every other
  // resolver uses, so a slug that collides with someone's profile username can
  // never route this contact to them.
  const slug = row.card_owner as string;
  const { data: card } = await admin.from("cards").select("id, name, user_id").eq("username", slug).maybeSingle();
  let capturedBy = (card?.user_id as string | undefined) ?? null;
  if (!capturedBy) {
    const { data: p } = await admin.from("profiles").select("id").eq("username", slug).maybeSingle();
    capturedBy = (p?.id as string | undefined) ?? null;
  }
  if (!capturedBy) return null;

  return {
    capturedBy,
    row,
    lead: {
      leadId: row.id as string,
      name: row.name as string,
      email: (row.email as string) || null,
      phone: (row.phone as string) || null,
      company: (row.company as string) || null,
      location: (row.location as string) || null,
      whereMet: (row.where_met as string) || null,
      message: (row.message as string) || null,
      notes: (row.notes as string) || null,
      source: row.source ? getSourceLabel(row.source as string) : null,
      capturedByCard: slug,
      capturedByName: (card?.name as string | null) ?? null,
      capturedByCardId: (card?.id as string | undefined) ?? null,
      tags: crmTags(row.tags),
    },
  };
}

const norm = (v: unknown) => (typeof v === "string" ? v.trim() : v ?? null) || null;

/**
 * What an edit changed, as far as a CRM can tell. Comparing values — not just
 * which keys the request carried — is what stops opening a contact (which
 * PATCHes its tags to clear "unread") from syncing anything at all: the
 * dashboard sends whole objects back, and an unchanged field is not a change.
 */
export function crmChanges(before: LeadRow, after: LeadRow): { fields: ContactField[]; note: boolean; tags: boolean } {
  const fields = CRM_CONTACT_FIELDS.filter((f) => norm(before[f]) !== norm(after[f]));
  const note = CRM_NOTE_FIELDS.some((f) => norm(before[f]) !== norm(after[f]));
  const tagKey = (t: unknown) => (crmTags(t) ?? []).slice().sort().join("\u0000");
  return { fields, note, tags: tagKey(before.tags) !== tagKey(after.tags) };
}

/**
 * The contact every "Send test contact" press sends. Always the same email, so
 * pressing it twice proves the second press UPDATES the record rather than
 * making a duplicate — the thing people most want to check before trusting a
 * connection. Labelled as a test everywhere it shows, and safe to delete.
 */
export const TEST_CONTACT_EMAIL = "swiftcard-test@example.com";
