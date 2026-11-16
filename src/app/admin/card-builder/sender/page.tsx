import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { listOutbox, macStatus, senderSettings } from "@/lib/prospect-preview/outbox";
import SenderView from "./SenderView";

export const metadata = { title: "iMessage sender — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Card Builder: the Mac's iMessage sender ─────────────────────────────────
// Its rules (hours, days, daily cap, the gap between texts), whether the Mac is
// on, and every opener queued or sent. The markup lives in SenderView.tsx.

export default async function SenderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const [settings, mac, outbox] = await Promise.all([senderSettings(), macStatus().catch(() => ({ at: null, note: null, next_send_at: null })), listOutbox().catch(() => [])]);
  return <SenderView settings={settings} mac={mac} outbox={outbox} now={new Date().getTime()} done={sp.done ?? null} />;
}
