import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { rememberOwnerNetwork } from "@/lib/prospect-preview/outbox";
import { requireAdmin } from "@/lib/admin";
import { liveAlerts } from "@/lib/prospect-preview/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/card-builder/alerts: prospects looking at their preview
// right now (a real view that rang in the last 15 minutes, not yet marked
// "called"). Polled by the banner across the admin (app/admin/
// ProspectAlertBanner) while its tab is visible.
//
// It also remembers the network this admin device is on (as a hash), so the
// owner opening a preview link from any device on that connection, signed in
// or not, never counts as the prospect looking (lib/prospect-preview/outbox.ts).
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await rememberOwnerNetwork(clientIp(req), "admin").catch(() => {});
  const alerts = await liveAlerts().catch(() => []);
  return NextResponse.json({ alerts }, { headers: { "Cache-Control": "no-store" } });
}
