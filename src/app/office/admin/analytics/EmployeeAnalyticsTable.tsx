"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import DownloadLink from "@/components/DownloadLink";
import type { EmployeeMetrics } from "@/lib/office-analytics";
import { defaultEmployeeSort } from "@/lib/office-analytics-metrics";
import { relativeTime } from "@/lib/relative-time";
import { useDisplayClock } from "@/components/DisplayClock";

type SortKey = keyof Pick<
  EmployeeMetrics,
  "name" | "cardName" | "views" | "uniqueVisitors" | "scans" | "leads" | "contactsSaved" | "swiftlinkViews" | "lastActivityAt"
>;

const COLUMNS: { key: SortKey; label: string; hint: string }[] = [
  { key: "name", label: "Employee", hint: "Team member name" },
  { key: "cardName", label: "Card", hint: "Their card, or how many cards they own" },
  { key: "views", label: "Views", hint: "Times their card was opened — repeat visits count; reloads within a visit don't" },
  { key: "uniqueVisitors", label: "Unique visitors", hint: "Distinct visitors in the selected range" },
  { key: "scans", label: "Scans", hint: "Views attributed to a QR code scan or NFC tap" },
  { key: "leads", label: "Leads", hint: "People who shared their contact info" },
  { key: "contactsSaved", label: "Contact downloads", hint: "Visitors who downloaded this card as a contact. Whether they then tapped Add in their phone's contact sheet is not something any app can see." },
  { key: "swiftlinkViews", label: "SwiftLink views", hint: "Visits to their Swift Links page" },
  { key: "lastActivityAt", label: "Last activity", hint: "Most recent view, lead, or contact save" },
];

// Client-side search + sort over the (already server-authorized, date-ranged)
// employee metrics — modeled on the existing filter pattern in
// office/admin/leads/LeadsTable.tsx, extended with real click-to-sort columns.
export default function EmployeeAnalyticsTable({ employees, range }: { employees: EmployeeMetrics[]; range: string }) {
  const [query, setQuery] = useState("");
  // Hydration-safe "x ago" (components/DisplayClock).
  const clock = useDisplayClock();
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? employees.filter((r) => r.name.toLowerCase().includes(q) || r.cardName.toLowerCase().includes(q)) : employees;

    if (!sortKey) return defaultEmployeeSort(filtered);

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return dir * av.localeCompare(bv);
      return dir * ((av as number) - (bv as number));
    });
  }, [employees, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2.5 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by employee or card name…"
          aria-label="Search employees or cards"
          className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
        />
        <DownloadLink
          href={`/api/office/analytics/export?range=${encodeURIComponent(range)}`}
          title="Downloads the full current date range as CSV (not limited to the search above)"
          className="text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-3.5 py-2.5 rounded-xl transition-colors text-center whitespace-nowrap"
        >
          Export CSV
        </DownloadLink>
      </div>

      {visible.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <p className="text-gray-400 text-sm">Nothing matches that search.</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className="text-left px-4 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      title={c.hint}
                      aria-label={`Sort by ${c.label}`}
                      className="flex items-center gap-1 text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
                    >
                      {c.label}
                      {sortKey === c.key && <span aria-hidden="true">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {visible.map((r) => (
                <tr key={r.userId} className="hover:bg-gray-800/40 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link href={`/office/admin/analytics/${r.userId}`} className="text-white font-medium hover:text-purple-300 transition-colors">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{r.cardName}</td>
                  <td className="px-4 py-3 text-gray-300 tabular-nums">{r.views}</td>
                  <td className="px-4 py-3 text-gray-300 tabular-nums">{r.uniqueVisitors}</td>
                  <td className="px-4 py-3 text-gray-300 tabular-nums">{r.scans}</td>
                  <td className="px-4 py-3 text-gray-300 tabular-nums font-semibold">{r.leads}</td>
                  <td className="px-4 py-3 text-gray-300 tabular-nums">{r.contactsSaved}</td>
                  <td className="px-4 py-3 text-gray-300 tabular-nums">{r.swiftlinkViews}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {r.lastActivityAt ? relativeTime(r.lastActivityAt, clock.now) : "No activity yet"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
