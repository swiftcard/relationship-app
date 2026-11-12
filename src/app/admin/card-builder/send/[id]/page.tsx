import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { UUID_RE } from "@/lib/prospect-preview/input";
import { buildMessages } from "@/lib/prospect-preview/messages";
import { getPreviewById, senderName } from "@/lib/prospect-preview/store";
import SendView from "./SendView";

export const metadata = { title: "Send — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Card Builder: send one preview ──────────────────────────────────────────
// The three messages for one prospect, signed with the signed-in admin's own
// first name. The markup lives in SendView.tsx.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export default async function SendPreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin();
  if (!admin) notFound();
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const p = await getPreviewById(id);
  if (!p) notFound();
  const sender = await senderName(admin.id);
  const messages = buildMessages(p, { link: `${APP_URL}/p/${p.slug}`, sender });
  return <SendView p={p} messages={messages} now={new Date().getTime()} senderKnown={!!sender} done={sp.done ?? null} error={sp.error ?? null} />;
}
