"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon, type IconName } from "./_ui/icons";

// ── The site admin's navigation ─────────────────────────────────────────────
// A sidebar on a computer, a top bar with a Menu on a phone (owner, 2026-10-27:
// "everything is all over the place" — so every section is one list, grouped,
// in the same place on every page). Referrals and Retention are not sections
// of their own any more: they are tabs inside Company Analytics, and the
// people who closed their accounts are a tab inside Users.
//
// The phone menu is a <details>, so it opens and every link works before the
// page has hydrated, or with no JavaScript at all.

type NavItem = { href: string; label: string; icon: IconName };

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Business",
    items: [
      { href: "/admin", label: "Overview", icon: "overview" },
      { href: "/admin/users", label: "Users", icon: "users" },
      { href: "/admin/analytics", label: "Company Analytics", icon: "analytics" },
      { href: "/admin/website", label: "Website", icon: "website" },
      { href: "/admin/referrals", label: "Referrals", icon: "gift" },
      { href: "/admin/retention", label: "Retention", icon: "heart" },
    ],
  },
  {
    title: "Tools",
    items: [
      { href: "/admin/marketing", label: "Marketing", icon: "marketing" },
      { href: "/admin/crew", label: "Agents", icon: "agents" },
      { href: "/admin/plans", label: "Sandbox", icon: "sandbox" },
    ],
  },
];

const isActive = (href: string, pathname: string) =>
  href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-6">
      {NAV_GROUPS.map((g) => (
        <div key={g.title}>
          <p className="adm-nav-group px-3 mb-1.5">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => (
              <li key={it.href}>
                <Link href={it.href} onClick={onNavigate} className="adm-nav-item" aria-current={isActive(it.href, pathname) ? "page" : undefined}>
                  <Icon name={it.icon} />
                  {it.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function AdminNav({ email }: { email: string }) {
  const pathname = usePathname() ?? "/admin";
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => { if (menu.current) menu.current.open = false; };
  // A navigation closes the phone menu (the <details> stays open otherwise).
  useEffect(() => { if (menu.current) menu.current.open = false; }, [pathname]);

  const current = NAV_GROUPS.flatMap((g) => g.items).find((it) => isActive(it.href, pathname))?.label ?? "Site admin";

  return (
    <>
      {/* Computer: the sidebar. The white column runs the page's full height;
          the list inside it stays put while the page scrolls. */}
      <div className="adm-sidebar hidden lg:block shrink-0">
      <aside className="flex flex-col sticky top-0 h-screen px-3 py-5 overflow-y-auto">
        <Link href="/admin" className="flex items-center gap-2 px-3 mb-7 min-h-[36px]">
          <span className="sc-t-headline">SwiftCard</span>
          <span className="sc-badge sc-badge-tint">Site admin</span>
        </Link>
        <nav aria-label="Site admin" className="flex-1">
          <NavList pathname={pathname} />
        </nav>
        <div className="adm-rule pt-4 mt-6 px-3 space-y-2">
          {email && <p className="sc-t-caption adm-muted truncate" title={email}>Signed in as {email}</p>}
          <Link href="/dashboard" className="adm-link sc-t-subhead inline-flex items-center gap-1.5 min-h-[36px]">
            <Icon name="back" className="w-4 h-4" />
            My dashboard
          </Link>
        </div>
      </aside>
      </div>

      {/* Phone and tablet: a top bar with the same list behind Menu.
          sc-office-header keeps it below the status bar in the iOS shell
          (globals.css) — the same fix the Office console's header uses. */}
      <header className="adm-topbar sc-office-header sc-glass sticky top-0 z-40 lg:hidden">
        <div className="relative flex items-center justify-between gap-2 h-14 px-2">
          <details ref={menu} className="adm-menu">
            <summary className="sc-btn sc-btn-plain sc-btn-sm cursor-pointer" aria-label="Open the site admin menu">
              <Icon name="menu" />
              <span>Menu</span>
            </summary>
            <div className="adm-menu-panel absolute left-2 right-2 top-full mt-2 p-3 max-h-[75vh] overflow-y-auto z-50">
              <NavList pathname={pathname} onNavigate={close} />
              <div className="adm-rule mt-4 pt-3 px-3">
                {email && <p className="sc-t-caption adm-muted truncate">Signed in as {email}</p>}
              </div>
            </div>
          </details>
          <p className="sc-t-headline truncate absolute left-1/2 -translate-x-1/2 max-w-[45%] text-center pointer-events-none">{current}</p>
          <Link href="/dashboard" className="sc-btn sc-btn-plain sc-btn-sm">
            Dashboard
          </Link>
        </div>
      </header>
    </>
  );
}
