import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { backToTab, field } from "@/lib/crew/admin-form";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import { TEAMS } from "@/lib/crew/registry";
import type { Settings } from "@/lib/crew/types";

// The big red switch, the daily $ limits and the disclosure line.
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const form = await req.formData();
  const store = new SupabaseStore();
  const action = field(form, "action");
  if (action === "kill") {
    await store.updateSettings({ kill_all: true });
    return backToTab(req, field(form, "tab") || "teams", "Every agent is stopped.");
  }
  if (action === "unkill") {
    await store.updateSettings({ kill_all: false });
    return backToTab(req, field(form, "tab") || "teams", "Agents can run again.");
  }
  const patch: Partial<Settings> = {};
  const cap = Number(field(form, "daily_usd_cap"));
  if (Number.isFinite(cap) && cap >= 0 && cap <= 500) patch.daily_usd_cap = Math.round(cap * 100) / 100;
  patch.disclosure_on = field(form, "disclosure_on") === "on";
  patch.economy = field(form, "economy") === "on";
  patch.second_opinion = field(form, "second_opinion") === "on";
  const disclosure = field(form, "disclosure");
  if (disclosure) patch.disclosure = disclosure.slice(0, 200);
  const caps: Settings["team_caps"] = {};
  for (const t of TEAMS) {
    const v = field(form, `team_cap_${t}`);
    if (v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0) caps[t] = { usd: Math.round(Number(v) * 100) / 100 };
  }
  patch.team_caps = caps;
  await store.updateSettings(patch);
  return backToTab(req, "settings", "Settings saved.");
}
