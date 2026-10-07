import { getAdminSupabase } from "@/lib/supabase-admin";
import { officeLeadTag } from "@/lib/office-leads";
import { writeAudit } from "@/lib/audit";
import { reportError } from "@/lib/report-error";

// ── When someone leaves a team, their contacts stay with the company ─────────
//
// The office's Contacts tab is every contact on a CURRENT teammate's cards,
// plus every contact stamped with the office tag (lib/office-leads). The
// stamp is what keeps a contact on the list once its teammate is gone, and the
// removal dialog promises exactly that: "the contacts they captured stay with
// your company".
//
// Owner, 2026-10-07: contacts were silently going missing. Only the admin's
// Remove button stamped them, and only the first 1,000. Every other way off a
// team stamped nothing, so those contacts simply vanished from the company's
// list:
//   • seats reduced below the headcount (Stripe webhook → seat trim),
//   • the company's Office subscription ending (Stripe webhook),
//   • the owner switching Office → Pro, or a free Office month expiring
//     (tearDownOfficeForOwner),
//   • the teammate accepting an invite to a different team (api/join).
// Each of those now calls recordOfficeDeparture, and Remove calls
// keepContactsWithOffice — the same stamping, with no cap.
//
// Only contacts that exist NOW are stamped: anything the person captures after
// leaving is theirs alone, and nothing new reaches the old employer.

/** Every card address this person holds: the account handle and each card. */
export async function slugsHeldBy(userId: string): Promise<string[]> {
  const admin = getAdminSupabase();
  const [{ data: prof }, { data: cards }] = await Promise.all([
    admin.from("profiles").select("username").eq("id", userId).maybeSingle(),
    admin.from("cards").select("username").eq("user_id", userId),
  ]);
  return Array.from(new Set([
    (prof?.username as string | null) ?? "",
    ...(cards ?? []).map((c) => (c.username as string | null) ?? ""),
  ].filter(Boolean)));
}

const PAGE = 1000;
// Ids per update request — keeps the request URL comfortably short.
const CHUNK = 150;

/**
 * Stamp EVERY contact on this person's cards with the office tag, so the
 * contacts stay on the office's Contacts tab after they leave.
 *
 * Paged by id rather than capped, and written in groups that share the same
 * tags (one update per group, not one per contact). Each update only touches
 * rows whose tags are still exactly what was read, so a tag changed meanwhile
 * is never overwritten; those rows are picked up by the next pass.
 *
 * Throws on a database error — callers decide whether that may block them.
 */
export async function keepContactsWithOffice(
  officeId: string,
  userId: string,
  /** Their card addresses, when the caller has already looked them up. */
  knownSlugs?: string[],
): Promise<{ slugs: string[]; stamped: number; missed: number }> {
  const admin = getAdminSupabase();
  const slugs = knownSlugs ?? (await slugsHeldBy(userId));
  const tag = officeLeadTag(officeId);
  let stamped = 0;
  let missed = 0;
  if (!slugs.length) return { slugs, stamped, missed };

  for (let pass = 0; pass < 3; pass++) {
    // Every contact on their cards still without the stamp, grouped by tags.
    const groups = new Map<string, { tags: string[] | null; ids: string[] }>();
    let after: string | null = null;
    for (;;) {
      let q = admin.from("leads").select("id, tags").in("card_owner", slugs).order("id", { ascending: true }).limit(PAGE);
      if (after) q = q.gt("id", after);
      const { data, error } = await q;
      if (error) throw new Error(`reading contacts to keep: ${error.message}`);
      const rows = data ?? [];
      for (const r of rows) {
        const tags = Array.isArray(r.tags) ? (r.tags as string[]) : null;
        if (tags?.includes(tag)) continue;
        const key = JSON.stringify(tags);
        const g = groups.get(key) ?? { tags, ids: [] };
        g.ids.push(r.id as string);
        groups.set(key, g);
      }
      if (rows.length < PAGE) break;
      after = rows[rows.length - 1].id as string;
    }
    if (!groups.size) return { slugs, stamped, missed: 0 };

    missed = 0;
    for (const g of groups.values()) {
      for (let i = 0; i < g.ids.length; i += CHUNK) {
        const ids = g.ids.slice(i, i + CHUNK);
        let q = admin.from("leads").update({ tags: [...(g.tags ?? []), tag] }).in("id", ids);
        // Unchanged since it was read: same set of tags (or still none).
        q = g.tags === null ? q.is("tags", null) : q.contains("tags", g.tags).containedBy("tags", g.tags);
        const { data, error } = await q.select("id");
        if (error) throw new Error(`keeping contacts with the office: ${error.message}`);
        const done = data?.length ?? 0;
        stamped += done;
        missed += ids.length - done;
      }
    }
    if (!missed) break;
  }
  return { slugs, stamped, missed };
}

export type OfficeDepartureReason = "seats_reduced" | "office_ended" | "joined_another_team";

/**
 * Everything a departure that ISN'T the admin's Remove button has to record:
 * the contacts stay with the company, and the removal is written to the audit
 * trail — which is what lets the console's contact drawer show that person's
 * history up to the day they left (lib/office-contact-detail).
 *
 * Never throws: these run inside billing cascades and the join flow, which
 * must finish. A failure is reported, never silent.
 */
export async function recordOfficeDeparture(
  officeId: string,
  userId: string,
  reason: OfficeDepartureReason,
): Promise<void> {
  let slugs: string[] = [];
  try {
    const kept = await keepContactsWithOffice(officeId, userId);
    slugs = kept.slugs;
    if (kept.missed) {
      await reportError("office.departure-contacts-missed", new Error(`${kept.missed} contacts not stamped`), { officeId, userId, reason }).catch(() => {});
    }
  } catch (e) {
    await reportError("office.departure-contacts-failed", e, { officeId, userId, reason }).catch(() => {});
  }
  await writeAudit({ action: "member.removed", actorId: null, orgId: officeId, targetId: userId, metadata: { slugs, reason } });
}
