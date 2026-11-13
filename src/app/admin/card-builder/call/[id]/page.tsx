import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { callBrief } from "@/lib/prospect-preview/call";
import { UUID_RE } from "@/lib/prospect-preview/input";
import { resolveOutreach } from "@/lib/prospect-preview/outreach";
import { getPreviewById, senderName } from "@/lib/prospect-preview/store";
import CallView from "./CallView";

export const metadata = { title: "Call — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── The Call screen ─────────────────────────────────────────────────────────
// Where the "[Owner] is viewing their card" alert lands. Loads the preview and
// writes the brief; the markup lives in CallView.tsx.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export default async function CallScreen({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin();
  if (!admin) notFound();
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const p = await getPreviewById(id);
  if (!p) notFound();
  const sender = await senderName(admin.id);
  const brief = callBrief(p, { sender });
  const voicemail = resolveOutreach(p, { link: `${APP_URL}/p/${p.slug}`, sender }).voicemail;
  return <CallView p={p} brief={brief} voicemail={voicemail} appUrl={APP_URL} now={new Date().getTime()} done={sp.done ?? null} />;
}
