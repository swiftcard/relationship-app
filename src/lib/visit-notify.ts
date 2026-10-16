import { getAdminSupabase } from "@/lib/supabase-admin";
import { sendPushToUser } from "@/lib/push";
import { VIEW_VISIT_WINDOW_MS } from "@/lib/view-window";
import { UNCAPPED, type PushCategory } from "@/lib/push-policy";

// ONE NOTIFICATION PER PERSON, PER CARD, PER VISIT.
//
// The rule the owner actually wants: "someone views my card, I get one
// notification about that, not two." Before this file, a single person on a
// single visit could ring the owner's phone three times — the view, the
// milestone it happened to cross, and the contact save thirty seconds later —
// because each of those was written by a different piece of code that only
// ever deduped against ITSELF.
//
// So dedupe moved off the event and onto the VISIT. Every notification a
// visitor can cause carries the same visit_key; the partial unique index on
// that column (supabase/notifications-visit-key.sql) means the second one
// physically cannot insert. It upgrades the row that exists instead:
//
//   viewed your card  →  downloaded your contact card  →  shared their info
//
// under the SAME collapse id, so when an upgrade does re-push the lock screen
// REPLACES the banner rather than adding one. The owner ends a visit with
// exactly one notification, showing the furthest that person got.
//
// Only an UNCAPPED upgrade re-pushes at all — see push() below. A view being
// overtaken by a download changes the row in silence; a stranger turning into
// a named lead is worth the one extra buzz.

/** How newsworthy an event is. A visit only ever moves up this list. */
export const VISIT_RANK: Record<string, number> = {
  card_viewed: 1,
  // A contact the owner already knows came back (lib/contact-return-notify.ts),
  // then did something on the page. Both sit BELOW milestone so a milestone
  // crossed by this very view can still upgrade the row and write its
  // once-ever ledger — its copy keeps the contact's sentence in its body.
  contact_returned: 1.5,
  contact_engaged: 1.7,
  milestone: 2,
  contact_saved: 3,
  new_lead: 4,
};

export type VisitIdentity = {
  cardOwner: string;
  visitorId?: string | null;
  ip?: string | null;
  now?: number;
};

/**
 * The visit a piece of activity belongs to — plus the one before it.
 *
 * Same 30-minute length as the view counter (view-window.ts) so the bell, the
 * traffic chart and the lock screen can never disagree about whether two
 * touches were one visit. Anonymous visitors fall back to their IP: coarser,
 * but a visitor with no id is exactly the case where two events would
 * otherwise both notify.
 *
 * WHY TWO KEYS: the row dedupes elsewhere slide (now − 30min), but a key has
 * to be a fixed string to be unique-indexed, so it buckets on wall-clock
 * boundaries. A visitor who views at 10:29 and saves at 10:31 would land in
 * two different buckets and notify twice — every visit straddling :00 or :30
 * would duplicate, by construction. So the caller also checks the PREVIOUS
 * bucket and joins that visit when its notification is still inside the
 * window. That makes the window slide while the key stays indexable.
 */
export function visitKeys(opts: VisitIdentity): { current: string; previous: string } {
  const who = (opts.visitorId ?? "").trim() || `ip:${(opts.ip ?? "unknown").trim()}`;
  const bucket = Math.floor((opts.now ?? Date.now()) / VIEW_VISIT_WINDOW_MS);
  const key = (b: number) => `${opts.cardOwner.toLowerCase()}:${who}:${b}`;
  return { current: key(bucket), previous: key(bucket - 1) };
}

/** The visit key for a piece of activity, ignoring the boundary lookback. */
export function visitKey(opts: VisitIdentity): string {
  return visitKeys(opts).current;
}

// APNs caps apns-collapse-id at 64 bytes and a visit key can exceed that
// (visitor ids are up to 64 chars on their own), so the push tag is a short
// stable hash of the key. Same value on every push for the visit — that is the
// whole point: iOS replaces a banner carrying a collapse id it already showed.
export function visitPushTag(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return `visit-${h.toString(36)}`;
}

export type VisitNotice = {
  /** notifications.type — also the VISIT_RANK lookup ("milestone_5" ranks as "milestone"). */
  type: string;
  /** Which of the interrupt-worthy categories this is, if any (push-policy.ts).
   *  OMITTED ON PURPOSE for news that belongs in the bell and nowhere else — a
   *  view milestone, say: it still writes the row and still upgrades the visit,
   *  it just never buzzes. Carrying a category is permission to interrupt, not
   *  a guarantee: the policy layer still applies quiet hours, the daily cap and
   *  the hourly view batch, and an upgrade mid-visit stays silent unless the
   *  category is uncapped (see push() below). */
  pushCategory?: PushCategory;
  title: string;
  body: string;
  /** Deep link for the push tap. */
  url: string;
  /**
   * Lock-screen wording when it differs from the bell row. A new lead reads
   * "Ali Khan shared their info with you" in the bell but shows their phone
   * number on the lock screen, where the useful thing is the number itself.
   */
  pushBody?: string;
  /**
   * Lock-screen HEADLINE when it differs from the bell row.
   *
   * One caller: a view that crossed a milestone (see /api/card-events). The
   * push was already going out for that view; this makes its title the
   * celebration ("50 views — on fire!") instead of "Card viewed". It does not
   * create a push, change the category, or bypass a switch — with no
   * pushCategory there is still nothing to title.
   */
  pushTitle?: string;
  /**
   * THE ONCE-EVER MILESTONE LEDGER, e.g. "milestone_50".
   *
   * Written to its own column rather than inferred from `type`, and upgrade()
   * below never clears it. That is the whole reason the column exists: a visit
   * that crosses a milestone and then saves a contact gets its type rewritten
   * from milestone_50 to contact_saved, so a type-based ledger would forget the
   * milestone had ever been announced and fire it again on the next view. This
   * survives every later upgrade in the visit.
   */
  milestone?: string;
  /**
   * The known contact this row is about (notifications.lead_id). Opens their
   * contact from the bell without matching on names, and deletes the row
   * with them (decision D8). Also counted for the per-contact push cap.
   */
  leadId?: string | null;
};

function rankOf(type: string): number {
  if (type.startsWith("milestone_")) return VISIT_RANK.milestone;
  return VISIT_RANK[type] ?? 0;
}

export type VisitNotifyResult = "created" | "upgraded" | "suppressed" | "failed";

type OpenVisit = { id: string; type: string; visit_key: string };

// The visit this person already has open on this card, if any: a notification
// under either the current or the previous bucket whose timestamp is still
// inside the window. Returns null when the column isn't migrated yet, which
// degrades the whole file to insert-and-push (i.e. the old behaviour).
//
// EVERY query here is scoped to the recipient (user_id). The key is built from
// the card slug, and a slug can change hands: rename "alex" → "alex-smith" and
// someone else can register "alex" at once. Unscoped, the new owner's lead
// found the OLD owner's open row and rewrote it — the old owner's bell showed a
// stranger's contact (isolation audit 2026-09-24).
async function openVisit(
  admin: ReturnType<typeof getAdminSupabase>,
  userId: string,
  keys: { current: string; previous: string },
  now: number,
): Promise<OpenVisit | null> {
  const { data } = await admin
    .from("notifications")
    .select("id, type, visit_key, created_at")
    .eq("user_id", userId)
    .in("visit_key", [keys.current, keys.previous])
    .gte("created_at", new Date(now - VIEW_VISIT_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data?.[0];
  return row ? { id: row.id as string, type: row.type as string, visit_key: row.visit_key as string } : null;
}

/**
 * Tell the owner about one thing a visitor did — at most once per visit.
 *
 * Returns what happened, which callers use to decide whether to fire their own
 * side effects (a CRM mirror still fires per event; a push does not).
 *
 * Degrades safely: if the visit_key column hasn't been migrated yet, this falls
 * back to plain insert-and-push, i.e. exactly the old behaviour.
 */
export async function notifyVisit(opts: {
  userId: string;
  cardOwner: string;
  visitorId?: string | null;
  ip?: string | null;
  notice: VisitNotice;
  now?: number;
}): Promise<VisitNotifyResult> {
  const admin = getAdminSupabase();
  const { notice } = opts;
  const now = opts.now ?? Date.now();
  const keys = visitKeys({ cardOwner: opts.cardOwner, visitorId: opts.visitorId, ip: opts.ip, now });

  // Join the visit already in progress when this person's last notification is
  // still inside the window — even if the clock has since crossed a bucket
  // boundary. Otherwise start a new one.
  const open = await openVisit(admin, opts.userId, keys, now);
  const key = open?.visit_key ?? keys.current;
  const tag = visitPushTag(key);

  // `onUpgrade` = this visit already has a row, so the owner has very likely
  // already been buzzed once for this same person.
  //
  // ONE PERSON'S VISIT IS ONE INTERRUPTION. The collapse id means an upgrade
  // REPLACES the banner rather than stacking a second one, which keeps the lock
  // screen tidy — but a replacement still buzzes, and "someone viewed my card"
  // followed thirty seconds later by "someone downloaded my contact card" is
  // two buzzes from one visitor. That is the exact complaint this whole file
  // exists to answer, so a mid-visit upgrade is silent by default.
  //
  // The exception is the uncapped categories — a lead, a reply, a billing
  // failure. Those are the things a person would be genuinely angry to have
  // held back, and someone handing over their details after browsing is a big
  // enough change in the news to be worth the second buzz. The capped ones
  // (a view, a download) are nice to know: they update the row and wait.
  // The bell row the push announces: its id rides in the payload so a tap on
  // the lock screen marks it read (audit N-01). Set just before each push().
  let notificationId: string | null = null;
  const push = async (onUpgrade = false) => {
    if (!notice.pushCategory) return;   // bell-only news
    if (onUpgrade && !UNCAPPED.includes(notice.pushCategory)) return;
    await sendPushToUser(opts.userId, {
      category: notice.pushCategory,
      title: notice.pushTitle ?? notice.title,
      body: notice.pushBody ?? notice.body,
      url: notice.url,
      // Names the card on the lock screen when the account has several.
      cardOwner: opts.cardOwner,
      // Same tag for every notification in this visit → the messenger replaces
      // the banner instead of stacking a second one.
      tag,
      leadId: notice.leadId,
      notificationId,
    }).catch(() => { /* a dead subscription must never fail the event */ });
  };

  const row = {
    // Chosen here rather than by the database, so the push can carry it
    // without a second round trip.
    id: crypto.randomUUID(),
    user_id: opts.userId,
    card_owner: opts.cardOwner,
    type: notice.type,
    title: notice.title,
    body: notice.body,
    visit_key: key,
    ...(notice.milestone ? { milestone: notice.milestone } : {}),
    ...(notice.leadId ? { lead_id: notice.leadId } : {}),
  };

  // Known open visit: upgrade it, or stay quiet. No second row, no second buzz.
  if (open) {
    if (rankOf(notice.type) <= rankOf(open.type)) return "suppressed";
    notificationId = open.id;
    return (await upgrade(admin, opts.userId, open.id, notice)) ? (await push(true), "upgraded") : "failed";
  }

  notificationId = row.id;
  const { error } = await admin.from("notifications").insert(row);
  if (!error) {
    await push();
    return "created";
  }

  const code = (error as { code?: string } | null)?.code;

  // Column not migrated yet — behave exactly as before the visit ledger existed.
  // Tries dropping the NEWER column first (milestone, supabase/milestone-one-bell.sql)
  // so an environment that has visit_key but not milestone keeps its visit dedupe.
  if (code === "42703" || code === "PGRST204") {
    // Newest column first: lead_id (warm-lead-alerts.sql) — keep the visit
    // dedupe and the milestone ledger when only the contact stamp is missing.
    if ("lead_id" in row) {
      const { lead_id: _lid, ...withoutLead } = row as typeof row & { lead_id?: string };
      void _lid;
      const { error: e0 } = await admin.from("notifications").insert(withoutLead);
      if (!e0) { await push(); return "created"; }
    }
    const { milestone: _m, lead_id: _l2, ...withoutMilestone } = row as typeof row & { milestone?: string; lead_id?: string };
    void _m; void _l2;
    if ("milestone" in row) {
      const { error: e1 } = await admin.from("notifications").insert(withoutMilestone);
      if (!e1) { await push(); return "created"; }
    }
    const { visit_key: _unused, ...legacy } = withoutMilestone;
    void _unused;
    const { error: retryError } = await admin.from("notifications").insert(legacy);
    if (retryError) return "failed";
    await push();
    return "created";
  }

  // 23505 = a concurrent request opened this visit between the lookup above and
  // this insert. The unique index is the race backstop; fall into the same
  // upgrade-or-stay-quiet path rather than writing a second row.
  if (code === "23505") {
    const { data: existing } = await admin
      .from("notifications")
      .select("id, type")
      .eq("user_id", opts.userId)
      .eq("visit_key", key)
      .maybeSingle();
    if (!existing) {
      // The key is held by ANOTHER account's row (the unique index is on the
      // key alone, and this slug belonged to them minutes ago). Never touch
      // theirs: this owner still gets their own row, just outside the ledger.
      const { visit_key: _k, ...unkeyed } = row;
      void _k;
      const { error: e2 } = await admin.from("notifications").insert(unkeyed);
      if (e2) return "failed";
      await push();
      return "created";
    }
    if (rankOf(notice.type) <= rankOf(existing.type as string)) return "suppressed";
    notificationId = existing.id as string;
    return (await upgrade(admin, opts.userId, existing.id as string, notice)) ? (await push(true), "upgraded") : "failed";
  }

  return "failed";
}

/** Rewrite the visit's notification to say the newer, bigger thing. */
async function upgrade(
  admin: ReturnType<typeof getAdminSupabase>,
  userId: string,
  id: string,
  notice: VisitNotice,
): Promise<boolean> {
  const patch = {
    type: notice.type,
    title: notice.title,
    body: notice.body,
    read: false,
    // Sorts back to the top of the bell: this visit just became news again.
    created_at: new Date().toISOString(),
    // SET, NEVER CLEARED. A visit that crosses a milestone and then captures a
    // lead upgrades twice; the second upgrade must not wipe the ledger the
    // first one wrote, or the milestone announces itself again forever.
    ...(notice.milestone ? { milestone: notice.milestone } : {}),
    // Set when the upgrade is about a known contact; never cleared by a later
    // anonymous-shaped upgrade, for the same reason as the milestone.
    ...(notice.leadId ? { lead_id: notice.leadId } : {}),
  };
  const { error } = await admin.from("notifications").update(patch).eq("id", id).eq("user_id", userId);
  if (!error) return true;
  const code = (error as { code?: string } | null)?.code;
  if (notice.leadId && (code === "42703" || code === "PGRST204")) {
    const { lead_id: _l, ...withoutLead } = patch as typeof patch & { lead_id?: string };
    void _l;
    const { error: e1 } = await admin.from("notifications").update(withoutLead).eq("id", id).eq("user_id", userId);
    if (!e1) return true;
  }
  if (notice.milestone && (code === "42703" || code === "PGRST204")) {
    const { milestone: _m, ...withoutMilestone } = patch;
    void _m;
    const { error: retryError } = await admin.from("notifications").update(withoutMilestone).eq("id", id).eq("user_id", userId);
    return !retryError;
  }
  return false;
}
