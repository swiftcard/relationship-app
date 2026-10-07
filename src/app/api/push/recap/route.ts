import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { sendPushToUser } from "@/lib/push";
import { insertNotification } from "@/lib/notify";
import { readPushPrefs } from "@/lib/push-policy";
import { isOfficePlan } from "@/lib/plan";
import { followUpState, type FollowUpStep } from "@/lib/lead-followup";
import {
  alertTeam, firstNameOf, formatCount, nextTeamMilestone, noCardCopy, noFollowUpCopy, teamAlertRecipients,
  teamPushContext, teamPushThread, TEAM_LEAD_MILESTONES, TEAM_VIEW_MILESTONES,
} from "@/lib/team-alerts";
import { displayLabelFrom } from "@/lib/office-notify";
import { officeNotificationPath } from "@/lib/office-notification-links";
import { isRecapHour, isTeamCheckHour, isTeamRecapBellHour, noticeGivenToday, personalRecapCopy, rankPlaces, teamRecapCopy } from "@/lib/weekly-recap";

// ── The hourly notification sweep: Monday recaps + the daily team check ─────
//
// Owner, 2026-09-22. Called by .github/workflows/push-catchup.yml on an hourly
// schedule that GitHub runs only a few times a day (same secret as the morning
// catch-up, for the same Hobby-plan reason). So each part has a WINDOW, not an
// hour, and decides for itself whether it is due (lib/weekly-recap):
//
//   1. WEEKLY RECAP — due all Monday from 9am in each person's own zone. One
//      push each: an Office admin (of a team with at least one teammate) gets
//      the TEAM's week, everyone else their own. Marked in push_log BEFORE
//      sending, so a duplicate run cannot buzz twice. Nothing for an empty week.
//   2. TEAM CHECK — due from 9am to midnight in the owner's zone, every day,
//      per office with a team or an open invitation: leads with no follow-up
//      24h on (only ones not already announced), teammates two days in with no
//      card, a team milestone crossed, invitations that expired (bell only),
//      and on Mondays the team's week in the admin bell. Grouped — one row
//      names everyone it is about. Every piece is ledgered in
//      office_notifications, so reruns are no-ops, and "leads waiting" / "no
//      card yet" go out at most once a day (noticeGivenToday).
//
// Pushes go through sendPushToUser: the person's switches, quiet hours and the
// team_alert cap of two a day all still apply.

export const runtime = "nodejs";
export const maxDuration = 60;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
const DAY = 24 * 3600 * 1000;
const RECAP_MARK = "recap";

type Admin = ReturnType<typeof getAdminSupabase>;

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const accepted = [process.env.PUSH_CATCHUP_SECRET, process.env.CRON_SECRET]
    .filter((s): s is string => Boolean(s))
    .map((s) => `Bearer ${s}`);
  // An unset secret must never authorize (`Bearer undefined`).
  return accepted.length > 0 && !!auth && accepted.includes(auth);
}

/** Every slug a set of users' cards answer to, including the Swift Links key. */
async function slugsFor(admin: Admin, userIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!userIds.length) return out;
  const { data } = await admin.from("cards").select("user_id, username").in("user_id", userIds);
  for (const c of data ?? []) {
    const list = out.get(c.user_id as string) ?? [];
    if (c.username) list.push(c.username as string);
    out.set(c.user_id as string, list);
  }
  return out;
}
const viewKeys = (slugs: string[]) => slugs.flatMap((s) => [s, `${s}__links`]);

type Team = { officeId: string; ownerId: string; name: string | null; memberIds: string[] };

// Every table read below is PAGED. PostgREST stops an unpaged select at 1,000
// rows without saying so, and this job used to read push_subscriptions and
// office_members whole — past the 1,000th row, recaps and team checks would
// silently skip people (2026-10-02 notification audit).
const PAGE = 1000;

/** Offices with at least one active teammate: officeId → the team. */
async function teams(admin: Admin): Promise<Map<string, Team>> {
  const byOffice = new Map<string, string[]>();
  for (let from = 0; ; from += PAGE) {
    const { data: members } = await admin.from("office_members").select("office_id, user_id")
      .eq("status", "active").order("id").range(from, from + PAGE - 1);
    for (const m of members ?? []) {
      if (!m.user_id) continue;
      byOffice.set(m.office_id as string, [...(byOffice.get(m.office_id as string) ?? []), m.user_id as string]);
    }
    if (!members || members.length < PAGE) break;
  }
  const out = new Map<string, Team>();
  if (!byOffice.size) return out;
  const { data: offices } = await admin.from("offices").select("id, owner_id, name").in("id", [...byOffice.keys()]);
  for (const o of offices ?? []) {
    out.set(o.id as string, {
      officeId: o.id as string, ownerId: o.owner_id as string, name: (o.name as string | null) ?? null,
      memberIds: byOffice.get(o.id as string) ?? [],
    });
  }
  return out;
}

/**
 * Only teams whose owner is STILL on the Office plan. The offices row outlives
 * the subscription on purpose (re-subscribing restores the team), so an office
 * existing proves nothing: a lapsed owner with a leftover pending invite was
 * being sent "leads waiting" and "team milestone" alerts about their own cards,
 * into a team inbox they can no longer open (2026-10-02 audit). Same test as
 * requireOfficeCapability (lib/office-roles) and officeIsLive (lib/office-notify).
 */
async function liveTeams(admin: Admin, all: Map<string, Team>): Promise<Map<string, Team>> {
  const ownerIds = [...new Set([...all.values()].map((t) => t.ownerId).filter(Boolean))];
  const planOf = new Map<string, string | null>();
  for (let i = 0; i < ownerIds.length; i += 200) {
    const { data } = await admin.from("profiles").select("id, plan").in("id", ownerIds.slice(i, i + 200));
    for (const p of data ?? []) planOf.set(p.id as string, (p.plan as string | null) ?? null);
  }
  return new Map([...all].filter(([, t]) => isOfficePlan(planOf.get(t.ownerId) ?? null)));
}

async function alreadyRecapped(admin: Admin, userId: string, now: number): Promise<boolean> {
  const { data } = await admin.from("push_log").select("id")
    .eq("user_id", userId).eq("outcome", RECAP_MARK)
    .gte("created_at", new Date(now - 6 * DAY).toISOString()).limit(1);
  return !!data?.length;
}

async function markRecap(admin: Admin, userId: string, plan: string): Promise<void> {
  await admin.from("push_log").insert({ user_id: userId, category: "weekly_recap", plan, outcome: RECAP_MARK, endpoints: 0 });
}

async function teamWeek(admin: Admin, team: { ownerId: string; memberIds: string[] }, now: number) {
  const people = [team.ownerId, ...team.memberIds];
  const slugs = await slugsFor(admin, people);
  const since = new Date(now - 7 * DAY).toISOString();

  // Team totals only — no "who led" (owner, 2026-10-06: the console is a
  // window onto the team, not a race between teammates).
  let views = 0, leads = 0, quiet = 0;
  for (const uid of people) {
    const s = slugs.get(uid) ?? [];
    if (!s.length) continue;
    const [{ count: v }, { count: l }] = await Promise.all([
      admin.from("card_views").select("id", { count: "exact", head: true }).in("username", viewKeys(s)).gte("viewed_at", since),
      admin.from("leads").select("id", { count: "exact", head: true }).in("card_owner", s).not("tags", "cs", "{demo}").gte("created_at", since),
    ]);
    const pv = v ?? 0, pl = l ?? 0;
    views += pv; leads += pl;
    if (uid !== team.ownerId && pv === 0) quiet++;
  }
  return { views, leads, quiet };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = getAdminSupabase();
  const now = Date.now();
  const counts = { recapsPersonal: 0, recapsTeam: 0, teamChecks: 0, leadsWaiting: 0, membersNoCard: 0, milestones: 0, invitesExpired: 0 };

  const allTeams = await liveTeams(admin, await teams(admin));
  // Who receives the TEAM recap instead of their own: admins of a real team.
  const teamOf = new Map<string, Team>();
  for (const t of allTeams.values()) {
    for (const uid of await teamAlertRecipients(t.officeId)) teamOf.set(uid, t);
  }

  // ── 1. Monday recaps ──────────────────────────────────────────────────────
  // EVERY account, not only those with a phone registered. This loop used to be
  // driven by push_subscriptions, so the bell row — the recap the docs promise
  // every plan — never reached anyone who had not turned on notifications
  // (2026-10-02 audit; the team week had the same gap, fixed in part 2 below).
  // sendPushToUser is a logged no-op for someone with no device.
  const profiles = new Map<string, Record<string, unknown>>();
  for (let from = 0; ; from += PAGE) {
    const { data } = await admin.from("profiles").select("id, plan, customization").order("id").range(from, from + PAGE - 1);
    for (const p of data ?? []) profiles.set(p.id as string, p);
    if (!data || data.length < PAGE) break;
  }
  const userIds = [...profiles.keys()];
  for (const userId of userIds) {
    try {
      const profile = profiles.get(userId);
      // A deleted account (inside its 30-day reopen window) hears nothing.
      if ((profile?.customization as { _deleted?: boolean } | null)?._deleted) continue;
      const prefs = readPushPrefs(profile?.customization);
      if (prefs.weekly_recap === false) continue;
      if (!isRecapHour(now, prefs.timezone)) continue;
      if (await alreadyRecapped(admin, userId, now)) continue;
      const plan = (profile?.plan as string | null) ?? "free";

      const team = teamOf.get(userId);
      if (team) {
        const copy = teamRecapCopy(await teamWeek(admin, team, now));
        if (!copy) continue;
        await markRecap(admin, userId, plan);
        // One bell row per office per week, however many admins it has.
        const { data: had } = await admin.from("office_notifications").select("id")
          .eq("office_id", team.officeId).eq("type", "team_weekly_recap")
          .gte("created_at", new Date(now - 6 * DAY).toISOString()).limit(1);
        if (!had?.length) await alertTeam(team.officeId, { type: "team_weekly_recap", title: copy.title, body: copy.body });
        // "Team · <office>" and the team thread, like every team push — so a
        // Monday lock screen never confuses the team week for their own.
        await sendPushToUser(userId, {
          category: "weekly_recap", title: copy.title, body: copy.body,
          url: `${APP_URL}${officeNotificationPath("team_weekly_recap")}`, tag: "weekly-recap-team",
          context: teamPushContext(team.name), thread: teamPushThread(team.officeId),
        });
        counts.recapsTeam++;
        continue;
      }

      const slugs = (await slugsFor(admin, [userId])).get(userId) ?? [];
      if (!slugs.length) continue;
      const since = new Date(now - 7 * DAY).toISOString();
      const [{ data: views }, { count: contacts }, { count: viewCount }] = await Promise.all([
        // Rows give the places (the top few are all the copy needs); the COUNT
        // comes from an exact count below — rows stop at PostgREST's 1000 cap,
        // so "Your week: N views" could never say more than 1,000.
        admin.from("card_views").select("location").in("username", viewKeys(slugs)).gte("viewed_at", since).limit(1000),
        admin.from("leads").select("id", { count: "exact", head: true }).in("card_owner", slugs).not("tags", "cs", "{demo}").gte("created_at", since),
        admin.from("card_views").select("id", { count: "exact", head: true }).in("username", viewKeys(slugs)).gte("viewed_at", since),
      ]);
      const copy = personalRecapCopy({
        views: viewCount ?? views?.length ?? 0,
        contacts: contacts ?? 0,
        places: rankPlaces((views ?? []).map((v) => v.location as string | null)),
      });
      if (!copy) continue;
      await markRecap(admin, userId, plan);
      // The bell row carries the marked place: blurred for Free, like any view.
      await insertNotification({ user_id: userId, type: "weekly_recap", title: copy.title, body: copy.body });
      await sendPushToUser(userId, { category: "weekly_recap", title: copy.title, body: copy.body, url: `${APP_URL}/dashboard`, tag: "weekly-recap" });
      counts.recapsPersonal++;
    } catch (e) {
      console.error("[push] recap failed for a user:", e instanceof Error ? e.message : e);
    }
  }

  // ── 2. The daily team check ───────────────────────────────────────────────
  // Every office with a teammate — and every office still waiting on an
  // invitation, whose first expired invite used to go unmentioned because the
  // office had nobody active yet.
  const candidates = new Map(allTeams);
  {
    const pendingOffices = new Set<string>();
    for (let from = 0; ; from += PAGE) {
      const { data: pending } = await admin.from("office_members").select("office_id")
        .eq("status", "pending").order("id").range(from, from + PAGE - 1);
      for (const p of pending ?? []) pendingOffices.add(p.office_id as string);
      if (!pending || pending.length < PAGE) break;
    }
    const extra = [...pendingOffices].filter((id) => !candidates.has(id));
    for (let i = 0; i < extra.length; i += 200) {
      const { data: offices } = await admin.from("offices").select("id, owner_id, name").in("id", extra.slice(i, i + 200));
      for (const o of offices ?? []) {
        candidates.set(o.id as string, { officeId: o.id as string, ownerId: o.owner_id as string, name: (o.name as string | null) ?? null, memberIds: [] });
      }
    }
  }
  // The pending-only offices are exactly where a lapsed owner hides: re-check.
  const toCheck = await liveTeams(admin, candidates);
  for (const team of toCheck.values()) {
    try {
      const { data: owner } = await admin.from("profiles").select("customization").eq("id", team.ownerId).maybeSingle();
      const ownerTz = readPushPrefs(owner?.customization).timezone;
      if (!isTeamCheckHour(now, ownerTz)) continue;
      counts.teamChecks++;

      const people = [team.ownerId, ...team.memberIds];
      const slugMap = await slugsFor(admin, people);
      const slugs = [...slugMap.values()].flat();

      // Who each person is, by first name — so grouped news can say WHO:
      // their card's name, else the name the admin typed on the invite, else
      // their address.
      const [{ data: cardNames }, { data: roster }] = await Promise.all([
        admin.from("cards").select("user_id, name").in("user_id", people),
        admin.from("office_members").select("user_id, invite_name, invite_email, joined_at")
          .eq("office_id", team.officeId).eq("status", "active"),
      ]);
      const nameOf = new Map<string, string>();
      for (const c of cardNames ?? []) {
        if (c.name && !nameOf.has(c.user_id as string)) nameOf.set(c.user_id as string, firstNameOf(c.name as string));
      }
      for (const m of roster ?? []) {
        const uid = m.user_id as string | null;
        if (uid && !nameOf.has(uid)) nameOf.set(uid, firstNameOf(displayLabelFrom(m.invite_name as string | null, m.invite_email as string | null)));
      }
      const who = (uid: string | undefined) => (uid && nameOf.get(uid)) || "A teammate";

      // The team's week in the admin bell, every Monday, whether or not any
      // admin has a phone registered. Part 1 only reaches people with a push
      // device, so an owner who never turned on notifications never saw the
      // team's week anywhere. One row per office per week (part 1 may already
      // have written it this run).
      if (team.memberIds.length && isTeamRecapBellHour(now, ownerTz)) {
        const { data: had } = await admin.from("office_notifications").select("id")
          .eq("office_id", team.officeId).eq("type", "team_weekly_recap")
          .gte("created_at", new Date(now - 6 * DAY).toISOString()).limit(1);
        if (!had?.length) {
          const copy = teamRecapCopy(await teamWeek(admin, team, now));
          if (copy) await alertTeam(team.officeId, { type: "team_weekly_recap", title: copy.title, body: copy.body });
        }
      }

      if (slugs.length) {
        // Leads a day old (but not older than a week — stale leads are the
        // Leads tab's job, not a phone's) with NO follow-up set up: the state
        // the admin Leads table shows as "No follow-up" and opens filtered to.
        // It used to be "still marked New" — a status nothing in the product
        // can change any more, so every lead was announced a day after it came
        // in. Only ones not yet announced; never the sample contact every new
        // card starts with (lib/demo-contact).
        const ownerOfSlug = new Map<string, string>();
        for (const [uid, list] of slugMap) for (const s of list) ownerOfSlug.set(s.toLowerCase(), uid);
        const { data: recent } = await admin.from("leads").select("id, card_owner, follow_up_sequence, tags")
          .in("card_owner", slugs)
          .not("tags", "cs", "{demo}")
          .lte("created_at", new Date(now - DAY).toISOString())
          .gte("created_at", new Date(now - 7 * DAY).toISOString())
          .limit(500);
        const stuck = (recent ?? []).filter((l) =>
          followUpState(l.follow_up_sequence as FollowUpStep[] | null, l.tags as string[] | null) === "none");
        if (stuck.length) {
          const { data: prior } = await admin.from("office_notifications").select("meta, created_at")
            .eq("office_id", team.officeId).eq("type", "leads_waiting")
            .gte("created_at", new Date(now - 8 * DAY).toISOString());
          const told = new Set<string>((prior ?? []).flatMap((r) => ((r.meta as { leadIds?: string[] } | null)?.leadIds ?? [])));
          if (!noticeGivenToday(prior, now) && stuck.some((l) => !told.has(l.id as string))) {
            // One row for the whole team, naming whose leads they are.
            const perPerson = new Map<string, number>();
            for (const l of stuck) {
              const uid = ownerOfSlug.get(String(l.card_owner ?? "").toLowerCase()) ?? "";
              perPerson.set(uid, (perPerson.get(uid) ?? 0) + 1);
            }
            const copy = noFollowUpCopy([...perPerson].map(([uid, n]) => ({ name: who(uid || undefined), n })));
            await alertTeam(team.officeId, {
              type: "leads_waiting",
              title: copy.title,
              body: copy.body,
              meta: { leadIds: stuck.map((l) => l.id as string) },
              push: { body: copy.pushBody },
            });
            counts.leadsWaiting++;
          }
        }

        // Team milestones — all-time totals, each round number once, ever.
        // CARD views only (no "__links" keys): the milestone says "card views"
        // and opens the Team tab, whose Card views tile counts the card alone.
        const [{ count: totalViews }, { count: totalLeads }] = await Promise.all([
          admin.from("card_views").select("id", { count: "exact", head: true }).in("username", slugs),
          admin.from("leads").select("id", { count: "exact", head: true }).in("card_owner", slugs).not("tags", "cs", "{demo}"),
        ]);
        const { data: ms } = await admin.from("office_notifications").select("meta")
          .eq("office_id", team.officeId).eq("type", "team_milestone");
        // A row records its own rung AND every lower one it jumped past (meta.also),
        // so an office that crossed several at once never hears about the lower ones later.
        const announced = (kind: string) => (ms ?? [])
          .map((r) => r.meta as { kind?: string; n?: number; also?: number[] } | null)
          .filter((m) => m?.kind === kind)
          .flatMap((m) => [m!.n as number, ...(m!.also ?? [])]);
        const viewHit = nextTeamMilestone(totalViews ?? 0, TEAM_VIEW_MILESTONES, announced("views"));
        const leadHit = nextTeamMilestone(totalLeads ?? 0, TEAM_LEAD_MILESTONES, announced("leads"));
        // Leads first: if both crossed on one day, that is the one to buzz for;
        // the other still gets its bell row.
        for (const [kind, hit, push] of [["leads", leadHit, true], ["views", viewHit, !leadHit]] as const) {
          if (!hit) continue;
          const ladder = kind === "leads" ? TEAM_LEAD_MILESTONES : TEAM_VIEW_MILESTONES;
          await alertTeam(team.officeId, {
            type: "team_milestone",
            title: `Your team passed ${formatCount(hit)} ${kind === "leads" ? "contacts" : "card views"} 🎉`,
            body: kind === "leads" ? "Every contact your team has captured, all time." : "Every view of your team's cards, all time.",
            // Record every rung reached, so a jump past several never announces the lower ones later.
            meta: { kind, n: hit, also: ladder.filter((x) => x < hit) },
            ...(push ? { push: {} } : {}),
          });
          counts.milestones++;
        }
      }

      // Teammates who joined two or more days ago and still have no card:
      // they can't share anything, and the admin is the one who can nudge
      // them. Each person is announced once, ever (meta.userIds is the
      // ledger); the row names everyone still without one. A month on it is
      // the Team tab's job, not a notification's.
      const noCard = (roster ?? []).filter((m) => {
        const uid = m.user_id as string | null;
        const joined = m.joined_at ? Date.parse(m.joined_at as string) : NaN;
        return !!uid && !(slugMap.get(uid)?.length) && joined <= now - 2 * DAY && joined >= now - 30 * DAY;
      });
      if (noCard.length) {
        const { data: priorNoCard } = await admin.from("office_notifications").select("meta, created_at")
          .eq("office_id", team.officeId).eq("type", "members_no_card");
        const toldNoCard = new Set<string>((priorNoCard ?? []).flatMap((r) => ((r.meta as { userIds?: string[] } | null)?.userIds ?? [])));
        if (!noticeGivenToday(priorNoCard, now) && noCard.some((m) => !toldNoCard.has(m.user_id as string))) {
          const copy = noCardCopy(noCard.map((m) => who(m.user_id as string)));
          await alertTeam(team.officeId, {
            type: "members_no_card",
            title: copy.title,
            body: copy.body,
            meta: { userIds: noCard.map((m) => m.user_id as string) },
            push: {},
          });
          counts.membersNoCard++;
        }
      }

      // Invitations that ran out unanswered in the last week — bell only.
      const { data: expired } = await admin.from("office_members").select("id, invite_name, invite_email, expires_at")
        .eq("office_id", team.officeId).eq("status", "pending")
        .lte("expires_at", new Date(now).toISOString())
        .gte("expires_at", new Date(now - 7 * DAY).toISOString());
      if (expired?.length) {
        const { data: noted } = await admin.from("office_notifications").select("meta")
          .eq("office_id", team.officeId).eq("type", "invite_expired");
        const done = new Set((noted ?? []).map((r) => (r.meta as { memberId?: string } | null)?.memberId));
        for (const inv of expired) {
          if (done.has(inv.id as string)) continue;
          const invitee = displayLabelFrom(inv.invite_name as string | null, inv.invite_email as string | null);
          await alertTeam(team.officeId, {
            type: "invite_expired",
            title: `${invitee}'s invitation expired`,
            body: inv.invite_email
              ? `${inv.invite_email} never accepted. Send it again from the Team tab — the seat is still yours.`
              : "They never accepted. Send it again from the Team tab — the seat is still yours.",
            meta: { memberId: inv.id },
          });
          counts.invitesExpired++;
        }
      }
    } catch (e) {
      console.error("[push] team check failed for an office:", e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true, ...counts });
}
