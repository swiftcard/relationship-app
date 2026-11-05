import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { sendTrialChargeNotices } from "@/lib/trial-notice";

export const runtime = "nodejs";
export const maxDuration = 60;

// Hourly, from .github/workflows/trial-notice.yml — NOT a Vercel cron.
//
// The notice has to land within about an hour of exactly 7 days before the
// first charge (see lib/trial-notice for why that minute matters to Visa and
// Mastercard), and Vercel's Hobby plan allows two crons per project, each at
// most once a day. Worse, adding an hourly one there does not warn: it makes
// every later deployment fail validation. GitHub's scheduler is free, has no
// such limit, and is already how the morning push catch-up runs.
//
// The daily /api/reminders cron calls the same function as a backstop, so a
// stalled GitHub schedule delays the notice instead of dropping it.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  // PUSH_CATCHUP_SECRET is accepted so this can run on the GitHub secret that
  // already exists, and CRON_SECRET so the job can move onto a Vercel cron the
  // day the plan allows it — neither needs a code change. CLOCK_SECRET is the
  // Supabase clock's key (pg_cron trial-notice → clock_call, Vault clock_secret),
  // which runs this hourly; GitHub's schedule only fires a few times a day.
  const accepted = [process.env.CLOCK_SECRET, process.env.TRIAL_NOTICE_SECRET, process.env.PUSH_CATCHUP_SECRET, process.env.CRON_SECRET]
    .filter((s): s is string => Boolean(s))
    .map((s) => `Bearer ${s}`);
  // An unset secret must never authorize — `Bearer undefined` would otherwise
  // be a valid credential for anyone who guessed it.
  if (!accepted.length || !auth || !accepted.includes(auth)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "email_not_configured" }, { status: 500 });
  }

  const result = await sendTrialChargeNotices(getAdminSupabase(), new Resend(process.env.RESEND_API_KEY));
  return NextResponse.json({ ok: true, ...result });
}
