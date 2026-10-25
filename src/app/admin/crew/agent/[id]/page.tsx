import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { loadAgentDetail } from "@/lib/crew/agent-detail";
import { scrub } from "@/lib/crew/agent-status";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import AgentDetail from "../../AgentDetail";

export const metadata = { title: "Agent — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// One agent's page on the Agents tab: its status and buttons, schedule,
// what it did this week, what it made, and the raw records behind a toggle.

export default async function AgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  if (!(await requireAdmin())) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const x = await loadAgentDetail(new SupabaseStore(), id);
  if (!x || !("row" in x)) notFound();
  return <AgentDetail x={x} edit={sp.edit} msg={sp.msg ? scrub(sp.msg) : undefined} tone={sp.tone} />;
}
