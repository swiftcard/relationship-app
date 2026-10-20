import { NextResponse, type NextRequest } from "next/server";
import { tickAuthorized } from "@/lib/crew/auth";
import { SupabaseStore } from "@/lib/crew/store-supabase";

// ── Results from the monitors that already run in GitHub Actions ────────────
// uptime.yml posts health.json, nightly-qa.yml posts nightly/summary.json.
// Stored as-is (size-capped); the Watchdog agents read them on their next run.
// crew-fix.yml posts back the pull request it opened for an approved card.
export const dynamic = "force-dynamic";

const SOURCES = new Set(["health", "nightly", "fix", "social"]);
const MAX_BYTES = 400_000;

/** crew-render.yml reads the spec of the social post it is drawing. */
export async function GET(req: NextRequest) {
  if (!process.env.CREW_TICK_SECRET) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!tickAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("social_spec") ?? "";
  if (!/^[0-9a-z-]{8,40}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const spec = await new SupabaseStore().kvGet(`social:spec:${id}`);
  return spec ? NextResponse.json(spec) : NextResponse.json({ error: "no such spec" }, { status: 404 });
}

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
  if (source === "social") {
    // crew-render.yml: the pictures it drew for a social post, stored in our
    // own Supabase storage bucket (crew-media). Only those URLs are accepted.
    const f = json as { spec_id?: string; step?: string; files?: { key?: string; url?: string }[] };
    const base = `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1/object/public/crew-media/social/`;
    if (!f.spec_id || !/^[0-9a-z-]{8,40}$/.test(f.spec_id) || (f.step !== "options" && f.step !== "final")) return NextResponse.json({ error: "bad spec" }, { status: 400 });
    const files = (f.files ?? [])
      .filter((x) => typeof x.key === "string" && /^[a-z0-9-]{1,40}$/.test(x.key) && typeof x.url === "string" && x.url.startsWith(base + f.spec_id + "/"))
      .slice(0, 80)
      .map((x) => ({ key: x.key!, url: x.url! }));
    await store.kvSet(`social:render:${f.spec_id}:${f.step}`, { files, at: new Date().toISOString() });
    return NextResponse.json({ ok: true, files: files.length });
  }
  if (source === "fix") {
    const f = json as { approval_id?: string; pr_url?: string | null; run_url?: string };
    const a = f.approval_id ? await store.getApproval(f.approval_id) : null;
    if (!a || a.kind !== "code_fix") return NextResponse.json({ error: "no such fix" }, { status: 404 });
    const prUrl = typeof f.pr_url === "string" && /^https:\/\/github\.com\/swiftcard\/relationship-app\/pull\/\d+$/.test(f.pr_url) ? f.pr_url : null;
    const runUrl = typeof f.run_url === "string" && f.run_url.startsWith("https://github.com/") ? f.run_url : null;
    await store.updateApproval(a.id, { meta: { ...a.meta, result: { ...((a.meta?.result as object) ?? {}), pr_url: prUrl, run_url: runUrl } } });
    return NextResponse.json({ ok: true });
  }
  await store.kvSet(`ingest:${source}`, { at: new Date().toISOString(), run: req.nextUrl.searchParams.get("run"), data: json });
  return NextResponse.json({ ok: true });
}
