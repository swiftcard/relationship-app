import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { listPreviews } from "@/lib/prospect-preview/store";
import CardBuilderView from "./CardBuilderView";

export const metadata = { title: "Card Builder — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Card Builder: preview cards for sales prospects ─────────────────────────
// Build a preview of a prospect's card (and their team's), send them the
// unlisted link, and see who has really looked. The moment they do, every
// admin is alerted to call (lib/prospect-preview/alert.ts). The markup lives
// in CardBuilderView.tsx.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export default async function CardBuilderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const list = await listPreviews();
  const now = new Date();
  return (
    <CardBuilderView
      list={list}
      appUrl={APP_URL}
      now={now.getTime()}
      made={sp.made ?? null}
      error={sp.error ?? null}
      done={sp.done ?? null}
      calendarSet={/^https:\/\/\S+$/.test((process.env.PROSPECT_CALENDAR_URL ?? "").trim())}
    />
  );
}
