"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/website", label: "Website" },
  { href: "/admin/marketing", label: "Marketing" },
  { href: "/admin/crew", label: "Agents" },
  { href: "/admin/referrals", label: "Referrals" },
  { href: "/admin/retention", label: "Retention" },
  { href: "/admin/plans", label: "Sandbox" },
];

export default function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 -mb-px overflow-x-auto no-scrollbar">
      {LINKS.map((l) => {
        const active = l.href === "/admin" ? pathname === "/admin" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`px-3 py-2 text-[0.8125rem] font-medium whitespace-nowrap border-b-2 transition-colors ${
              active
                ? "border-blue-500 text-white"
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
