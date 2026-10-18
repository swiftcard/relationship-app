"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DateRangePreset } from "@/lib/office-analytics-dates";

const OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

export default function AnalyticsDateRangePicker({ current }: { current: DateRangePreset }) {
  const pathname = usePathname();
  // Same segmented control as the dashboard's Traffic range (Today / Week / …).
  return (
    <div className="sc-segmented flex items-center rounded-lg p-0.5" role="group" aria-label="Date range">
      {OPTIONS.map((o) => (
        <Link
          key={o.value}
          href={`${pathname}?range=${o.value}`}
          aria-current={current === o.value ? "true" : undefined}
          className={`px-3 py-1 text-xs font-semibold rounded-md whitespace-nowrap transition-colors ${
            current === o.value ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-300"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
