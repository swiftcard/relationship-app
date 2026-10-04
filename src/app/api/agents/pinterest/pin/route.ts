import { NextRequest, NextResponse } from "next/server";
import { botAuthorized } from "@/lib/instagram-bot-auth";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { freshAccessToken, loadConnections } from "@/lib/agent-connections";
import { campaignLink } from "@/lib/campaign-links";
import { PIN_IDEAS, pinCode, pinIdea } from "@/lib/pinterest-pins";

// ── Pinterest: post one pin ──────────────────────────────────────────────────
// The picture is rendered and uploaded by scripts/pinterest-pins.mjs (GitHub
// Actions, where a browser exists); this route does the part that needs the
// stored Pinterest connection: find or create the board, create the pin, and
// write the ledger row. Each idea is posted once (agent_pins.slug is the key).
//
//   GET  → which ideas still need posting, and whether Pinterest is connected
//   POST { slug, image_url } → the pin

export const runtime = "nodejs";
export const maxDuration = 60;

const API = "https://api.pinterest.com/v5";

type Board = { id: string; name: string };

async function pinterest<T>(token: string, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

async function boardFor(token: string, name: string, description: string): Promise<Board | string> {
  const list = await pinterest<{ items?: Board[]; message?: string }>(token, "/boards?page_size=100");
  if (!list.ok) return `boards: ${list.data.message ?? list.status}`;
  const found = (list.data.items ?? []).find((b) => b.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const made = await pinterest<Board & { message?: string }>(token, "/boards", { method: "POST", body: JSON.stringify({ name, description, privacy: "PUBLIC" }) });
  return made.ok && made.data.id ? { id: made.data.id, name } : `create board: ${made.data.message ?? made.status}`;
}

export async function GET(req: NextRequest) {
  if (!botAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const conn = (await loadConnections()).pinterest;
  const db = getAdminSupabase();
  const { data, error } = await db.from("agent_pins").select("slug, status");
  if (error) return NextResponse.json({ connected: !!conn, ready: false, pending: [], message: "Run supabase/agent-pinterest.sql first." });
  const done = new Set((data ?? []).filter((r) => r.status === "posted").map((r) => r.slug as string));
  return NextResponse.json({ connected: !!conn, ready: true, pending: PIN_IDEAS.filter((p) => !done.has(p.slug)).map((p) => p.slug) });
}

export async function POST(req: NextRequest) {
  if (!botAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { slug?: unknown; image_url?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const imageUrl = typeof body?.image_url === "string" ? body.image_url : "";
  const idea = pinIdea(slug);
  if (!idea || !/^https:\/\//.test(imageUrl)) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const conn = (await loadConnections()).pinterest;
  if (!conn) return NextResponse.json({ ok: false, reason: "not_connected" });
  const token = await freshAccessToken(conn);
  if (!token) return NextResponse.json({ ok: false, reason: "token_expired — reconnect Pinterest in Agent Flow → Settings" });

  const db = getAdminSupabase();
  const code = pinCode(slug);
  const { data: existing } = await db.from("agent_pins").select("status, pin_url").eq("slug", slug).maybeSingle();
  if (existing?.status === "posted") return NextResponse.json({ ok: true, already: true, pin_url: existing.pin_url });

  const board = await boardFor(token, idea.board, `${idea.board} from SwiftCard — digital business cards people save in one tap.`);
  if (typeof board === "string") {
    await db.from("agent_pins").upsert({ slug, code, image_url: imageUrl, status: "failed", error: board }, { onConflict: "slug" });
    return NextResponse.json({ ok: false, reason: board });
  }

  const link = campaignLink(code, idea.profession);
  const made = await pinterest<{ id?: string; message?: string; code?: number }>(token, "/pins", {
    method: "POST",
    body: JSON.stringify({
      board_id: board.id,
      title: idea.headline.slice(0, 100),
      description: idea.description.slice(0, 800),
      link,
      alt_text: `${idea.headline} — a SwiftCard digital business card design`.slice(0, 500),
      media_source: { source_type: "image_url", url: imageUrl },
    }),
  });
  if (!made.ok || !made.data.id) {
    const reason = `pin: ${made.data.message ?? made.status}`;
    await db.from("agent_pins").upsert({ slug, code, board_id: board.id, board_name: board.name, image_url: imageUrl, status: "failed", error: reason }, { onConflict: "slug" });
    return NextResponse.json({ ok: false, reason });
  }
  const pinUrl = `https://www.pinterest.com/pin/${made.data.id}/`;
  await db.from("agent_pins").upsert({
    slug, code, board_id: board.id, board_name: board.name, pin_id: made.data.id, pin_url: pinUrl, image_url: imageUrl,
    status: "posted", error: null, posted_at: new Date().toISOString(),
  }, { onConflict: "slug" });
  return NextResponse.json({ ok: true, pin_url: pinUrl, board: board.name, link });
}
