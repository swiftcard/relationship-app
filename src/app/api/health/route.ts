import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { checkApnsCredentials } from "@/lib/apns";
import { checkFcmCredentials } from "@/lib/fcm";

// ── Canonical health endpoint ────────────────────────────────────────────────
// One cheap, honest answer to "is the product alive right now?": the app is
// serving AND its database answers. Used by Performance Watch (every 4h) and
// available to uptime checks. Deliberately tiny — no auth, no user data, and
// the DB probe is a HEAD count on one table.
export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  let db = false;
  try {
    const { error } = await getAdminSupabase().from("profiles").select("id", { count: "exact", head: true }).limit(1);
    db = !error;
  } catch { db = false; }
  // The DATABASE's time, measured here: the credential checks below (push,
  // Wallet, Stripe) take their own time and must not read as a slow database
  // in the uptime guard's "database answers quickly" check (< 1,200ms).
  const dbMs = Date.now() - t0;
  // PUSH CREDENTIALS. Reported, never part of `ok`: a broken APNs key must not
  // take the site's health down with it, but it must be VISIBLE — for a week in
  // 2026-09 not one notification reached a phone and nothing anywhere said so.
  // Booleans and Apple's reason word only; no key material. scripts/health-check
  // turns these into an alert.
  // fcm is the Android half, and it is silent in exactly the same way: a wrong
  // or revoked service-account key means no Android phone ever buzzes and
  // nothing turns red. Asking Google to mint an access token is the step that
  // fails when the key, the client email or the project disagree, and it sends
  // no notification to anyone.
  type CredHealth = { configured: boolean; ok: boolean; reason: string };
  let push: { apns: CredHealth; fcm: CredHealth; webPush: boolean } | null = null;
  try {
    push = {
      apns: await checkApnsCredentials(),
      fcm: await checkFcmCredentials(),
      webPush: !!process.env.VAPID_PRIVATE_KEY && !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    };
  } catch { push = null; }
  // GOOGLE WALLET, the Android pass. Reported the same way and for the same
  // reason: a revoked service-account key makes "Add to Google Wallet" fail on
  // every Android phone with nothing turning red. Not configured is normal
  // until the issuer account exists. Imported only here, so the pass builder
  // it sits beside never loads on the hot path above.
  let googleWallet: CredHealth | null = null;
  try {
    const { checkGoogleWalletCredentials } = await import("@/lib/google-wallet");
    googleWallet = await checkGoogleWalletCredentials();
  } catch { googleWallet = null; }
  // STRIPE, the money. Reported, never part of `ok`, for the same reason as
  // push: a revoked or test key means no real payment goes through and
  // nothing else turns red. "live"/"test" or Stripe's error, no business data;
  // cached five minutes and capped at three seconds (lib/admin-data/billing).
  let stripe: CredHealth | null = null;
  try {
    const { stripeHealth } = await import("@/lib/admin-data/billing");
    stripe = await stripeHealth();
  } catch { stripe = null; }
  // WHICH BUILD is answering. Deployment Checks hold a new build until CI
  // passes, so "deployed" and "live" are different moments; the post-deploy
  // checks wait for this to name their commit (scripts/wait-for-live.mjs)
  // before testing swiftcard.me. The repository is public; this is no secret.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || null;
  return NextResponse.json(
    { ok: db, db, dbMs, push, googleWallet, stripe, sha },
    { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
