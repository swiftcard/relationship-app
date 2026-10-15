import { redirect } from "next/navigation";
import Link from "next/link";
import { adminAccess } from "@/lib/admin";
import AdminNav from "./AdminNav";
import AdminTwoStep from "./AdminTwoStep";

// Every /admin page inherits this shell: server-side admin gate + one
// consistent nav so each section is a proper page (no more crammed tabs).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await adminAccess();
  if (access.state === "signed_out") redirect("/login");
  if (access.state === "not_admin") redirect("/dashboard");
  // Signed in with the password only: the second step comes first, and no
  // admin page renders until it's done (audit SEC-06, lib/admin).
  if (access.state === "needs_second_step") {
    return (
      <div className="sc-app min-h-screen bg-gray-950 text-white flex items-center justify-center px-5 py-10">
        <AdminTwoStep email={access.email} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Top accent stripe */}
      <div className="sc-top-stripe fixed top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-600 via-violet-500 to-blue-400 z-50" />

      <header className="sticky top-0 z-40 bg-gray-950/90 backdrop-blur border-b border-gray-800/80">
        <div className="max-w-6xl mx-auto px-5">
          <div className="flex items-center justify-between h-12">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/admin" className="flex items-center gap-2 shrink-0">
                <span className="text-[0.625rem] font-bold tracking-[0.25em] text-slate-500 uppercase">SwiftCard</span>
                <span className="text-xs font-bold text-white bg-blue-600/20 border border-blue-500/30 text-blue-300 px-2 py-0.5 rounded-full">Admin</span>
              </Link>
            </div>
            <Link href="/dashboard" className="text-xs text-gray-500 hover:text-white transition-colors shrink-0">
              ← My dashboard
            </Link>
          </div>
          <AdminNav />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 pt-6 pb-16">{children}</main>
    </div>
  );
}
