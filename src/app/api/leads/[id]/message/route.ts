import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOwnerUsernames } from "@/lib/owner-usernames";
import { isLockedLead, ownsLead } from "@/lib/lead-access";
import { isPaidUser } from "@/lib/notification-privacy";
import { deliverToLead } from "@/lib/messaging";
import { isPaidPlan } from "@/lib/plan";
import { isRateLimited } from "@/lib/rate-limit";
import { outboundDailyCapHit, OUTBOUND_CAP_MESSAGE } from "@/lib/outbound-cap";

// GET — the conversation thread (outbound messages you've sent this contact).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();
  const [{ data: lead }, usernames] = await Promise.all([
    admin.from("leads").select("card_owner, tags").eq("id", id).single(),
    getOwnerUsernames(user.id),
  ]);
  if (!ownsLead(usernames, lead)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // A contact locked behind the Free cap is hidden everywhere else; so is its thread.
  if (isLockedLead(lead) && !(await isPaidUser(user.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Table may not exist before the migration is run — degrade to empty thread.
  const { data: messages } = await admin
    .from("lead_messages")
    .select("id, direction, channel, body, status, created_at")
    .eq("lead_id", id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ messages: messages ?? [] });
}

// POST — send a message to the contact via email (free, preferred) or SMS
// (one shared SwiftCard number). Branded so they know who it's from.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Every send here is a real Twilio or Resend charge on the SHARED sender —
  // the same reason the sibling SMS route is capped. This one inherited
  // nothing, so any authenticated account, Free included, could script it and
  // run up spend with no ceiling and no meter.
  if (await isRateLimited(`lead-message:${user.id}`, 60, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "You're sending messages very quickly — give it a minute and try again." },
      { status: 429 },
    );
  }
  if (await outboundDailyCapHit(user.id)) {
    return NextResponse.json({ error: OUTBOUND_CAP_MESSAGE }, { status: 429 });
  }

  const { text, channel: reqChannel, subject } = await req.json();
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) return NextResponse.json({ error: "Message is empty." }, { status: 400 });
  // Cap the payload: an SMS is billed per segment, so an unbounded body is an
  // unbounded charge. Generous enough for a long email, far short of abuse.
  if (body.length > 5000) {
    return NextResponse.json({ error: "That message is too long." }, { status: 413 });
  }
  const preferChannel = reqChannel === "sms" || reqChannel === "email" ? reqChannel : undefined;

  const admin = getAdminSupabase();
  const [{ data: lead }, usernames] = await Promise.all([
    admin.from("leads").select("name, email, phone, card_owner, tags").eq("id", id).single(),
    getOwnerUsernames(user.id),
  ]);
  if (!ownsLead(usernames, lead)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The SAMPLE contact (lib/demo-contact) is not a person: its email and
  // phone are made up. Sending "to" it mailed example.com and wrote a "Sent"
  // row into its Activity & Messages that described nothing real.
  if (((lead?.tags as string[] | null) ?? []).includes("demo")) {
    return NextResponse.json({ error: "Jordan is a sample contact, so nothing is sent. Messages go to your real contacts." }, { status: 400 });
  }
  // Messaging a contact the Free cap is hiding would reach someone whose details
  // the account cannot see — the lock has to hold on send as well as on read.
  if (isLockedLead(lead) && !(await isPaidUser(user.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // An explicit DECLINE blocks SMS here too — see the same guard in
  // /api/sms/send. Only the SMS channel is blocked: this route is email-first,
  // and declining texts is not a decline of email, which carries its own
  // unsubscribe. A text step must never silently fall back to email either, so
  // reject rather than re-routing.
  const declinedSms = (lead.tags as string[] | null)?.includes("sms-paused") ?? false;
  // Affirmative opt-in (the sms-ok tag). With no explicit channel from the UI,
  // this promotes SMS over email in deliverToLead — a contact who ticked the
  // consent box is telling us texts are the channel they actually read.
  // sms-paused vetoes it, so a later "stop texting me" outranks the earlier yes.
  const smsConsented = ((lead.tags as string[] | null) ?? []).includes("sms-ok") && !declinedSms;
  if (declinedSms && (preferChannel === "sms" || !lead.email)) {
    return NextResponse.json(
      { error: "sms_declined", message: "This contact didn't opt in to texts. You can still email them." },
      { status: 409 },
    );
  }

  // Sender identity = the card that captured this lead (fall back to profile).
  const { data: card } = await admin
    .from("cards")
    .select("name, title, company, phone, email, website")
    .eq("username", lead.card_owner)
    .maybeSingle();
  let sender = card as { name?: string; title?: string; company?: string; phone?: string; email?: string; website?: string } | null;
  if (!sender) {
    const { data: prof } = await admin
      .from("profiles")
      .select("name, title, company, phone, email, website")
      .eq("username", lead.card_owner)
      .maybeSingle();
    sender = prof;
  }
  // Paid senders get no SwiftCard branding on the message they send.
  const { data: senderPlan } = await admin.from("profiles").select("plan").eq("id", user.id).maybeSingle();

  const result = await deliverToLead({
    leadId: id,
    cardOwner: lead.card_owner,
    lead: { email: lead.email, phone: lead.phone, name: lead.name },
    sender: {
      name: sender?.name || null,
      title: sender?.title || null,
      company: sender?.company || null,
      phone: sender?.phone || null,
      email: sender?.email || null,
      website: sender?.website || null,
    },
    text: body,
    // Capped like the body: a subject is one line, not a second message.
    subject: typeof subject === "string" ? subject.replace(/[\r\n]+/g, " ").slice(0, 150) : null,
    cardUsername: lead.card_owner,
    channel: preferChannel,
    smsConsented,
    senderPaid: isPaidPlan(senderPlan?.plan as string | null),
    // Typed by hand in the contact's reply box, sent on that tap — personal
    // mail, so no List-Unsubscribe headers to file it under Promotions.
    personal: true,
  });
  const { channel, status } = result;

  if (status === "no_contact") {
    // A text that found a phone on file it can't use: say so, not "no phone".
    if (channel === "sms" && lead.phone) {
      return NextResponse.json({ error: "This number can't receive texts from SwiftCard (only US and Canadian mobile numbers can)." }, { status: 400 });
    }
    return NextResponse.json({ error: "This contact has no email or phone on file." }, { status: 400 });
  }
  if (status === "opted_out") {
    return NextResponse.json({ error: "opted_out", channel, message: `This contact opted out of ${channel === "sms" ? "texts" : "emails"}.` }, { status: 409 });
  }
  if (status === "not_configured") {
    return NextResponse.json(
      {
        error: "not_configured",
        channel,
        message: channel === "sms"
          ? "Texting isn't switched on yet — add your Twilio keys + Messaging Service SID to send SMS."
          : "Email isn't switched on yet — add your Resend API key to send emails.",
      },
      { status: 503 },
    );
  }
  if (status === "failed") {
    return NextResponse.json({ error: "failed", channel, message: "Couldn't deliver the message. Please try again." }, { status: 502 });
  }

  const createdAt = new Date().toISOString();
  return NextResponse.json({
    ok: true,
    channel,
    message: { id: createdAt, direction: "out", channel, body, status: "sent", created_at: createdAt },
  });
}
