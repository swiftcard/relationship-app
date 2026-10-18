import type { SupabaseClient } from "@supabase/supabase-js";

// ── Guest uploads: adopted when claimed, gone when abandoned (audit SEC-04) ──
//
// Someone building a first card with no account can upload a photo or a video
// (owner, 2026-09-17). Those land in card-uploads under guest/<random>/, a
// public bucket, and nothing ever removed them: anyone, with no account, could
// park files at permanent URLs on the project's storage domain. Two halves:
//
//   • adopt — when a draft becomes a real card, every guest file it uses is
//     copied into the account's own folder and the card points there, so no
//     card ever depends on a guest/ object;
//   • purge — the daily cron deletes guest/ objects older than any draft is
//     worth keeping. A draft claimed later still has its words and design;
//     its pictures can be added again.

const BUCKET = "card-uploads";
const MARKER = `/storage/v1/object/public/${BUCKET}/`;

/** Guest files older than this are removed. */
export const GUEST_UPLOAD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The storage path of a guest upload's public URL, or null for anything else. */
export function guestPathOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const at = value.indexOf(MARKER);
  if (at < 0) return null;
  const path = decodeURIComponent(value.slice(at + MARKER.length).split(/[?#]/)[0]);
  return path.startsWith("guest/") && !path.includes("..") ? path : null;
}

/**
 * Copy every guest file `value` points at into `${userId}/` and rewrite the
 * URLs, in place, through any depth of objects and arrays. A copy that fails
 * leaves that URL as it was: the card still shows it, and the purge's age
 * limit is the only cost.
 */
export async function adoptGuestUploads(admin: SupabaseClient, userId: string, value: unknown): Promise<void> {
  const seen = new Map<string, string>();
  let n = 0;
  const adopt = async (url: string): Promise<string> => {
    const from = guestPathOf(url);
    if (!from) return url;
    if (seen.has(from)) return seen.get(from)!;
    const to = `${userId}/adopted-${Date.now()}-${n++}-${from.split("/").pop()}`;
    const { error } = await admin.storage.from(BUCKET).copy(from, to);
    if (error) return url;
    const next = admin.storage.from(BUCKET).getPublicUrl(to).data.publicUrl ?? url;
    seen.set(from, next);
    return next;
  };
  const walk = async (node: unknown): Promise<void> => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (typeof node[i] === "string") node[i] = await adopt(node[i] as string);
        else await walk(node[i]);
      }
    } else if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        if (typeof obj[k] === "string") obj[k] = await adopt(obj[k] as string);
        else await walk(obj[k]);
      }
    }
  };
  await walk(value);
}

/** Delete guest/ objects older than GUEST_UPLOAD_TTL_MS. Returns how many. */
export async function purgeStaleGuestUploads(admin: SupabaseClient, nowMs: number = Date.now()): Promise<number> {
  const cutoff = nowMs - GUEST_UPLOAD_TTL_MS;
  const store = admin.storage.from(BUCKET);
  let removed = 0;
  // guest/<random>/<file>: one folder per upload session.
  for (let offset = 0; offset < 10_000; offset += 100) {
    const { data: folders, error } = await store.list("guest", { limit: 100, offset });
    if (error || !folders?.length) break;
    for (const folder of folders) {
      const { data: files } = await store.list(`guest/${folder.name}`, { limit: 100 });
      const stale = (files ?? [])
        .filter((f) => f.created_at && Date.parse(f.created_at) < cutoff)
        .map((f) => `guest/${folder.name}/${f.name}`);
      if (!stale.length) continue;
      const { error: rmError } = await store.remove(stale);
      if (!rmError) removed += stale.length;
    }
    if (folders.length < 100) break;
  }
  return removed;
}
