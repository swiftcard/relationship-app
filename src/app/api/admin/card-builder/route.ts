import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { parsePreviewForm } from "@/lib/prospect-preview/input";
import { createPreview } from "@/lib/prospect-preview/store";

export const runtime = "nodejs";

// POST /api/admin/card-builder: create a preview card for a prospect.
// Posted by the plain <form method="post"> on /admin/card-builder, so it works
// before hydration and answers with a 303 back to the page: ?made=<slug> on
// success (the page shows the link to copy), ?error=… with what to fix.

function back(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL("/admin/card-builder", req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v.slice(0, 200));
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // A form on another site can't make previews in the owner's name.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "cross-site" }, { status: 403 });

  const form = await req.formData().catch(() => new FormData());
  const parsed = parsePreviewForm((k) => form.get(k));
  if (!parsed.ok) return back(req, { error: parsed.error });

  const made = await createPreview(parsed.value);
  if (made.ok) return back(req, { made: made.preview.slug });
  if (made.reason === "slug_taken") return back(req, { error: "That link name is already used by another preview. Pick a different one, or leave it empty." });
  if (made.reason === "not_set_up") return back(req, { error: "Card Builder's storage hasn't been created yet. Run supabase/prospect-previews.sql once." });
  return back(req, { error: "That didn't save. Try again in a minute." });
}
