import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { sendPushToUser } from "@/lib/push";
import { isPaidPlan } from "@/lib/plan";
import { unlockedLeadBody } from "@/lib/notification-privacy";
import {
  localHour, quietWindowStart, readPushPrefs, QUIET_END_HOUR, QUIET_WINDOW_MS, type PushCategory,
} from "@/lib/push-policy";
import { contactMayPush } from "@/lib/contact-return-notify";
import { hasMarkedName } from "@/lib/contact-privacy";
import { teamAlertRecipients, teamPushContext, teamPushThread } from "@/lib/team-alerts";
import { officeNotificationPath } from "@/lib/office-notification-links";
import type { OfficeNotificationType } from "@/lib/office-notify";

// ── The morning after quiet hours ────────────────────────────────────────────
//
// Quiet hours hold everything between 10pm and 8am, billing included, and that
// rule is right: nothing SwiftCard has to say is worth waking someone for. But
// held used to mean DROPPED. A lead who handed over their details at 10:30pm
// produced a log line saying "quiet_hours" and then nothing — no banner that
// night, and no banner in the morning either. The owner found out whenever they
// next happened to open the app, which for the notification that matters most
// in the product is the failure this whole file exists to fix.
//
// So: one push, at 8am in the person's OWN timezone, saying what came in while
// they were asleep. One, not a replay — a night of five events must not become
// five buzzes at breakfast.
//
// WHERE THE COPY COMES FROM. Not a queue. Every held push left a bell row
// behind (lib/visit-notify.ts writes the row first and pushes second), so the
// news is already written, already scoped to this user, and already safe to
// show — a locked free lead's row says "… shared their info — open to unlock",
// never an upgrade pitch. Reading it back is strictly better than storing a
// copy of the payload that could drift from it.
//
// WHY THE WINDOW IS EXACTLY QUIET HOURS. A row written at 9:30pm was pushed
// normally; re-announcing it in the morning would be telling someone something
// they were already told. Only rows created after quiet hours began can have
// been held, so only those are candidates.

export const runtime = "nodejs";
export const maxDuration = 60;

type Row = Record<string, unknown>;

/** Written by this route, read by this route: the once-a-day idempotency mark. */
const CATCHUP_OUTCOME = "catchup";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// Which bell rows could have been held by quiet hours — i.e. the ones whose
// producer asked for a push. A milestone is deliberately absent: it is bell-only
// news that never had a push to hold (lib/push-policy.ts), and a "50 views"
// banner at 8am would be the product cheering at someone, not their news.
const CATEGORY_FOR_TYPE: Record<string, PushCategory> = {
  card_viewed: "card_view",
  contact_saved: "contact_saved",
  // A known contact coming back (lib/contact-return-notify.ts). The row's
  // title carries their name in a mark; sendPushToUser makes it "A contact"
  // on a Free lock screen, exactly as the live push does.
  contact_returned: "contact_return",
  contact_engaged: "contact_return",
  new_lead: "new_lead",
  lead_reply: "lead_reply",
  payment_failed: "billing_problem",
};

/** Biggest news first. Same order as the visit ledger's ranks, plus billing. */
const RANK: Record<PushCategory, number> = {
  billing_problem: 5,
  new_lead: 4,
  lead_reply: 4,
  contact_return: 3.5,
  contact_saved: 3,
  card_view: 1,
  meeting_booked: 2,
  // Never held overnight in practice (the recap goes at 9am, team alerts at
  // send time or 9am), and neither writes a personal bell row this reads —
  // listed so the ranking is total.
  team_alert: 2.5,
  weekly_recap: 0.5,
};

// Team news an admin's phone was sent (lib/team-alerts `push`), and so could
// have been held overnight: a teammate joining at 11pm, or the team check
// landing at the OWNER's 9am — which is still quiet hours for an admin in
// another timezone. These live in office_notifications, which this job used to
// never read, so held team news was simply lost (2026-10-02 notification
// audit). Bell-only team rows (invite_expired, invite_declined, member_left)
// never had a push to hold, and the Monday team recap goes at 9am.
const TEAM_PUSH_TYPES = ["member_joined", "member_first_lead", "leads_waiting", "members_no_card", "team_milestone"];

type TeamRow = { officeId: string; officeName: string | null; type: string; title: string; body: string | null; created_at: string };

const PAGE = 1000;

/** The catch-up is due from the end of quiet hours (8am) until this hour. */
const CATCHUP_LAST_HOUR = 20;

function destinationFor(category: PushCategory, cardOwner: string | null): string {
  const card = cardOwner ? `?card=${encodeURIComponent(cardOwner)}` : "";
  if (category === "billing_problem") return `${APP_URL}/settings/flows?billing=1`;
  // A contact who is waiting on a reply belongs in Contacts; a view belongs on
  // the dashboard that shows it. Both are the same screens the live pushes use.
  if (category === "new_lead" || category === "lead_reply" || category === "contact_return") return `${APP_URL}/contacts${card}`;
  return `${APP_URL}/dashboard${card}`;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  // Two accepted credentials, because this job cannot be a Vercel cron.
  //
  // 8am local is a different hour in every timezone, so this has to run hourly
  // — and the account is on Vercel's HOBBY plan, where crons are limited to two
  // per project and to ONCE A DAY each. (Adding an hourly one does not warn:
  // it makes every subsequent deployment fail validation, which is how this was
  // found.) The caller is .github/workflows/push-catchup.yml instead, on
  // GitHub's scheduler, which is free and has no such limit.
  //
  // CRON_SECRET stays accepted so the job can move back onto a Vercel cron the
  // day the plan allows it, with no code change.
  const accepted = [process.env.PUSH_CATCHUP_SECRET, process.env.CRON_SECRET]
    .filter((s): s is string => Boolean(s))
    .map((s) => `Bearer ${s}`);
  // A secret that is unset must never authorize: `Bearer undefined` would
  // otherwise be a valid credential for anyone who guessed it.
  if (!accepted.length || !auth || !accepted.includes(auth)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = getAdminSupabase();
  const now = Date.now();
  const counts = { subscribers: 0, atEight: 0, alreadyDone: 0, nothingHeld: 0, sent: 0 };

  // Driven by DEVICES, not by profiles: someone with no push subscription has
  // nothing to catch up on, and this runs every hour of every day.
  // PAGED: an unpaged select stops at PostgREST's 1,000-row cap without saying
  // so, and everyone past the 1,000th device silently lost their mornings.
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data: subs, error } = await admin.from("push_subscriptions").select("user_id").order("id").range(from, from + PAGE - 1);
    if (error) {
      console.error("[push] catch-up could not read subscriptions:", error.message);
      return NextResponse.json({ error: "read_failed" }, { status: 500 });
    }
    for (const s of subs ?? []) ids.add(s.user_id as string);
    if (!subs || subs.length < PAGE) break;
  }
  const userIds = [...ids];
  counts.subscribers = userIds.length;

  // Unread team news from the last 12 hours, keyed by each admin who was sent
  // it. Read once for the run; each person's own quiet window filters it below.
  const teamRowsFor = new Map<string, TeamRow[]>();
  try {
    const { data: recent } = await admin.from("office_notifications")
      .select("office_id, type, title, body, created_at")
      .eq("read", false)
      .in("type", TEAM_PUSH_TYPES)
      .gte("created_at", new Date(now - 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(PAGE);
    const officeIds = [...new Set((recent ?? []).map((r) => r.office_id as string))];
    if (officeIds.length) {
      const { data: offices } = await admin.from("offices").select("id, name").in("id", officeIds);
      const nameOf = new Map((offices ?? []).map((o) => [o.id as string, (o.name as string | null) ?? null]));
      for (const officeId of officeIds) {
        // teamAlertRecipients: the owner and roles that see team analytics,
        // and nobody once the team has lapsed — the same people the live push
        // went to.
        const recipients = await teamAlertRecipients(officeId);
        const rows: TeamRow[] = (recent ?? []).filter((r) => r.office_id === officeId).map((r) => ({
          officeId, officeName: nameOf.get(officeId) ?? null,
          type: r.type as string, title: r.title as string, body: (r.body as string | null) ?? null, created_at: r.created_at as string,
        }));
        for (const uid of recipients) teamRowsFor.set(uid, [...(teamRowsFor.get(uid) ?? []), ...rows]);
      }
    }
  } catch { /* team news is extra; never cost anyone their own morning */ }

  // Read the profiles in batches rather than one per subscriber. This runs
  // every hour of every day and almost nobody in it is at 8am — a round trip
  // each would be the whole cost of the job, paid 23 times for nothing.
  const profiles = new Map<string, Row>();
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await admin
      .from("profiles").select("id, plan, customization").in("id", userIds.slice(i, i + 200));
    for (const p of data ?? []) profiles.set(p.id as string, p as Row);
  }

  for (const userId of userIds) {
    try {
      const profile = profiles.get(userId);
      const prefs = readPushPrefs(profile?.customization);
      const paid = isPaidPlan((profile?.plan as string | null) ?? null);

      // Nothing was ever held for someone who switched quiet hours off.
      if (prefs.quietHours === false) continue;
      // NO TIMEZONE, NO CATCH-UP. The send path falls back to UTC when it does
      // not know someone's zone, and guessing here would be worse than the gap
      // it fills: 8am UTC is 4am on the east coast, so the notification meant to
      // rescue a lead from silence would instead be the 4am buzz the quiet-hours
      // rule exists to prevent. TimezoneSync learns the zone on the next launch;
      // until then this person is simply skipped.
      if (!prefs.timezone) continue;
      // 8am, or 9am if the scheduler was late. GitHub's cron is best-effort and
      // can lag under load; a strict equality would silently skip a person's
      // whole morning over a twenty-minute delay. The once-a-day mark below is
      // what keeps the wider window from meaning two notifications.
      //
      // NOT ONLY 8–9am ANY MORE (2026-10-05). The scheduler is a GitHub cron
      // that runs a few times a day, not hourly — 01:42, 08:35 and 18:04 UTC on
      // 2026-10-05 — so an 8–9am slot was usually missed and the catch-up
      // simply never came. It is now due from 8am until 8pm (two hours before
      // quiet hours start again), still once a day, and still only for news
      // that is UNREAD: open the app first and there is nothing to send.
      const hour = localHour(now, prefs.timezone) % 24;
      if (hour < QUIET_END_HOUR || hour >= CATCHUP_LAST_HOUR) continue;
      counts.atEight++;

      // Once a day, even if the cron fires twice in the hour.
      const { data: already } = await admin
        .from("push_log")
        .select("id")
        .eq("user_id", userId)
        .eq("outcome", CATCHUP_OUTCOME)
        .gte("created_at", new Date(now - 14 * 3600 * 1000).toISOString()) // spans the whole 8am–8pm window
        .limit(1);
      if (already?.length) { counts.alreadyDone++; continue; }

      // Everything written during quiet hours that they have not already seen.
      // Unread matters: someone who woke at 3am, opened the app and read it all
      // does not need to be told again at 8.
      const { data: rows } = await admin
        .from("notifications")
        .select("type, title, body, card_owner, created_at, lead_id")
        .eq("user_id", userId)
        .eq("read", false)
        // The real 10pm boundary in their zone, not `now − 10h`: a cron that
        // runs late must still read the whole night (see quietWindowStart).
        .gte("created_at", new Date(quietWindowStart(now, prefs.timezone)).toISOString())
        // …and BEFORE quiet hours ended. Now that this can run in the
        // afternoon, a row written at 10am — pushed live, nothing held — must
        // not be announced again as "while you were away".
        .lt("created_at", new Date(quietWindowStart(now, prefs.timezone) + QUIET_WINDOW_MS).toISOString())
        .order("created_at", { ascending: false })
        .limit(50);

      type Held = { row: Row; category: PushCategory; team?: TeamRow };
      let held: Held[] = (rows ?? [])
        .map((r) => ({ row: r as Row, category: CATEGORY_FOR_TYPE[r.type as string] }))
        .filter((x): x is Held =>
          // A category switched OFF is a decision the person made; the morning
          // must not be a way around it.
          Boolean(x.category) && prefs[x.category] !== false);

      // Their team's held news, under the Team alerts switch.
      if (prefs.team_alert !== false) {
        const since = quietWindowStart(now, prefs.timezone);
        for (const t of teamRowsFor.get(userId) ?? []) {
          const at = new Date(t.created_at).getTime();
          if (at < since || at >= since + QUIET_WINDOW_MS) continue; // held overnight only
          held.push({ row: { type: t.type, title: t.title, body: t.body, card_owner: null, created_at: t.created_at, lead_id: null }, category: "team_alert", team: t });
        }
        held.sort((a, b) => String(b.row.created_at).localeCompare(String(a.row.created_at)));
      }

      // ── The contacts the owner silenced ─────────────────────────────────
      // A contact marked Not interested / Closed is held from the phone at
      // produce time by stripping the push category (card-events,
      // contact-return-notify).
      // The bell row carries no trace of that, so read back naively this
      // morning would announce exactly the contact they silenced. Same rules,
      // re-applied. A read failure keeps the old behaviour rather than
      // dropping the whole night.
      const contactRows = held.filter((x) => x.category === "contact_return" && x.row.lead_id);
      if (contactRows.length) {
        try {
          const ids = [...new Set(contactRows.map((x) => String(x.row.lead_id)))];
          const { data: leads } = await admin.from("leads").select("id, status").in("id", ids);
          const byId = new Map((leads ?? []).map((l) => [l.id as string, l]));
          const allowed = (leadId: string): boolean => {
            const l = byId.get(leadId);
            if (!l) return true;
            if (!contactMayPush({ status: l.status as string | null })) return false;
            return true;
          };
          held = held.filter((x) => x.category !== "contact_return" || !x.row.lead_id || allowed(String(x.row.lead_id)));
        } catch { /* keep every held row */ }
      }

      if (!held.length) { counts.nothingHeld++; continue; }

      // The biggest thing that happened, newest first within a tie — `rows` is
      // already newest-first, and sort() is stable, so ranking alone is enough.
      const top = [...held].sort((a, b) => RANK[b.category] - RANK[a.category])[0];
      const extra = held.length - 1;

      // MARKED BEFORE SENDING. A crash between the two costs one morning's
      // catch-up; the other order costs a duplicate, and a phone buzzing twice
      // with the same news is the complaint this product has already had.
      await admin.from("push_log").insert({
        user_id: userId,
        category: top.category,
        plan: (profile?.plan as string | null) ?? "free",
        outcome: CATCHUP_OUTCOME,
        endpoints: 0,
      });

      // A LOCKED Free lead (its name is marked, api/leads): the live push says a
      // plain "New contact" / "Someone shared their info — open to unlock.",
      // because "New contact: a contact" is what the marked title becomes on a
      // Free lock screen. The morning says exactly what the night would have.
      const lockedLead = !paid && top.row.type === "new_lead" && hasMarkedName(String(top.row.title ?? ""));
      const contactUrl = top.row.lead_id
        ? `${APP_URL}/contacts?${top.row.card_owner ? `card=${encodeURIComponent(String(top.row.card_owner))}&` : ""}lead=${encodeURIComponent(String(top.row.lead_id))}`
        : null;
      await sendPushToUser(userId, {
        category: top.category,
        // The headline is the news itself, exactly as the bell wrote it ("New
        // contact: Dana Whitfield"). The count goes in the body, where it
        // cannot push the name off the line.
        title: lockedLead ? "New contact" : String(top.row.title ?? "While you were away"),
        body: extra > 0
          ? `Plus ${extra} more while you were away.`
          : lockedLead
            ? "Someone shared their info — open to unlock."
          // A contact locked overnight and unlocked by an upgrade before 8am
          // must not reach a paid lock screen as "— open to unlock".
          : paid && top.row.type === "new_lead"
            ? unlockedLeadBody(String(top.row.body ?? ""))
            : String(top.row.body ?? ""),
        // The same screen the live push opens: a new contact or a reply opens
        // THAT contact (the bell row carries lead_id since 2026-10-02); one
        // returning contact on Pro opens that contact, on Free (the name is
        // withheld) that card's dashboard, where the row waits in the bell; team
        // news opens the admin screen the team bell row opens.
        url: top.team
          ? `${APP_URL}${officeNotificationPath(top.team.type as OfficeNotificationType)}`
          : extra === 0 && (top.category === "new_lead" || top.category === "lead_reply") && contactUrl
          ? contactUrl
          : extra === 0 && top.category === "contact_return" && contactUrl
          ? paid
            ? contactUrl
            : `${APP_URL}/dashboard${top.row.card_owner ? `?card=${encodeURIComponent(String(top.row.card_owner))}` : ""}`
          : destinationFor(top.category, (top.row.card_owner as string | null) ?? null),
        // Team news says which team, and sits in that team's thread, like every
        // team push (lib/team-alerts).
        ...(top.team ? { context: teamPushContext(top.team.officeName), thread: teamPushThread(top.team.officeId) } : {}),
        // Name the card only when the whole night was about ONE card — "Card:
        // Work" over "Plus 3 more" would be wrong if the others were elsewhere.
        cardOwner: held.every((h) => (h.row.card_owner ?? null) === (top.row.card_owner ?? null))
          ? ((top.row.card_owner as string | null) ?? null)
          : null,
        // One collapse id: a retry replaces this morning's banner instead of
        // stacking a second one beside it.
        tag: "catchup",
        catchup: true,
      });
      counts.sent++;
    } catch (e) {
      // One account's bad row must never stop the morning for everyone behind it.
      console.error(`[push] catch-up failed for ${userId}:`, e);
    }
  }

  return NextResponse.json(counts);
}
