import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/admin";
import { marketingEmail, unsubUrl, marketingHeaders } from "@/lib/email-templates";
import { getAccountEmailMap } from "@/lib/account-email";
import { isPaidPlan } from "@/lib/plan";
import { emailOptOutSet, isEmailOptedOut } from "@/lib/messaging";
import { marketingAudience } from "@/lib/marketing-consent";
import { preferenceCenterUrl } from "@/lib/email-token";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

type Segment = "all" | "free" | "pro" | "office";

function segmentQuery(admin: ReturnType<typeof getAdminSupabase>, segment: Segment) {
  // customization->>_deleted: the recipient COUNT in GET already excludes
  // soft-deleted profiles, and this query did not — so the composer showed one
  // number and the send loop mailed a larger set, including people who had
  // deleted their account and were promised their data was on its way out.
  // Latent while no profile is soft-deleted; certain to fire on the first one.
  let q = admin
    .from("profiles")
    .select("id, name, email")
    .or("customization->>_deleted.is.null,customization->>_deleted.neq.true");
  if (segment === "free") q = q.eq("plan", "free");
  else if (segment === "pro") q = q.in("plan", ["pro", "enterprise"]);
  else if (segment === "office") q = q.eq("plan", "enterprise");
  return q;
}

// GET: live recipient counts per segment (shown in the composer before sending).
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = getAdminSupabase();

  const { data: profiles, error } = await admin.from("profiles").select("id, email, plan, customization");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const live = (profiles ?? []).filter((p) => p.email && !((p.customization as { _deleted?: boolean } | null)?._deleted));
  const counts = {
    all: live.length,
    free: live.filter((p) => p.plan === "free" || !p.plan).length,
    pro: live.filter((p) => isPaidPlan(p.plan)).length,
    office: live.filter((p) => p.plan === "enterprise").length,
  };

  // How many have opted out of marketing (skipped at send time).
  let optedOut = 0;
  const { data: prefs, error: prefErr } = await admin.from("email_preferences").select("user_id, marketing_emails").eq("marketing_emails", false);
  if (!prefErr) optedOut = (prefs ?? []).length;

  return NextResponse.json({ counts, optedOut, emailTablesReady: !prefErr });
}

// POST: send a marketing email to a segment — or, with test:true, ONLY to the
// admin themselves so the email can be checked before blasting everyone.
export async function POST(req: NextRequest) {
  const adminUser = await requireAdmin();
  if (!adminUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const {
    segment = "all",
    subject,
    headline,
    message,
    ctaLabel = "Open SwiftCard",
    ctaUrl = APP_URL,
    test = false,
    sendKey,
  } = body as { segment?: Segment; subject?: string; headline?: string; message?: string; ctaLabel?: string; ctaUrl?: string; test?: boolean; sendKey?: string };

  if (!subject || !headline || !message) {
    return NextResponse.json({ error: "subject, headline, message required" }, { status: 400 });
  }
  // Bounded on the server, not only by the composer (audit F-ADMIN-06): this
  // text is sent to every account in the segment.
  if ([subject, headline, ctaLabel].some((v) => typeof v !== "string" || v.length > 200)
    || typeof message !== "string" || message.length > 5000
    || typeof ctaUrl !== "string" || ctaUrl.length > 500) {
    return NextResponse.json({ error: "The subject, headline and button can be up to 200 characters, the message up to 5,000." }, { status: 400 });
  }

  const admin = getAdminSupabase();
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Test mode: one email, to the admin, clearly labeled. Nothing else sent.
  if (test) {
    // The admin's OWN unsubscribe token, so a test send exercises the real
    // one-click link end to end. Previously this passed unsubUrl(""), which
    // rendered a tokenless URL that could never identify anyone — so the test
    // send was the one email guaranteed not to prove the link works.
    const { data: adminPrefs } = await admin
      .from("email_preferences")
      .select("unsubscribe_token")
      .eq("user_id", adminUser.id)
      .maybeSingle();
    const unsub = unsubUrl((adminPrefs?.unsubscribe_token as string | null) ?? "");
    const template = marketingEmail({
      firstName: "there",
      subject: `[TEST] ${subject}`,
      headline,
      body: message,
      ctaLabel,
      ctaUrl,
      unsubscribeUrl: unsub,
    });
    try {
      const { error } = await resend.emails.send({
        // NO `from` override here. It used to be spread AFTER the template,
        // which silently replaced the campaign sender with the transactional
        // one — so the marketing/transactional split never actually happened.
        // The template carries news@ (lib/email-senders).
        ...template,
        subject: `[TEST] ${subject}`,
        to: adminUser.email!,
        ...(unsub ? { headers: marketingHeaders(unsub) } : {}),
      });
      if (error) return NextResponse.json({ error: `Test send failed: ${error.message}` }, { status: 500 });
      return NextResponse.json({ test: true, sent: 1, to: adminUser.email });
    } catch (e) {
      return NextResponse.json({ error: `Test send failed: ${e}` }, { status: 500 });
    }
  }

  const { data: profiles, error } = await segmentQuery(admin, segment);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Campaign log ────────────────────────────────────────────────────────────
  // One row per campaign, created BEFORE sending (status 'processing') and
  // finalized after. `sendKey` is generated once per confirm dialog on the
  // client, so a double-click or a retried request can't send (or log) twice.
  // If the table hasn't been migrated yet (admin-email-log.sql), sending still
  // works — history is simply unavailable, and the UI says so.
  let campaignId: string | null = null;
  {
    const { data: created, error: campErr } = await admin
      .from("admin_email_campaigns")
      .insert({
        idempotency_key: sendKey || null,
        sent_by: adminUser.email ?? "admin",
        segment,
        subject,
        headline,
        body: message,
        cta_label: ctaLabel,
        cta_url: ctaUrl,
        intended_count: profiles?.length ?? 0,
      })
      .select("id")
      .single();
    if (campErr?.code === "23505" && sendKey) {
      // Same sendKey already used — this exact campaign was (or is being) sent.
      const { data: existing } = await admin
        .from("admin_email_campaigns")
        .select("sent_count, skipped_count, status")
        .eq("idempotency_key", sendKey)
        .maybeSingle();
      return NextResponse.json({
        duplicate: true,
        sent: existing?.sent_count ?? 0,
        skipped: existing?.skipped_count ?? 0,
        status: existing?.status ?? "processing",
        errors: [],
      });
    }
    campaignId = (created?.id as string | null) ?? null;
  }

  // Best-effort per-recipient outcome row; tolerates a pre-migration schema.
  async function logRecipient(row: { user_id: string | null; email: string; status: string; resend_id?: string | null; error?: string | null }) {
    const full = { type: "marketing", subject, campaign_id: campaignId, ...row };
    const { error: e1 } = await admin.from("email_logs").insert(full);
    if (e1) {
      // campaign_id / error / status columns may not exist yet — log what we can.
      await admin.from("email_logs").insert({ user_id: row.user_id, email: row.email, type: "marketing", subject, resend_id: row.resend_id ?? null }).then(() => {}, () => {});
    }
  }

  // Send to the ACCOUNT (auth) email of each user, not profiles.email (which can
  // be the card's public contact address). One listUsers page → id→auth-email map.
  const authEmails = await getAccountEmailMap();

  // Email preferences for the WHOLE list in one read (chunked) instead of one
  // query per recipient. At ~1,000 users that was 1,000 extra serial round trips
  // inside a single function invocation — a real timeout risk that could strand
  // a broadcast half-sent. Same values, same skip rules, just fetched up front.
  const prefsById = new Map<string, { marketing_emails?: boolean | null; unsubscribe_token?: string | null }>();
  {
    const ids = (profiles ?? []).map((p) => p.id as string);
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

  // THE preference-centre gate: category flag, 30-day pause and the new
  // marketing_opt_out, for the whole list in one chunked read. A broadcast is a
  // product update; promotions have their own sender and their own category.
  // Fail-closed inside the helper — an id whose row could not be read is absent
  // from the set, so the check below skips it.
  const allowedByPrefs = await marketingAudience(
    (profiles ?? []).map((p) => p.id as string),
    "product_updates",
  );

  // Contact-level opt-outs for this whole recipient list, in one chunked read
  // (same reason the prefs above are batched — N serial round trips in one
  // invocation is a timeout risk). Fail-closed inside the helper.
  const contactOptOuts = await emailOptOutSet(
    (profiles ?? []).map((p) => authEmails.get(p.id) ?? (p.email as string | null)),
  );

  // ── Warm-up guard ───────────────────────────────────────────────────────────
  // This loop sends one email per profile with nothing throttling it, so a
  // launch blast to the whole list goes out as a single burst. On a domain with
  // no sending history that is the classic way to lose deliverability for
  // months: providers cannot distinguish a real product's launch from a
  // spammer's first run, and judge it on the only evidence available — a cold
  // domain that suddenly emitted thousands of messages.
  //
  // The cap is a rolling 24-hour count of marketing sends, so it encodes the
  // warm-up ramp itself: raise EMAIL_DAILY_SEND_CAP as reputation builds
  // (~50 → 100 → 250 → 500 → 1000, never more than doubling day over day).
  //
  // It REFUSES rather than truncating. A partial send would leave half the list
  // having received a campaign with no record of where it stopped, and re-running
  // would double-send everyone before it.
  const dailyCap = Number(process.env.EMAIL_DAILY_SEND_CAP ?? 200);
  if (Number.isFinite(dailyCap) && dailyCap > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // status='sent' only: email_logs also holds 'skipped' and 'failed' rows, and
    // counting those would burn the cap on mail that was never delivered — a run
    // that skipped 500 unsubscribed users would lock out the next 500 real sends.
    // …and promo blasts, which go out from the same domain (audit F-ADMIN-03).
    const [{ count: sentToday }, { count: promoToday }] = await Promise.all([
      admin.from("email_logs").select("*", { count: "exact", head: true }).eq("type", "marketing").eq("status", "sent").gte("created_at", since),
      admin.from("email_logs").select("*", { count: "exact", head: true }).like("type", "promo:%").gte("created_at", since),
    ]);

    const already = (sentToday ?? 0) + (promoToday ?? 0);
    const wanted = (profiles ?? []).length;
    if (already + wanted > dailyCap) {
      return NextResponse.json(
        {
          error: "warmup_cap",
          message:
            `This send (${wanted}) plus ${already} already sent in the last 24h would exceed ` +
            `the ${dailyCap}/day warm-up cap. Send to a smaller segment, wait, or raise ` +
            `EMAIL_DAILY_SEND_CAP once the domain has more sending history.`,
          cap: dailyCap,
          sent_last_24h: already,
          requested: wanted,
        },
        { status: 429 },
      );
    }
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const profile of profiles ?? []) {
    const recipient = authEmails.get(profile.id) ?? profile.email;
    if (!recipient) {
      skipped++;
      if (campaignId) await logRecipient({ user_id: profile.id, email: "(no email address)", status: "skipped", error: "No account email address" });
      continue;
    }

    // Missing row = never opted out (same as the old .single() returning null).
    const prefs = prefsById.get(profile.id as string);

    if (prefs?.marketing_emails === false || !allowedByPrefs.has(profile.id as string)) {
      skipped++;
      if (campaignId) await logRecipient({ user_id: profile.id, email: recipient, status: "skipped", error: "Unsubscribed, paused, or opted out of this category" });
      continue;
    }

    // The OTHER suppression list. message_opt_outs is written by the
    // contact-level unsubscribe (/api/unsubscribe/contact) and was consulted
    // only by the lead / invite / follow-up senders — so someone who
    // unsubscribed from a follow-up, and was told we'd stop emailing that
    // address, kept getting broadcasts whenever it was also their account
    // email. Neither unsubscribe endpoint writes the other table, so the lists
    // never converged. Both are checked now, everywhere.
    if (isEmailOptedOut(contactOptOuts, recipient)) {
      skipped++;
      if (campaignId) await logRecipient({ user_id: profile.id, email: recipient, status: "skipped", error: "Address opted out of all SwiftCard email" });
      continue;
    }

    const firstName = profile.name?.split(" ")[0] || "there";
    const token = prefs?.unsubscribe_token ?? "";

    const unsub = unsubUrl(token);

    // No token, no send. unsubUrl returns undefined for a blank token, and this
    // loop used to carry on regardless: the footer link degraded to a plain
    // sentence and the List-Unsubscribe header pair was dropped, so the message
    // went out with no opt-out of any kind and /api/unsubscribe had nothing to
    // match the recipient by. Because nothing provisioned an email_preferences
    // row, that was EVERY recipient.
    //
    // Provisioning now mints the row at signup and a backfill covered existing
    // accounts, so this should not trigger — it is the backstop that makes
    // "we cannot mail you without an opt-out" true by construction rather than
    // by assumption. Skipping is the safe direction: a missed marketing email
    // is nothing, an unsubscribable one is a CAN-SPAM violation.
    if (!unsub) {
      skipped++;
      if (campaignId) {
        await logRecipient({
          user_id: profile.id,
          email: recipient,
          status: "skipped",
          error: "No unsubscribe token — cannot send marketing mail without a working opt-out",
        });
      }
      continue;
    }
    const template = marketingEmail({
      firstName,
      subject,
      headline,
      body: message,
      ctaLabel,
      ctaUrl,
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
      if (sendErr) {
        failed++;
        errors.push(`${recipient}: ${sendErr.message}`);
        await logRecipient({ user_id: profile.id, email: recipient, status: "failed", error: sendErr.message });
        continue;
      }

      await logRecipient({ user_id: profile.id, email: recipient, status: "sent", resend_id: emailData?.id ?? null });

      sent++;
    } catch (e) {
      failed++;
      errors.push(`${recipient}: ${e}`);
      await logRecipient({ user_id: profile.id, email: recipient, status: "failed", error: String(e).slice(0, 500) });
    }
  }

  // Finalize the campaign: Sent (no failures), Partially sent, or Failed.
  if (campaignId) {
    const status = failed === 0 ? "sent" : sent === 0 ? "failed" : "partial";
    await admin
      .from("admin_email_campaigns")
      .update({ sent_count: sent, failed_count: failed, skipped_count: skipped, status, completed_at: new Date().toISOString() })
      .eq("id", campaignId);
  }

  return NextResponse.json({ sent, skipped, failed, errors });
}
