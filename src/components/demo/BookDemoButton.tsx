"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

// ── "Book a demo" on the pricing page's Office card ─────────────────────────
// Owner, 2026-11-03: a button on the Office plan only, on the website's
// pricing page only. It sits under "Get Office" as the second choice: the same
// pill and height, white with a blue outline, so it never competes with buying.
//
// It is a real link to /demo, so before the page has hydrated (or with no
// JavaScript) a tap still books a demo, on the page. Once hydrated, a plain
// click opens the popup instead; a cmd/ctrl-click still opens /demo in a tab.
//
// Never rendered inside the iPhone or Android app: /pricing itself is blocked
// there (src/proxy.ts and the page's own guard), and this lives only in
// src/app/pricing/page.tsx, never in the shared PlanTierCards.

const DemoBookingDialog = dynamic(() => import("./DemoBookingDialog"), { ssr: false });
const preload = () => { void import("./DemoBookingDialog"); };

/** Matches OFFICE_CTA_CLASS's pill and height exactly (the 1px border is
 *  taken out of the vertical padding). */
export const OFFICE_DEMO_CTA_CLASS =
  "mt-2.5 flex w-full items-center justify-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-[13px] text-sm font-bold leading-tight text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20";

export default function BookDemoButton({ seats }: { seats?: number | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Link
        href="/demo"
        prefetch={false}
        className={OFFICE_DEMO_CTA_CLASS}
        aria-haspopup="dialog"
        onPointerEnter={preload}
        onFocus={preload}
        onClick={(e) => {
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Book a demo
      </Link>
      {open && <DemoBookingDialog seats={seats} onClose={() => setOpen(false)} />}
    </>
  );
}
