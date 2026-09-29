import { NextRequest, NextResponse, after } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { syncLeadToAllCrms, sendLeadToZapier } from "@/lib/crm-sync";
import { getSourceLabel, sourcePhrase } from "@/lib/source-labels";
import { PLAN_LIMITS, LOCKED_LEAD_TAG, isPaidPlan } from "@/lib/plan";
import { readUsage, bumpUsage } from "@/lib/usage";
import { cardIsOffline, cardWithinPlanLimit, ownerIsDeleted } from "@/lib/card-active";
import { isRateLimited } from "@/lib/rate-limit";
import { reportError } from "@/lib/report-error";

// after() here runs five CRM providers — several make two or three
// sequential calls — plus a Zapier webhook. Vercel's default cap can cut that
// tail off with no error, no alert and no retry, which is the exact failure the
// reminders route's own header documents. Give the side effects room.
export const maxDuration = 60;
import { clientIp } from "@/lib/client-ip";
import { notifyVisit } from "@/lib/visit-notify";
import { insertNotification } from "@/lib/notify";
import { announceFirstLeadIfTeammate } from "@/lib/team-alerts";
import { isLikelyBot } from "@/lib/bot-detection";
import { resolveGeo } from "@/lib/request-geo";
import { attachVisitIdentity, resolveVisitIdentity } from "@/lib/visit-identity";
import { bindFormDevice } from "@/lib/known-contact";
import { isOwnerRequest } from "@/lib/self-traffic";
import { markName } from "@/lib/contact-privacy";
import { activeEvent } from "@/lib/event-tag";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, company, message, card_owner, tags, source, visitor_id: client_visitor_id } = await req.json();

    // This is a PUBLIC endpoint — require real strings, not just truthy values
    // (a JSON payload of {name: [], phone: {}} would otherwise pass and crash
    // downstream string handling in emails/vCards).
    if (typeof name !== "string" || !name.trim() || typeof phone !== "string" || !phone.trim() || typeof card_owner !== "string" || !card_owner.trim()) {
      return NextResponse.json({ error: "Name and phone are required." }, { status: 400 });
    }
    // …and every other field too, with a size. They flow into the owner's
    // contact list, notifications, CRM syncs and Zapier payloads, so a
    // multi-megabyte "message" or an object for "email" from an unauthenticated
    // POST must stop here (security audit 2026-09-24).
    const optionalText = (v: unknown, max: number) => v === undefined || v === null || (typeof v === "string" && v.length <= max);
    if (
      name.length > 200 || phone.length > 40 || card_owner.length > 100 ||
      !optionalText(email, 254) || !optionalText(company, 200) ||
      !optionalText(message, 3000) || !optionalText(source, 80)
    ) {
      return NextResponse.json({ error: "Some of those details are too long." }, { status: 400 });
    }

    // ── The SAME visitor id the card's views are keyed on ─────────────────────
    // /api/card-events keys every view, save and link tap on the sc_vid cookie
    // (lib/visit-identity.ts). This route used to store the body's localStorage
    // id instead, and the two drift apart the moment a browser loses its
    // storage but keeps its cookie (ITP eviction, an account switch wiping
    // kontact_vid, a private window). A lead whose visitor_id no longer matches
    // its own later visits can never be recognised when they come back, and its
    // "new contact" notification opens a different visit_key from the view it
    // should have upgraded. Resolve it exactly the way card-events does, and
    // hand the cookie back so a browser without one keeps this identity.
    const visitIdentity = resolveVisitIdentity(req, typeof client_visitor_id === "string" ? client_visitor_id : null);
    const visitor_id = visitIdentity.visitorId;

    // Visitors must not be able to inject system tags ("sc-locked" would hide
    // the lead behind the paywall, "email-paused" would kill its automations).
    // Only the scanner's benign marker survives from the client.
    const CLIENT_TAG_WHITELIST = new Set(["scanned"]);
    const safeTags = (Array.isArray(tags) ? tags : []).filter(
      (t): t is string => typeof t === "string" && CLIENT_TAG_WHITELIST.has(t)
    );

    // SMS consent (TCPA/CTIA): the share forms carry an affirmative, unchecked-
    // by-default checkbox. Declining it must not block the share — but the lead
    // is created with the sms-paused tag, the same per-contact switch the
    // follow-up cron already honors, so automated texts skip them until they
    // (or the owner, at the contact's request) flip it. Only an EXPLICIT false
    // pauses: an absent field means an older/other caller that never asked, and
    // changing those would silently rewire existing capture paths. Kept OUT of
    // safeTags — that array also feeds the Zapier webhook payload, and internal
    // system tags must not start appearing in customers' Zaps.
    // NO SMS CONSENT COMES FROM THIS ROUTE ANY MORE (owner, 2026-09-20).
    //
    // "Share your info" hands the owner a contact's details — the visitor
    // typing what the owner would otherwise type themselves. It never enrolled
    // anyone in text messages, so the consent box came off the forms, and this
    // public endpoint now IGNORES sms_consent entirely rather than trusting a
    // browser about it. That closes the matching hole: the field arrived from
    // an unauthenticated request, so anything could have posted
    // sms_consent:true and minted the one tag the follow-up cron requires.
    //
    // A text still needs consent — it just has to come from the SwiftCard
    // user, who is the person who actually has it. Turning a contact's text
    // automation on (PATCH /api/leads/[id], authenticated) is that assertion
    // and is the only thing that sets sms-ok. Contacts captured here carry
    // neither tag, exactly like the scanner and manual entry, so nothing
    // automated ever texts them by default. STOP/HELP are unchanged.

    // Rate limit: same IP submitting to the same card too frequently.
    // card_owner is normalized so "Alice " vs "alice" can't mint fresh buckets.
    const ip = clientIp(req);
    const rateKey = `${ip}:${card_owner.trim().toLowerCase()}`;
    if (await isRateLimited(rateKey)) {
      return NextResponse.json({ error: "Too many submissions. Please wait a few minutes." }, { status: 429 });
    }
    // …and one ceiling per CARD, whatever the IP. Rotating addresses defeated
    // the per-IP limit, and every fake contact is a push to the owner, a CRM
    // sync, and (on Free) one of the month's contacts used up. Far above what a
    // busy trade-show hour produces.
    if (await isRateLimited(`lead-card:${card_owner.trim().toLowerCase()}`, 120, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many submissions. Please wait a few minutes." }, { status: 429 });
    }

    // Bot/crawler/synthetic-monitor traffic must not create a lead — unlike
    // an inflated view count, a fake lead here pushes a real notification,
    // push alert, and CRM/Zapier sync to the card owner (code review: this
    // was the only public ingest route without the bot check already applied
    // to views/card-events/analytics-event).
    if (isLikelyBot(req.headers.get("user-agent"))) {
      return NextResponse.json({ error: "Unable to submit right now." }, { status: 400 });
    }

    // This request's own edge geo headers — shared helper (request-geo.ts):
    // guarded decode (a malformed x-vercel-ip-city used to throw here, and the
    // outer catch turned one bad header into a 500 that LOST THE LEAD), keeps
    // a city even when the country header is missing, honest null otherwise —
    // and cross-checked against a second IP database, so two sources that
    // disagree on the town report the state they share instead.
    //
    // resolveGeo, not resolveLocation: it returns the same label PLUS how much
    // of it is real, so the contact panel can say "Near Great Neck, NY" or
    // "New York (approximate)" instead of printing a state-level guess under a
    // map pin next to a phone number the person actually typed in.
    const geo = await resolveGeo(req, ip);
    const location = geo.label;

    const admin = getAdminSupabase();

    // Resolve the OWNER of this card slug. card_owner is the card's username —
    // for multi-card accounts that is NOT the profile slug, so look the card up
    // first and fall back to the legacy profile-slug match. Without this,
    // notifications/emails silently skipped every non-primary card.
    const ownerSelect = "id, plan, name, email, phone, company, customization";
    // select("*") so the is_offline kill-switch is actually present on the row —
    // an explicit column list would silently omit it (and would error outright on
    // a pre-migration schema), leaving lead capture open on an offline card.
    const { data: cardRow } = await admin.from("cards").select("*").eq("username", card_owner).maybeSingle();
    const { data: ownerProfile } = cardRow?.user_id
      ? await admin.from("profiles").select(ownerSelect).eq("id", cardRow.user_id).maybeSingle()
      : await admin.from("profiles").select(ownerSelect).eq("username", card_owner).maybeSingle();

    // ISOLATION RULE: the account's signup email must never appear on anything
    // card-facing. Everything shown to the LEAD comes from the CARD's own
    // identity (falling back to the profile only for legacy profile-cards).
    // (It used to fall back field by field even WITH a card row — a card with
    // no email showed the signup email. Isolation audit 2026-09-24.)
    const cardIdentity = cardRow
      ? {
          name: (cardRow.name as string) || ownerProfile?.name || "",
          email: (cardRow.email as string) || "",
          phone: (cardRow.phone as string) || "",
          company: (cardRow.company as string) || "",
        }
      : {
          name: ownerProfile?.name || "",
          email: ownerProfile?.email || "",
          phone: ownerProfile?.phone || "",
          company: ownerProfile?.company || "",
        };

    // Kill-switch: no lead capture for nonexistent slugs, deleted accounts, or
    // plan-deactivated extra cards — the page 404s, and this API must not be a
    // back door (previously a bogus card_owner could insert orphan leads).
    if (!ownerProfile || ownerIsDeleted(ownerProfile.customization)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // A card an office admin took offline captures no leads either — its page
    // 404s, so this API must not stay open as a back door.
    if (cardIsOffline(cardRow)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (cardRow && !(await cardWithinPlanLimit(cardRow.id, cardRow.user_id, ownerProfile.plan))) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // Idempotency: a double-submit (double-tap, slow-response retry, or a
    // client that fires on both click and form-submit) must not create two
    // leads — that means two notifications, two pushes, and two CRM/Zapier
    // syncs for one person. The (IP, card) rate limit is 3/10min, which is
    // deliberately loose enough to let two DIFFERENT people at one venue (shared
    // NAT IP) both submit — so it can't be the dedup. Instead, treat a lead as a
    // duplicate of a very recent one from the SAME person to the SAME card:
    // matched on visitor_id when present (the first-party per-browser id, so two
    // different people never collide), else on the phone number (unique to a
    // person). Window kept short (5 min) so a genuine second visit later still
    // captures. On a hit we return success WITHOUT inserting — the visitor
    // already succeeded the first time, so re-reporting success is correct and
    // avoids a "something went wrong" re-submit loop.
    const DEDUP_WINDOW_MS = 5 * 60 * 1000;
    // Duplicate = same phone to the same card within the window (and same
    // visitor_id too when the browser supplied one, for extra precision). Same
    // phone → same person, so this catches the double-submit without dropping a
    // genuinely different second contact. A corrected re-submit with a DIFFERENT
    // phone is not a duplicate and still captures.
    const dedupSince = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    let dupQuery = admin
      .from("leads")
      .select("id, tags")
      .eq("card_owner", card_owner)
      .eq("phone", phone)
      .gte("created_at", dedupSince)
      .limit(1);
    // A freshly MINTED id (no cookie, no client id) is unique to this request,
    // so matching on it would stop a fast double-tap from deduping at all —
    // fall back to phone alone exactly as a browser with no id always did.
    if (!visitIdentity.minted) dupQuery = dupQuery.eq("visitor_id", visitor_id);
    const { data: recentDup } = await dupQuery;
    if (recentDup?.length) {
      // Nothing to reconcile on a re-submit: this route cannot change SMS
      // consent in either direction any more (see above).
      return attachVisitIdentity(NextResponse.json({ success: true, deduped: true }), visitIdentity);
    }

    // Free plan: 5 new leads/month. We NEVER reject a visitor's info — over the
    // cap the lead is still captured and stored, just flagged locked (blurred in
    // the owner's dashboard until they upgrade; unlocked instantly when they do).
    // The counter lives on the ACCOUNT so deleting/remaking a card can't reset it.
    let locked = false;
    // This lead is the month's LAST free one — see the heads-up below.
    let lastFreeLead = false;
    if (!isPaidPlan(ownerProfile?.plan) && ownerProfile?.id) {
      const usedThisMonth = readUsage(ownerProfile.customization).leads;
      locked = usedThisMonth >= PLAN_LIMITS.FREE_LEADS_PER_MONTH;
      lastFreeLead = usedThisMonth + 1 === PLAN_LIMITS.FREE_LEADS_PER_MONTH;
      await bumpUsage(admin, ownerProfile.id, ownerProfile.customization as Record<string, unknown> | null, "leads");
    }

    const eventTag = activeEvent(ownerProfile?.customization);
    // TYPED ON THE OWNER'S OWN PHONE — the owner handed their phone to the
    // person in front of them. The contact is real and is saved, but this
    // browser is the OWNER'S: binding it to the contact (and stamping it as
    // the contact's visitor_id) made every later visit the owner made from it
    // read "Aaron viewed your card" in Aaron's Activity (2026-09-23 audit).
    // Same identity-based check as every analytics ingest (lib/self-traffic).
    const fromOwnersDevice = await isOwnerRequest(admin, card_owner).catch(() => false);

    const leadRow = {
        name,
        email: email || null,
        phone: phone || null,
        company: company || null,
        message: message || null,
        location: location || null,
        // Added by supabase/analytics-accuracy.sql; the insert below degrades
        // without it so a lead is never lost to an unapplied migration.
        geo_accuracy: geo.accuracy,
        card_owner,
        // New reach-outs arrive unread; over the free monthly cap they're also
        // tagged locked so the dashboard blurs them behind Pro. NO sms-ok /
        // sms-paused here — a shared contact carries neither, and only the
        // owner's own authenticated assertion can add one (see above).
        tags: [
          ...safeTags,
          "unread",
          ...(locked ? [LOCKED_LEAD_TAG] : []),
        ],
        source: source || null,
        visitor_id: fromOwnersDevice ? null : visitor_id,
        // "At an event?" (lib/event-tag.ts): the owner said where they are
        // meeting people today, so this contact is saved as met there.
        ...(eventTag ? { where_met: eventTag.label } : {}),
    };
    let { data: insertedLead, error } = await admin.from("leads").insert(leadRow).select("id").single();
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      // geo_accuracy not migrated yet (supabase/analytics-accuracy.sql). A LEAD
      // IS THE PRODUCT — losing one to a column that doesn't exist yet would be
      // the worst possible trade for a display nicety, and the visitor would see
      // "something went wrong" and submit again. Drop the qualifier, keep the
      // lead; the panel then renders the label exactly as it does today.
      const { geo_accuracy: _unused, ...legacyRow } = leadRow;
      void _unused;
      ({ data: insertedLead, error } = await admin.from("leads").insert(legacyRow).select("id").single());
    }

    if (error) {
      console.error("Supabase insert error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ── Everything past this point is BEST-EFFORT ──────────────────────────
    // The lead is already saved. A failure in CRM sync / notifications / email
    // must NEVER report failure back to the visitor (they'd see "something went
    // wrong" and re-submit a duplicate, even though we captured them fine).
    try {
    // THIS BROWSER IS THIS CONTACT from now on, for this owner — the binding
    // that lets their later visits be recognised (lib/known-contact.ts). After
    // the response, like every other side effect here: a return visit worth
    // announcing is at least a visit window away, and the visitor must not
    // wait on it. The owner's own details are never bound (they tested their
    // own form), and a different person bound to this browser is superseded.
    if (insertedLead?.id && ownerProfile?.id && !fromOwnersDevice) {
      const leadId = insertedLead.id as string;
      const ownerId = ownerProfile.id as string;
      after(
        bindFormDevice(admin, { leadId, ownerId, visitorId: visitor_id, email, phone })
          .catch((e) => reportError("leads.bindFormDevice", e)),
      );
    }

    // Sync to every connected CRM and the Zapier webhook (non-blocking).
    // Plan is re-checked HERE, at send time, not just when the integration was
    // connected. A token survives a downgrade, so without this a lapsed account
    // keeps syncing to a Pro-only destination indefinitely. dispatchCrmEvent
    // already gated its events this way — these paths did not, so the same
    // account could still receive lead syncs while its view/notification events
    // had stopped. Same rule everywhere now.
    if (ownerProfile?.id && isPaidPlan(ownerProfile.plan)) {
      // The context below is what a CRM record can't get anywhere else: where
      // the meeting happened, how the card was tapped, and WHICH card captured
      // it — which in an Office identifies the rep. Providers that have nowhere
      // to put a field ignore it, so this is additive for them.
      const leadData = {
        name,
        email: email || null,
        phone: phone || null,
        company: company || null,
        location,
        message: message || null,
        source: source ? getSourceLabel(source) : null,
        capturedByCard: card_owner,
        capturedByName: cardIdentity.name || null,
        // safeTags, NOT the raw client array: at capture time tags are
        // visitor-controlled, and they flow into HighLevel's first-class tags
        // field where a tag can fire the owner's workflows. Owner-chosen tags
        // reach the CRMs through the lead EDIT route instead.
        tags: safeTags.length ? safeTags : null,
        // The key per-card CRM scoping is checked against, inside
        // getCrmConnection and resolveZapierTarget. Undefined for a legacy
        // profile-card with no cards row, which is treated as out-of-scope
        // whenever a scope is set — "can't prove it belongs" must not send
        // someone's contacts onward.
        capturedByCardId: (cardRow?.id as string | undefined) ?? null,
      };
      // after(): these were bare floating promises. Nothing awaited them, so on
      // a serverless host the function could return its response and be frozen
      // with the CRM calls still in flight — the sync would simply never happen.
      // after() keeps the invocation alive until they finish WITHOUT making the
      // visitor wait: the form still returns immediately. allSettled inside
      // syncLeadToAllCrms, so one provider being down can't cancel the others.
      // The Zapier send validates its URL against the Zapier allowlist and the
      // card scope at send time, and is bounded by CRM_WEBHOOK_TIMEOUT_MS.
      after(
        Promise.allSettled([
          syncLeadToAllCrms(leadData, ownerProfile.id),
          sendLeadToZapier(leadData, ownerProfile.id),
        ]),
      );
    }

    // Tell the card owner (non-blocking).
    if (ownerProfile?.id) {
      // A sentence, not a column heading: "from a QR code" (lib/source-labels).
      const sourceStr = sourcePhrase(source);
      // A locked lead (over the free monthly cap) gets a TEASER notification —
      // it must not reveal the contact's name/details, or that would bypass the
      // lock. It's a conversion nudge instead.
      // after(), like the CRM syncs above and for exactly the same reason: a
      // bare floating promise can be cut off when the serverless function
      // freezes after responding. That is the worst version of losing a lead —
      // the row saves, so nothing looks wrong, but the owner gets no bell and
      // never learns the contact exists. The syncs twenty lines up were fixed
      // for this; the notification and push right here were missed.
      // ONE NOTIFICATION PER PERSON PER VISIT: this same person almost always
      // viewed the card and saved the contact minutes ago, each of which
      // already notified. Sharing their info is the biggest news of the visit,
      // so it UPGRADES that notification in place and replaces the banner —
      // rather than being the third buzz from one visitor.
      // A locked lead is still a lead, and the person still needs to know a
      // real human just handed over their details. Both the bell body AND the
      // pushBody below used to be upgrade pitches ("You've hit your 5 free
      // leads… Upgrade to Pro") — marketing, which push-policy.ts forbids, in
      // the one slot that should carry news. State the fact; the app explains
      // the cap when they open it.
      // A LOCKED lead's name is exactly what the cap withholds — the Contacts
      // page does not list them at all — yet this row used to print it. The
      // name is wrapped in the same NAME mark a returning contact's is
      // (lib/contact-privacy.ts): a Free bell shows blocks the app blurs (and,
      // on the web, "See who and where →"), an upgrade reveals every name the
      // account was already told about, and the lock screen says nothing.
      const shown = locked ? markName(name) : name;
      const title = `New contact: ${shown}`;
      const body = locked
        ? `${shown} shared their info — open to unlock.`
        : `${name} shared their info with you${sourceStr}.`;
      // THE SAME PERSON THE VIEW TRACKER SAW. /api/card-events keys a visit on
      // resolveVisitIdentity — the httpOnly sc_vid cookie first, the page's own
      // id second. This route keyed it on the raw body id alone, so whenever
      // the two differed (a browser that lost localStorage between opening the
      // card and sending the form; an id the server had to mint) the lead
      // opened a SECOND visit instead of upgrading the view's row: two bell
      // rows and two buzzes for one person, the second in an uncapped category.
      // A minted id matches nothing by definition, so that case keeps the old
      // value and falls back to the IP exactly as before.
      const seen = resolveVisitIdentity(req, typeof visitor_id === "string" ? visitor_id : null);
      const visitVisitorId = seen.minted ? visitor_id : seen.visitorId;
      after(
        notifyVisit({
          userId: ownerProfile.id,
          cardOwner: card_owner,
          visitorId: visitVisitorId,
          ip,
          notice: {
            type: "new_lead",
            pushCategory: "new_lead",
            title,
            body,
            // THE EXACT SCREEN: this contact's detail panel, not a dashboard
            // they then have to search. /contacts?lead= is the same deep link
            // the in-app bell uses (NotificationBell).
            url: insertedLead?.id
              ? `${APP_URL}/contacts?card=${encodeURIComponent(card_owner)}&lead=${insertedLead.id}`
              : `${APP_URL}/contacts?card=${encodeURIComponent(card_owner)}`,
            // NO vCARD ON THE NOTIFICATION. It used to carry one, and the web
            // notification put a "Save to Contacts" button on it that finished
            // the job without ever opening SwiftCard. Removed 2026-09-11: this
            // is the highest-intent moment the product gets, and the person
            // should see who it is and what they wrote before deciding to keep
            // them. The vCard is a button inside the app, one tap further in.
            //
            // The lock screen shows the useful thing: their number. A LOCKED
            // lead is the one case where we have nothing to show — the details
            // are exactly what is being withheld, the name included — so it
            // says what happened, never "Upgrade to Pro", which is a sales
            // message on a phone. Its own title too: the marked one above
            // would reach a Free lock screen as "New contact: a contact".
            ...(locked ? { pushTitle: "New contact" } : {}),
            pushBody: locked
              ? "Someone shared their info — open to unlock."
              : (phone ? `${phone}${company ? ` · ${company}` : ""}` : (email ?? "Tap to save")),
          },
        }).catch((e) => reportError("leads.notify", e)),
      );
      // An Office TEAMMATE's first lead ever → their admins hear about it
      // (lib/team-alerts). Never each lead after that: those stay with the
      // teammate, so a busy team cannot flood the admin's phone.
      // THE HEADS-UP, once a month at most (2026-09-23 notification review).
      // The next contact used to arrive locked with no warning at all. Bell
      // only — never a push: it is news about the plan, not about a person.
      // The app shows its own wording (lib/native-notification-copy).
      if (lastFreeLead) {
        const cap = PLAN_LIMITS.FREE_LEADS_PER_MONTH;
        after(insertNotification({
          user_id: ownerProfile.id as string,
          card_owner,
          type: "lead_cap_reached",
          title: `That's ${cap} of ${cap} new contacts this month`,
          // Accurate to lib/lead-access: a contact past the cap stays held until
          // the account is paid; the reset on the 1st frees NEW contacts only.
          body: "Anyone else who shares their info this month is still saved — nothing is lost, and Pro opens every one of them. Your free contacts reset on the 1st.",
        }).then(() => undefined).catch((e) => reportError("leads.cap_notice", e)));
      }
      after(announceFirstLeadIfTeammate(ownerProfile.id as string, (cardRow?.name as string | null) || (ownerProfile.name as string | null) || null));
    }


    // NOTE: the instant "Great connecting with you" confirmation email to the
    // LEAD was removed on purpose — the owner's real follow-up (manual or the
    // Day-1 automation) is the first thing the lead hears, not a canned blast.
    } catch (sideErr) {
      // Lead was saved; log and still report success to the visitor.
      console.error("Lead post-insert side-effect error (lead saved):", sideErr instanceof Error ? sideErr.message : sideErr);
    }

    return attachVisitIdentity(NextResponse.json({ success: true }), visitIdentity);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("API route error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
