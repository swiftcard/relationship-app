import type { getAdminSupabase } from "@/lib/supabase-admin";
import { VIEW_VISIT_WINDOW_MS } from "@/lib/view-window";

// ── Is this visitor someone the owner already knows? ─────────────────────────
//
// The warm-lead feature (docs/plans/warm-lead-alerts.md) names a returning
// visitor: "Priya re-opened your card". A wrong name there costs more trust
// than ten missed ones, so this file answers the question the way a careful
// person would — from evidence the OWNER earned, never from anything the
// visitor's browser volunteered — and when the evidence is mixed it says
// "I don't know".
//
// THE EVIDENCE is a binding in contact_devices: this browser (its sc_vid
// cookie, lib/visit-identity.ts) belongs to this lead, and here is how we
// learned it:
//
//   form     the browser submitted this owner's lead form
//   link     the browser opened a per-contact link the owner sent (PR A5)
//   account  a signed-in SwiftCard viewer whose verified email is the lead's
//
// What is deliberately NOT evidence:
//   • the swiftcard_visitor localStorage blob (device-wide, any owner, and
//     page script can write it) — it keeps powering the hedged "Looks like X"
//     copy it always did (owner decision D10), and never a named alert;
//   • the email/phone fields on a card_events row (client-supplied);
//   • IP address, user agent, or any other fingerprint.
//
// THE RULES:
//   1. One active lead bound to the browser → that lead.
//   2. Several → the same person only if they share an email or phone (they
//      submitted twice); then the newest. Otherwise AMBIGUOUS → anonymous. A
//      family iPad at an open house must never name the wrong person.
//   3. A different person submitting the form on an already-bound browser
//      SUPERSEDES the old binding (the newest submitter owns the browser).
//   4. The owner is never a contact of their own: a lead whose email or phone
//      is the owner's (they tested their own form) is never bound or named.
//
// Never throws. Every failure — including the tables not existing yet because
// supabase/warm-lead-alerts.sql hasn't been applied — degrades to anonymous,
// which is exactly today's behaviour.

type Admin = ReturnType<typeof getAdminSupabase>;

export type BindingSource = "form" | "link" | "account";

/** How sure we are, for copy and scoring. "forwarded" is a browser reached
 *  through a link the owner sent that had ALREADY been opened on another
 *  browser: someone the contact passed it to, maybe. Never named (D3). */
export type ContactConfidence = BindingSource | "forwarded";

export type KnownContact = {
  kind: "known";
  leadId: string;
  name: string;
  /** The card slug the lead was captured on (leads.card_owner). */
  cardOwner: string;
  confidence: ContactConfidence;
  capturedAt: string;
  status: string | null;
  tags: string[];
  whereMet: string | null;
};

export type ContactResolution = KnownContact | { kind: "anonymous" } | { kind: "ambiguous" };

const ANONYMOUS: ContactResolution = { kind: "anonymous" };

/** The strongest evidence wins when one lead has several bindings to a browser. */
const CONFIDENCE_ORDER: Record<ContactConfidence, number> = { form: 3, account: 2, link: 1, forwarded: 0 };

type BindingRow = { lead_id: string; bound_via: BindingSource; link_device_index?: number | null };

/** A link binding past the link's first browser is a forwarded link. */
export function confidenceOf(b: BindingRow): ContactConfidence {
  return b.bound_via === "link" && (b.link_device_index ?? 1) > 1 ? "forwarded" : b.bound_via;
}

export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.includes("@") ? e : null;
}

/** Last ten digits: "+1 (917) 905-7335" and "9179057335" are one number. */
export function normalizePhone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = v.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : null;
}

type PersonKeys = { emails: Set<string>; phones: Set<string> };

function keysOf(rows: { email?: unknown; phone?: unknown }[]): PersonKeys {
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const r of rows) {
    const e = normalizeEmail(r.email);
    const p = normalizePhone(r.phone);
    if (e) emails.add(e);
    if (p) phones.add(p);
  }
  return { emails, phones };
}

function sharesKey(a: { email?: unknown; phone?: unknown }, b: { email?: unknown; phone?: unknown }): boolean {
  const ea = normalizeEmail(a.email);
  const pa = normalizePhone(a.phone);
  return (!!ea && ea === normalizeEmail(b.email)) || (!!pa && pa === normalizePhone(b.phone));
}

/** True when the lead is the owner themselves (rule 4). */
export function isOwnersOwnDetails(lead: { email?: unknown; phone?: unknown }, owner: PersonKeys): boolean {
  const e = normalizeEmail(lead.email);
  const p = normalizePhone(lead.phone);
  return (!!e && owner.emails.has(e)) || (!!p && owner.phones.has(p));
}

/** Every email and phone the owner shows anywhere: the profile and each card. */
export async function ownerContactKeys(admin: Admin, ownerId: string): Promise<PersonKeys> {
  try {
    const [{ data: profile }, { data: cards }] = await Promise.all([
      admin.from("profiles").select("email, phone").eq("id", ownerId).maybeSingle(),
      admin.from("cards").select("email, phone").eq("user_id", ownerId),
    ]);
    return keysOf([...(profile ? [profile] : []), ...((cards ?? []) as { email?: unknown; phone?: unknown }[])]);
  } catch {
    return { emails: new Set(), phones: new Set() };
  }
}

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  card_owner: string;
  created_at: string;
  status: string | null;
  tags: string[] | null;
  where_met: string | null;
};

/**
 * The pure decision over the leads a browser is bound to (rules 1, 2 and 4).
 * Exported for tests; resolveKnownContact is the only production caller.
 */
export function decideKnownContact(
  bindings: BindingRow[],
  leads: LeadRow[],
  owner: PersonKeys,
): ContactResolution {
  const eligible = leads.filter((l) => !isOwnersOwnDetails(l, owner));
  if (eligible.length === 0) return ANONYMOUS;

  const newest = [...eligible].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (eligible.some((l) => l.id !== newest.id && !sharesKey(l, newest))) return { kind: "ambiguous" };

  let confidence: ContactConfidence | null = null;
  for (const b of bindings) {
    if (b.lead_id !== newest.id) continue;
    const c = confidenceOf(b);
    if (!confidence || CONFIDENCE_ORDER[c] > CONFIDENCE_ORDER[confidence]) confidence = c;
  }
  if (!confidence) return ANONYMOUS;

  return {
    kind: "known",
    leadId: newest.id,
    name: (newest.name ?? "").trim(),
    cardOwner: newest.card_owner,
    confidence,
    capturedAt: newest.created_at,
    status: newest.status ?? null,
    tags: Array.isArray(newest.tags) ? newest.tags : [],
    whereMet: newest.where_met ?? null,
  };
}

/** Who is this browser to this owner? */
export async function resolveKnownContact(
  admin: Admin,
  opts: { ownerId: string | null | undefined; visitorId: string | null | undefined },
): Promise<ContactResolution> {
  const { ownerId, visitorId } = opts;
  if (!ownerId || !visitorId) return ANONYMOUS;
  try {
    const { data: bindings, error } = await admin
      .from("contact_devices")
      .select("lead_id, bound_via, link_device_index")
      .eq("owner_id", ownerId)
      .eq("visitor_id", visitorId)
      .is("superseded_at", null)
      .is("wrong_at", null);
    if (error || !bindings?.length) return ANONYMOUS;

    const leadIds = [...new Set(bindings.map((b) => b.lead_id as string))];
    const { data: leads, error: leadsErr } = await admin
      .from("leads")
      .select("id, name, email, phone, card_owner, created_at, status, tags, where_met")
      .in("id", leadIds);
    if (leadsErr || !leads?.length) return ANONYMOUS;

    const owner = await ownerContactKeys(admin, ownerId);
    return decideKnownContact(
      bindings as BindingRow[],
      leads as LeadRow[],
      owner,
    );
  } catch {
    return ANONYMOUS;
  }
}

/**
 * Record that the browser which just submitted a lead form belongs to that
 * lead (rule 3 supersedes any other person bound to it; rule 4 skips the
 * owner's own details). Returns what it did, for the caller's log.
 */
export async function bindFormDevice(
  admin: Admin,
  opts: {
    leadId: string;
    ownerId: string;
    visitorId: string;
    email: string | null | undefined;
    phone: string | null | undefined;
    /** When the share really happened — an offline outbox replay's time. */
    at?: number | null;
  },
): Promise<"bound" | "owner" | "skipped"> {
  const { leadId, ownerId, visitorId, email, phone } = opts;
  if (!leadId || !ownerId || !visitorId) return "skipped";
  try {
    const owner = await ownerContactKeys(admin, ownerId);
    if (isOwnersOwnDetails({ email, phone }, owner)) return "owner";

    // Rule 3: anyone ELSE already bound to this browser for this owner is
    // superseded. The same person re-submitting is left alone — the resolver
    // treats their leads as one person and names the newest.
    const { data: others } = await admin
      .from("contact_devices")
      .select("id, lead_id, bound_at")
      .eq("owner_id", ownerId)
      .eq("visitor_id", visitorId)
      .is("superseded_at", null)
      .neq("lead_id", leadId);
    const nowMs = opts.at ?? Date.now();
    if (others?.length) {
      const { data: otherLeads } = await admin
        .from("leads")
        .select("id, email, phone")
        .in("id", others.map((o) => o.lead_id as string));
      const differentPeople = new Set(
        (otherLeads ?? [])
          .filter((l) => !sharesKey(l, { email, phone }))
          .map((l) => l.id as string),
      );
      // A binding whose lead no longer exists is gone by cascade already.
      const toSupersede = others.filter((o) => differentPeople.has(o.lead_id as string)).map((o) => o.id as string);
      if (toSupersede.length) {
        await admin.from("contact_devices").update({ superseded_at: new Date().toISOString() }).in("id", toSupersede);
        // The visit that led to THIS share is this person's, even though the
        // resolver stamped it as the previous person's while their binding
        // was the only one ("A re-opened your card" was B on the family iPad).
        // Only the last visit window, and never the earlier person's own
        // capture sitting (their first window after binding).
        const slugs = await ownerSlugs(admin, ownerId);
        for (const o of others.filter((x) => differentPeople.has(x.lead_id as string))) {
          const theirsUntil = o.bound_at ? new Date(o.bound_at as string).getTime() + VIEW_VISIT_WINDOW_MS : 0;
          const fromIso = new Date(Math.max(nowMs - VIEW_VISIT_WINDOW_MS, theirsUntil)).toISOString();
          // lead_confidence stays: an event that WAS a contact's never falls back
          // to the name stamped on it (lib/recent-visits).
          await admin.from("card_events").update({ lead_id: null })
            .eq("lead_id", o.lead_id as string).eq("visitor_id", visitorId)
            .in("card_owner_username", slugs).gte("created_at", fromIso);
          await admin.from("card_views").update({ lead_id: null })
            .eq("lead_id", o.lead_id as string).eq("visitor_id", visitorId)
            .in("username", slugs.flatMap((s) => [s, `${s}__links`])).gte("viewed_at", fromIso);
        }
      }
    }

    // The SAME person sharing again from the same browser: clear the marks and
    // keep bound_at. Moving it to now moved the contact's history window with
    // it, and the visit they were first captured in (read from shortly before
    // bound_at) vanished from their timeline on a one-tap re-share.
    const { data: existing } = await admin
      .from("contact_devices")
      .select("id, bound_via, bound_at")
      .eq("lead_id", leadId)
      .eq("visitor_id", visitorId)
      .maybeSingle();
    if (existing && existing.bound_via === "form" && existing.bound_at) {
      const { error } = await admin
        .from("contact_devices")
        .update({ superseded_at: null, wrong_at: null })
        .eq("id", existing.id as string);
      if (error) return "skipped";
      await stampShareVisit(admin, { leadId, ownerId, visitorId, nowMs });
      return "bound";
    }

    // A fresh submission is the strongest evidence there is, so it clears an
    // earlier supersede or "wrong person" mark on this exact pair.
    const { error } = await admin.from("contact_devices").upsert(
      {
        lead_id: leadId,
        owner_id: ownerId,
        visitor_id: visitorId,
        bound_via: "form",
        bound_at: new Date(nowMs).toISOString(),
        superseded_at: null,
        wrong_at: null,
      },
      { onConflict: "lead_id,visitor_id" },
    );
    if (error) return "skipped";
    await stampShareVisit(admin, { leadId, ownerId, visitorId, nowMs });
    return "bound";
  } catch {
    return "skipped";
  }
}

/** Every slug this owner's events are filed under (lib/owner-usernames, on
 *  the client this module was handed). */
async function ownerSlugs(admin: Admin, ownerId: string): Promise<string[]> {
  const [{ data: profile }, { data: cards }] = await Promise.all([
    admin.from("profiles").select("username").eq("id", ownerId).maybeSingle(),
    admin.from("cards").select("username").eq("user_id", ownerId),
  ]);
  const names = [profile?.username, ...(cards ?? []).map((c) => c.username)].filter((n): n is string => typeof n === "string" && !!n);
  return names.length ? names : ["__none__"];
}

/** The visit that leads up to a share — the window the contact's history has
 *  always credited to them (card-events GET: two hours before the binding). */
const SHARE_LEAD_IN_MS = 2 * 60 * 60 * 1000;

/**
 * Stamp the visit they shared in with their id, so it is THEIR data rather
 * than a window recomputed at read time. Recomputed, it moved: a one-tap
 * re-share shifted bound_at and the capture visit vanished from their history;
 * another person sharing on the same device later pulled it into theirs; and
 * "3rd visit this week" (stamped card_views) never counted it.
 *
 * Only events nobody was named for, from this browser, on this owner's cards,
 * and never earlier than the last time ANOTHER contact's binding on this
 * browser could still have been theirs. Best effort: a failure leaves the
 * read-time window doing what it always did.
 */
async function stampShareVisit(
  admin: Admin,
  opts: { leadId: string; ownerId: string; visitorId: string; nowMs: number },
): Promise<void> {
  try {
    const { leadId, ownerId, visitorId, nowMs } = opts;
    const { data: otherBindings } = await admin
      .from("contact_devices")
      .select("bound_at")
      .eq("owner_id", ownerId)
      .eq("visitor_id", visitorId)
      .neq("lead_id", leadId);
    const floor = (otherBindings ?? [])
      .map((b) => (b.bound_at ? new Date(b.bound_at as string).getTime() + VIEW_VISIT_WINDOW_MS : 0))
      .filter((t) => t <= nowMs)
      .reduce((max, t) => Math.max(max, t), nowMs - SHARE_LEAD_IN_MS);
    const fromIso = new Date(floor).toISOString();
    const untilIso = new Date(nowMs + 60_000).toISOString();
    const slugs = await ownerSlugs(admin, ownerId);
    await admin.from("card_events").update({ lead_id: leadId, lead_confidence: "form" })
      .eq("visitor_id", visitorId).is("lead_id", null)
      .in("card_owner_username", slugs).gte("created_at", fromIso).lte("created_at", untilIso);
    await admin.from("card_views").update({ lead_id: leadId })
      .eq("visitor_id", visitorId).is("lead_id", null)
      .in("username", slugs.flatMap((s) => [s, `${s}__links`])).gte("viewed_at", fromIso).lte("viewed_at", untilIso);
  } catch {
    /* the read-time window still credits the visit */
  }
}

/** Stamp the binding as seen. Fire-and-forget; never throws. */
export async function touchContactDevice(
  admin: Admin,
  opts: { ownerId: string; visitorId: string; leadId: string },
): Promise<void> {
  try {
    await admin
      .from("contact_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("owner_id", opts.ownerId)
      .eq("visitor_id", opts.visitorId)
      .eq("lead_id", opts.leadId);
  } catch {
    /* best effort */
  }
}
