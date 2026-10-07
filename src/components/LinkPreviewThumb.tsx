"use client";

import { useEffect, useState } from "react";
import { faviconFor } from "@/lib/link-brand";
import { videoThumbnail } from "@/lib/video";
import { fetchLinkPreview, type LinkPreview } from "@/lib/link-preview-client";

// Small square link-preview thumbnail for the card editor's "Additional links"
// rows, so a link visibly HAS a preview the moment it's added — the same
// picture the public Swift Links tile uses (a video's frame, else the page's
// og:image via /api/link-preview) and the same logo (/api/link-icon), so what
// you see here is what renders there. Always shows something: picture →
// picture through the image proxy → the site's logo → a link glyph, so a row
// never looks empty or broken.

function fullHref(url: string) {
  const v = (url || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v.replace(/^\/+/, "")}`;
}

export default function LinkPreviewThumb({ url }: { url: string }) {
  const [pv, setPv] = useState<LinkPreview | null>(null);
  // 0 = the picture as-is, 1 = through /api/img-proxy, 2 = no picture.
  const [imgStage, setImgStage] = useState<0 | 1 | 2>(0);
  const [iconFailed, setIconFailed] = useState(false);

  const href = fullHref(url);
  const video = videoThumbnail(href);

  useEffect(() => {
    // Clear the PREVIOUS url's preview before fetching the new one. Without
    // this the old thumbnail stays on screen next to the new link until the
    // fetch lands, which reads as the wrong preview rather than a loading one.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset stale preview before refetch
    setPv(null);
    setImgStage(0);
    setIconFailed(false);
    if (!href || video) return;
    let cancelled = false;
    fetchLinkPreview(href).then((d) => { if (!cancelled) setPv(d); });
    return () => { cancelled = true; };
  }, [href, video]);

  const picture = video || pv?.image || null;
  const img = !picture || imgStage === 2 ? null : imgStage === 1 ? `/api/img-proxy?url=${encodeURIComponent(picture)}&w=160` : picture;
  const icon = href && !iconFailed ? faviconFor(href) : null;

  return (
    <span className="shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-gray-800 border border-gray-700 flex items-center justify-center">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgStage((s) => (s === 0 ? 1 : 2))}
        />
      ) : icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={icon}
          alt=""
          className="w-5 h-5 object-contain"
          loading="lazy"
          // Server-rendered: a 404 (site with no logo) that lands before
          // hydration fires no onError — read it off the element instead.
          ref={(el) => { if (el?.complete && el.naturalWidth === 0) setIconFailed(true); }}
          onError={() => setIconFailed(true)}
        />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={2} className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
        </svg>
      )}
    </span>
  );
}
