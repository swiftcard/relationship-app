import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { agentsAttention, agentsHealth } from "@/lib/admin-data/agents-health";

export const runtime = "nodejs";

// Are the agents working: Pause all, the Sheet sync, each agent's last run.
// Read-only and admin-gated; the Overview and the notification center read it.
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }
  try {
    const health = await agentsHealth();
    return NextResponse.json({ ...health, attention: agentsAttention(health) });
  } catch (e) {
    console.error("[admin/agents-health] read failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
}
