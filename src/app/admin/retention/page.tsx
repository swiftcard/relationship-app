import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";

// Retention is a tab of Company Analytics now (owner, 2026-10-27: "Why is
// there one page for referrals and one page for retention? That doesn't make
// sense."). This address stays so old links and bookmarks still land there.
// The people who closed their accounts are under Users › Closed accounts.
export const dynamic = "force-dynamic";

export default async function AdminRetentionPage() {
  // The admin layout is NOT a security boundary: an RSC request can render
  // this segment without its parent layout. Every page that reads data checks.
  if (!(await requireAdmin())) notFound();
  redirect("/admin/analytics?tab=retention");
}
