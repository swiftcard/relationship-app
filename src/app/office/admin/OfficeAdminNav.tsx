"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Four tabs, in the order an owner uses them: who's on my team → how their
// cards are being used → who we've met → what do our cards look like
// (plus Billing for whoever pays). The old Overview/Cards/
// Invite tabs are folded in: Team IS the landing page, per-card management
// lives inside each person, and inviting is a button, not a destination.
const LINKS = [
  { href: "/office/admin", label: "Team", tour: "admin-nav-team" },
  { href: "/office/admin/analytics", label: "Analytics", tour: "admin-nav-analytics" },
  // "Contacts", as in the rest of the app: someone saving a lawyer's number
  // is not a sales lead (owner, 2026-10-06). The URL stays /leads so links in
  // old notifications and bookmarks keep working.
  { href: "/office/admin/leads", label: "Contacts", tour: "admin-nav-leads" },
  { href: "/office/admin/branding", label: "Branding", tour: "admin-nav-branding" },
];

export default function OfficeAdminNav({ canBrand = true, canBill = false }: { canBrand?: boolean; canBill?: boolean }) {
  const pathname = usePathname();
  // Branding only for roles that can open it (the page redirects the others),
  // and a Billing tab for whoever pays — seats and invoices live in Settings.
  const links = [
    ...LINKS.filter((l) => canBrand || l.href !== "/office/admin/branding"),
    ...(canBill ? [{ href: "/settings/flows?billing=1#billing", label: "Billing", tour: undefined }] : []),
  ];
  return (
    <nav className="flex gap-1 -mb-px overflow-x-auto rd-scrollbar-none">
      {links.map((l) => {
        // Team owns the root plus the person/card detail subtrees, so drilling
        // into a teammate keeps the Team tab lit.
        const active =
          l.href === "/office/admin"
            ? pathname === "/office/admin" ||
              pathname.startsWith("/office/admin/team") ||
              pathname.startsWith("/office/admin/cards")
            : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            data-tour={l.tour}
            className={`px-3 py-2 text-[0.8125rem] font-medium whitespace-nowrap border-b-2 transition-colors ${
              active
                ? "border-purple-500 text-white"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
