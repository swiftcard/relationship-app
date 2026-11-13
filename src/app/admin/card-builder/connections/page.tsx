import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ownerBackground, uploadMeta } from "@/lib/prospect-preview/desk";
import ConnectionsView from "./ConnectionsView";

export const metadata = { title: "Warm paths — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Card Builder: the owner's LinkedIn connections ──────────────────────────
// Upload and background. The markup lives in ConnectionsView.tsx.

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const [meta, background] = await Promise.all([uploadMeta(), ownerBackground()]);
  return <ConnectionsView meta={meta} background={background} done={sp.done ?? null} error={sp.error ?? null} n={sp.n ?? null} />;
}
