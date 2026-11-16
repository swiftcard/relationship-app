// ── Card Builder's Mac agent: Messages.app and its database ──────────────────
// Sending goes through AppleScript (osascript), on the iMessage service ONLY:
// a number that isn't on iMessage fails there instead of going out as a green
// SMS. What happened to a sent message, and who replied, is read from the
// Messages database (~/Library/Messages/chat.db), read-only, which needs Full
// Disk Access for the Node that runs the agent (docs/card-builder-mac.md).

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const CHAT_DB = join(homedir(), "Library", "Messages", "chat.db");
/** chat.db keeps time as nanoseconds since 2001-01-01. */
const APPLE_EPOCH_S = 978307200;
export const appleTime = (ms) => BigInt(Math.floor(ms / 1000 - APPLE_EPOCH_S)) * 1_000_000_000n;

const SEND_SCRIPT = `
on run argv
  set theNumber to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    set svc to 1st account whose service type = iMessage
    try
      set target to participant theNumber of svc
    on error
      set target to buddy theNumber of svc
    end try
    send theText to target
  end tell
end run`;

/** Hand one message to Messages.app, on iMessage. Throws with Messages' own words when it refuses. */
export async function sendIMessage(e164, text) {
  await run("/usr/bin/osascript", ["-e", SEND_SCRIPT, e164, text], { timeout: 30_000 });
}

/** Rows from chat.db as objects, or null when it can't be read (no Full Disk Access yet). */
export async function queryChatDb(sql) {
  if (!existsSync(CHAT_DB)) return null;
  try {
    const { stdout } = await run("/usr/bin/sqlite3", ["-readonly", "-json", CHAT_DB, sql], { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout.trim() ? JSON.parse(stdout) : [];
  } catch {
    return null;
  }
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Has this number only ever been an SMS conversation on this Mac? Then it
 * isn't on iMessage (or wasn't when last texted): skip it without trying.
 * Null when there is no history either way, or chat.db can't be read.
 */
export async function knownNotIMessage(e164) {
  const rows = await queryChatDb(`select service from handle where id = ${q(e164)}`);
  if (!rows || !rows.length) return null;
  return rows.every((r) => r.service === "SMS");
}

/**
 * What became of the message just sent to `e164`: "delivered", "sms" (it went,
 * but as a green text), "failed"
 * (Messages couldn't deliver it on iMessage), "sent" (left this Mac, delivery
 * not confirmed yet) or "unknown" (chat.db can't be read).
 */
export async function outcomeOf(e164, sinceMs) {
  const rows = await queryChatDb(`
    select m.error as error, m.is_delivered as delivered, m.is_sent as sent, m.service as service
    from message m join handle h on m.handle_id = h.ROWID
    where m.is_from_me = 1 and h.id = ${q(e164)} and m.date >= ${appleTime(sinceMs - 5000)}
    order by m.date desc limit 1`);
  if (rows === null) return "unknown";
  const m = rows[0];
  if (!m) return "unknown";
  if (Number(m.error) !== 0) return "failed";
  if (m.service && m.service !== "iMessage") return "sms";
  if (Number(m.delivered) === 1) return "delivered";
  return Number(m.sent) === 1 ? "sent" : "pending";
}

/** Replies from these numbers since a chat.db row id: [{ rowid, phone, text }]. */
export async function repliesFrom(phones, afterRowId) {
  if (!phones.length) return [];
  const rows = await queryChatDb(`
    select m.ROWID as rowid, h.id as phone, m.text as text
    from message m join handle h on m.handle_id = h.ROWID
    where m.is_from_me = 0 and m.ROWID > ${Number(afterRowId) || 0} and h.id in (${phones.map(q).join(",")})
    order by m.ROWID asc limit 500`);
  return rows ?? [];
}

export async function latestRowId() {
  const rows = await queryChatDb("select max(ROWID) as id from message");
  return rows?.[0]?.id ?? 0;
}

/**
 * "Stop", "unsubscribe", "remove me", "don't text me", "wrong number": they
 * never hear from us again. The one-word carrier keywords only count as the
 * WHOLE reply, so "End of day works" or "Cancel my 3pm, call at 4" is a hot
 * lead, not an opt-out.
 */
export const STOP_RE = /^\s*(?:(?:stop|stop all|unsubscribe|cancel|end|quit|stopall)\s*[.!]*\s*$|(?:please\s+)?(?:stop texting|remove me|take me off|do ?n[o']t (?:text|message|contact)|not interested|wrong number|leave me alone|unsubscribe me)\b)/i;
