"use client";

import type { DesignHistory } from "@/lib/use-design-history";

// The Undo button of a design tab (lib/use-design-history). It lives WITH THE
// PREVIEW on every screen — the one thing that stays in view while the controls
// scroll, and where the change being undone is seen going back:
//   • "pill"   — the desktop preview's header, and the phone's Swift Links
//                strip beside its section buttons.
//   • "corner" — the phone's pinned card, top-left, mirroring the full-size
//                cue on the top-right; off the card face so it never covers it.
// Shown only when there is something to undo; the pill keeps its space (so
// nothing shifts when it appears), the corner simply isn't there.

function UndoIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 14L4 9l5-5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9h10.5a5.5 5.5 0 010 11H11" />
    </svg>
  );
}

export default function UndoDesignButton({ history, variant, className = "" }: {
  history: DesignHistory;
  variant: "pill" | "corner";
  className?: string;
}) {
  if (variant === "corner") {
    if (!history.canUndo) return null;
    return (
      <button
        type="button"
        onClick={history.undo}
        aria-label="Undo last design change"
        title="Undo"
        className={`absolute -top-2 -left-2 z-10 w-8 h-8 rounded-full bg-gray-900 text-white ring-2 ring-white/80 flex items-center justify-center shadow before:absolute before:-inset-2 before:content-[''] ${className}`}
      >
        <UndoIcon className="w-4 h-4" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={history.undo}
      disabled={!history.canUndo}
      aria-hidden={!history.canUndo}
      tabIndex={history.canUndo ? 0 : -1}
      title="Undo your last design change"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[0.6875rem] font-semibold border border-transparent bg-gray-800/60 text-gray-200 hover:bg-gray-700 transition-opacity ${history.canUndo ? "opacity-100" : "opacity-0 pointer-events-none"} ${className}`}
    >
      <UndoIcon className="w-3.5 h-3.5" />
      Undo
    </button>
  );
}
