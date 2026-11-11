import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { liveAlerts } from "@/lib/prospect-preview/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/card-builder/alerts: prospects looking at their preview
// right now (a real view that rang in the last 15 minutes, not yet marked
// "called"). Polled by the banner across the admin (app/admin/
// ProspectAlertBanner) while its tab is visible.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const alerts = await liveAlerts().catch(() => []);
  return NextResponse.json({ alerts }, { headers: { "Cache-Control": "no-store" } });
}
