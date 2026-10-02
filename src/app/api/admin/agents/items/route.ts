import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { firstName } from "@/lib/agent-org";
import { executeItem, type QueueItemLite } from "@/lib/agent-execute";

// Approve can upload a rendered video to YouTube or wait for Instagram to
// process a reel — well past the default function budget.
export const maxDuration = 120;

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
    return NextResponse.json({ ready: true, items: data, assets: await assetsFor(admin, data ?? []) });
  } catch {
    return NextResponse.json({ ready: false, items: [] });
  }
}

/** The rendered video / picture each item carries (payload.asset_id, a
 *  carousel's asset_ids, or either option's asset_id) → its file in the
 *  creative pool. A post the owner publishes BY HAND — TikTok, where no tool
 *  may post for you — is useless without the file, and the queue used to show
 *  only the caption. Ready assets only; a missing table is an empty map. */
async function assetsFor(admin: ReturnType<typeof getAdminSupabase>, items: Array<{ payload?: unknown }>): Promise<Record<string, { kind: string; url: string }>> {
  const UUID = /^[0-9a-f-]{36}$/i;
  const ids = new Set<string>();
  const take = (p: unknown) => {
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    if (typeof o.asset_id === "string" && UUID.test(o.asset_id)) ids.add(o.asset_id);
    if (Array.isArray(o.asset_ids)) for (const a of o.asset_ids) if (typeof a === "string" && UUID.test(a)) ids.add(a);
  };
  for (const it of items) {
    take(it.payload);
    const opts = (it.payload as { options?: Array<{ payload?: unknown }> } | null)?.options;
    if (Array.isArray(opts)) for (const o of opts) take(o?.payload);
  }
  if (!ids.size) return {};
  try {
    const { data } = await admin.from("media_assets").select("id, kind, url, status").in("id", [...ids].slice(0, 300));
    return Object.fromEntries((data ?? []).filter((a) => a.status === "ready" && a.url).map((a) => [a.id as string, { kind: a.kind as string, url: a.url as string }]));
  } catch {
    return {};
  }
}

const ITEM_ACTIONS = new Set(["approved", "rejected", "edited", "contacted", "replied", "converted", "acknowledged", "published", "csv_downloaded", "pending", "choose"]);

type ChoiceOption = { label?: string; headline?: string; content?: string; why_this?: string; payload?: Record<string, unknown> };
type ChoicePayload = { kind?: string; options?: ChoiceOption[]; research?: string; request_id?: string | null; signal_id?: string | null };

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
      // The Radar signal this reply answers (lib/radar.mjs) — carried through
      // so the pick marks that signal handled.
      signal_id: p.signal_id ?? null,
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
      await admin.from("agent_queue_items").update({ status: "published", actioned_at: now }).eq("id", item.id);
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
    // A reply written for a Radar signal: the owner's call on the item is the
    // call on the signal too (picked/approved → handled, Neither → dismissed).
    const signalId = (item.payload as Record<string, unknown> | null)?.signal_id;
    if (typeof signalId === "string" && signalId) {
      const signalStatus = action === "rejected" ? "dismissed" : ["approved", "published", "contacted", "acknowledged"].includes(action) ? "handled" : null;
      if (signalStatus) await admin.from("agent_radar_signals").update({ status: signalStatus, item_id: item.id }).eq("id", signalId).then(() => {}, () => {});
    }
    // Blog publish: flip the post live on /blog from the queued payload. A
    // chosen blog option publishes the same way, in the same step.
    const goLive = (action === "published" && item.item_type === "blog_post") || (chosen && item.item_type === "blog_post");
    if (goLive && item.payload?.slug) {
      const post = item.payload as { slug: string; title: string; description?: string; meta_description?: string; keyword?: string; og_title?: string; content_md?: string };
      // Brain-written posts (a "choice" the owner picked) carry meta_description
      // and keep the body in item.content, not description/content_md. Both
      // columns are NOT NULL, so reading only the Blog Writer's shape made the
      // insert fail silently while the queue said "published" (2026-09-28).
      const { error: liveErr } = await admin.from("agent_blog_posts").upsert({
        slug: post.slug, title: post.title, description: post.description ?? post.meta_description ?? "",
        keyword: post.keyword ?? null, og_title: post.og_title ?? post.title,
        content_md: post.content_md ?? item.content, status: "published", published_at: now,
      });
      if (liveErr) {
        await admin.from("agent_queue_items").update({ status: "pending", actioned_at: now }).eq("id", item.id);
        execFailed.push({ id: item.id, reason: `the post didn't reach /blog (${liveErr.message}); it's back in the queue` });
        continue;
      }
      await admin.from("agent_blog_topics").update({ status: "published" }).eq("slug", post.slug);
      // The option not taken is free to come back another day with a better angle.
      const otherSlug = ((raw.payload as ChoicePayload | null)?.options ?? []).map((o) => (o.payload as { slug?: string } | undefined)?.slug).find((sl) => sl && sl !== post.slug);
      if (chosen && otherSlug) await admin.from("agent_blog_topics").update({ status: "declined" }).eq("slug", otherSlug).neq("status", "published");
    }
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
