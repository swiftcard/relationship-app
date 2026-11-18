import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { googleVoiceSent } from "@/lib/prospect-preview/google-voice";
import { sendContext } from "@/lib/prospect-preview/outbox";
import { approvalQueue } from "@/lib/prospect-preview/pipeline";
import { listPreviews } from "@/lib/prospect-preview/store";
import GoogleVoiceView from "./GoogleVoiceView";

export const metadata = { title: "Send from Google Voice — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Card Builder: Send from Google Voice ────────────────────────────────────
// The approved prospects whose opener goes from the owner's Google Voice
// number, one tap each, today's count against the cap, and "They said stop"
// for what already went. The markup lives in GoogleVoiceView.tsx.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export default async function GoogleVoicePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const list = await listPreviews();
  const now = new Date();
  const rows = list.ready ? list.rows : [];
  const showing = [...approvalQueue(rows, now.getTime()).send, ...googleVoiceSent(rows, now.getTime())];
  const ctx = await sendContext(showing, rows, now);
  return <GoogleVoiceView list={list} appUrl={APP_URL} now={now.getTime()} done={sp.done ?? null} error={sp.error ?? null} ctx={ctx} />;
}
