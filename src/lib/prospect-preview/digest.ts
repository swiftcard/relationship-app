import { getAdminSupabase } from "@/lib/supabase-admin";
import { sendPushToUser } from "@/lib/push";
import { localHour } from "@/lib/push-policy";
import { notifyAdmin } from "@/lib/admin-notify";
import { adminUserIds } from "./alert";
import { claimUnannouncedBatches } from "./desk";
import { batchBrief, batchPush } from "./learn";
import { followUps, type FollowUp } from "./pipeline";
import { listPreviews } from "./store";

// ── Card Builder: "3 follow-ups due today" ──────────────────────────────────
// One push each morning there is somebody to chase, with the count (owner,
// 2026-11-13). The list itself, with each prospect's words ready and one tap
// to send them, is "Follow up today" on admin › Card Builder.
//
// Called on the hour by the same clock as the other morning pushes
// (.github/workflows/push-catchup.yml and the Supabase clock), so it decides
// for itself whether it is morning and whether today's has already gone:
//
//   • due from 8am New York time (the owner's; staff have no timezone of
//     their own on file) until 8pm, because the clock is best-effort
//   • once a day: the notification-center row is written first, under a key
//     with the day in it, and only the run that wrote it sends the push
//   • nothing due, nothing sent. This never tells anyone "0 follow-ups"
//
// It sends nothing to a prospect. Texts stay hand-sent.

export const DIGEST_TIMEZONE = "America/New_York";
export const DIGEST_FIRST_HOUR = 8;
export const DIGEST_LAST_HOUR = 20;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
const PATH = "/admin/card-builder/follow-up";

export const digestDue = (now: number): boolean => {
  const h = localHour(now, DIGEST_TIMEZONE);
  return h >= DIGEST_FIRST_HOUR && h < DIGEST_LAST_HOUR;
};

export const digestKey = (now: number): string => `prospect-follow-ups:${new Date(now).toLocaleDateString("en-CA", { timeZone: DIGEST_TIMEZONE })}`;

/** The words on the lock screen: the count, then who is first and why. */
export function digestText(list: FollowUp[], nameOf: (id: string) => string): { title: string; body: string } {
  const n = list.length;
  const first = list[0];
  const rest = n - 1;
  return {
    title: n === 1 ? "1 follow-up due today" : `${n} follow-ups due today`,
    body: `${nameOf(first.id)}: ${first.why}${rest > 0 ? ` And ${rest} more.` : ""}`.slice(0, 170),
  };
}

export type DigestResult = { sent: number; due: number; reason: "sent" | "not_morning" | "nothing_due" | "already_sent" | "not_ready" };

export async function sendFollowUpDigest(now: number = Date.now()): Promise<DigestResult> {
  if (!digestDue(now)) return { sent: 0, due: 0, reason: "not_morning" };
  const list = await listPreviews();
  if (!list.ready) return { sent: 0, due: 0, reason: "not_ready" };
  const due = followUps(list.rows, now);
  if (!due.length) return { sent: 0, due: 0, reason: "nothing_due" };

  const byId = new Map(list.rows.map((r) => [r.id, r]));
  const { title, body } = digestText(due, (id) => byId.get(id)?.owner_name ?? "A prospect");

  // The claim: a plain insert, so the unique key refuses a second run today.
  const { error } = await getAdminSupabase().from("admin_notifications").insert({
    kind: "prospects", severity: "important", title, body, href: PATH, dedupe_key: digestKey(now), meta: { due: due.length },
  });
  if (error) return { sent: 0, due: due.length, reason: error.code === "23505" ? "already_sent" : "not_ready" };

  const ids = await adminUserIds();
  const results = await Promise.all(ids.map((userId) =>
    sendPushToUser(userId, { title, body, url: `${APP_URL}${PATH}`, tag: "prospect-follow-ups", category: "prospect_view" }).then(() => 1).catch(() => 0),
  ));
  return { sent: results.reduce<number>((a, b) => a + b, 0), due: due.length, reason: "sent" };
}

// ── "22 drafts ready to approve" ────────────────────────────────────────────
// One push when a /build batch finishes (owner, 2026-11-13). The command-line
// tool that runs a batch can't push (it holds no push keys, and is pinned to
// send nothing), so it only marks the batch finished; this, on the same clock
// as the digest, announces it. An overnight batch that finishes at 3am waits
// for the morning: it is news, not an alarm.

//
//   /build now      announced as soon as it finishes, between 8am and 10pm
//   /build tonight  "ready by 8am": announced from 8am, never the evening it
//                   was started (a batch typed at 9pm that finishes at 9:40pm
//                   says so at 8 the next morning, with the day's first coffee)

export const BATCH_PUSH_FIRST_HOUR = 8;
export const BATCH_PUSH_LAST_HOUR = 22;
export const TONIGHT_PUSH_LAST_HOUR = 18;
/** Which kinds of batch may be announced at this hour (New York). */
export function batchKindsDue(now: number): ("now" | "tonight")[] {
  const h = localHour(now, DIGEST_TIMEZONE);
  if (h < BATCH_PUSH_FIRST_HOUR || h >= BATCH_PUSH_LAST_HOUR) return [];
  return h < TONIGHT_PUSH_LAST_HOUR ? ["now", "tonight"] : ["now"];
}

export async function announceBatches(now: number = Date.now()): Promise<{ announced: number }> {
  const batches = await claimUnannouncedBatches(batchKindsDue(now), new Date(now));
  if (!batches.length) return { announced: 0 };
  const list = await listPreviews();
  const rows = list.ready ? list.rows : [];
  const ids = await adminUserIds();
  for (const b of batches) {
    const { title, body } = batchPush(batchBrief(b, rows));
    await notifyAdmin({ kind: "prospects", title, body, href: "/admin/card-builder", dedupeKey: `prospect-batch:${b.id}` });
    await Promise.all(ids.map((userId) =>
      sendPushToUser(userId, { title, body, url: `${APP_URL}/admin/card-builder`, tag: `prospect-batch-${b.id}`, category: "prospect_view" }).catch(() => {}),
    ));
  }
  return { announced: batches.length };
}
