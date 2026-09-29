import { NextRequest, NextResponse, after } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { cardEventNotice, REPEAT_VISIT_LOOKBACK_MS } from "@/lib/card-event-notify";
import { dispatchCrmEvent } from "@/lib/crm-events";
import { getOwnerUsernames } from "@/lib/owner-usernames";
import { isCardActive } from "@/lib/card-active";
import { isRateLimited } from "@/lib/rate-limit";
import { isOwnerActivity, resolveOwnerId } from "@/lib/self-traffic";
import { attachVisitIdentity, deviceKeyFor, resolveVisitIdentity } from "@/lib/visit-identity";
import { authoritativeEventIdentity, corroboratedContact, resolveSessionViewer } from "@/lib/viewer-identity";
import { clientIp } from "@/lib/client-ip";
import { isLikelyBot, botFamily } from "@/lib/bot-detection";
import { logIngest, type IngestReason, type IngestDecision } from "@/lib/ingest-log";
import { resolveGeo, type GeoResult } from "@/lib/request-geo";
import { stripLocationMarks } from "@/lib/location-privacy";
import { stripNameMarks } from "@/lib/contact-privacy";
import { VIEW_VISIT_WINDOW_MS } from "@/lib/view-window";
import { recordView } from "@/lib/record-view";
import { resolveKnownContact, touchContactDevice } from "@/lib/known-contact";
import { bindViaLink, isContactToken } from "@/lib/contact-links";
import { contactReturnNotice, isLockedContact, isReturnVisit } from "@/lib/contact-return-notify";
import { isPaidPlan } from "@/lib/plan";
import { isLockedLead } from "@/lib/lead-access";
import { isPaidUser } from "@/lib/notification-privacy";
import { notifyVisit, visitKey } from "@/lib/visit-notify";
import type { PushCategory } from "@/lib/push-policy";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// The only event types this public endpoint accepts. Anything else used to be
// insertable verbatim — including forged "downloaded_vcard" rows that inflated
// the office contact-save stats and fired un-throttled notifications.
//
// clicked_link joined them when Swift Links buttons and card external links got
// tracking at all (they had none). It deliberately reaches NO notification:
// cardEventNotice returns null for it, so a tap writes a row, appears in the
// contact's timeline, and never rings anybody's phone. A page of eight links is
// eight taps, and none of them is news.
const EVENT_TYPES = new Set(["viewed_card", "downloaded_vcard", "clicked_link"]);

// A bounded string from an untrusted body, or null. Every stored field goes
// through this — a non-string or unbounded payload degrades to absent rather
// than becoming a permanent row value.
function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

// Public: called from card page without auth
/**
 * Separate visits this browser made to this page in the last 7 days, this one
 * included — for "3rd visit this week 👀" (lib/card-event-notify.ts). One
 * view event is recorded per visit per surface (view-visit-window), so a row
 * count IS a visit count. Best-effort: a failed read just loses the headline.
 */
async function countRecentVisits(
  admin: ReturnType<typeof getAdminSupabase>,
  cardOwner: string,
  visitorId: string,
  surface: "card" | "links",
): Promise<number | undefined> {
  try {
    const { count } = await admin
      .from("card_events")
      .select("id", { count: "exact", head: true })
      .eq("card_owner_username", cardOwner)
      .eq("visitor_id", visitorId)
      .eq("event_type", "viewed_card")
      .eq("surface", surface)
      .gte("created_at", new Date(Date.now() - REPEAT_VISIT_LOOKBACK_MS).toISOString());
    return count ?? undefined;
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const card_owner_username = str(body?.card_owner_username, 80);
    const client_visitor_id = str(body?.visitor_id, 64);
    const event_type = str(body?.event_type, 40);
    const source = str(body?.source, 48);
    const surface: "card" | "links" = body?.surface === "links" ? "links" : "card";
    const visitor_name = str(body?.visitor_name, 120);
    const visitor_email = str(body?.visitor_email, 200);
    const visitor_phone = str(body?.visitor_phone, 40);
    // Query strings carry tokens/session ids on referring sites — keep only
    // origin+path, same privacy stance as site-view's host-only referrers.
    const referrer_url = (str(body?.referrer_url, 300) ?? "").split(/[?#]/)[0] || null;
    const device_info = str(body?.device_info, 250);
    // WHICH link, for clicked_link. Normalised to a bare host on the client
    // (lib/track-link-click.ts) and re-bounded here like every other stored
    // field, because a client value is a client value.
    const target = str(body?.target, 120);
    // The link's own label, for "tapped your Listings link". clicked_link only.
    const target_label = event_type === "clicked_link" ? str(body?.target_label, 60) : null;
    // A per-contact link token (?ct=, lib/contact-links.ts). The tracker only
    // sends it AFTER the human gate, and only on a view.
    const contact_token = isContactToken(body?.contact_token) ? (body.contact_token as string) : null;

    if (!card_owner_username || !event_type || !EVENT_TYPES.has(event_type)) {
      // Nothing to log: with no slug there is no entity to attribute a decision
      // to, and a forged event type is noise, not a measurement.
      return NextResponse.json({ ok: true });
    }

    // ── The visitor's DURABLE identity ────────────────────────────────────────
    // Every row, every dedupe key and every conversation match below keys on
    // `visitor_id`, and until now that was whatever the page script had in
    // localStorage this millisecond. A browser that cannot keep that value
    // (an in-app browser, a fresh WKWebView, a partitioned or evicted store)
    // sent a new one on every load, so one visit wrote four rows and counted
    // four unique visitors. The sc_vid cookie is the durable answer, the
    // client's id is ADOPTED into it on first sight so no existing visitor
    // loses their history, and the device key below covers the browser that
    // can keep neither. See lib/visit-identity.ts.
    const visitIdentity = resolveVisitIdentity(req, client_visitor_id);
    const visitor_id = visitIdentity.visitorId;

    // ── Every exit from here on records WHY ───────────────────────────────────
    // The pipeline used to decline a request and keep no trace, so "why is that
    // view missing?" and "is that view real?" were both unanswerable. `decided`
    // writes one row to analytics_ingest_log and returns the same response the
    // caller always got — the response shape is unchanged, deliberately, because
    // a public endpoint must not start describing its internals to the client.
    // It is fire-and-forget and cannot fail loudly (lib/ingest-log.ts).
    const entityKey = surface === "links" ? `${card_owner_username}__links` : card_owner_username;
    const decided = (
      reason: IngestReason,
      // Named for what it is rather than `body` — the request body is already in
      // scope in this function, and shadowing it here is how that becomes a bug.
      responseFlags: Record<string, boolean> = {},
      extra: Partial<IngestDecision> = {},
    ) => {
      logIngest({
        product: surface === "links" ? "swiftlinks" : "swiftcard",
        entityKey,
        eventType: event_type,
        surface,
        counted: reason === "recorded",
        reason,
        source,
        visitorId: visitor_id,
        ...extra,
      });
      // The identity cookie rides on every exit, declined ones included: the
      // request that was just deduped is exactly the one whose next attempt
      // has to be recognisable as the same visit.
      return attachVisitIdentity(NextResponse.json({ ok: true, ...responseFlags }), visitIdentity);
    };

    // Public, unauthenticated, and both accepted events reach the card owner's
    // lock screen — cap per (IP, card) so a known/guessed username can't be
    // looped to flood that owner's notifications.
    const ip = clientIp(req)
      ?? "unknown";
    if (await isRateLimited(`card-events:${ip}:${card_owner_username}`, 20, 10 * 60 * 1000)) {
      return decided("rate_limited", { rateLimited: true });
    }

    // Bot/crawler/synthetic-monitor traffic never counts — checked against the
    // real request header, not the client-supplied device_info.
    const ua = req.headers.get("user-agent");
    if (isLikelyBot(ua)) {
      // The FAMILY, never the User-Agent string: a UA is a device fingerprint,
      // and this log exists to explain decisions, not to profile visitors.
      return decided("bot", { bot: true }, { classification: botFamily(ua), classificationReason: "user_agent" });
    }

    // Speculative loads (prefetch/prerender/link preview) are not people —
    // same guard as /api/views, so the two tables can't disagree about them.
    const purpose = `${req.headers.get("sec-purpose") ?? ""} ${req.headers.get("purpose") ?? ""} ${req.headers.get("x-purpose") ?? ""}`.toLowerCase();
    if (/prefetch|prerender|preview/.test(purpose)) {
      return decided("prefetch", { prefetch: true }, { classificationReason: "purpose_header" });
    }

    // Only record events for cards that actually serve — /api/views has always
    // enforced this; this route not doing so meant deleted/deactivated slugs
    // still generated events, notifications, and CRM traffic.
    if (!(await isCardActive(card_owner_username))) {
      return decided("inactive"); // response says nothing: don't reveal which slugs exist
    }

    const admin = getAdminSupabase();

    // Resolve the request's REAL identity once — it drives both decisions
    // below. Null for anonymous visitors, which is the common case.
    const sessionViewer = await resolveSessionViewer(admin);

    // Owner self-activity never records — an owner tapping around their own
    // card must not create events or "saved your contact" notifications to
    // themselves. (Client components also suppress this; server closes it.)
    // Shared, identity-based check — never IP-based (see self-traffic.ts).
    //
    // TWO SIGNALS, not one. The session was the only one for months and
    // production shows it never fired once: zero "self" rows in
    // analytics_ingest_log, while the owner's own views of his own cards were
    // recorded as anonymous strangers and pushed to his phone. Public card and
    // Swift Links routes sit outside the proxy's matcher, so a signed-in owner
    // whose access token has expired reads as signed-out here. The httpOnly
    // sc_device cookie the proxy already plants on authenticated routes answers
    // "which account is signed in on this browser", which survives all of that.
    const ownerId = await resolveOwnerId(admin, card_owner_username);
    if (await isOwnerActivity(admin, ownerId, sessionViewer?.userId)) {
      return decided("self", { self: true }, {
        identityLevel: sessionViewer ? "confirmed" : "associated",
        classificationReason: sessionViewer ? "owner_session" : "owner_device",
      });
    }

    // ── Is this someone the owner already KNOWS? ───────────────────────────────
    // Only from a binding the owner earned (they shared their details from this
    // browser, or opened a link the owner sent them) — never from the name the
    // browser volunteered, never from IP or user agent. Two different people
    // bound to one browser is "ambiguous", which is anonymous. Stamped on the
    // view and the event rows as lead_id, so a contact's history is a join on
    // their id rather than a match on anything they typed (lib/known-contact.ts).
    //
    // A per-contact link opened in this browser is evidence, so it binds FIRST
    // — then the resolution below already sees the contact on this very view.
    // Only for a view (the tracker's post-human-gate POST), only for this
    // card's own owner, and never from a datacenter: link scanners (Outlook
    // SafeLinks, Proofpoint, Mimecast) run there, and a scanner "opening" the
    // link must never become "Priya re-opened your card". resolveGeo is cached
    // per IP, so recordView's own lookup below is a cache hit.
    if (contact_token && event_type === "viewed_card" && ownerId) {
      const tokenGeo = await resolveGeo(req, ip);
      const rateOk = !(await isRateLimited(`contact-token:${ip}`, 20, 10 * 60 * 1000));
      if (!tokenGeo.isHosting && rateOk) {
        await bindViaLink(admin, { token: contact_token, ownerId, visitorId: visitor_id });
      }
    }
    const contact = await resolveKnownContact(admin, { ownerId, visitorId: visitor_id });
    const knownLeadId = contact.kind === "known" ? contact.leadId : null;

    // VIEWS: record the card_views row (chart, counters, locations) HERE,
    // through the same function /api/views uses, and only carry on to the
    // notification when it was genuinely recorded. Keyed on the SURFACE
    // ("<slug>__links" for Swift Links), so a card view and a links view by
    // the same visitor are two BARS on the chart. They are still only one
    // NOTIFICATION — one person, one visit, one buzz (lib/visit-notify.ts).
    // Anything not recorded (same-visit reload, self-view) makes no
    // notification either: the bell can never say something the bars don't.
    let viewOutcome: "recorded" | null = null;
    // recordView already resolved this request's geo; reusing its answer means
    // the card_views row and the card_events row can never disagree about where
    // the visit came from OR about how confident that answer is.
    let viewGeo: GeoResult | null = null;
    // The milestone this view crossed, if any. recordView DETECTS it and writes
    // nothing (lib/milestones.ts); folding it into the visit's one notification
    // below is what stopped one view producing two bell rows.
    let milestone: Awaited<ReturnType<typeof recordView>>["milestone"] = null;
    if (event_type === "viewed_card") {
      const viewsKey = surface === "links" ? `${card_owner_username}__links` : card_owner_username;
      const { outcome, geo: recordedGeo, milestone: crossed } = await recordView({
        req,
        username: viewsKey,
        visitorId: visitor_id,
        // Keyed on the SURFACE, like the row itself, so the card page and the
        // Swift Links page each get their own last-resort dedupe slot.
        deviceKey: deviceKeyFor({
          ip, userAgent: req.headers.get("user-agent"), username: viewsKey,
        }),
        // Only a browser that could keep no identity at all may be deduped on
        // the (shared-by-design) device key — see record-view.ts.
        identityMinted: visitIdentity.minted,
        // The cookie arrived with the request: a proven identity, so its row
        // carries no device key and can never be merged with someone else's.
        identityFromCookie: !visitIdentity.setCookie,
        leadId: knownLeadId,
        source,
        ip,
      });
      milestone = crossed ?? null;
      if (outcome !== "recorded") {
        // recordView's own verdict: deduped (same visit), self, inactive, or a
        // failed write. Its geo answer rides along so even a declined attempt
        // records at what confidence the location WOULD have been known.
        return decided(outcome as IngestReason, { [outcome]: true }, {
          geoAccuracy: recordedGeo?.accuracy ?? null,
          geoSource: recordedGeo?.source ?? null,
          isRelay: recordedGeo?.isRelay ?? null,
        });
      }
      viewOutcome = "recorded";
      viewGeo = recordedGeo ?? null;
    }

    // ONE VISIT = ONE EVENT. The same visitor re-touching
    // the same card inside the visit window (reload, double-fire, browser
    // retry) is the same event; past the window a return is a genuine repeat
    // and records — and notifies — again. Checked against the DATABASE, not an
    // in-memory throttle: serverless instances don't share memory, which is
    // how one visit used to produce duplicate pushes. Uses the same window as
    // /api/views (view-window.ts) so the dashboard, the contact timeline, and
    // the push notification always agree on whether a view happened.
    const windowStart = new Date(Date.now() - VIEW_VISIT_WINDOW_MS).toISOString();
    if (viewOutcome === "recorded") {
      // Already deduped against card_views above (surface-aware).
    } else if (visitor_id) {
      // SURFACE-AWARE, like the card_views dedup. Without the surface term this
      // query answered "has this visitor done this event on this card" and so
      // treated a Swift Links view and a card view as the same event — which is
      // the defect the surface column exists to fix. `.is(null)` is included
      // because every row written before the column existed carries NULL and
      // was, in practice, a card-surface event.
      // TARGET too, for the same reason as surface: two taps on two DIFFERENT
      // links in one visit are two events, and without this the second would be
      // swallowed as a duplicate of the first — the same bug, one day later.
      const base = admin
        .from("card_events")
        .select("id")
        .eq("card_owner_username", card_owner_username)
        .eq("visitor_id", visitor_id)
        .eq("event_type", event_type)
        .gte("created_at", windowStart);
      // Typed .eq()/.is() rather than an .or() filter STRING: these are
      // client-supplied values, and a PostgREST or() takes a comma-separated
      // expression, so a comma or quote inside one would change the query's
      // shape instead of failing to match (the same reasoning the events GET
      // below already spells out).
      const byTarget = target ? base.eq("target", target) : base.is("target", null);
      const { data: dup, error: dupErr } = await (
        surface === "card"
          ? byTarget.or("surface.is.null,surface.eq.card")
          : byTarget.eq("surface", surface)
      ).limit(1).maybeSingle();
      // Column not migrated yet → fall back to the pre-surface question rather
      // than letting a failed filter read as "no duplicate" and record twice.
      if (dupErr && (dupErr.code === "42703" || dupErr.code === "PGRST204")) {
        const { data: legacyDup } = await admin
          .from("card_events")
          .select("id")
          .eq("card_owner_username", card_owner_username)
          .eq("visitor_id", visitor_id)
          .eq("event_type", event_type)
          .gte("created_at", windowStart)
          .limit(1)
          .maybeSingle();
        if (legacyDup) return decided("deduped", { deduped: true }, { classificationReason: "event_window_legacy" });
      } else if (dup) {
        return decided("deduped", { deduped: true }, { classificationReason: "event_window" });
      }
    } else {
      // No visitor id → nothing to dedupe rows on; hold this path to one event
      // per (IP, card, type) per window so a stripped-down client can't spam.
      // The target is part of the key so a visitor with no id can still tap more
      // than one link in half an hour.
      if (await isRateLimited(`events-anon:${ip}:${card_owner_username}:${event_type}:${target ?? ""}`, 1, VIEW_VISIT_WINDOW_MS)) {
        return decided("deduped", { deduped: true }, { classificationReason: "no_visitor_id_ip_window" });
      }
    }

    // WHO viewed: the session decides when there is one. The client-supplied
    // fields come from a device-global localStorage blob that survives account
    // switches, which is how one user's views got recorded under another
    // user's name (see lib/viewer-identity.ts).
    //
    // AN ANONYMOUS VISITOR IS NAMED ONLY TO AN OWNER THEY GAVE THEIR DETAILS TO.
    // The blob is written when someone shares with ANY card, and it used to be
    // stamped on every card that browser opened afterwards — so an owner the
    // person had never met was told "Looks like Priya viewed your card", with
    // her email and phone stored on their events (owner decision 2026-09-18,
    // warm-lead plan hazard H4). The browser's own claim is now never used:
    // a visitor this owner knows (lib/known-contact.ts) is named from the
    // owner's OWN record of them, and everyone else is "Someone".
    const ownersOwnContact = contact.kind === "known" && contact.confidence !== "forwarded" ? contact : null;
    void visitor_name; void visitor_email; void visitor_phone;
    const identity = authoritativeEventIdentity(sessionViewer, {
      visitor_name: ownersOwnContact ? ownersOwnContact.name || null : null,
      visitor_email: null,
      visitor_phone: null,
    });

    // WHERE from: this request's own edge geo headers, cross-checked against a
    // second IP database — never client-supplied (request-geo.ts). Stored on
    // the event so the notification, the contact timeline, and the dashboard
    // all read the same value; missing data stays null, never a placeholder.
    //
    // For a view this is the IDENTICAL object recordView used, so the two rows
    // cannot drift. For a vCard save (which records no view) it is resolved
    // here, and the per-IP cache in request-geo makes that a cache hit anyway.
    const geo = viewGeo ?? (await resolveGeo(req, ip));
    const location = geo.label;

    const row = {
      card_owner_username,
      visitor_id,
      event_type,
      source: source || "direct_link",
      visitor_name: identity.visitor_name,
      visitor_email: identity.visitor_email,
      visitor_phone: identity.visitor_phone,
      referrer_url,
      device_info,
      location,
      // Explicit, like card_views.viewed_at — the dedup window above and the
      // conversation sort both filter on this; no dependency on a column
      // DEFAULT existing in production.
      created_at: new Date().toISOString(),
      // ── The columns supabase/analytics-accuracy.sql adds ──────────────────
      // WHICH PAGE. Without this, card_events could not tell a Swift Links view
      // from a card view: the visit-bucket unique index rejected the second
      // surface of one visit as a duplicate, so the event was lost and the
      // contact's timeline said "Viewed your card" for a links view. It is
      // written on every event type, not just views, so a vCard saved off the
      // links page is attributed to the page it happened on.
      surface,
      // Which link was pressed (clicked_link only; NULL for views and saves).
      target,
      // HOW MUCH OF THE LOCATION IS REAL. The label alone cannot say whether
      // "New York, US" is a city or the state two disagreeing databases fell
      // back to — see lib/request-geo.ts and lib/location-display.ts.
      geo_accuracy: geo.accuracy,
      geo_source: geo.source,
      // WHO, when the owner knows (supabase/warm-lead-alerts.sql). Absent — not
      // null — for everyone else, so an unapplied migration costs nothing on
      // the common anonymous path.
      ...(contact.kind === "known" ? { lead_id: contact.leadId, lead_confidence: contact.confidence } : {}),
      // Also from warm-lead-alerts.sql, and dropped with the contact stamp.
      ...(target_label ? { target_label } : {}),
    };
    let { error: insertErr } = await admin.from("card_events").insert(row);
    if (insertErr && (insertErr.code === "42703" || insertErr.code === "PGRST204") && ("lead_id" in row || "target_label" in row)) {
      // warm-lead-alerts.sql not applied yet: keep everything else on the row
      // and drop only its columns. The newest columns go first.
      const { lead_id: _l, lead_confidence: _lc, target_label: _tl, ...withoutLead } =
        row as typeof row & { lead_id?: string; lead_confidence?: string; target_label?: string };
      void _l; void _lc; void _tl;
      ({ error: insertErr } = await admin.from("card_events").insert(withoutLead));
    }
    if (insertErr && (insertErr.code === "42703" || insertErr.code === "PGRST204")) {
      // A column this row carries isn't migrated yet — record the event without
      // the optional ones rather than dropping it. Ordered newest-first so the
      // retry is the widest row production can actually accept: location came
      // with view-visit-window.sql, surface/geo_* with analytics-accuracy.sql.
      const { surface: _s, target: _t, geo_accuracy: _ga, geo_source: _gs, lead_id: _l2, lead_confidence: _lc2, target_label: _tl2, ...withoutNew } =
        row as typeof row & { lead_id?: string; lead_confidence?: string; target_label?: string };
      void _s; void _t; void _ga; void _gs; void _l2; void _lc2; void _tl2;
      ({ error: insertErr } = await admin.from("card_events").insert(withoutNew));
      if (insertErr && (insertErr.code === "42703" || insertErr.code === "PGRST204")) {
        const { location: _unused, ...withoutLocation } = withoutNew;
        void _unused;
        ({ error: insertErr } = await admin.from("card_events").insert(withoutLocation));
      }
    }
    const geoFields: Partial<IngestDecision> = {
      geoAccuracy: geo.accuracy,
      geoSource: geo.source,
      isRelay: geo.isRelay,
    };
    if (insertErr) {
      // 23505 = the visit-bucket unique index caught a concurrent duplicate —
      // a normal dedup; the racing request already recorded (and notified).
      // NOTE this is the one place the log and card_views can honestly differ:
      // for a VIEW the row is already written (recordView committed it) and only
      // the event lost the race, so the decision is recorded as "deduped" while
      // a bar exists. That is the truth, and it is why the reason is stored.
      if (insertErr.code === "23505") {
        return decided("deduped", { deduped: true }, { ...geoFields, classificationReason: "event_unique_index" });
      }
      console.error("card_events insert failed:", insertErr.message, { card_owner_username });
      // No event row → no notification: the two must never disagree.
      return decided("error", {}, geoFields);
    }

    // What the notification layer did with this event, for the decision log:
    // the one question the audit could not answer was "this view recorded — did
    // the owner hear about it, and if not, why?".
    if (contact.kind === "known" && ownerId) {
      const leadId = contact.leadId;
      after(touchContactDevice(admin, { ownerId, visitorId: visitor_id, leadId }));
    }

    let notified: IngestDecision["notified"] = "not_eligible";
    let identityLevel: IngestDecision["identityLevel"] = "anonymous";

    // Fire in-app notification — the dedup above already decided this event is
    // genuine news, so every recorded view/save notifies exactly once.
    {
      // card_owner_username is the CARD's slug — resolve through the cards
      // table first (multi-card accounts), then the legacy profile slug.
      const { data: cardRow } = await admin.from("cards").select("user_id").eq("username", card_owner_username).maybeSingle();
      const { data: owner } = cardRow?.user_id
        ? await admin.from("profiles").select("id, plan, customization").eq("id", cardRow.user_id).maybeSingle()
        : await admin.from("profiles").select("id, plan, customization").eq("username", card_owner_username).maybeSingle();

      if (owner?.id) {
        const isView = event_type === "viewed_card";

        // Is this the very first view this card has ever had?
        //
        // Counted under the SAME key the view was recorded with: card_views
        // stores the Swift Links surface as "<slug>__links", so counting the
        // bare slug here would always return 0 for a links view. 1 = the view
        // just recorded; a failed count returns null, which is not "first".
        //
        // This no longer GATES the push — it only changes the WORDING. A card's
        // first view is the moment the product proves itself to its owner, and
        // it is worth naming as one.
        let firstEver = false;
        if (isView) {
          const { count } = await admin
            .from("card_views")
            .select("id", { count: "exact", head: true })
            .eq("username", surface === "links" ? `${card_owner_username}__links` : card_owner_username);
          firstEver = count === 1;
        }

        // ── A contact the owner already KNOWS, coming back ──────────────────
        // (lib/known-contact.ts decided who; lib/contact-return-notify.ts says
        // it.) Not the visit they were captured in — that was "New contact" —
        // and never a Free lead whose details are locked behind the cap. The
        // tag outlives an upgrade (only the plan unlocks it), so a Pro owner's
        // once-locked contacts are named like any other.
        //
        // The visit is keyed on the CONTACT, not the browser: Priya on her
        // phone and her laptop in the same half hour is one visit, one row,
        // one buzz. Every notifyVisit below uses this key, so a milestone or a
        // download in the same visit upgrades the same row.
        const returning =
          contact.kind === "known" && isReturnVisit(contact) && (!isLockedContact(contact) || isPaidPlan(owner.plan as string | null)) ? contact : null;
        const visitWho = returning ? `lead:${returning.leadId}` : visitor_id;
        let returnNotice: ReturnType<typeof contactReturnNotice> = null;
        if (returning) {
          // "3rd visit this week": distinct visits, all of their browsers — the
          // card_views rows this contact's lead_id is stamped on.
          const { count, error: visitsErr } = await admin
            .from("card_views")
            .select("id", { count: "exact", head: true })
            .eq("lead_id", returning.leadId)
            .gte("viewed_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
          returnNotice = contactReturnNotice({
            contact: returning,
            eventType: event_type as "viewed_card" | "downloaded_vcard" | "clicked_link",
            surface,
            linkName: target_label ?? target,
            visitsThisWeek: visitsErr ? 1 : Math.max(count ?? 1, 1),
            paid: isPaidPlan(owner.plan as string | null),
          });
        }

        // identity, not the raw client field — the notification must name the
        // person who ACTUALLY viewed, never a stale cached identity.
        const notice = returnNotice ?? cardEventNotice({
          eventType: event_type,
          visitorName: identity.visitor_name,
          source,
          surface,
          location,
          // Without this the copy says "near New York, US" for an answer that
          // only ever meant "somewhere in New York State" (lib/location-display).
          geoAccuracy: geo.accuracy,
          firstEver,
          // A session is proof of who this is; a remembered name is not, and
          // the copy now says which it has (lib/card-event-notify.ts).
          nameConfirmed: !!sessionViewer,
          repeatVisits: isView && !firstEver && !returning && visitor_id
            ? await countRecentVisits(admin, card_owner_username, visitor_id, surface)
            : undefined,
        });

        // Flood backstop: the dedup keys on the client-supplied visitor_id, so
        // a caller rotating ids could still ring the owner's phone once per
        // request. One IP can only reach an owner's lock screen a few times an
        // hour — events above the cap still record, they just don't buzz.
        const flooded = await isRateLimited(`notify-ip:${card_owner_username}:${ip}`, 6, 60 * 60 * 1000);

        // EVERY view is a candidate to buzz; the throttles decide which ones do.
        //
        // This used to be first-view-only — the count === 1 above was the gate —
        // so a view push could fire exactly once in a card's entire lifetime.
        // Someone could share their card at a conference, collect forty views,
        // and their phone would never make a sound. The worry behind that rule
        // was real (nobody wants twenty banners from one printed QR code) but
        // the answer to it was already built and could never engage:
        // push-policy.ts batches views to one an hour inside a five-a-day cap,
        // notifyVisit allows one per visitor per visit, and `flooded` above
        // holds any single IP to six an hour. Four throttles, all now live.
        //
        // A saved contact carries its own category. It is higher intent than a
        // view — someone who saves your card meant to keep you — and it lands
        // as its own alert only when it OPENS the visit (a QR that goes
        // straight to the vCard). Mid-visit it upgrades the row without a
        // second buzz; see the UNCAPPED rule in lib/visit-notify.ts.
        const pushCategory: PushCategory | undefined = returnNotice
          ? returnNotice.pushCategory
          : isView
            ? "card_view"
            : event_type === "downloaded_vcard"
              ? "contact_saved"
              : undefined;

        // How sure we are WHO this was. A session is proof; a name that came
        // from the visitor's own earlier share is an association, not an
        // identification (the browser is shared, the link is forwardable); no
        // name at all is anonymous. Recorded, never displayed as certainty.
        identityLevel = sessionViewer
          ? "confirmed"
          : identity.visitor_name || identity.visitor_email || identity.visitor_phone
            ? "associated"
            : "anonymous";

        if (flooded) notified = "suppressed";
        if (notice && !flooded) {
          // ONE NOTIFICATION PER PERSON PER VISIT. A view then a save by the
          // same visitor upgrades the notification the owner already has
          // (and replaces the banner) instead of buzzing a second time.
          notified = await notifyVisit({
            userId: owner.id,
            cardOwner: card_owner_username,
            visitorId: visitWho,
            ip,
            notice: {
              type: notice.type,
              ...(pushCategory ? { pushCategory } : {}),
              title: notice.title,
              body: notice.body,
              ...(returnNotice?.pushBody ? { pushBody: returnNotice.pushBody } : {}),
              ...(returning ? { leadId: returning.leadId } : {}),
              // ── The celebration reaches the lock screen, at no extra cost ──
              //
              // This view is ALREADY pushing (pushCategory "card_view", the
              // switch the person agreed to). Until now its headline said
              // "Card viewed" while the bell row a tap away said "50 views —
              // on fire!", so the one moment an owner is unambiguously pleased
              // was the one moment the phone kept to itself.
              //
              // A milestone still cannot CAUSE a push — there is no category
              // that carries a view count and there must not be one — it only
              // retitles the push the view was already sending. Same buzz,
              // same category, same switch, better sentence. The bell row is
              // still upgraded below, which is what writes the once-ever
              // ledger; if that upgrade is what fails, the ledger simply isn't
              // written and the next view announces it again, exactly as
              // before.
              //
              // Not for a returning contact: "Priya re-opened your card" is the
              // bigger news, and the milestone still lands in the bell row.
              ...(milestone && !returning ? { pushTitle: milestone.title } : {}),
              // Deep-link to THIS card's dashboard — a bare /dashboard opened
              // whichever card the owner last had selected, which on a
              // multi-card account could be the wrong one. A returning contact
              // opens THEIR contact, the same screen a new lead's push opens.
              // Pro only: on Free the name is the thing being withheld, and
              // opening their contact would print it. A Free tap lands on this
              // card's dashboard, where the row waits in the bell with the name
              // still blurred (the dashboard's own notifications list went with
              // Quick Contacts, 2026-09-29).
              url: returning && isPaidPlan(owner.plan as string | null)
                // The contact lives under the card they were CAPTURED on,
                // which may be another of this owner's cards: opening it
                // under this card showed a contact missing from that card's
                // list (isolation audit 2026-09-24).
                ? `${APP_URL}/contacts?card=${encodeURIComponent(returning.cardOwner || card_owner_username)}&lead=${returning.leadId}`
                : `${APP_URL}/dashboard?card=${encodeURIComponent(card_owner_username)}`,
            },
          });
          // Mirror this conversation notification to the owner's CRM. The CRM
          // wants the EVENT, not the merged headline — a milestone is our
          // gamification, not something to write into their pipeline.
          //
          // CONTACT DETAILS ARE CORROBORATED FIRST. This endpoint is public and
          // card slugs are public, so for an anonymous visitor the name, email
          // and phone arrive from the client — by design, so someone who shared
          // once is recognised next time. That is fine for our own bell, which
          // records the difference as `identityLevel` above and never presents
          // it as certain. It is NOT fine to post into Salesforce, HubSpot or a
          // Zapier pipeline: a stranger could POST any slug with any name and
          // email and write a fabricated contact into a customer's system of
          // record. So the details forwarded here come from the LEAD this
          // visitor actually submitted to THIS owner, read server-side — or the
          // event goes without contact details at all, which is honest and
          // still useful (it carries the event, source and location).
          // A link tap never produced a CRM notification before a contact
          // could be recognised by one; it still doesn't.
          const crmContact = event_type === "clicked_link" ? null : await corroboratedContact({
            admin,
            cardOwner: card_owner_username,
            visitorId: visitor_id,
            sessionViewer,
            identity,
          });
          if (event_type !== "clicked_link") await dispatchCrmEvent(card_owner_username, {
            type: "conversation.notification",
            event: isView ? "card_viewed" : "contact_saved",
            title: stripNameMarks(notice.title),
            // Plain text. The body carries invisible location marks for the
            // app's own notification list (lib/location-privacy.ts); a customer's
            // Salesforce record is not the place for them. The `location` field
            // below is the CRM's own, unchanged — a connected CRM is a paid
            // feature, so nothing is being withheld here.
            body: stripNameMarks(stripLocationMarks(notice.body)),
            ...(crmContact ? { contact: crmContact } : {}),
            source: source || "direct_link",
            location: location ?? undefined,
          });

          // ── The milestone this view crossed, folded into the SAME row ──────
          //
          // It used to be its own bell row, written inside recordView, which is
          // how one view produced two notifications a second apart:
          //   21:47:55  milestone_50  "50 views — on fire!"
          //   21:47:56  card_viewed   "Someone viewed your Swift Links."
          //
          // Announced AFTER the view, deliberately: notifyVisit only ever moves
          // a visit UP the rank list, so the view (rank 1) creates the row and
          // the milestone (rank 2) upgrades it in place. Doing it the other way
          // round would leave the owner a bare statistic with no idea who had
          // just been on their card.
          //
          // The copy carries BOTH facts, because both matter and there is now
          // only one row to carry them: the celebration as the headline, the
          // person and place in the body.
          //
          // `milestone:` is the once-ever ledger (notifications.milestone).
          // upgrade() sets it and never clears it, so a lead captured later in
          // this same visit rewrites the type without losing the record that
          // this milestone was announced.
          //
          // Never pushes: no pushCategory, and push-policy.ts has no category
          // that could carry a view count anyway.
          if (milestone) {
            await notifyVisit({
              userId: owner.id,
              cardOwner: card_owner_username,
              visitorId: visitWho,
              ip,
              notice: {
                type: milestone.type,
                ...(returning ? { leadId: returning.leadId } : {}),
                milestone: milestone.type,
                title: milestone.title,
                // Who just visited, the number they took the card past, and one
                // thing to go and do about it. The third sentence is the reason
                // a milestone is worth writing at all — see lib/milestones.ts.
                body: `${notice.body} That's ${milestone.reached.toLocaleString("en-US")} views on /${milestone.slug}. ${milestone.body}`,
                url: `${APP_URL}/dashboard?card=${encodeURIComponent(card_owner_username)}`,
              },
            });
          }
        }
      }
    }

    // The success path. visitKey ties this row to the notification ledger so one
    // visit can be read end to end: the bars, the event, and the buzz.
    return decided("recorded", {}, {
      ...geoFields,
      identityLevel,
      notified,
      visitKey: visitKey({ cardOwner: card_owner_username, visitorId: visitor_id, ip }),
      classification: "human",
      classificationReason: "passed_ingest_gates",
    });
  } catch {
    // The visitor is never told an analytics failure happened, and never will
    // be. Nothing is logged here either: with the body unparsed there is no
    // entity to attribute a decision to.
    return NextResponse.json({ ok: true });
  }
}

// Private: fetch events for a visitor (card owner only)
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const params = req.nextUrl.searchParams;
    const leadId = params.get("lead_id");
    const visitorIdParam = params.get("visitor_id");
    if (!leadId && !visitorIdParam) return NextResponse.json([], { status: 200 });

    // All the user's card slugs (profile + every card) — a multi-card account
    // must see the visitor's activity on ANY of its cards, not just the primary.
    const usernames = await getOwnerUsernames(user.id);
    const admin = getAdminSupabase();

    // Identity to match on. `lead_id` is the good path: the contact's details
    // stay server-side and we can match on more than one of them. `visitor_id`
    // remains accepted so an older client keeps working.
    let visitorId = visitorIdParam;
    let leadCreatedAt: string | null = null;
    if (leadId) {
      if (!/^[0-9a-f-]{36}$/i.test(leadId)) return NextResponse.json([], { status: 200 });
      const { data: lead } = await admin
        .from("leads")
        .select("visitor_id, email, phone, card_owner, tags, created_at")
        .eq("id", leadId)
        .maybeSingle();
      // Scoped to this owner's cards — a lead id from someone else's account
      // must not return their visitor's activity.
      if (!lead || !usernames.includes(lead.card_owner as string)) {
        return NextResponse.json([], { status: 200 });
      }
      // A contact locked behind the Free cap is hidden from this account, and
      // its events carry the name and email the lock withholds.
      if (isLockedLead(lead) && !(await isPaidUser(user.id))) {
        return NextResponse.json([], { status: 200 });
      }
      visitorId = (lead.visitor_id as string | null) ?? null;
      leadCreatedAt = (lead.created_at as string | null) ?? null;
    }

    // WHAT COUNTS AS THIS CONTACT'S ACTIVITY (2026-09-23 audit: the section
    // "shows a lot of false information"). Only evidence the SERVER holds:
    //   1. events stamped with this lead's id when they happened — the join
    //      that already honours "wrong person" and a browser handed to someone
    //      else (lib/known-contact.ts);
    //   2. events from a browser still bound to them (not superseded, not
    //      marked wrong, not a forwarded link), from shortly before they shared
    //      onward — never an event already stamped as ANOTHER contact's, and
    //      never the days-old history of a shared or borrowed device;
    //   3. for a contact from before bindings existed, the browser they shared
    //      from, under the same two limits.
    // Matching the email or phone a BROWSER claimed about itself is gone: those
    // came from a shared localStorage blob and put one person's views under
    // another's name.
    //
    // `surface` tells the conversation timeline whether a view was the card or
    // the Swift Links page — without it every links view read "Viewed your
    // card" while the owner's notification said "Swift Links viewed". Requested
    // defensively: selecting a column that isn't migrated yet fails the whole
    // query, and an empty conversation is worse than an unlabelled one.
    const WANT = "id, event_type, source, visitor_name, visitor_email, created_at";
    let cols = `${WANT}, surface, target`;
    {
      const probe = await admin.from("card_events").select("surface").limit(1);
      if (probe.error && (probe.error.code === "42703" || probe.error.code === "PGRST204")) cols = WANT;
    }
    // lead_confidence arrives with warm-lead-alerts.sql; probed the same way.
    if (cols !== WANT) {
      const probe = await admin.from("card_events").select("lead_confidence").limit(1);
      if (!probe.error) cols = `${cols}, lead_confidence, target_label`;
    }
    // The visit that led to sharing starts before the share itself.
    const LEAD_IN_MS = 2 * 60 * 60 * 1000;
    const since = (iso: string | null | undefined, leadIn: boolean) =>
      iso ? new Date(new Date(iso).getTime() - (leadIn ? LEAD_IN_MS : 0)).toISOString() : null;
    const notAnotherContact = leadId ? `lead_id.is.null,lead_id.eq.${leadId}` : null;

    const lookups: PromiseLike<{ data: unknown }>[] = [];
    if (leadId) {
      lookups.push(admin.from("card_events").select(cols).in("card_owner_username", usernames).eq("lead_id", leadId));

      const { data: bindings } = await admin
        .from("contact_devices")
        .select("visitor_id, bound_via, link_device_index, bound_at, superseded_at, wrong_at")
        .eq("lead_id", leadId);
      const active = (bindings ?? []).filter((bd) =>
        !bd.superseded_at && !bd.wrong_at &&
        !(bd.bound_via === "link" && ((bd.link_device_index as number | null) ?? 1) > 1));
      for (const bd of active) {
        const from = since((bd.bound_at as string | null) ?? leadCreatedAt, bd.bound_via !== "link");
        let q = admin.from("card_events").select(cols).in("card_owner_username", usernames)
          .eq("visitor_id", bd.visitor_id as string).or(notAnotherContact!);
        if (from) q = q.gte("created_at", from);
        lookups.push(q);
      }
      // A contact from before bindings: the browser they shared from — unless
      // a binding for it exists and was superseded or marked wrong.
      if (visitorId && !(bindings ?? []).some((bd) => bd.visitor_id === visitorId)) {
        let q = admin.from("card_events").select(cols).in("card_owner_username", usernames)
          .eq("visitor_id", visitorId).or(notAnotherContact!);
        const from = since(leadCreatedAt, true);
        if (from) q = q.gte("created_at", from);
        lookups.push(q);
      }
    } else if (visitorId) {
      // Older clients asking by visitor id only.
      lookups.push(admin.from("card_events").select(cols).in("card_owner_username", usernames).eq("visitor_id", visitorId));
    }

    const results = await Promise.all(lookups);
    const byId = new Map<string, Record<string, unknown>>();
    // `cols` is built at runtime (the surface probe above), so PostgREST can no
    // longer infer a row type from it — rows are read as the plain records this
    // route already serialised them as.
    for (const r of results) {
      for (const row of (r.data ?? []) as unknown as Record<string, unknown>[]) {
        byId.set(row.id as string, row);
      }
    }

    const merged = [...byId.values()].sort(
      (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
    );
    return NextResponse.json(merged);
  } catch {
    return NextResponse.json([]);
  }
}
