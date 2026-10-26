import { NextResponse, type NextRequest } from "next/server";
import { tickAuthorized } from "@/lib/crew/auth";
import { syncSheet } from "@/lib/crew/sheets/sync";
import { SupabaseStore } from "@/lib/crew/store-supabase";

// ── Set up (or re-sync) the workbook on demand ──────────────────────────────
// scripts/crew-sheet-setup.mjs calls this with Bearer CREW_TICK_SECRET. It
// runs exactly one sync: creates the workbook if there is none (in the Shared
// Drive), makes every tab, shares it, and fills it. The same thing the
// sheet-sync agent does every 15 minutes; this just doesn't wait for it.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!process.env.CREW_TICK_SECRET) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!tickAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const report = await syncSheet(new SupabaseStore(), new Date());
  return NextResponse.json({ ok: report.errors.length === 0, at: new Date().toISOString(), ...report });
}
