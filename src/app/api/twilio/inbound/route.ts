import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { addOptOut, removeOptOut, normalizePhone, logMessage } from "@/lib/messaging";
import { sendPushToUser } from "@/lib/push";
import { insertNotification } from "@/lib/notify";
import { reportError } from "@/lib/report-error";
import { isLockedLead } from "@/lib/lead-access";
import { isPaidPlan } from "@/lib/plan";
import { markName } from "@/lib/contact-privacy";

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "stop all"]);
const START_WORDS = new Set(["start", "unstop", "yes", "unsubscribe off"]);
const HELP_WORDS = new Set(["help", "info"]);

// HELP response (CTIA): program name, support contact, and opt-out reminder.
// If Twilio Advanced Opt-Out is enabled it answers HELP before we ever see it;
// this is the fail-safe so "Reply HELP for help" is true either way.
const HELP_REPLY =
  "SwiftCard (Swift Card Inc): follow-up messages sent on behalf of SwiftCard users. " +
  "Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out. " +
  "Support: hello@swiftcard.me or swiftcard.me/contact";

function twiml(message?: string) {
  const body = message
    ? `<Response><Message>${message.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message></Response>`
    : `<Response></Response>`;
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

// Twilio posts inbound SMS here (set this URL as the Messaging Service inbound webhook).
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  // Verify the request really came from Twilio (signed with your auth token).
  // FAIL CLOSED: without a configured auth token, an unsigned request could
  // forge inbound SMS to manipulate the opt-out list or inject into a thread.
  // In production we require the token + a valid signature; the skip flag is
  // honored only outside production (local testing).
  const skip = process.env.TWILIO_SKIP_VALIDATION === "true" && process.env.NODE_ENV !== "production";
  if (!skip) {
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!token) {
      return new NextResponse("Twilio not configured", { status: 503 });
    }
    const sig = req.headers.get("x-twilio-signature");
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const url = `https://${host}/api/twilio/inbound`;
    if (!sig || !twilio.validateRequest(token, sig, url, params)) {
      return new NextResponse("Invalid signature", { status: 403 });
    }
  }

  const from = params.From || "";
  const bodyText = (params.Body || "").trim();
  const keyword = bodyText.toLowerCase();

  // STOP / START keyword handling (carrier + our own suppression list).
  if (STOP_WORDS.has(keyword)) {
    // The carrier blocks further SMS to this number regardless, so the person
    // is protected either way — but OUR suppression list is what stops the
    // sequence engine from continuing to burn steps against them, and what
    // keeps the record of the request. addOptOut retries and reports; a
    // persistent failure must be loud rather than inferred later from a
    // complaint.
    if (!(await addOptOut("sms", from))) {
      await reportError("twilio.inbound.stop-not-recorded", { from });
    }
    return twiml(); // Twilio Advanced Opt-Out sends the confirmation; stay silent.
  }
  if (START_WORDS.has(keyword)) {
    await removeOptOut("sms", from);
    return twiml();
  }
  if (HELP_WORDS.has(keyword)) {
    return twiml(HELP_REPLY);
  }

  // Otherwise it's a real reply — log it into the ONE thread it belongs to.
  //
  // The phone lookup is global (a number can be a contact of several accounts —
  // normal when two users meet the same person at an event), and SwiftCard sends
  // through ONE shared Messaging Service, so `To` can't tell us who was messaged.
  // Writing the reply to every match would put a private answer meant for one
  // user into another user's conversation thread — a cross-account leak. Instead:
  //   • exactly one match  → that account holds this contact alone; log it there.
  //   • several matches    → attribute to whoever actually texted them last
  //                          (most recent OUTBOUND sms), never to the others.
  //   • several, none of whom ever texted → unattributable; log to none rather
  //                          than guess and leak.
  // STOP/START suppression above stays global on purpose (carrier requirement).
  const digits = normalizePhone(from);
  if (digits.length >= 7) {
    try {
      const admin = getAdminSupabase();
      // `phone` is stored as TYPED — "(212) 555-1234", "212.555.1234", "+1 212…"
      // — so a plain "%5551234%" missed every formatted copy. When the account
      // that actually texted had it formatted and one other account had it bare,
      // the bare one was the ONLY candidate and got the reply, its words in the
      // bell and on the lock screen (isolation audit 2026-09-24). A wildcard
      // between every digit finds every spelling; the exact normalized compare
      // below keeps only true matches. No small cap: a cut-off could drop the
      // account that texted before the "who texted last" rule ever saw it.
      const spread = `%${digits.split("").join("%")}%`;
      const { data: leads } = await admin
        .from("leads")
        .select("id, card_owner, phone, name, tags")
        .ilike("phone", spread)
        .limit(1000);
      const matches = (leads ?? []).filter((l) => l.phone && normalizePhone(l.phone) === digits);

      let target: { id: string; card_owner: string | null; name?: string | null; tags?: unknown } | null = null;
      if (matches.length === 1) {
        target = matches[0] as { id: string; card_owner: string | null; name?: string | null; tags?: unknown };
      } else if (matches.length > 1) {
        const { data: lastOut } = await admin
          .from("lead_messages")
          .select("lead_id")
          .in("lead_id", matches.map((m) => m.id as string))
          .eq("direction", "out")
          .eq("channel", "sms")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const winnerId = lastOut?.lead_id as string | undefined;
        target = winnerId
          ? ((matches.find((m) => m.id === winnerId) ?? null) as { id: string; card_owner: string | null; name?: string | null; tags?: unknown } | null)
          : null;
      }

      // ONE TEXT, ONE NOTIFICATION. Twilio redelivers a webhook it did not get
      // a timely 200 for, and this handler does a lead scan, an insert and an
      // APNs round trip before it answers. Without this a redelivery wrote the
      // reply into the thread twice and buzzed the owner twice for one message
      // — in an UNCAPPED category, so nothing downstream would absorb it.
      // MessageSid is Twilio's id for the message; it is identical on a retry.
      const messageSid = (params.MessageSid || params.SmsSid || "").trim() || null;
      if (target && messageSid) {
        const { data: seen } = await admin
          .from("lead_messages")
          .select("id")
          .eq("provider_sid", messageSid)
          .eq("direction", "in")
          .limit(1);
        if (seen?.length) return twiml();
      }

      if (target) {
        await logMessage({ leadId: target.id, cardOwner: target.card_owner, direction: "in", channel: "sms", body: bodyText, status: "received", providerSid: messageSid });

        // A lead answering a follow-up is a live conversation, and the reply is
        // worthless an hour late — this is the one inbound event in the product
        // that is genuinely time-critical. Bell row AND push, on every plan.
        if (target.card_owner) {
          const { data: cardRow } = await admin
            .from("cards").select("user_id").eq("username", target.card_owner).maybeSingle();
          const { data: owner } = cardRow?.user_id
            ? await admin.from("profiles").select("id, plan").eq("id", cardRow.user_id).maybeSingle()
            : await admin.from("profiles").select("id, plan").eq("username", target.card_owner).maybeSingle();
          if (owner?.id) {
            // A contact locked behind the Free cap is hidden on the Contacts
            // page, so neither their name nor their words go on the bell or the
            // lock screen (2026-10-06 notification audit). Sequences are Pro,
            // but one started before a downgrade can still draw a reply.
            const hidden = isLockedLead(target) && !isPaidPlan(owner.plan as string | null);
            const rawWho = (target.name || "").trim();
            const who = !rawWho ? "A contact" : hidden ? markName(rawWho) : rawWho;
            const shownText = hidden ? "Open SwiftCard to read their reply." : bodyText;
            // /contacts?lead=<id> opens THAT conversation. It is the link the
            // in-app bell already uses; /dashboard?lead= (my first attempt)
            // reads no such param and would have dumped them on the dashboard.
            const base = (process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me").replace(/\/$/, "");
            const url = `${base}/contacts?card=${encodeURIComponent(target.card_owner)}&lead=${encodeURIComponent(target.id)}`;
            const wrote = await insertNotification({
              user_id: owner.id as string,
              card_owner: target.card_owner,
              // Without it the bell row opened the contacts list rather than
              // this conversation (2026-10-02 notification audit).
              lead_id: target.id,
              type: "lead_reply",
              title: `${who} replied`,
              // The message itself, trimmed by push-policy to the lock-screen
              // budget. Seeing the actual words is why this is worth a buzz.
              body: shownText.replace(/\s+/g, " ").trim().slice(0, 300),
            }, { allowRepeat: true }).catch(() => false);
            // Never buzz for a row that was not written (notify.ts's contract):
            // a rejected duplicate means someone already announced this reply.
            if (wrote) await sendPushToUser(owner.id as string, {
              category: "lead_reply",
              title: `${who} replied`,
              body: shownText,
              url,
              tag: `lead-reply-${target.id}`,
              cardOwner: target.card_owner,
            }).catch(() => {});
          }
        }
      }
    } catch { /* ignore */ }
  }

  return twiml();
}
