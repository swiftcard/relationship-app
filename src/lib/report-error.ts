// ── Central error reporter ──────────────────────────────────────────────────
// Every unexpected failure in a critical path (billing webhook, cron, CRM sync)
// should flow through here so it's both (a) greppable in Vercel logs as
// structured JSON and (b) optionally pushed to a chat webhook for real-time
// alerts. This is intentionally dependency-free — no SDK to fight Next's build.
//
// Set ALERT_WEBHOOK_URL to a Slack or Discord *incoming webhook* URL to get
// pinged when something breaks. Without it, errors are still structured-logged.
//
// Never throws: reporting an error must not itself break the path that failed.

import { isRateLimited } from "@/lib/rate-limit";

const ALERT_URL = process.env.ALERT_WEBHOOK_URL;
const APP_ENV = process.env.VERCEL_ENV || process.env.NODE_ENV || "development";

/**
 * Stable grouping key for "the same bug". Numbers, uuids, and quoted values are
 * stripped so `card 41 not found` and `card 92 not found` group together —
 * otherwise every occurrence looks like a brand-new incident and the watchdog's
 * dedupe cannot hold.
 */
function fingerprintOf(context: string, message: string): string {
  const shape = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/["'`][^"'`]{0,80}["'`]/g, "<v>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return `${context}|${shape}`;
}

export async function reportError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>,
): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));
  const payload = {
    level: "error",
    context,
    message: err.message,
    stack: err.stack,
    env: APP_ENV,
    ...(extra ? { extra } : {}),
  };

  // (a) Structured log — always. Vercel captures stderr; log drains can alert on it.
  try {
    console.error(`[error] ${JSON.stringify(payload)}`);
  } catch {
    console.error("[error]", context, err.message);
  }

  // A storm of one bug (a bad deploy under launch traffic) must not become
  // thousands of database writes and chat posts. Rows are capped per
  // fingerprint, not collapsed to one: Bo's detector (marketing-agents/lib/
  // detectors.mjs) needs 3+ rows in 15 min to call it an incident. The chat
  // alert says it once per 10 min. A limiter failure falls through to
  // reporting — losing an alert is worse than sending a duplicate.
  const fingerprint = fingerprintOf(context, err.message);
  const STORM_WINDOW = 10 * 60 * 1000;
  const rowCapped = await isRateLimited(`report-error:row:${fingerprint}`, 20, STORM_WINDOW).catch(() => false);

  // (b) Durable row — so something can READ this back. The console line above
  // is ephemeral and needs a Vercel token to reach; this is what lets Bo watch
  // for crashes with the Supabase key the agents already hold. Fire-and-forget
  // and fully swallowed: if the table is missing (migration not yet applied) or
  // Supabase is down, the path that failed must not fail twice.
  if (!rowCapped) {
    try {
      const { getAdminSupabase } = await import("@/lib/supabase-admin");
      await getAdminSupabase().from("error_events").insert({
        context,
        message: err.message.slice(0, 2000),
        stack: err.stack?.slice(0, 8000) ?? null,
        env: APP_ENV,
        fingerprint,
        ...(extra ? { extra } : {}),
      });
    } catch {
      /* durable sink is best-effort — the structured log above is the fallback */
    }
  }

  // (c) Real-time chat alert — only if a webhook is configured. Short-timeout,
  // best-effort; a down webhook must never delay or break the caller.
  // Not for client.* reports: their text comes from an UNAUTHENTICATED POST
  // (/api/client-error), so forwarding it let anyone write "🚨 SwiftCard error"
  // messages — links included — into the ops channel (security audit
  // 2026-09-24). They still land in (a) and (b) above.
  if (
    ALERT_URL &&
    !context.startsWith("client.") &&
    !(await isRateLimited(`report-error:alert:${fingerprint}`, 1, STORM_WINDOW).catch(() => false))
  ) {
    const text = `🚨 *SwiftCard error* [${APP_ENV}] — *${context}*\n${err.message}`;
    try {
      await fetch(ALERT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `text` works for Slack, `content` for Discord — sending both is
        // harmless (each ignores the key it doesn't use).
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      /* alerting is best-effort — the structured log above is the source of truth */
    }
  }
}
