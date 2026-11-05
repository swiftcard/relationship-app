import { after } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import type { BotFamily } from "@/lib/bot-detection";
import type { GeoAccuracy } from "@/lib/request-geo";

// ── Why a request was, or was not, counted ───────────────────────────────────
//
// THE GAP THIS FILLS. The pipeline makes a chain of honest decisions — bot,
// prefetch, the owner's own visit, a same-visit reload, a card that no longer
// serves, a rate limit — and then throws away every request it declines. So
// "why is that view missing?" and "is that view real?" were both unanswerable,
// and the only way to judge the classifier was to argue about it. On
// 2026-09-09 the evidence for every finding in the analytics audit had to be
// reconstructed by hand from the surviving rows.
//
// WHAT IT IS NOT. It is not a second analytics pipeline and no customer-facing
// number may ever be computed from it. card_views remains the one source of
// counted truth; this records the DECISION, not the traffic. The 14-day
// retention in supabase/analytics-accuracy.sql is part of that: a log that
// cannot be summed over a quarter cannot quietly become a shadow warehouse.
//
// WHAT IT MUST NEVER CARRY. No raw IP, no User-Agent, no name, email or phone —
// a decision log about people is still about people. The visitor is identified
// the same pseudonymous way card_views identifies them (the browser id), the bot
// signal is a family NAME rather than the UA that matched it, and the location
// is only ever the confidence level, never the place.
//
// Shaped after push_log and error_events, the two precedents in this project
// for a small, self-trimming, service-role-only decision log.

export type IngestReason =
  /** A card_views row was written. */
  | "recorded"
  /** Real, and already counted in this visit — a reload, a double-fire, a retry. */
  | "deduped"
  /** The owner looking at their own card. */
  | "self"
  /** SwiftCard's own staff (an ADMIN_EMAILS session) opening a customer's
   *  card — from /admin, a support check, a demo account. Not a visitor. */
  | "staff"
  /** The slug doesn't serve: deleted, taken offline, or past a plan limit. */
  | "inactive"
  /** Cloud/datacenter egress that is not a consumer privacy relay — a crawler
   *  or render farm with a browser-shaped User-Agent. See request-geo.ts for
   *  why this is separable from Private Relay traffic, which still counts. */
  | "hosting"
  /** Positive User-Agent match (see classification for which family). */
  | "bot"
  /** Announced prefetch/prerender/link-preview load — a speculative fetch. */
  | "prefetch"
  /** Over the per-IP cap on a public endpoint. */
  | "rate_limited"
  /** Refused before anything else: unknown event type, missing slug. */
  | "rejected"
  /** Arrived at /api/views, which no longer records anything (see that route).
   *  Its own reason so a client still calling it is visible, not silent. */
  | "retired_endpoint"
  /** The write failed. The visitor is unaffected; the row is simply lost. */
  | "error";

export type IngestDecision = {
  product: "swiftcard" | "swiftlinks";
  /** The card_views key: "<slug>" or "<slug>__links", so a row joins onto the
   *  counted table without anyone having to re-derive the suffix. */
  entityKey: string;
  eventType: string;
  surface?: "card" | "links" | null;
  counted: boolean;
  reason: IngestReason;
  classification?: BotFamily | "human" | "datacenter" | null;
  classificationReason?: string | null;
  source?: string | null;
  identityLevel?: "confirmed" | "associated" | "anonymous" | null;
  geoAccuracy?: GeoAccuracy | null;
  geoSource?: string | null;
  isRelay?: boolean | null;
  notified?: "created" | "upgraded" | "suppressed" | "failed" | "not_eligible" | null;
  visitorId?: string | null;
  visitKey?: string | null;
};

/**
 * Record one ingest decision. Fire-and-forget, and impossible to fail loudly.
 *
 * after(), not a bare floating promise: a serverless function can freeze the
 * moment it responds, which would cut an unawaited insert off mid-flight — the
 * same reason the CRM syncs and the lead notification use it. after() keeps the
 * instance alive until this settles WITHOUT delaying the response, so the
 * visitor never waits on a log line.
 *
 * Every failure is swallowed, including the table not existing yet. Analytics
 * observability must never be the reason a card stops loading or a contact
 * stops being captured.
 */
export function logIngest(decision: IngestDecision): void {
  try {
    after(
      (async () => {
        try {
          await getAdminSupabase().from("analytics_ingest_log").insert({
            product: decision.product,
            entity_key: decision.entityKey,
            event_type: decision.eventType,
            surface: decision.surface ?? null,
            counted: decision.counted,
            reason: decision.reason,
            classification: decision.classification ?? null,
            classification_reason: decision.classificationReason ?? null,
            source: decision.source ?? null,
            identity_level: decision.identityLevel ?? null,
            geo_accuracy: decision.geoAccuracy ?? null,
            geo_source: decision.geoSource ?? null,
            is_relay: decision.isRelay ?? null,
            notified: decision.notified ?? null,
            visitor_id: decision.visitorId ?? null,
            visit_key: decision.visitKey ?? null,
          });
        } catch {
          /* table not migrated, or Supabase unreachable — never surfaces */
        }
      })(),
    );
  } catch {
    // after() throws outside a request scope (a unit test, a script). The log
    // line is optional; the caller is not.
  }
}
