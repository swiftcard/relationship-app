import { after, NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { cleanText } from "@/lib/demo/input";
import { getBooking, queueMessages, updateBooking } from "@/lib/demo/store";
import { cancelDemo } from "@/lib/demo/service";
import { drainDue } from "@/lib/demo/outbox";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/admin/demos/<id>  action = cancel | no_show | resend
// Posted by plain <form method="post">s on /admin/demos, so it answers with a
// 303 back to the page (with ?done=… for the message); a JSON caller gets JSON.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeBack(v: unknown): string {
  return typeof v === "string" && /^\/admin\/demos(\?tab=past)?$/.test(v) ? v : "/admin/demos";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  // A form on another site can't cancel the owner's demos.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "cross-site" }, { status: 403 });

  const { id } = await ctx.params;
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  const input: Record<string, unknown> = isJson
    ? await req.json().catch(() => ({}))
    : Object.fromEntries((await req.formData().catch(() => new FormData())).entries());
  const back = safeBack(input.back);
  const reply = (done: string, status = 200) => {
    if (isJson) return NextResponse.json({ ok: done !== "failed", done }, { status });
    const url = new URL(back, req.nextUrl.origin);
    url.searchParams.set("done", done);
    return NextResponse.redirect(url, 303);
  };

  if (!UUID_RE.test(id)) return reply("failed", 404);
  const b = await getBooking(id);
  if (!b) return reply("failed", 404);
  const now = new Date();

  switch (input.action) {
    case "cancel": {
      if (b.status !== "confirmed") return reply("canceled");
      await cancelDemo(b, "admin", cleanText(input.reason, 500) || null, now);
      after(() => drainDue({ bookingId: b.id }).catch(() => {}));
      return reply("canceled");
    }
    case "no_show": {
      if (new Date(b.starts_at).getTime() > now.getTime() || b.status === "canceled") return reply("failed", 409);
      const r = await updateBooking(b.id, { status: "no_show" });
      return reply(r.ok ? "no_show" : "failed", r.ok ? 200 : 500);
    }
    case "resend": {
      if (b.status !== "confirmed" || new Date(b.starts_at).getTime() <= now.getTime()) return reply("failed", 409);
      await queueMessages([{ booking_id: b.id, kind: "confirmation", send_at: now }]);
      after(() => drainDue({ bookingId: b.id }).catch(() => {}));
      return reply("resent");
    }
    default:
      return reply("failed", 400);
  }
}
