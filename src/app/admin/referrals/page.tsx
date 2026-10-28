import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";

// Referrals is a tab of Company Analytics now (owner, 2026-10-27). This
// address stays so old links and bookmarks still land there.
export const dynamic = "force-dynamic";

export default async function AdminReferralsPage() {
  if (!(await requireAdmin())) notFound();
  redirect("/admin/analytics?tab=referrals");
}
