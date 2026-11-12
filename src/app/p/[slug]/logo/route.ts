import { SLUG_RE } from "@/lib/prospect-preview/input";
import { logoResponse } from "@/lib/prospect-preview/logo-server";
import { previewState } from "@/lib/prospect-preview/real-view";
import { getPreviewBySlug } from "@/lib/prospect-preview/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /p/<slug>/logo: the prospect's logo with an even margin around it, for
// the cards on their preview page (lib/prospect-preview/logo-server). Gone
// when the preview is: a draft, a paused or an expired preview answers 404
// here exactly as its page does.

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const slug = (await ctx.params).slug.toLowerCase();
  if (!SLUG_RE.test(slug)) return new Response(null, { status: 404 });
  const preview = await getPreviewBySlug(slug);
  if (!preview || previewState(preview) !== "live") return new Response(null, { status: 404 });
  return logoResponse(preview.logo_url);
}
