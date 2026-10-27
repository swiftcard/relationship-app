import { redirect } from "next/navigation";
import { adminAccess } from "@/lib/admin";
import AdminShell from "./AdminShell";
import "./admin.css";

// Every /admin page inherits this: the server-side admin gate, then one shell
// (AdminShell: the light theme, the sidebar on a computer, the Menu on a
// phone), so every section sits in the same frame in the same place.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await adminAccess();
  if (access.state === "signed_out") redirect("/login");
  if (access.state === "not_admin") redirect("/dashboard");

  return <AdminShell email={access.user.email ?? ""}>{children}</AdminShell>;
}
