import ForceLightTheme from "@/components/ForceLightTheme";
import AdminNav from "./AdminNav";

// ── The site admin's frame: sidebar (or phone top bar) + the page ───────────
// Split from layout.tsx (which only gates) so tests/render can measure the
// real shell with fixture pages inside it.
//
// LIGHT, always (owner, 2026-10-27: "I don't like how it's dark. I want it to
// be light."). `sc-app` puts the console inside the app's theme system — the
// same move the Office console made — and ForceLightTheme holds
// data-sc-theme="light" while it's open, even on a device that saved dark
// mode. The boot script in app/layout.tsx does the same before first paint
// for a direct load, so it never flashes dark. Pages that were written dark
// (Marketing, Agents) are painted light by globals.css's remap layer without
// their files changing.
export default function AdminShell({ email, unread = null, children }: { email: string; unread?: number | null; children: React.ReactNode }) {
  return (
    <div className="sc-app sc-admin min-h-screen lg:flex">
      <ForceLightTheme />
      <AdminNav email={email} unread={unread} />
      <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 pt-5 sm:pt-6 lg:pt-8 pb-16">
        <div className="mx-auto w-full max-w-[1200px]">{children}</div>
      </main>
    </div>
  );
}
