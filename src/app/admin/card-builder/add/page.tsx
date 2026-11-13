import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { listQueue } from "@/lib/prospect-preview/desk";
import AddView from "./AddView";

export const metadata = { title: "Add — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Card Builder: Add ───────────────────────────────────────────────────────
// The queue of prospects waiting for the next /build run, and the box that
// adds to it. The markup lives in AddView.tsx.

export default async function AddPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const queue = await listQueue();
  return <AddView queue={queue} now={new Date().getTime()} done={sp.done ?? null} error={sp.error ?? null} n={sp.n ?? null} />;
}
