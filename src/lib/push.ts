import webpush from "web-push";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isApnsEndpoint, sendApnsBadge, sendApnsDetailed } from "@/lib/apns";
import { isFcmEndpoint, sendFcmDetailed } from "@/lib/fcm";
import { reportError as reportServerError } from "@/lib/report-error";
import { assertSafeUrl } from "@/lib/safe-fetch";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { stripLocationMarks, teaseLocation } from "@/lib/location-privacy";
import { genericNames, stripNameMarks } from "@/lib/contact-privacy";
import { NATIVE_HIDDEN_TYPES } from "@/lib/native-notification-copy";
import { FREE_STATE_TYPES } from "@/lib/notification-privacy";
import {
  decidePush, fitBody, fitBodyKeepingPlace, readPushPrefs, pushCardTag, cardTagLine, MAX_TITLE_CHARS, OWN_CAP, UNCAPPED, VIEW_ROLLUP_TAG, SOFT_CAP_CATEGORIES,
  type PushCategory, type PushCardRow,
} from "@/lib/push-policy";

// web-push POSTs to whatever host the stored endpoint names. Endpoints are
// validated at registration, but a hostname can rebind to a private IP after
// storage — so re-assert public-internet safety at SEND time too (SSRF
// defense-in-depth). Rejects quietly: a bad endpoint just isn't delivered.
async function endpointIsSafeToSend(endpoint: string): Promise<boolean> {
  try {
    await assertSafeUrl(new URL(endpoint));
    return true;
  } catch {
    return false;
  }
}

/**
 * Send one push, if policy allows it.
 *
 * EVERY push in the product goes through here, and every one of them must name
 * its category — that is what makes "only these five things may interrupt
 * someone" enforceable rather than a comment. There is deliberately no way to
 * send an uncategorised push.
 *
 * NO PLAN CHECK. Free, trial, Pro and Office are treated identically: the
 * subscription rows are read by user id and nothing here looks at a plan. The
 * plan is recorded on the log line so we can prove that, not to branch on it.
 */
export async function sendPushToUser(userId: string, payload: {
  title: string;
  body: string;
  url: string;
  tag?: string;
  /** Set by the policy, never by a caller: no sound, no screen — see PushMode. */
  silent?: boolean;
  category: PushCategory;
  /** The known contact this push is about (contact_return): counted for the
   *  one-per-contact-per-day cap and written to push_log.lead_id. */
  leadId?: string | null;
  /**
   * The slug of the card this is about. For an account with 2+ cards the push
   * then SAYS which card ("Card: Work") — see pushCardTag. Every producer that
   * knows the card passes it; account-level news (billing) has none.
   */
  cardOwner?: string | null;
  /** The 8am catch-up only — see PolicyInput.catchup. */
  catchup?: boolean;
  /**
   * WHOSE news this is, when no card tag says it: "Team · Harbor Realty" on an
   * Office admin's team pushes (lib/team-alerts), so a lock screen tells the
   * team's news from their own card's.
   */
  context?: string | null;
  /** iOS notification group (aps thread-id). Defaults to the tag. */
  thread?: string;
}) {
  const admin = getAdminSupabase();

  // One read for the switches, the timezone and the plan. The plan is for the
  // log only — see the note above.
  const { data: profile } = await admin
    .from("profiles")
    .select(PLAN_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  const prefs = readPushPrefs(profile?.customization);
  const plan = (profile?.plan as string | null) ?? "free";
  // effectivePlan: an expired timed grant is Free now, not at the next cron.
  const paid = isPaidProfile(profile);

  const log = async (outcome: string, endpointCount = 0) => {
    try {
      const row: Record<string, unknown> = {
        user_id: userId,
        category: payload.category,
        plan,
        outcome,
        endpoints: endpointCount,
      };
      const { error } = await admin.from("push_log").insert(payload.leadId ? { ...row, lead_id: payload.leadId } : row);
      // lead_id arrives with supabase/warm-lead-alerts.sql; before that, the
      // row is still worth having without it.
      if (error && payload.leadId && (error.code === "42703" || error.code === "PGRST204")) {
        await admin.from("push_log").insert(row);
      }
    } catch { /* a logging failure must never stop a notification */ }
  };

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let cappedSentToday = 0;
  let lastViewPushAt: number | null = null;
  let lastViewUpdateAt: number | null = null;
  let contactReturnSentToday = 0;
  let sameContactSentToday = 0;
  let teamAlertSentToday = 0;
  let softSentToday = 0;
  // Every view that reached this function since the hour's alert: the alert
  // itself, the silent updates after it, and the ones the update throttle held
  // back. That total is what the running-count banner says, so it must count
  // the held-back ones too or the number visibly skips.
  const viewAttemptsSinceAlert: number[] = [];
  try {
    const { data: recent } = await admin
      .from("push_log")
      .select("category, outcome, created_at")
      .eq("user_id", userId)
      // "sent" alone can no longer answer these questions: a silent update logs
      // "rollup" and a held-back one logs "batched", and both are views that
      // happened. Still a closed list — a "no_subscription" row is not a view.
      .in("outcome", ["sent", "rollup", "batched"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    for (const row of recent ?? []) {
      const cat = row.category as PushCategory;
      const outcome = row.outcome as string;
      const at = Date.parse(row.created_at as string);
      // The cap counts real interruptions only — never a silent update, never
      // something that was suppressed.
      if (outcome === "sent" && !UNCAPPED.includes(cat) && !OWN_CAP.includes(cat)) cappedSentToday++;
      if (outcome === "sent" && cat === "contact_return") contactReturnSentToday++;
      if (outcome === "sent" && cat === "team_alert") teamAlertSentToday++;
      if (outcome === "sent" && SOFT_CAP_CATEGORIES.includes(cat)) softSentToday++;
      if (cat !== "card_view") continue;
      if (outcome === "sent" && (!lastViewPushAt || at > lastViewPushAt)) lastViewPushAt = at;
      if (outcome === "rollup" && (!lastViewUpdateAt || at > lastViewUpdateAt)) lastViewUpdateAt = at;
      viewAttemptsSinceAlert.push(at);
    }
  } catch {
    // Log table missing (pre-migration): no history means no cap and no batch
    // window. Sending is the safe direction — the alternative is silently
    // dropping every notification in the product.
  }

  // One push per contact per day (decision D4). Asked separately and only for
  // this category: push_log.lead_id may not be migrated yet, and a failed
  // filter must never take the whole cap history down with it.
  if (payload.category === "contact_return" && payload.leadId) {
    const { count, error } = await admin
      .from("push_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("category", "contact_return")
      .eq("outcome", "sent")
      .eq("lead_id", payload.leadId)
      .gte("created_at", since);
    if (!error) sameContactSentToday = count ?? 0;
  }

  const verdict = decidePush({
    category: payload.category, prefs, cappedSentToday, lastViewPushAt, lastViewUpdateAt,
    contactReturnSentToday, sameContactSentToday, teamAlertSentToday, softSentToday,
    catchup: payload.catchup === true,
  });
  if (!verdict.send) {
    await log(verdict.reason);
    return;
  }

  // ── The silent running count ────────────────────────────────────────────
  // Same notification, replaced in place: one collapse id for the counter, no
  // sound, and the newest view's own sentence underneath the number. The alert
  // that opened the hour keeps its VISIT tag and is left alone — it may since
  // have been upgraded to "…shared their info with you", and overwriting that
  // with a view count would be a downgrade.
  const isUpdate = verdict.mode === "update";
  const alertAt = lastViewPushAt;
  const viewsThisHour = alertAt
    ? viewAttemptsSinceAlert.filter((at) => at >= alertAt).length + 1
    : 1;

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subs?.length) { await log("no_subscription"); return; }

  // The lock screen truncates BOTH lines; do it ourselves, on word boundaries.
  // Title and body have different budgets because the OS gives them different
  // room — trimming only the body still let a long name be cut mid-word.
  //
  // An update's headline is the COUNT ("6 views in the last hour") and its body
  // stays the newest view's own sentence, so the banner keeps saying who and
  // where while the number climbs. "views", never "people": card_views counts
  // visits, and one person returning after thirty minutes counts again — the
  // same honesty rule the milestones copy is held to (lib/milestones.ts).
  // WHERE A LOCK SCREEN LOSES THE LOCATION. The place a view came from is a
  // Pro feature, and a push cannot blur anything — so for a Free account the
  // place is shaded out in one fixed shape ("Sam viewed your Swift Links in
  // ▒▒▒▒▒, ▒▒." — lib/location-privacy teaseLocation, owner 2026-09-22). A
  // paid account keeps it, with the invisible marks removed.
  // Every push in the product goes through here, so no producer can forget.
  //
  // The same rule for a KNOWN CONTACT'S NAME (lib/contact-privacy.ts): a Free
  // lock screen says "A contact re-opened your card", a paid one says "Priya".
  const plainBody = (s: string) =>
    paid ? stripNameMarks(stripLocationMarks(s)) : teaseLocation(genericNames(s));
  payload = {
    ...payload,
    title: fitBody(isUpdate ? `${viewsThisHour} views in the last hour` : plainBody(payload.title), MAX_TITLE_CHARS),
    // The place survives the trim: it ends the sentence, and on Pro it is the
    // point of the notification (lib/push-policy fitBodyKeepingPlace).
    body: fitBodyKeepingPlace(payload.body, plainBody),
    ...(isUpdate ? { tag: VIEW_ROLLUP_TAG, silent: true } : {}),
  };

  // WHICH CARD. One extra read, and only once we know a device will receive
  // this. Best-effort: a failed lookup sends the notification untagged rather
  // than not at all.
  let cardLine: string | null = null;
  if (payload.cardOwner) {
    try {
      const { data: cards } = await admin
        .from("cards")
        .select("username, label, name, company")
        .eq("user_id", userId);
      const tag = pushCardTag((cards ?? []) as PushCardRow[], payload.cardOwner);
      cardLine = tag ? cardTagLine(tag) : null;
    } catch { /* untagged */ }
  }
  // iOS has a real line for it (aps.alert.subtitle, between title and body). A
  // browser notification has only title + body, so there it leads the body on a
  // line of its own — never the title, which the OS truncates first.
  // The same line carries "Team · <office>" on an Office admin's team news
  // (payload.context); a card tag wins, as the more specific of the two.
  const line = cardLine ?? (payload.context?.trim() || null);
  // THE ICON'S RED NUMBER (iOS only; 2026-10-06 notification audit) — see
  // unreadBadgeCount. The app re-sets the exact number from the bell as it is
  // read (lib/app-badge), and reading on the website re-sends it
  // (syncAppBadge), so this only has to be right when the push lands.
  const badge = subs.some((s) => isApnsEndpoint(s.endpoint))
    ? await unreadBadgeCount(admin, userId, paid)
    : undefined;
  const apnsPayload = { ...payload, ...(line ? { subtitle: line } : {}), ...(badge !== undefined ? { badge } : {}) };
  const webPayload = line ? { ...payload, body: `${line}\n${payload.body}` } : payload;

  // Native iOS devices register with an "apns:<token>" endpoint and go through
  // APNs; browser subscriptions keep going through web-push. Both prune their
  // dead endpoints the same way.
  const apnsSubs = subs.filter((s) => isApnsEndpoint(s.endpoint));
  const fcmSubs = subs.filter((s) => isFcmEndpoint(s.endpoint));
  // EVERYTHING ELSE is a browser subscription. This filter has to name every
  // native prefix explicitly: it used to read `!isApnsEndpoint(...)` alone,
  // which would hand an Android "fcm:<token>" row to web-push, whose job is to
  // POST to the endpoint AS A URL. That is not a crash — it is one
  // "blocked-endpoint" line in the failure list and a notification nobody ever
  // receives, so Android push would appear to work and silently never arrive.
  const webSubs = subs.filter((s) => !isApnsEndpoint(s.endpoint) && !isFcmEndpoint(s.endpoint));

  // Every send resolves to whether it REACHED a device. The old accounting
  // counted any settled promise as delivered, so an APNs rejection — including
  // the one that deleted the subscription — was logged as "sent": the log said
  // pushes were going out for a week in which not one arrived.
  const sends: Promise<boolean>[] = [];
  const failures: string[] = [];

  for (const sub of apnsSubs) {
    sends.push(
      sendApnsDetailed(sub.endpoint, apnsPayload).then(async (r) => {
        if (r.result === "sent") return true;
        if (r.result === "gone") {
          // Both Apple environments disowned it, or Apple said Unregistered.
          // An uninstalled app is ordinary life, not a fault — prune and move on.
          await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          return false;
        }
        failures.push(`apns ${r.result} ${r.status} ${r.reason}`.trim());
        return false;
      }).catch((e) => { failures.push(`apns threw ${e instanceof Error ? e.message : String(e)}`); return false; })
    );
  }

  // Android. Same accounting and same pruning rule as APNs above: only a real
  // delivery counts as true, and only an explicit "this device is gone" is
  // allowed to delete the row. Android gets `webPayload`, not `apnsPayload`:
  // there is no subtitle line on Android, so the card/team line has to lead the
  // body or it is lost.
  for (const sub of fcmSubs) {
    sends.push(
      sendFcmDetailed(sub.endpoint, webPayload).then(async (r) => {
        if (r.result === "sent") return true;
        if (r.result === "gone") {
          await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          return false;
        }
        failures.push(`fcm ${r.result} ${r.status} ${r.reason}`.trim());
        return false;
      }).catch((e) => { failures.push(`fcm threw ${e instanceof Error ? e.message : String(e)}`); return false; })
    );
  }

  if (webSubs.length && process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    webpush.setVapidDetails(
      "mailto:hello@swiftcard.me",
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    const payloadStr = JSON.stringify(webPayload);
    for (const sub of webSubs) {
      sends.push(
        endpointIsSafeToSend(sub.endpoint).then(async (safe): Promise<boolean> => {
          if (!safe) { failures.push("web blocked-endpoint"); return false; }
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payloadStr
            );
            return true;
          } catch (err) {
            const code = (err as { statusCode?: number })?.statusCode;
            if (code === 404 || code === 410) {
              // Expired browser subscription: prune, not a fault.
              await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
              return false;
            }
            failures.push(`web ${code ?? "error"}`);
            return false;
          }
        })
      );
    }
  }

  if (!sends.length) { await log("no_deliverable_endpoint"); return; }
  const results = await Promise.allSettled(sends);
  const delivered = results.filter((r) => r.status === "fulfilled" && r.value === true).length;
  // A push nobody received is invisible by nature — the owner just stops hearing
  // from the product. Put Apple's / the browser's own reason where the uptime
  // and nightly checks already look (error_events), once per failed send.
  if (failures.length) {
    await reportServerError("push.delivery", new Error(`push not delivered (${payload.category}): ${[...new Set(failures)].join(" | ")}`), { userId }).catch(() => {});
  }
  // "rollup" is its own outcome and NOT "sent", deliberately: `sent` is what
  // opens and closes the one-alert-an-hour window and what the daily cap counts,
  // and a silent update must do neither — otherwise a busy afternoon would slide
  // the window forever and the owner would never hear the next real alert.
  // A rollup that reached nobody logs "failed" like anything else, so the
  // throttle doesn't hold back the next attempt on the strength of a no-op.
  await log(delivered ? (isUpdate ? "rollup" : "sent") : "failed", delivered);
  return results;
}

/**
 * THE ICON'S RED NUMBER: the unread rows the app's bell would count — the same
 * types it hides in the app (lib/native-notification-copy) and, for a paid
 * reader, the Free-state rows it never shows (lib/notification-privacy). Every
 * push and every badge sync reads it here, so the two can never disagree.
 * A failed count is undefined: send no badge, never a wrong one.
 */
async function unreadBadgeCount(
  admin: ReturnType<typeof getAdminSupabase>,
  userId: string,
  paid: boolean,
): Promise<number | undefined> {
  try {
    const excluded = ["referral_claim", ...NATIVE_HIDDEN_TYPES, ...(paid ? FREE_STATE_TYPES : [])];
    const { count, error } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("read", false)
      .not("type", "in", `(${excluded.join(",")})`);
    return error ? undefined : (count ?? 0);
  } catch {
    return undefined;
  }
}

/**
 * TELL THE PHONE THE NEW NUMBER after the bell changes on the WEBSITE — read,
 * marked unread, dismissed, cleared — on a computer or in a phone's browser.
 *
 * Every push sets the icon to the unread count, so without this a notification
 * read anywhere but the app left its number on the phone: the owner read and
 * cleared the bell and the "1" stayed (2026-10-07). Reading inside the app
 * needs none of this — the app sets the icon itself (lib/app-badge).
 *
 * A badge-only push (lib/apns buildApnsBadge): nothing shown, nothing heard,
 * and it works on every installed build. It is not a notification, so it is not
 * in push_log, no cap counts it, and quiet hours do not hold it — the person is
 * awake, they just read something. Best-effort: on any failure the icon keeps
 * its number until the next push carries the right one.
 */
export async function syncAppBadge(userId: string): Promise<void> {
  try {
    const admin = getAdminSupabase();
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint")
      .eq("user_id", userId);
    const phones = (subs ?? []).filter((s) => isApnsEndpoint(s.endpoint as string));
    if (!phones.length) return;

    const { data: profile } = await admin
      .from("profiles")
      .select(PLAN_COLUMNS)
      .eq("id", userId)
      .maybeSingle();
    const count = await unreadBadgeCount(admin, userId, isPaidProfile(profile));
    if (count === undefined) return;

    await Promise.all(phones.map(async (s) => {
      const endpoint = s.endpoint as string;
      const r = await sendApnsBadge(endpoint, count);
      // Same pruning rule as an alert: only Apple saying the phone is gone.
      if (r.result === "gone") await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
    }));
  } catch { /* the next push carries the right number */ }
}
