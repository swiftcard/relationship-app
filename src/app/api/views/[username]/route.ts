import { NextRequest, NextResponse } from "next/server";
import { logIngest } from "@/lib/ingest-log";

// ── RETIRED: this endpoint no longer writes analytics ────────────────────────
//
// It was the original view recorder. Nothing has called it since the tracker
// moved to /api/card-events (components/CardEventTracker.tsx says so in as many
// words), but it stayed public, and that made it the weakest surface in the
// whole pipeline (owner report, 2026-09-18 — "analytics have to be accurate,
// people could sue us"):
//
//   • It wrote card_views rows, dispatched CRM events and crossed milestones
//     while writing NOTHING to analytics_ingest_log — so anything arriving here
//     was invisible to the only audit trail the product has, and produced a bar
//     on the chart with no matching bell row, breaking the invariant
//     lib/record-view.ts exists to hold.
//   • The human gate that protects the real path (navigator.webdriver, page
//     visibility, a 2.5s dwell) is browser-side and cannot apply to a direct
//     POST. With a per-IP cap of 20 per 10 minutes, a script that varied its
//     User-Agent could push roughly 2,880 fabricated views a day at any public
//     slug, each with a plausible location.
//
// It answers 200 so any page still open from before the tracker changed does
// not see an error, and records the attempt in the ingest log so a caller that
// still uses it is visible rather than silent. Views are recorded in exactly
// one place now: /api/card-events → lib/record-view.ts.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const entityKey = (username ?? "").toLowerCase().slice(0, 120);

  logIngest({
    product: entityKey.endsWith("__links") ? "swiftlinks" : "swiftcard",
    entityKey,
    eventType: "viewed_card",
    counted: false,
    reason: "retired_endpoint",
    classificationReason: "api_views_retired",
  });

  // Deliberately the same shape the caller always got.
  return NextResponse.json({ ok: true, retired: true });
}
