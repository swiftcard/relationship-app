import type { Metadata } from "next";
import Eyebrow from "@/components/site/Eyebrow";
import Link from "next/link";
import SiteNav from "@/components/site/SiteNav";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import { getAdminSupabase } from "@/lib/supabase-admin";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import "@/app/home.css";

// ── The SwiftCard blog ───────────────────────────────────────────────────────
// Posts live in agent_blog_posts (written and reviewed before the Agent Flow
// tab was retired, 2026-10-19). This page reads ONLY
// status='published' rows via the server admin client — there is no user
// write path to this table (RLS on, no policies).
export const revalidate = 300;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export const metadata: Metadata = {
  title: "Blog | SwiftCard",
  description: "Guides and honest comparisons on digital business cards, lead capture, follow-up, and networking that actually converts.",
  alternates: { canonical: `${APP_URL}/blog` },
};

export default async function BlogIndexPage() {
  let posts: { slug: string; title: string; description: string; published_at: string | null }[] = [];
  try {
    const { data } = await getAdminSupabase()
      .from("agent_blog_posts")
      .select("slug, title, description, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(100);
    posts = data ?? [];
  } catch { /* table not created yet — render the empty state */ }

  return (
    // bg-cream stays only for the native shell's status-bar canvas rule in
    // globals.css (html.native-app:has(main.bg-cream)); .hp paints the page
    // itself white (owner, 2026-09-17: light pages, no cream).
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <SiteNav />
      <HomeHeadingReveal />
      <section className="hp-page-hero text-center px-5 sm:px-6 pt-28 sm:pt-36 pb-14">
        <div className="relative" data-hp-head>
          <div className="mb-4"><Eyebrow dark={false}>Blog</Eyebrow></div>
          <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 mb-4 [text-wrap:balance]">The SwiftCard blog</h1>
          <p className="hp-lede max-w-xl mx-auto">Digital business cards, lead capture, and following up, written plainly and compared honestly.</p>
        </div>
      </section>
      <div className="hp-soft flex-1">
      <section className="max-w-2xl mx-auto w-full px-5 sm:px-6 pt-14 pb-20">
        {posts.length === 0 && <p className="text-slate-500 text-center">First posts are on the way.</p>}
        <div className="flex flex-col gap-3">
          {posts.map((p) => (
            <Link key={p.slug} href={`/blog/${p.slug}`} className="hp-card block">
              <p className="text-slate-900 font-semibold text-[1.0625rem]">{p.title}</p>
              <p className="text-slate-500 text-sm mt-1.5 leading-relaxed">{p.description}</p>
              {p.published_at && <p className="text-slate-500 text-xs mt-2">{new Date(p.published_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>}
            </Link>
          ))}
        </div>
      </section>
      </div>
      <SiteFooterMini />
    </main>
  );
}
