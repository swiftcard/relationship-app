import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { UUID_RE } from "@/lib/prospect-preview/input";
import { logoResponse } from "@/lib/prospect-preview/logo-server";
import { getPreviewById } from "@/lib/prospect-preview/store";

export const runtime = "nodejs";

// GET /api/admin/card-builder/<id>/logo: the same padded logo the public page
// serves (/p/<slug>/logo), for staff looking at a preview that isn't public.

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response(null, { status: 404 });
  const preview = await getPreviewById(id);
  if (!preview) return new Response(null, { status: 404 });
  return logoResponse(preview.logo_url, preview.brand_primary);
}
