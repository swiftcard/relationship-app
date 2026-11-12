import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { UUID_RE } from "@/lib/prospect-preview/input";
import { getPreviewById } from "@/lib/prospect-preview/store";
import EditView from "./EditView";

export const metadata = { title: "Edit preview — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Card Builder: edit one preview ──────────────────────────────────────────
// Where a new preview lands (as a draft) and where it is published. The
// markup lives in EditView.tsx.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export default async function EditPreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  if (!(await requireAdmin())) notFound();
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const p = await getPreviewById(id);
  if (!p) notFound();
  return <EditView p={p} appUrl={APP_URL} now={new Date().getTime()} done={sp.done ?? null} error={sp.error ?? null} />;
}
