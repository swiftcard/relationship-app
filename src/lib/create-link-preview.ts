import { createFileFromId } from "@/lib/create-link";
import { getCardPageData } from "@/lib/card-page-data";
import { resolveCardMeta } from "@/lib/resolve-card";
import { getAdminSupabase } from "@/lib/supabase-admin";

// The picture behind a Create + share link (lib/create-link), fitted onto a
// calm background at the standard 1200×630 link-preview size — what iMessage,
// WhatsApp, Slack and LinkedIn show as the big preview.
//
// Only the card owner's own upload can appear: the owner comes from the slug,
// the file name from the id. Returns null for anything off — a bad id, a
// missing picture, or a card that is offline / deleted / over its plan — and
// the caller falls back to the card's normal preview.

export const LINKED_PREVIEW_SIZE = { width: 1200, height: 630 };
const BACKGROUND = "#F4F1EC"; // the card page's warm paper, a shade deeper
const PAD = 48;

export async function linkedPicturePreview(username: string, id: string): Promise<Buffer | null> {
  const file = createFileFromId(id);
  if (!file) return null;
  if (!(await resolveCardMeta(username))) return null; // a card that is down previews nothing of theirs
  const { cardRow } = await getCardPageData(username);
  const ownerId = cardRow?.user_id as string | undefined;
  if (!ownerId) return null;
  try {
    const { data, error } = await getAdminSupabase().storage.from("card-uploads").download(`${ownerId}/${file}`);
    if (error || !data) return null;
    const src = Buffer.from(await data.arrayBuffer());
    const sharp = (await import("sharp")).default;
    // First frame of a GIF; contained (never cropped) and never enlarged past
    // 2×, so a small logo doesn't turn to mush.
    const { width: W, height: H } = LINKED_PREVIEW_SIZE;
    const inner = { width: W - PAD * 2, height: H - PAD * 2 };
    const meta = await sharp(src, { animated: false }).metadata();
    const w0 = meta.width || inner.width, h0 = meta.height || inner.height;
    const k = Math.min(2, inner.width / w0, inner.height / h0);
    const pic = await sharp(src, { animated: false })
      .rotate()
      .resize({ width: Math.max(1, Math.round(w0 * k)), height: Math.max(1, Math.round(h0 * k)), fit: "inside" })
      .png()
      .toBuffer();
    return await sharp({ create: { width: W, height: H, channels: 3, background: BACKGROUND } })
      .composite([{ input: pic, gravity: "center" }])
      .jpeg({ quality: 86 })
      .toBuffer();
  } catch {
    return null;
  }
}
