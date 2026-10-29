import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { BATCH_KEY, LOG_KEY, RESEARCH_KEY, batchState, type BlogBatch, type BlogLogEntry, type MarketResearch } from "@/lib/crew/blog/writer";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import BlogWriterView from "./BlogWriterView";

export const metadata = { title: "Blog Writer — SwiftCard Admin" };
export const dynamic = "force-dynamic";

/** The request time, read once (a server page renders once per request). */
function clock(): number {
  return Date.now();
}

// The Blog Writer (owner, 2026-10-29): Generate, read the two posts, publish one.
export default async function BlogWriterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const store = new SupabaseStore();
  const [batch, log, research, posts] = await Promise.all([
    store.kvGet<BlogBatch>(BATCH_KEY).catch(() => null),
    store.kvGet<BlogLogEntry[]>(LOG_KEY).catch(() => null),
    store.kvGet<MarketResearch>(RESEARCH_KEY).catch(() => null),
    getAdminSupabase().from("agent_blog_posts").select("slug, title, published_at").eq("status", "published").order("published_at", { ascending: false }),
  ]);
  const now = clock();
  return (
    <BlogWriterView
      batch={batchState(batch, new Date(now))}
      log={log ?? []}
      posts={(posts.data ?? []) as { slug: string; title: string; published_at: string | null }[]}
      research={research}
      msg={sp.msg?.slice(0, 300)}
      tone={sp.tone}
      now={now}
    />
  );
}
