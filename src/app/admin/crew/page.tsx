import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { loadDashboard } from "@/lib/crew/dashboard";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import CrewView from "./CrewView";

export const metadata = { title: "Agents — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── The Agents tab (Crew) ───────────────────────────────────────────────────
// Drafts from the AI teams wait here for a person's tap. Plan:
// docs/plans/agent-system.md. The markup lives in CrewView.tsx.

export default async function CrewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const data = await loadDashboard(new SupabaseStore());
  return <CrewView data={data} tab={sp.tab} msg={sp.msg} />;
}
