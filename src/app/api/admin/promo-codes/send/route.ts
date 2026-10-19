import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { promoEmail, unsubUrl, marketingHeaders } from "@/lib/email-templates";
import { requireAdmin } from "@/lib/admin";
import { getAccountEmailMap } from "@/lib/account-email";
import { emailOptOutSet, isEmailOptedOut } from "@/lib/messaging";
import { canSendMarketing } from "@/lib/marketing-consent";
import { preferenceCenterUrl } from "@/lib/email-token";
import { officeTeamMemberIds } from "@/lib/office-team-members";
import { isOfficePlan, isPaidPlan } from "@/lib/plan";

// POST /api/admin/promo-codes/send — email a promo code to targeted users.
// Same session-based admin gate as the rest of the console.
export async function POST(req: NextRequest) {
  const adminUser = await requireAdmin();
  if (!adminUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const {
    code,            // required: promo code string
    headline,        // email subject / h1
    message,         // body copy
    segment = "free", // "free" | "pro" | "all"
    sendKey,         // one per confirm dialog: a double-click or retry can't send twice
  } = body;

  if (!code || !headline || !message) {
    return NextResponse.json({ error: "code, headline, message required" }, { status: 400 });
  }
  // The same bounds the broadcast composer keeps (audit F-ADMIN-06).
  if (typeof headline !== "string" || typeof message !== "string" || headline.length > 200 || message.length > 5000) {
    return NextResponse.json({ error: "The headline can be up to 200 characters and the message up to 5,000." }, { status: 400 });
  }
  const key = typeof sendKey === "string" && sendKey.length <= 64 ? sendKey : null;

  const admin = getAdminSupabase();

  // Look up the promo code
  const { data: promo, error: promoErr } = await admin
    .from("promo_codes")
    .select("*")
    .eq("code", code.toUpperCase().trim())
    .eq("active", true)
    .single();

  if (promoErr || !promo) {
    return NextResponse.json({ error: "Promo code not found or inactive" }, { status: 404 });
  }

  // free_time FIRST. The admin console only creates free_time codes, and a
  // free-time code explicitly nulls out the discount amount — so the percent
  // branch could never be true and every real code fell through to the dollar
  // fallback, rendering "$0.00 off your upgrade". That string is the only
  // place a recipient sees the offer's terms, and they act on it at checkout.
  // No codes have been mailed yet, so this is fixed before first use.
  const freeDays = Number(promo.free_days ?? 0);
  // The plan the code is FOR — it said "SwiftCard Pro" on every code, including
  // an Office code.
  const appliesTo = String(promo.applies_to ?? "any");
  const planWords = appliesTo === "office" ? "SwiftCard Office" : appliesTo === "pro" ? "SwiftCard Pro" : "SwiftCard Pro or Office";
  const discountText =
    promo.discount_type === "free_time" && freeDays > 0
      ? `${freeDays} ${freeDays === 1 ? "day" : "days"} of ${planWords}, free`
      : promo.discount_type === "percent" && promo.discount_percent
        ? `${promo.discount_percent}% off your first month of ${planWords}`
        : `$${((promo.discount_amount ?? 0) / 100).toFixed(2)} off your upgrade`;

  // Fetch target users. Excludes soft-deleted profiles — same gap the
  // broadcast segment query had: people who deleted their account, and were
  // told their data was on its way out, would still get a promo blast.
  let q = admin
    .from("profiles")
    .select("id, name, email, plan")
    .or("customization->>_deleted.is.null,customization->>_deleted.neq.true");
  if (segment === "free") q = q.eq("plan", "free");
  else if (segment === "pro") q = q.in("plan", ["pro", "enterprise"]);
  const { data: profiles } = await q;

  // TEAM MEMBERS never get a plan offer. Their plan is a seat their company
  // pays for, so "N days of SwiftCard Pro, free" is an offer they cannot use —
  // and the app itself never asks a team member to choose a plan or pay.
  // (The "pro" segment is pro+enterprise, and "all" has no plan filter, so
  // both reached them.) Fail closed: no exclusion list, no send.
  let teamMembers: Set<string>;
  try {
    teamMembers = await officeTeamMemberIds(admin);
  } catch {
    return NextResponse.json({ error: "Couldn't load the team-member list, so nothing was sent. Try again." }, { status: 500 });
  }
  // Never offer a plan to someone who already has it. An Office OWNER is on
  // the top plan, so no code upgrades them ("Apply code & upgrade" to an
  // Office owner, for Pro); a Pro code is equally meaningless to a Pro
  // subscriber. A Pro account still receives an Office (or any-plan) code —
  // that one is a real step up.
  const alreadyHasIt = (plan: string | null | undefined) =>
    appliesTo === "pro" ? isPaidPlan(plan) : isOfficePlan(plan);
  const notMembers = (profiles ?? []).filter((p) => !teamMembers.has(p.id as string));
  const targets = notMembers.filter((p) => !alreadyHasIt(p.plan as string | null));
  const teamMembersSkipped = (profiles?.length ?? 0) - notMembers.length;

  const resend = new Resend(process.env.RESEND_API_KEY);
  // Send to each user's ACCOUNT (auth) email, not profiles.email (which can be
  // the card's public contact address).
  const authEmails = await getAccountEmailMap();

  // One chunked prefs read for the whole target list rather than a query per
  // recipient — same reason as the broadcast sender: N extra serial round trips
  // in one invocation is a timeout risk that can strand a send half-finished.
  const prefsById = new Map<string, { marketing_emails?: boolean | null; unsubscribe_token?: string | null }>();
  {
    const ids = targets.map((p) => p.id as string);
    for (let i = 0; i < ids.length; i += 500) {
      const { data: rows } = await admin
        .from("email_preferences")
        .select("user_id, marketing_emails, unsubscribe_token")
        .in("user_id", ids.slice(i, i + 500));
      for (const r of rows ?? []) {
        prefsById.set(r.user_id as string, r as { marketing_emails?: boolean | null; unsubscribe_token?: string | null });
      }
    }
  }

  // The second suppression list — see emailOptOutSet. A contact-level
  // unsubscribe promised we'd stop emailing that address; it was only ever
  // honoured by the lead/follow-up senders, never here.
  const contactOptOuts = await emailOptOutSet(
    targets.map((p) => authEmails.get(p.id) ?? (p.email as string | null)),
  );

  // ── The broadcast composer's protections (audit F-ADMIN-03) ────────────────
  // A promo blast is marketing mail from the same domain, and had none of them.
  //
  // The warm-up cap: a rolling 24h count of what has gone out, broadcasts and
  // promos together, refused rather than truncated — a partial send leaves half
  // the list mailed with no record of where it stopped.
  const dailyCap = Number(process.env.EMAIL_DAILY_SEND_CAP ?? 200);
  if (Number.isFinite(dailyCap) && dailyCap > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ count: broadcastToday }, { count: promoToday }] = await Promise.all([
      admin.from("email_logs").select("*", { count: "exact", head: true }).eq("type", "marketing").eq("status", "sent").gte("created_at", since),
      admin.from("email_logs").select("*", { count: "exact", head: true }).like("type", "promo:%").gte("created_at", since),
    ]);
    const already = (broadcastToday ?? 0) + (promoToday ?? 0);
    if (already + targets.length > dailyCap) {
      return NextResponse.json(
        { error: `This send (${targets.length}) plus ${already} already sent in the last 24h would exceed the ${dailyCap}/day warm-up cap. Send to a smaller segment or wait.` },
        { status: 429 },
      );
    }
  }

  // The campaign record, BEFORE sending: one row per confirm, so the same send
  // can't go out twice, and there is a record of it afterwards.
  let campaignId: string | null = null;
  {
    const { data: created, error: campErr } = await admin
      .from("admin_email_campaigns")
      .insert({
        idempotency_key: key,
        sent_by: adminUser.email ?? "admin",
        segment: `${segment} · promo ${promo.code}`,
        subject: headline,
        headline,
        body: message,
        intended_count: targets.length,
      })
      .select("id")
      .single();
    if (campErr?.code === "23505" && key) {
      const { data: existing } = await admin
        .from("admin_email_campaigns")
        .select("sent_count, skipped_count, status")
        .eq("idempotency_key", key)
        .maybeSingle();
      return NextResponse.json({ duplicate: true, sent: existing?.sent_count ?? 0, skipped: existing?.skipped_count ?? 0, teamMembersSkipped: 0, errors: [] });
    }
    campaignId = (created?.id as string | null) ?? null;
  }

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const profile of targets) {
    const recipient = authEmails.get(profile.id) ?? profile.email;
    if (!recipient) { skipped++; continue; }

    // Missing row = never opted out (same as the old .single() returning null).
    const prefs = prefsById.get(profile.id as string);

    if (prefs?.marketing_emails === false) { skipped++; continue; }
    // A promo code is the "Offers and promotions" category — someone who kept
    // product updates but switched offers off must not receive this.
    if (!(await canSendMarketing(profile.id as string, "promotions"))) { skipped++; continue; }
    if (isEmailOptedOut(contactOptOuts, recipient)) { skipped++; continue; }

    const firstName = profile.name?.split(" ")[0] || "there";
    const token = prefs?.unsubscribe_token ?? "";

    const unsub = unsubUrl(token);

    // Same backstop as the broadcast sender: a promo blast is marketing mail,
    // so no working opt-out means no send. Without an email_preferences row
    // unsubUrl returns undefined, the footer link degrades to plain text and
    // the List-Unsubscribe headers are dropped — and until provisioning was
    // fixed, no account had a row at all.
    if (!unsub) { skipped++; continue; }

    const template = promoEmail({
      firstName,
      code: promo.code,
      discountText,
      headline,
      body: message,
      unsubscribeUrl: unsub,
      prefsUrl: preferenceCenterUrl(profile.id as string),
    });

    try {
      const { data: emailData, error: sendErr } = await resend.emails.send({
        // NO `from` override here. It used to be spread AFTER the template,
        // which silently replaced the campaign sender with the transactional
        // one — so the marketing/transactional split never actually happened.
        // The template carries news@ (lib/email-senders).
        ...template,
        to: recipient,
        ...(unsub ? { headers: marketingHeaders(unsub) } : {}),
      });
      if (sendErr) { errors.push(`${recipient}: ${sendErr.message}`); continue; }

      // Tagged with the code ("promo:LAUNCH20") so the admin promo log can
      // report per-code send counts and dates. Nothing queries the bare
      // "promo" type, so this is safe to extend; older rows show up in the
      // log as untagged promo emails.
      await admin.from("email_logs").insert({
        user_id: profile.id,
        email: recipient,
        type: `promo:${promo.code}`,
        subject: template.subject,
        resend_id: emailData?.id,
      });

      sent++;
    } catch (e) {
      errors.push(`${recipient}: ${e}`);
    }
  }

  if (campaignId) {
    await admin
      .from("admin_email_campaigns")
      .update({ sent_count: sent, failed_count: errors.length, skipped_count: skipped, status: errors.length === 0 ? "sent" : sent === 0 ? "failed" : "partial", completed_at: new Date().toISOString() })
      .eq("id", campaignId);
  }

  return NextResponse.json({ sent, skipped, teamMembersSkipped, errors });
}
