"use client";

// Replay control for the guided tour. Lives in Settings under the help /
// AI-assistant section. Restarts the walkthrough from step one (navigating to
// the dashboard first, since that's where the tour begins).

import { startTour } from "@/lib/tour";

export default function TakeTourButton() {
  return (
    <button
      type="button"
      onClick={startTour}
      className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-white bg-gray-800 hover:bg-gray-700 border border-transparent rounded-full py-3 transition-colors"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m0 0a6 6 0 016 6c0 2-1 3-2 4s-1.5 2-1.5 3h-5c0-1-.5-2-1.5-3s-2-2-2-4a6 6 0 016-6z" />
      </svg>
      Take a Tour
    </button>
  );
}
