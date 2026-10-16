"use client";

import Link from "next/link";

// The way to the blurred part of a notification — on the WEBSITE only.
//
// Owner, 2026-09-22: make a Free account's notifications something people want
// to upgrade for. A row only reaches the browser with a place or a name blocked
// out ("█") when the account is Free (lib/notification-privacy redactForPlan),
// so the block itself is the signal — no plan prop to forget to pass.
//
// In the iPhone app too (owner, 2026-10-07): /upgrade there is Apple's
// in-app purchase. It was hidden in the app back when the app had no purchase
// path, which left a blurred name with no way to see it. NotificationBody
// stays a plain smudge with no pitch (owner, 2026-09-11); this is its own
// line, and it names no plan and no price.
export default function SeeWhoLink({ text }: { text: string }) {
  if (!text.includes("█")) return null;
  return (
    <Link
      href="/upgrade?from=notification"
      onClick={(e) => e.stopPropagation()}
      className="inline-block mt-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
    >
      See who and where →
    </Link>
  );
}
