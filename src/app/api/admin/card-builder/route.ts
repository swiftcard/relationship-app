import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { parsePreviewForm } from "@/lib/prospect-preview/input";
import { createPreview } from "@/lib/prospect-preview/store";

export const runtime = "nodejs";

// POST /api/admin/card-builder: create a preview card for a prospect.
// Posted by the plain <form method="post"> on /admin/card-builder, so it works
// before hydration and answers with a 303: to the new DRAFT's edit screen on
// success (nothing is public until it is published there), or back to the
// page with ?error=… and what to fix.

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
  // A new preview is a draft: it opens on its edit screen, where it is published.
  if (made.ok) return NextResponse.redirect(new URL(`/admin/card-builder/edit/${made.preview.id}?done=created`, req.nextUrl.origin), 303);
  if (made.reason === "slug_taken") return back(req, { error: "That link name is already used by another preview. Pick a different one, or leave it empty." });
  if (made.reason === "not_set_up") return back(req, { error: "Card Builder's storage hasn't been created yet. Run supabase/prospect-previews.sql once." });
  return back(req, { error: "That didn't save. Try again in a minute." });
}
