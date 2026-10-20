import { getAdminSupabase } from "@/lib/supabase-admin";
import type { Approval } from "../types";
import type { ExecResult } from "./index";

// Approved blog post → the public blog's own store (agent_blog_posts, which
// /blog and /blog/[slug] read; status 'published' is what makes it live).
// The slug is the primary key, so an existing post is never overwritten.

export async function publishBlogPost(a: Approval): Promise<ExecResult> {
  const m = a.meta as { slug?: string; description?: string; keyword?: string; og_title?: string };
  if (!m.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.slug) || !m.description) return { ok: false, message: "The post is missing its slug or description." };
  const { error } = await getAdminSupabase()
    .from("agent_blog_posts")
    .insert({
      slug: m.slug,
      title: a.title.replace(/^Blog:\s*/i, ""),
      description: m.description,
      keyword: m.keyword ?? null,
      og_title: m.og_title ?? null,
      content_md: a.body,
      status: "published",
      published_at: new Date().toISOString(),
    });
  if (error) return { ok: false, message: error.code === "23505" ? "A post with that address already exists." : `Could not publish: ${error.message}` };
  return { ok: true, message: `Published at /blog/${m.slug}.`, result: { url: `/blog/${m.slug}` } };
}
