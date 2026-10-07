"use client";

import { useEffect, useRef, useState } from "react";
import { faviconFor, monogramFor, monogramTint } from "@/lib/link-brand";

// A link's little brand mark: its favicon, over a coloured monogram.
//
// The monogram is painted FIRST and always — the favicon is a lazy image that
// cross-fades on top of it. That ordering is the whole point: a favicon-only
// mark is an empty box until the icon arrives, on a page opened over mobile
// data right after a QR scan. If the request is slow, blocked, or the site has
// no icon (/api/link-icon answers 404), the monogram stays and the row still
// looks designed.
export default function LinkMark({ url, size = 16 }: { url: string; size?: number }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const src = faviconFor(url);
  const showFavicon = loaded && !failed;

  // This mark is server-rendered, so the browser fetches the icon while the
  // page's JavaScript is still downloading — and an icon that arrives first
  // fires its load event before React has attached onLoad. Missed, the logo
  // sat fully downloaded at opacity 0 behind the monogram forever (measured on
  // the live card page 2026-10-07: every row on WebKit, most on Chromium). So
  // on mount, read what already happened. (An error that fired early needs no
  // adopting: unloaded, the image is already invisible over the monogram.)
  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, [src]);

  return (
    <span className="relative inline-grid place-items-center shrink-0" style={{ width: size, height: size }}>
      <span
        aria-hidden
        className="absolute inset-0 grid place-items-center font-bold text-white transition-opacity duration-200"
        style={{
          background: monogramTint(url),
          borderRadius: Math.max(3, Math.round(size * 0.28)),
          fontSize: Math.max(8, Math.round(size * 0.56)),
          lineHeight: 1,
          opacity: showFavicon ? 0 : 1,
        }}
      >
        {monogramFor(url)}
      </span>
      {src && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="relative object-contain transition-opacity duration-200"
          style={{ width: size, height: size, opacity: loaded ? 1 : 0 }}
        />
      )}
    </span>
  );
}
