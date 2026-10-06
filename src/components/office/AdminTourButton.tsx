"use client";

// Top-left "Tour" control on the Team page — starts the Office admin guided
// tour (Team → Analytics → Leads → Branding, cut to the viewer's role), independent of the main dashboard tour.

import { startAdminTour } from "@/lib/tour";

export default function AdminTourButton() {
  return (
    <button
      type="button"
      onClick={startAdminTour}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-300 bg-purple-500/10 hover:bg-purple-500/15 border border-purple-500/25 rounded-full px-3 py-1.5 transition-colors shrink-0"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m0 0a6 6 0 016 6c0 2-1 3-2 4s-1.5 2-1.5 3h-5c0-1-.5-2-1.5-3s-2-2-2-4a6 6 0 016-6z" />
      </svg>
      Tour
    </button>
  );
}
