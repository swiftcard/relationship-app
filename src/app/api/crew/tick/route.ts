import { NextResponse, type NextRequest } from "next/server";
import { tickAuthorized } from "@/lib/crew/auth";
import { liveProviders } from "@/lib/crew/providers";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import { runTick } from "@/lib/crew/tick";

// ── The Crew clock ──────────────────────────────────────────────────────────
// Called every 15 minutes by .github/workflows/crew-tick.yml with
// Bearer CREW_TICK_SECRET. A 404 until that secret exists. The tick itself
// stops after ~240s so it always finishes inside maxDuration.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!process.env.CREW_TICK_SECRET) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!tickAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const report = await runTick({ store: new SupabaseStore(), providers: liveProviders() });
  return NextResponse.json({ ok: true, at: new Date().toISOString(), ...report });
}
