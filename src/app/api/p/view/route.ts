import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { clientIp } from "@/lib/client-ip";
import { isRateLimited } from "@/lib/rate-limit";
import { resolveGeo } from "@/lib/request-geo";
import { describeDevice } from "@/lib/visit-device";
import { attachVisitIdentity, resolveVisitIdentity } from "@/lib/visit-identity";
import { alertAdminsOfView } from "@/lib/prospect-preview/alert";
import { SLUG_RE } from "@/lib/prospect-preview/input";
import { decideRealView, deviceTypeOf, shouldAlert } from "@/lib/prospect-preview/real-view";
import { alertsInLastDay, getPreviewBySlug, markAlerted, markTeamStripScrolled, recordView } from "@/lib/prospect-preview/store";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/p/view  { slug, event: "view" | "team_strip", visitor_id, touch }
//
// The preview page's beacon (app/p/[slug]/PreviewBeacon). It is only sent once
// the browser has seen a person (3s visible, or a scroll / tap / key), and
// this is where the server's own refusals happen: bots and link-preview
// fetchers, speculative loads, staff devices, datacenters, a preview that is
// gone or expired. The decision is one pure function
// (lib/prospect-preview/real-view.ts decideRealView).
//
// Public and unauthenticated, so it tells the caller nothing: every outcome
// is `200 { ok: true }`. And it is its OWN endpoint with its OWN table: the
// customers' card-view route (/api/card-events → lib/record-view.ts) is the
// only writer of card_views and must stay that way.

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  const done = () => NextResponse.json({ ok: true });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const slug = str(body?.slug, 64).toLowerCase();
  const event = body?.event === "team_strip" ? "team_strip" : "view";
  if (!SLUG_RE.test(slug)) return done();

  const ip = clientIp(req);
  if (await isRateLimited(`p-view:${ip}:${slug}`, 30, 10 * 60 * 1000)) return done();

  const ua = req.headers.get("user-agent");
  const preview = await getPreviewBySlug(slug);
  const geo = preview ? await resolveGeo(req, ip).catch(() => null) : null;
  const verdict = decideRealView({
    userAgent: ua,
    purposeHeader: req.headers.get("sec-purpose") ?? req.headers.get("purpose") ?? req.headers.get("x-purpose"),
    internalCookie: req.cookies.get("sc_internal")?.value === "1",
    adminSession: !!(await requireAdmin().catch(() => null)),
    isHosting: geo?.isHosting === true,
    preview,
  });
  if (verdict !== "record" || !preview) return done();

  const identity = resolveVisitIdentity(req, str(body?.visitor_id, 64) || null);
  const res = attachVisitIdentity(done(), identity);

  if (event === "team_strip") {
    await markTeamStripScrolled(preview.id, identity.visitorId);
    return res;
  }

  const touchMac = body?.touch === true;
  const view = await recordView({
    previewId: preview.id,
    deviceId: identity.visitorId,
    deviceType: deviceTypeOf(ua, touchMac),
    deviceLabel: describeDevice(ua, touchMac ? { model: "iPad" } : {})?.label ?? null,
  });
  if (!view || view.repeat) return res;

  if (shouldAlert({ firstFromDevice: view.firstFromDevice, alertsToday: await alertsInLastDay(preview.id) })) {
    // Marked before sending, so a slow push can never ring twice for one view.
    await markAlerted(view.viewId);
    await alertAdminsOfView({ viewId: view.viewId, preview }).catch(() => {});
  }
  return res;
}
