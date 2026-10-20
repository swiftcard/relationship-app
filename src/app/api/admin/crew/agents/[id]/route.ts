import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { backToTab, field } from "@/lib/crew/admin-form";
import { missingEnv } from "@/lib/crew/env";
import { liveProviders } from "@/lib/crew/providers";
import { agentById } from "@/lib/crew/registry";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import { LEASE_MS, runAgent } from "@/lib/crew/tick";
import type { Tier } from "@/lib/crew/types";

// Switch one agent on or off, run it now, change its daily $ or its model.
export const maxDuration = 300;

const TIERS: Tier[] = ["haiku", "sonnet", "opus", "fable"];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const def = agentById(id);
  const form = await req.formData();
  const tab = field(form, "tab") || "teams";
  if (!def) return backToTab(req, tab, "No such agent.");
  const store = new SupabaseStore();
  const action = field(form, "action");

  if (action === "enable") {
    if (def.locked) return backToTab(req, tab, `${def.name} can't be switched on: ${def.locked}`);
    const missing = missingEnv(def.needs);
    if (missing.length) return backToTab(req, tab, `${def.name} needs ${missing.join(", ")} first.`);
    await store.patchAgentState(id, { enabled: true, status_note: null });
    return backToTab(req, tab, `${def.name} is on.`);
  }
  if (action === "disable") {
    await store.patchAgentState(id, { enabled: false });
    return backToTab(req, tab, `${def.name} is off.`);
  }
  if (action === "cap") {
    const v = field(form, "usd");
    const n = v === "" ? null : Number(v);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) return backToTab(req, tab, "That limit doesn't look right.");
    await store.patchAgentState(id, { daily_usd_cap: n === null ? null : Math.round(n * 100) / 100 });
    return backToTab(req, tab, `${def.name}'s daily limit saved.`);
  }
  if (action === "model") {
    const v = field(form, "tier") as Tier | "";
    await store.patchAgentState(id, { model_override: TIERS.includes(v as Tier) ? (v as Tier) : null });
    return backToTab(req, tab, `${def.name}'s model saved.`);
  }
  if (action === "run") {
    const st = await store.getAgentState(id);
    if (!st.enabled) return backToTab(req, tab, `Switch ${def.name} on first.`);
    if (!(await store.claimLease(id, new Date(Date.now() + LEASE_MS), new Date()))) return backToTab(req, tab, `${def.name} is already running.`);
    const r = await runAgent({ def, store, providers: liveProviders() });
    return backToTab(req, tab, `${def.name}: ${r.summary}`);
  }
  return backToTab(req, tab, "Unknown button.");
}
