import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { connectorStatus } from "@/lib/agent-execute";
import { loadConnections, summarizeConnections } from "@/lib/agent-connections";
import agentConfig from "../../../../../marketing-agents/config.json";

// Every agent in config.json gets a settings row, even when the seed in
// supabase/agent-flow.sql was run before that agent existed — otherwise the
// agent is simply invisible on the tab (no row → no card, no toggle, no cap),
// which is how the 2026-09-08 expansion shipped 11 agents nobody could see
// or control. New rows start rested (paused), like every worker after Start.
async function seedMissingSettings(admin: ReturnType<typeof getAdminSupabase>, have: Set<string>) {
  const agents = agentConfig.agents as Record<string, { output_cap?: number; default_schedule?: string | null }>;
  const missing = Object.keys(agents).filter((id) => !have.has(id));
  if (!missing.length) return false;
  const rows = missing.map((id) => ({ agent_id: id, enabled: true, paused: true, output_cap: agents[id].output_cap ?? 6, schedule: agents[id].default_schedule ?? null }));
  const { error } = await admin.from("agent_settings").upsert(rows, { onConflict: "agent_id", ignoreDuplicates: true });
  return !error;
}

// Agent Flow: status board payload. Degrades to {ready:false} until the owner
// has run supabase/agent-flow.sql (same pattern as the referrals dashboard).
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const admin = getAdminSupabase();
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const [settings, system, runs, pending, monthRuns, playbooks] = await Promise.all([
      admin.from("agent_settings").select("*").order("agent_id"),
      admin.from("agent_system").select("*").limit(1).single(),
      admin.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(60),
      admin.from("agent_queue_items").select("agent_id, item_type").eq("status", "pending"),
      admin.from("agent_runs").select("agent_id, usage_usd, usage_tokens").gte("started_at", monthStart.toISOString()),
      // The brain's playbooks (supabase/agent-brain.sql). Missing table = no
      // playbooks yet, never a broken board.
      admin.from("agent_playbooks").select("agent_id, cadence, summary, best_practices, pitfalls, channels, researched_at").then((r) => r.data ?? [], () => []),
    ]);
    if (settings.error || system.error) {
      return NextResponse.json({ ready: false, message: "Run supabase/agent-flow.sql in the Supabase SQL editor to enable Agent Flow." });
    }
    if (await seedMissingSettings(admin, new Set((settings.data ?? []).map((r) => r.agent_id)))) {
      const again = await admin.from("agent_settings").select("*").order("agent_id");
      if (!again.error && again.data) settings.data = again.data;
    }
    const latest: Record<string, unknown> = {};
    for (const r of runs.data ?? []) if (!latest[r.agent_id]) latest[r.agent_id] = r;
    const pendingBy: Record<string, number> = {};
    for (const q of pending.data ?? []) pendingBy[q.agent_id] = (pendingBy[q.agent_id] ?? 0) + 1;
    const spendBy: Record<string, number> = {};
    const connections = await loadConnections();
    const tokensBy: Record<string, number> = {};
    for (const r of monthRuns.data ?? []) {
      spendBy[r.agent_id] = (spendBy[r.agent_id] ?? 0) + Number(r.usage_usd);
      tokensBy[r.agent_id] = (tokensBy[r.agent_id] ?? 0) + Number(r.usage_tokens ?? 0);
    }
    return NextResponse.json({
      ready: true,
      settings: settings.data, system: system.data,
      latestRuns: latest, recentRuns: runs.data,
      pendingBy, pendingTotal: (pending.data ?? []).length, spendBy, tokensBy,
      dispatchConfigured: !!process.env.GITHUB_AGENTS_TOKEN,
      connectors: connectorStatus(connections),
      connections: summarizeConnections(connections),
      playbooks,
      brainReady: !(settings.data ?? []).length || (settings.data ?? []).some((r) => "schedule_source" in r),
    });
  } catch {
    return NextResponse.json({ ready: false, message: "Run supabase/agent-flow.sql in the Supabase SQL editor to enable Agent Flow." });
  }
}
