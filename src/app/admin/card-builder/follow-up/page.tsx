import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { listPreviews, senderName } from "@/lib/prospect-preview/store";
import FollowUpView from "./FollowUpView";

export const metadata = { title: "Call and follow up — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Card Builder: Call and follow up ────────────────────────────────────────
// Where the morning push lands. The markup lives in FollowUpView.tsx.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export default async function FollowUpPage() {
  // The admin layout is NOT a security boundary; every data page checks.
  const admin = await requireAdmin();
  if (!admin) notFound();
  const [list, sender] = await Promise.all([listPreviews(), senderName(admin.id)]);
  return <FollowUpView list={list} appUrl={APP_URL} now={new Date().getTime()} sender={sender} />;
}
