import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { UUID_RE } from "@/lib/prospect-preview/input";
import { cancelOutbox, saveSenderSettings } from "@/lib/prospect-preview/outbox";
import { readSenderSettings } from "@/lib/prospect-preview/send-window";

export const runtime = "nodejs";

// POST /api/admin/card-builder/sender   action = settings | cancel
//
//   settings  the Mac sender's rules: paused, daily_cap, start, end, days[],
//             gap_min, gap_max (lib/prospect-preview/send-window.ts)
//   cancel    id = an outbox row not yet sent
//
// Plain <form method="post">s: answers with a 303 back to the Sender page.

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "cross-site" }, { status: 403 });

  const form = await req.formData().catch(() => new FormData());
  const back = (done: string) => NextResponse.redirect(new URL(`/admin/card-builder/sender?done=${done}`, req.nextUrl.origin), 303);

  if (form.get("action") === "cancel") {
    const id = String(form.get("id") ?? "");
    return back(UUID_RE.test(id) && (await cancelOutbox(id)) ? "canceled" : "failed");
  }
  const s = readSenderSettings({
    paused: form.get("paused"), daily_cap: form.get("daily_cap"), start: form.get("start"), end: form.get("end"),
    days: form.getAll("days").map(String), gap_min: form.get("gap_min"), gap_max: form.get("gap_max"),
  });
  return back((await saveSenderSettings(s)) ? "saved" : "failed");
}
