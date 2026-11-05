import { NextRequest, NextResponse } from "next/server";
import { purgeExpiredDeletedAccounts, reconcileDeletedSubscriptions } from "@/lib/account-purge";
import { reportError } from "@/lib/report-error";

// ── Permanent deletion, hourly ───────────────────────────────────────────────
//
// The daily cron (api/reminders) purges accounts whose 30-day reopen window has
// passed. An account the owner asked to be removed COMPLETELY — at once, with
// the address free to sign up again straight away — is flagged
// `_deletion.purgeNow` and should not wait up to a day for that run (owner,
// 2026-09-24). So the same purge also runs hourly, from the GitHub schedule
// that already wakes every hour (.github/workflows/push-catchup.yml) with the
// same secret.
//
// It runs the app's own deletion (lib/account-purge purgeUserData): billing
// cancelled first, every table, the stored images and uploads, then the sign-in
// account. Idempotent — an account with nothing due costs one small query.

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  // CLOCK_SECRET: the Supabase clock (pg_cron push-catchup, Vault clock_secret).
  const accepted = [process.env.CLOCK_SECRET, process.env.PUSH_CATCHUP_SECRET, process.env.CRON_SECRET]
    .filter((s): s is string => Boolean(s))
    .map((s) => `Bearer ${s}`);
  // An unset secret must never authorize (`Bearer undefined`).
  return accepted.length > 0 && !!auth && accepted.includes(auth);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let purged = 0;
  let subscriptionsStopped = 0;
  // Billing first, for accounts still inside their window; the purge itself
  // also cancels before it deletes anything.
  try {
    subscriptionsStopped = await reconcileDeletedSubscriptions();
  } catch (e) {
    await reportError("account.purge-due.reconcile", e).catch(() => {});
  }
  try {
    purged = await purgeExpiredDeletedAccounts();
  } catch (e) {
    await reportError("account.purge-due.purge", e).catch(() => {});
    return NextResponse.json({ ok: false, purged, subscriptionsStopped }, { status: 500 });
  }
  return NextResponse.json({ ok: true, purged, subscriptionsStopped });
}
