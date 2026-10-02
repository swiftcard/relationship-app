import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { CAMPAIGN_PLATFORMS } from "@/lib/referral";
import { campaignLink } from "@/lib/campaign-links";
import { campaignSourceLabel } from "@/lib/source-labels";

// ── Agent Flow → Settings → Tracked links ────────────────────────────────────
// One short link per place a link lives (a bio, a message, an ad), every
// platform. The code inside the link is also the signup source, so this is the
// one table that says what each platform actually produced: taps → signups →
// Pro trials. Read-only.

export const runtime = "nodejs";

const DAY = 86400e3;
type Prefix = keyof typeof CAMPAIGN_PLATFORMS;
const PREFIXES = Object.keys(CAMPAIGN_PLATFORMS) as Prefix[];
const prefixOf = (code: string): Prefix | null => PREFIXES.find((p) => code.startsWith(`${p}_`)) ?? null;

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = getAdminSupabase();
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const [clicks, signups] = await Promise.all([
    db.from("product_events").select("props").eq("name", "campaign_link_clicked").eq("is_internal", false).gte("created_at", since).limit(10000),
    db.from("profiles").select("signup_source, pro_trial_started_at, email").gte("created_at", since).not("signup_source", "is", null).limit(10000),
  ]);

  type Row = { code: string; label: string; taps: number; signups: number; trials: number };
  const rows = new Map<string, Row>();
  const row = (code: string) => {
    if (!rows.has(code)) rows.set(code, { code, label: campaignSourceLabel(code) ?? code, taps: 0, signups: 0, trials: 0 });
    return rows.get(code)!;
  };
  for (const r of clicks.data ?? []) {
    const code = String((r.props as { code?: unknown } | null)?.code ?? "");
    if (prefixOf(code)) row(code).taps++;
  }
  for (const r of signups.data ?? []) {
    const code = String(r.signup_source ?? "");
    // The QA harness's throwaway accounts are not signups.
    if (!prefixOf(code) || String(r.email ?? "").endsWith("swiftcard-test.invalid")) continue;
    row(code).signups++;
    if (r.pro_trial_started_at) row(code).trials++;
  }

  const platforms = PREFIXES.map((p) => {
    const mine = [...rows.values()].filter((r) => prefixOf(r.code) === p);
    return {
      prefix: p,
      name: CAMPAIGN_PLATFORMS[p],
      bio_link: campaignLink(`${p}_bio`),
      taps: mine.reduce((a, r) => a + r.taps, 0),
      signups: mine.reduce((a, r) => a + r.signups, 0),
      trials: mine.reduce((a, r) => a + r.trials, 0),
    };
  });
  return NextResponse.json({
    platforms,
    links: [...rows.values()].sort((a, b) => b.signups - a.signups || b.taps - a.taps).slice(0, 40),
  });
}
