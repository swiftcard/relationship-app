import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { firstName } from "@/lib/agent-org";
import { executeItem, type QueueItemLite } from "@/lib/agent-execute";

// Review-queue listing + actions. Item writes also append to
// agent_action_history — the accountability ledger the History view reads.
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const p = req.nextUrl.searchParams;
  try {
    const admin = getAdminSupabase();
    let q = admin.from("agent_queue_items").select("*").order("created_at", { ascending: false }).limit(Math.min(200, Number(p.get("limit") ?? 100)));
    q = q.eq("status", p.get("status") ?? "pending");
    if (p.get("agent")) q = q.eq("agent_id", p.get("agent")!);
    if (p.get("type")) q = q.eq("item_type", p.get("type")!);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ ready: true, items: data });
  } catch {
    return NextResponse.json({ ready: false, items: [] });
  }
}

const ITEM_ACTIONS = new Set(["approved", "rejected", "edited", "contacted", "replied", "converted", "acknowledged", "published", "csv_downloaded", "pending", "choose"]);

type ChoiceOption = { label?: string; headline?: string; content?: string; why_this?: string; payload?: Record<string, unknown> };
type ChoicePayload = { kind?: string; options?: ChoiceOption[]; research?: string; request_id?: string | null };

/**
 * The brain queues every piece of work as ONE item with TWO finished options
 * (item_type "choice"). Choosing collapses it into the option the owner picked:
 * the item becomes a normal item of the option's kind, carrying that option's
 * content and payload, and then goes down the same road an approved item does
 * (connector posts it, or it is saved as approved for the copy flow; a blog
 * post goes live). The other option is kept in the payload for the record.
 */
function resolveChoice(item: QueueItemLite, optionIndex: number) {
  const p = (item.payload ?? {}) as ChoicePayload;
  const options = Array.isArray(p.options) ? p.options : [];
  const pick = options[optionIndex];
  if (item.item_type !== "choice" || !pick || typeof pick.content !== "string" || !pick.content.trim()) return null;
  const kind = String(p.kind ?? "generic");
  return {
    item_type: kind,
    content: pick.content,
    payload: {
      ...(pick.payload ?? {}),
      chosen: pick.label ?? (optionIndex === 0 ? "A" : "B"),
      chosen_headline: pick.headline ?? null,
      options: options.map((o) => ({ label: o.label, headline: o.headline, why_this: o.why_this })),
      research: p.research ?? null,
      request_id: p.request_id ?? null,
    },
  };
}

/** Option A of a "competitor_found" item = start tracking them (Cleo's sweep). */
async function addCompetitor(admin: ReturnType<typeof getAdminSupabase>, payload: Record<string, unknown> | null | undefined) {
  const p = payload ?? {};
  const id = String(p.id ?? p.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!id || !p.name) return;
  const pages = Array.isArray(p.pages) ? (p.pages as Array<{ key?: string; url?: string }>).filter((x) => x?.key && x?.url).slice(0, 6) : [];
  await admin.from("agent_competitors").upsert({
    id, name: String(p.name), site: p.site ? String(p.site) : null, pages,
    app_store: p.app_store ? String(p.app_store) : null, discovered: true, active: true,
  }, { onConflict: "id" }).then(() => {}, () => {});
}

type BlogPostPayload = { slug?: string; title?: string; description?: string; keyword?: string; og_title?: string; content_md?: string };

function slugifyTitle(title: string) {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/**
 * Writes the post live and reports whether it actually landed. A blog_post
 * queue item must never be marked "published" unless this returns ok:true —
 * that's what kept an approved post invisible on /blog with no error anywhere.
 */
async function publishBlogPost(admin: ReturnType<typeof getAdminSupabase>, payload: Record<string, unknown> | null | undefined, fallbackTitle: string, now: string) {
  const post = (payload ?? {}) as BlogPostPayload;
  const slug = (post.slug?.trim() || slugifyTitle(post.title ?? fallbackTitle)) || null;
  if (!slug) return { ok: false as const, reason: "no slug and no title to derive one from" };
  if (!post.content_md || !post.description) return { ok: false as const, reason: "post is missing content or a description" };
  const { error } = await admin.from("agent_blog_posts").upsert({
    slug, title: post.title ?? fallbackTitle, description: post.description,
    keyword: post.keyword ?? null, og_title: post.og_title ?? post.title ?? fallbackTitle,
    content_md: post.content_md, status: "published", published_at: now,
  });
  if (error) return { ok: false as const, reason: error.message };
  await admin.from("agent_blog_topics").update({ status: "published" }).eq("slug", slug);
  revalidatePath("/blog");
  revalidatePath(`/blog/${slug}`);
  revalidatePath("/sitemap.xml");
  return { ok: true as const, slug };
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.slice(0, 100) : [];
  const requested: string = body?.action;
  if (!ids.length || !ITEM_ACTIONS.has(requested)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  // choose is one item at a time, with the option index the owner clicked.
  const optionIndex = Number(body?.option);
  if (requested === "choose" && (ids.length !== 1 || !(optionIndex === 0 || optionIndex === 1))) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const admin = getAdminSupabase();
  const { data: items } = await admin.from("agent_queue_items").select("*").in("id", ids);
  const now = new Date().toISOString();
  // Approve-to-execute: on Approve, an armed connector posts the item itself
  // (LinkedIn post, Reddit reply, Higgsfield job). No connector / not armed =
  // classic approved (copy flow). Only pending items can ever execute.
  const executed: Array<{ id: string; connector: string; detail: string; url?: string }> = [];
  const execFailed: Array<{ id: string; reason: string }> = [];

  for (const raw of items ?? []) {
    let item = raw;
    let after: string | null = null;
    let historyAction = requested;
    // A choice becomes the chosen option first, then behaves like Approve —
    // "the owner picks one of the two and it posts" (owner order 2026-09-08).
    let chosen = false;
    if (requested === "choose") {
      if (item.status !== "pending") continue;
      const resolved = resolveChoice(item as QueueItemLite, optionIndex);
      if (!resolved) { execFailed.push({ id: item.id, reason: "this item has no option to choose" }); continue; }
      item = { ...item, ...resolved };
      chosen = true;
      historyAction = "chose";
      await admin.from("agent_queue_items").update({ ...resolved, actioned_at: now }).eq("id", item.id);
      if (item.item_type === "competitor_found" && optionIndex === 0) await addCompetitor(admin, item.payload);
    }
    // A two-option item cannot be bulk-approved into nothing: the owner has to
    // pick A or B (or Neither). Anything else leaves it waiting.
    if (item.item_type === "choice" && (requested === "approved" || requested === "published" || requested === "contacted")) continue;
    const action = chosen ? "approved" : requested;
    if (action === "edited" && typeof body.content === "string" && ids.length === 1) {
      after = body.content;
      await admin.from("agent_queue_items").update({ content: after, status: "pending", actioned_at: now }).eq("id", item.id);
    } else if (action === "csv_downloaded") {
      // history-only: downloading the list is worth recording, not a status change
    } else if (action === "approved" && item.status === "pending" && chosen && item.item_type === "blog_post") {
      // A chosen blog post goes live right away — that IS the publish step.
      // Only mark it published if the row actually landed in agent_blog_posts.
      const result = await publishBlogPost(admin, item.payload, item.title, now);
      if (result.ok) {
        await admin.from("agent_queue_items").update({ status: "published", actioned_at: now }).eq("id", item.id);
        // The option not taken is free to come back another day with a better angle.
        const otherSlug = ((raw.payload as ChoicePayload | null)?.options ?? []).map((o) => (o.payload as { slug?: string } | undefined)?.slug).find((sl) => sl && sl !== result.slug);
        if (otherSlug) await admin.from("agent_blog_topics").update({ status: "declined" }).eq("slug", otherSlug).neq("status", "published");
      } else {
        execFailed.push({ id: item.id, reason: result.reason });
        await admin.from("agent_queue_items").update({ status: "approved", actioned_at: now }).eq("id", item.id);
        await admin.from("agent_messages").insert({
          from_id: "atlas", to_id: "owner", kind: "owner_out",
          body: `⚠ Couldn't publish “${String(item.title).slice(0, 70)}” — ${result.reason}. It's saved as approved.`,
        }).then(() => {}, () => {});
      }
    } else if (action === "published" && item.item_type === "blog_post") {
      // Direct Publish on a blog_post item — same rule: no row, no "published".
      const result = await publishBlogPost(admin, item.payload, item.title, now);
      if (result.ok) {
        await admin.from("agent_queue_items").update({ status: "published", actioned_at: now }).eq("id", item.id);
      } else {
        execFailed.push({ id: item.id, reason: result.reason });
        await admin.from("agent_messages").insert({
          from_id: "atlas", to_id: "owner", kind: "owner_out",
          body: `⚠ Couldn't publish “${String(item.title).slice(0, 70)}” — ${result.reason}.`,
        }).then(() => {}, () => {});
      }
    } else if (action === "approved" && item.status === "pending") {
      const out = await executeItem(item as QueueItemLite);
      if (out.executed) {
        historyAction = chosen ? "chose_posted" : "posted";
        executed.push({ id: item.id, connector: out.connector, detail: out.detail, url: out.url });
        await admin.from("agent_queue_items").update({
          status: "posted", actioned_at: now,
          payload: { ...(item.payload ?? {}), ...(out.payloadPatch ?? {}), posted_via: out.connector },
        }).eq("id", item.id);
        await admin.from("agent_messages").insert({
          from_id: "atlas", to_id: "owner", kind: "owner_out",
          body: `✅ ${out.detail} — “${String(item.title).slice(0, 70)}” (${firstName(item.agent_id)}'s work).${out.url ? ` ${out.url}` : ""}`,
        }).then(() => {}, () => {});
      } else {
        if (out.connector) execFailed.push({ id: item.id, reason: out.reason });
        await admin.from("agent_queue_items").update({ status: "approved", actioned_at: now }).eq("id", item.id);
        if (out.connector && !out.reason.includes("not connected")) {
          await admin.from("agent_messages").insert({
            from_id: "atlas", to_id: "owner", kind: "owner_out",
            body: `⚠ Couldn't auto-post “${String(item.title).slice(0, 70)}” — ${out.reason}. It's saved as approved; use Copy.`,
          }).then(() => {}, () => {});
        }
      }
    } else {
      await admin.from("agent_queue_items").update({ status: action, actioned_at: now }).eq("id", item.id);
    }
    await admin.from("agent_action_history").insert({
      item_id: item.id, action: historyAction, actor_email: user.email,
      edit_before: after ? item.content : null, edit_after: after,
    });
  }
  // Comms log: one line per decision (not per item) so bulk actions read as
  // one order. Best-effort — a comms hiccup must not fail the action.
  if (items?.length && requested !== "pending") {
    const VERB: Record<string, string> = { choose: `Picked option ${optionIndex === 0 ? "A" : "B"} of`, approved: "Approved", rejected: "Rejected", edited: "Edited and kept", contacted: "Marked as sent", replied: "Logged a reply on", converted: "Logged a CONVERSION on", acknowledged: "Read", published: "Published", csv_downloaded: "Downloaded the CSV for" };
    const who = [...new Set(items.map((i) => firstName(i.agent_id)))].slice(0, 4).join(", ");
    await admin.from("agent_messages").insert({
      from_id: "owner", to_id: "atlas", kind: "owner_in",
      body: `${VERB[requested] ?? requested} ${items.length === 1 ? `“${String(items[0].title).slice(0, 80)}”` : `${items.length} items`} (${who}'s work).`,
    }).then(() => {}, () => {});
  }
  return NextResponse.json({ ok: true, count: items?.length ?? 0, executed, execFailed });
}
