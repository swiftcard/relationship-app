import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { writePushPrefs } from "@/lib/push-prefs";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { assertSafeUrl } from "@/lib/safe-fetch";

// A browser push endpoint (or apns:<token> row) belongs to a DEVICE; on a
// shared device the signed-in user legitimately changes, so the upsert
// transfers the row. Endpoints are high-entropy URLs, so hijacking someone
// else's requires the endpoint itself to have leaked — but validate shape AND
// destination: the server later POSTs to this URL via web-push, so an
// unchecked https host is a blind-SSRF primitive into internal services.
// Returns true only for a native device token (apns: on iOS, fcm: on
// Android — neither is ever fetched as a URL) or a public-internet https URL.
async function isSafePushEndpoint(endpoint: unknown): Promise<boolean> {
  if (typeof endpoint !== "string" || endpoint.length > 1024) return false;
  if (endpoint.startsWith("apns:") || endpoint.startsWith("fcm:")) return endpoint.length > 20;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // Reject private/loopback/link-local/metadata hosts (also blocks a name
  // that resolves to a private IP — DNS-rebinding defense). Delivery in
  // lib/push.ts re-checks at send time to close the rebinding-at-send gap.
  try {
    await assertSafeUrl(url);
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (await isRateLimited(`push-subscribe:${user.id}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { endpoint, p256dh, auth, replaces, timezone } = await req.json();
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Missing subscription fields" }, { status: 400 });
  }
  if (!(await isSafePushEndpoint(endpoint))) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  const admin = getAdminSupabase();
  // The upsert result is CHECKED. A silent failure here told the client
  // "subscribed" while no row existed — and the failure mode is real: if the
  // production table lacks the UNIQUE constraint on endpoint that
  // onConflict:"endpoint" requires, Postgres raises 42P10 on every call. Worse,
  // without that constraint two accounts could both hold rows for one device
  // token, so pushes for BOTH would land on the same phone
  // (supabase/view-visit-window.sql adds the constraint + dedupes old rows).
  const { error } = await admin.from("push_subscriptions").upsert(
    { user_id: user.id, endpoint, p256dh, auth },
    { onConflict: "endpoint" }
  );
  if (error) {
    console.error("push_subscriptions upsert failed:", error.message);
    return NextResponse.json({ error: "Subscription not stored" }, { status: 500 });
  }

  // ONE ROW PER DEVICE. An APNs token rotates (OS upgrade, restore from
  // backup) and the client then registers the NEW endpoint while the old row
  // stays behind — same phone, two rows, and every notification arrives twice
  // until Apple eventually reports the old token unregistered. The client
  // sends the endpoint it is replacing; deleting it here closes that window.
  // Scoped to this user's own rows, so it can't be used to unsubscribe anyone
  // else's device.
  if (typeof replaces === "string" && replaces && replaces !== endpoint) {
    await admin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", replaces);
  }

  // Learn the device's timezone here, because this is the only moment we are
  // certain we have a real device in front of us. Quiet hours are 10pm-8am
  // LOCAL; without a zone they fall back to UTC, which would silence a
  // Californian's afternoon and buzz them at 3am. Best-effort: a failure to
  // record it must never fail the subscription itself.
  //
  // Through writePushPrefs so it survives a concurrent write to the shared
  // customization column — see lib/push-prefs.ts. (TimezoneSync keeps it right
  // afterwards, on any dashboard load, for people who travel.)
  if (typeof timezone === "string" && timezone && timezone.length < 64) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      await writePushPrefs(user.id, (push) => { push.timezone = timezone; });
    } catch { /* invalid zone, or profile write failed — not fatal */ }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  // NO SESSION REQUIRED. Holding the endpoint is the authorization (below), and
  // requiring a session meant a sign-out whose DELETE failed could never be
  // retried once signed out — the previous account's alerts kept arriving on
  // this device (isolation audit 2026-09-24). Throttled per IP instead.
  if (await isRateLimited(`push-unbind:${clientIp(req)}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { endpoint } = await req.json().catch(() => ({ endpoint: null }));
  if (typeof endpoint !== "string" || !endpoint || endpoint.length > 1000) {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  }

  const admin = getAdminSupabase();
  // Authorized by ENDPOINT POSSESSION, not row ownership. The endpoint is a
  // high-entropy capability that only the device holding it can present, and
  // this is how an account SWITCH severs the PREVIOUS account's binding: the
  // new session presents the device's endpoint but does not own the old row
  // (see lib/push-device.ts) — an .eq("user_id") filter here silently kept the
  // old account's notifications flowing to a device it no longer occupies.
  // Deleting can only ever STOP pushes to the presenting device; it exposes
  // nothing and transfers nothing.
  await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);

  return NextResponse.json({ ok: true });
}
