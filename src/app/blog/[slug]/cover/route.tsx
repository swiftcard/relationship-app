import { ImageResponse } from "next/og";
import { requireAdmin } from "@/lib/admin";
import { loadBrandOgInputs } from "@/lib/brand-og";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { BATCH_KEY, type BlogBatch } from "@/lib/crew/blog/writer";
import { SupabaseStore } from "@/lib/crew/store-supabase";

// ── A blog post's cover picture (1200 × 630) ───────────────────────────────
// Every post the Blog Writer makes opens with this (owner, 2026-10-29: "they
// can include pictures in the blog posts"): the post's own title on the
// site's brand look, with the real phone screenshot. Drawn from the published
// post's title; for a draft the owner is still choosing between in the admin,
// only an admin gets a picture (no one can make swiftcard.me draw any text).

export const runtime = "nodejs";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PHONE_RATIO = 1107 / 520;

async function titleFor(slug: string): Promise<{ title: string; draft: boolean } | null> {
  const { data } = await getAdminSupabase().from("agent_blog_posts").select("title").eq("slug", slug).eq("status", "published").maybeSingle();
  if (data?.title) return { title: data.title as string, draft: false };
  if (!(await requireAdmin())) return null;
  const batch = await new SupabaseStore().kvGet<BlogBatch>(BATCH_KEY).catch(() => null);
  const d = batch?.drafts.find((x) => x.slug === slug);
  return d ? { title: d.title, draft: true } : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) return new Response("not found", { status: 404 });
  const post = await titleFor(slug);
  if (!post) return new Response("not found", { status: 404 });
  const { fonts, logo, phones, headlineFont } = await loadBrandOgInputs(5000);
  const size = post.title.length > 52 ? 58 : 68;
  const phoneW = 330;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", background: "linear-gradient(135deg, #1d4ed8 0%, #172554 55%, #0b1020 100%)", fontFamily: "Geist", color: "#ffffff" }}>
        <div style={{ position: "absolute", left: 640, top: -120, width: 620, height: 620, borderRadius: 620, background: "radial-gradient(circle, rgba(147,197,253,0.35) 0%, rgba(147,197,253,0) 70%)", display: "flex" }} />
        <div style={{ position: "absolute", left: 72, top: 70, width: 640, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo && <img src={logo} width={44} height={44} alt="" style={{ borderRadius: 11 }} />}
            <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, color: "#bfdbfe" }}>SWIFTCARD BLOG</span>
          </div>
          <div style={{ marginTop: 48, fontSize: size, lineHeight: 1.06, fontWeight: 800, fontFamily: headlineFont, letterSpacing: -1.5, display: "flex" }}>{post.title}</div>
          <div style={{ marginTop: 34, fontSize: 24, color: "#dbeafe", display: "flex" }}>swiftcard.me</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {phones.front && <img src={phones.front} width={phoneW} height={Math.round(phoneW * PHONE_RATIO)} alt="" style={{ position: "absolute", left: 800, top: 70, transform: "rotate(6deg)" }} />}
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: fonts.length ? fonts : undefined,
      headers: { "Cache-Control": post.draft ? "private, no-store" : "public, max-age=86400, s-maxage=604800" },
    },
  );
}
