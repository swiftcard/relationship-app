import { NextResponse, type NextRequest } from "next/server";
import { tickAuthorized } from "@/lib/crew/auth";
import { SupabaseStore } from "@/lib/crew/store-supabase";

// ── Results from the monitors that already run in GitHub Actions ────────────
// uptime.yml posts health.json, nightly-qa.yml posts nightly/summary.json.
// Stored as-is (size-capped); the Watchdog agents read them on their next run.
export const dynamic = "force-dynamic";

const SOURCES = new Set(["health", "nightly"]);
const MAX_BYTES = 400_000;

export async function POST(req: NextRequest) {
  if (!process.env.CREW_TICK_SECRET) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!tickAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const source = req.nextUrl.searchParams.get("source") ?? "";
  if (!SOURCES.has(source)) return NextResponse.json({ error: "unknown source" }, { status: 400 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "not json" }, { status: 400 });
  }
  const store = new SupabaseStore();
  if (!(await store.ready())) return NextResponse.json({ ok: false, skipped: "crew not set up" });
  await store.kvSet(`ingest:${source}`, { at: new Date().toISOString(), run: req.nextUrl.searchParams.get("run"), data: json });
  return NextResponse.json({ ok: true });
}
