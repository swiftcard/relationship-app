import { after, NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { BATCH_KEY, batchState, generateBatch, publishChoice, type BlogBatch } from "@/lib/crew/blog/writer";
import { liveProviders } from "@/lib/crew/providers";
import { SupabaseStore } from "@/lib/crew/store-supabase";

// ── The Blog Writer's buttons ───────────────────────────────────────────────
// Generate: answers at once ("Writing…") and writes the two posts after the
// response, within this function's time (owner, 2026-10-29: "it'll take some
// time obviously because it has to make it good"). Publish: the one the owner
// picked goes live on /blog. Discard: lets both go. Plain form posts,
// admin-gated, refused from another site; every answer is a 303 back to the
// page with a message.
export const maxDuration = 300;

const PAGE = "/admin/crew/blog";

function back(req: NextRequest, msg: string, tone: "ok" | "err" = "ok") {
  const u = new URL(PAGE, req.nextUrl.origin);
  u.searchParams.set("msg", msg);
  u.searchParams.set("tone", tone);
  return NextResponse.redirect(u, 303);
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "cross-site" }, { status: 403 });
  const form = await req.formData().catch(() => new FormData());
  const action = String(form.get("action") ?? "");
  const store = new SupabaseStore();
  const admin = getAdminSupabase();

  if (action === "generate") {
    const cur = batchState(await store.kvGet<BlogBatch>(BATCH_KEY));
    if (cur?.status === "writing") return back(req, "It's already writing two posts. They'll show up here.", "err");
    if (cur?.status === "ready") return back(req, "Pick one of the two posts below first, or discard them.", "err");
    const { data: posts } = await admin.from("agent_blog_posts").select("slug, title, keyword");
    const batch: BlogBatch = { id: crypto.randomUUID(), status: "writing", started_at: new Date().toISOString(), finished_at: null, step: "Starting", drafts: [], error: null, published: null };
    await store.kvSet(BATCH_KEY, batch);
    after(() => generateBatch(store, liveProviders(), { batchId: batch.id, posts: (posts ?? []) as { slug: string; title: string; keyword: string | null }[] }));
    return back(req, "Writing two posts. This takes a few minutes; the page updates on its own.");
  }

  if (action === "publish") {
    const r = await publishChoice(store, async (row) => {
      const { error } = await admin.from("agent_blog_posts").insert(row);
      return { error: error ? { code: error.code, message: error.message } : null };
    }, { batchId: String(form.get("batch") ?? ""), index: Number(form.get("index") ?? -1) });
    if (!r.ok) return back(req, r.message, "err");
    revalidatePath("/blog");
    revalidatePath(`/blog/${r.slug}`);
    return back(req, `Published: "${r.title}". It's live at swiftcard.me/blog/${r.slug}.`);
  }

  if (action === "discard") {
    const cur = await store.kvGet<BlogBatch>(BATCH_KEY);
    if (cur && cur.status !== "writing") await store.kvSet(BATCH_KEY, null);
    return back(req, "Discarded. Press Generate for two new posts.");
  }

  return back(req, "Unknown button.", "err");
}
