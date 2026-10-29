import { redirect } from "next/navigation";
import { adminAccess } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import AdminShell from "./AdminShell";
import "./admin.css";

// Every /admin page inherits this: the server-side admin gate, then one shell
// (AdminShell: the light theme, the sidebar on a computer, the Menu on a
// phone), so every section sits in the same frame in the same place.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await adminAccess();
  if (access.state === "signed_out") redirect("/login");
  if (access.state === "not_admin") redirect("/dashboard");

  return <AdminShell email={access.user.email ?? ""} unread={await unreadNotifications()}>{children}</AdminShell>;
}

/** The bell's number. Null when it can't be read, so the bell shows no count
 *  rather than a wrong one. */
async function unreadNotifications(): Promise<number | null> {
  try {
    const { count, error } = await getAdminSupabase().from("admin_notifications").select("id", { count: "exact", head: true }).is("read_at", null);
    return error ? null : count ?? 0;
  } catch {
    return null;
  }
}
