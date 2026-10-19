"use client";

import { useEffect, useState } from "react";
import { PHOTO_TONE_SAMPLE, toneFromPixels } from "@/lib/photo-tone";

// One read per photo per session — the editors re-render on every keystroke
// and on every Look change, and none of that changes the photo.
const toneCache = new Map<string, string | null>();

/**
 * The header photo's colour, read in the browser — the editors' half of
 * "Photo match" (the public page reads it on the server, lib/photo-tone-server).
 * An https photo is re-read through the same-origin /api/img-proxy so the
 * canvas is not tainted (the link tiles' brightness check does the same); a
 * just-picked local file (blob:/data:) is read directly. Same centre-square
 * crop and the same arithmetic as the server (lib/photo-tone), so the preview
 * shows the colour the page will get. Null until read, and null for anything
 * unreadable — the Look's own fallback colours render meanwhile.
 */
export function usePhotoTone(url: string | null | undefined): string | null {
  const [read, setRead] = useState<{ url: string; tone: string | null } | null>(null);
  useEffect(() => {
    if (!url || toneCache.has(url)) return;
    const src = /^https:\/\//.test(url)
      ? `/api/img-proxy?url=${encodeURIComponent(url)}&w=96`
      // blob:/data: (a just-picked file) and same-origin paths (the
      // marketing demo's /marketing/ photos) are read directly.
      : /^(blob:|data:image\/|\/(?!\/))/.test(url) ? url : null;
    if (!src) return;
    let live = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let tone: string | null = null;
      try {
        const S = PHOTO_TONE_SAMPLE;
        const canvas = document.createElement("canvas");
        canvas.width = S; canvas.height = S;
        const ctx = canvas.getContext("2d");
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        if (ctx && side > 0) {
          ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, S, S);
          tone = toneFromPixels(ctx.getImageData(0, 0, S, S).data, S, S);
        }
      } catch { /* tainted or undecodable — keep the fallback colours */ }
      toneCache.set(url, tone);
      if (live) setRead({ url, tone });
    };
    img.onerror = () => {
      toneCache.set(url, null);
      if (live) setRead({ url, tone: null });
    };
    img.src = src;
    return () => { live = false; };
  }, [url]);
  if (!url) return null;
  if (toneCache.has(url)) return toneCache.get(url) ?? null;
  return read?.url === url ? read.tone : null;
}
