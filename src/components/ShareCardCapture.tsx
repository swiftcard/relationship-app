"use client";

// Renders the user's card EXACTLY as it appears on the public card page, then
// rasterizes it pixel-perfect (html-to-image, browser engine) and uploads it so
// the card's share-link preview (Open Graph image) is a real picture of the
// card — identical to the card it links to. Runs invisibly on the dashboard for
// the active card; re-captures only when THAT card's content changes.

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { CardData } from "@/components/card-templates/types";
import { withoutSocials } from "@/components/card-templates/types";
import { warmSharePreview } from "@/lib/share-preview";
import { capturePainted } from "@/lib/capture-verify";
import { SHARE_CAPTURE_VERSION } from "@/lib/share-capture-version";

const ClassicPro    = dynamic(() => import("@/components/card-templates/ClassicPro"),    { ssr: false });
const ModernBold    = dynamic(() => import("@/components/card-templates/ModernBold"),    { ssr: false });
const PhotoFirst    = dynamic(() => import("@/components/card-templates/PhotoFirst"),    { ssr: false });
const LocalBusiness = dynamic(() => import("@/components/card-templates/LocalBusiness"), { ssr: false });
const LuxuryMinimal = dynamic(() => import("@/components/card-templates/LuxuryMinimal"), { ssr: false });
const LogoFirst     = dynamic(() => import("@/components/card-templates/LogoFirst"),     { ssr: false });
const CustomCard    = dynamic(() => import("@/components/card-templates/CustomCard"),    { ssr: false });

const TEMPLATE_MAP: Record<string, React.ComponentType<{ data: CardData }>> = {
  "classic-pro": ClassicPro, "modern-bold": ModernBold, "photo-first": PhotoFirst,
  "local-business": LocalBusiness, "luxury-minimal": LuxuryMinimal, "logo-first": LogoFirst,
  "custom": CustomCard,
};

const NATURAL = 460;   // same natural card width the public page renders at
const CARD_BG = "#FAF7F2"; // the public card page background (shows at the card's rounded corners)

// Short stable hash (djb2) so we only re-capture when this card's content changes.
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Fetch a URL and turn it into a data: URL. Used to INLINE the photo/logo into
// the card node before rasterizing (see inlineImages).
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Replace every <img> src with an inlined data URL BEFORE capturing. html-to-image
// otherwise re-fetches each image while rasterizing, which (with a slow/cache-miss
// proxy) intermittently DROPPED the headshot/logo and shipped a card-share image
// missing the photo — the exact "sometimes my picture doesn't show" bug. Once the
// src is a data URL there's nothing to re-fetch, so the image always embeds.
// Returns false if ANY image failed to embed (proxied AND un-proxied), so the
// caller can reject the capture instead of poisoning storage with a photo-less one.
async function inlineImages(el: HTMLElement, fallbackSrc: Map<string, string>): Promise<boolean> {
  const imgs = Array.from(el.querySelectorAll("img"));
  const results = await Promise.all(imgs.map(async (img) => {
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) return true; // nothing to inline — not a failure
    const fallback = fallbackSrc.get(src);
    const candidates = fallback ? [src, fallback] : [src];
    for (const candidate of candidates) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const dataUrl = await fetchAsDataUrl(candidate);
        if (!dataUrl) continue;
        // Count it embedded only when the data URL actually DECODES (naturalWidth
        // > 0) — a proxy 200 with an HTML error body would otherwise pass yet
        // render as a broken image. A failed decode retries / rejects the capture.
        const decoded = await new Promise<boolean>((resolve) => {
          img.onload = () => resolve(img.naturalWidth > 0);
          img.onerror = () => resolve(false);
          img.src = dataUrl;
          setTimeout(() => resolve(img.naturalWidth > 0), 3000);
        });
        if (decoded) return true;
      }
    }
    return false; // every attempt failed to embed this image
  }));
  return results.every(Boolean);
}

// PNG dimensions straight from the header (width @ byte 16, height @ byte 20)
// of a data:image/png;base64 URL — no Image() round-trip needed.
function pngDims(dataUrl: string): { w: number; h: number } | null {
  try {
    const bin = atob(dataUrl.slice("data:image/png;base64,".length, "data:image/png;base64,".length + 44));
    const at = (i: number) =>
      (bin.charCodeAt(i) << 24) | (bin.charCodeAt(i + 1) << 16) | (bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3);
    const w = at(16) >>> 0, h = at(20) >>> 0;
    return w > 0 && h > 0 ? { w, h } : null;
  } catch {
    return null;
  }
}

export default function ShareCardCapture({
  cardData,
  template,
  username,
}: {
  cardData: CardData;
  template: string;
  username: string;
}) {
  // Only true once we know a fresh capture is due (stored hash ≠ current). Until
  // then the off-screen card isn't rendered at all — so a normal dashboard load
  // where the card hasn't changed pays ZERO render cost for this component.
  const [needsCapture, setNeedsCapture] = useState(false);
  // Photo/logo already resolved to data: URLs, so REACT renders them that way.
  //
  // This exists because inlining by mutating `img.src` after the fact is not
  // safe: React owns those <img> elements, and anything that re-renders this
  // component between the mutation and the rasterize silently restores the
  // original src. The lazy `dynamic()` template chunk resolving does exactly
  // that, and the window is wide — inlining is followed by `await
  // document.fonts.ready` plus a settle delay. The result was a capture whose
  // headshot <img> was back to a cross-origin URL that html-to-image then
  // dropped, producing a card with the photo panel rendered empty. That is the
  // "my picture doesn't show when I text my link" bug, and it is why the
  // existing guard never caught it: the image DID inline and decode, it was
  // just undone afterwards.
  //
  // Feeding data URLs in as props removes the race entirely — there is no
  // original src to restore.
  const [resolved, setResolved] = useState<{ photoUrl: string | null; logoUrl: string | null } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const capturingRef = useRef(false);
  const Template = TEMPLATE_MAP[template] ?? ClassicPro;

  // Capture-logic version. Bump to force a global re-capture
  // ("v8" = the name/logo/photo verified in the PIXELS, not just the DOM;
  // "v7" = photo/logo resolved to data URLs BEFORE render, so a re-render can't
  // undo the inlining; "v6" = wait for web fonts + verify each inlined image
  // actually decodes; "v5" = images inlined + reject on missing; "v4" = max-space
  // sizing, banner-aware logos).
  const contentSig = `share-v${SHARE_CAPTURE_VERSION}|` + hashStr(JSON.stringify(cardData) + "|" + template);
  const hashKey = `sc_sharehash_${username}`;

  // Photo/logo through a same-origin proxy so the browser can read them into the canvas.
  const proxy = (u?: string | null) => (u && /^https?:\/\//.test(u) ? `/api/img-proxy?url=${encodeURIComponent(u)}` : u ?? null);
  const captureData = {
    ...cardData,
    // The panel photo lives in customization and is painted through a CSS
    // url(), so html-to-image has to be able to read it into the canvas too —
    // a cross-origin one taints it and the whole capture comes back blank.
    // A panel VIDEO cannot rasterise at all, so its poster frame is what the
    // downloaded card shows; that is the same still every non-browser surface
    // already paints (lib/template-style.ts, panelBackground).
    customization: (() => {
      const c = (cardData as { customization?: Record<string, unknown> }).customization;
      if (!c || (!c.panelMedia && !c.panelMediaPoster)) return c;
      return {
        ...c,
        ...(c.panelMedia ? { panelMedia: proxy(c.panelMedia as string) } : {}),
        ...(c.panelMediaPoster ? { panelMediaPoster: proxy(c.panelMediaPoster as string) } : {}),
      };
    })(),
    // Prefer the pre-resolved data URL; fall back to the proxied URL so the
    // node still renders (and inlineImages can still try) if resolving failed.
    photoUrl: resolved?.photoUrl ?? proxy(cardData.photoUrl),
    logoUrl: resolved?.logoUrl ?? proxy((cardData as { logoUrl?: string | null }).logoUrl),
  } as CardData;

  // Rasterize the card once. Every image (photo/logo) must be loaded first so
  // the capture shows the whole card. A timeout stops a rare html-to-image hang
  // (font/resource embedding) from wedging the capture forever.
  async function renderOnce(): Promise<string | null> {
    const el = cardRef.current;
    if (!el) return null;
    // Wait for the lazy template to render…
    for (let i = 0; i < 80 && el.offsetHeight < 120; i++) await new Promise((r) => setTimeout(r, 100));
    // …and for its images (photo/logo) to load so they're in the capture.
    const imgs = Array.from(el.querySelectorAll("img"));
    await Promise.all(imgs.map((img) => (img.complete && img.naturalWidth > 0)
      ? Promise.resolve()
      : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); setTimeout(() => r(), 6000); })));

    // INLINE the photo/logo as data URLs so html-to-image can't drop them while
    // rasterizing (the intermittent "picture doesn't show in the share preview"
    // bug). Fall back from the same-origin proxy to the un-proxied source. If any
    // image still won't embed, REJECT this attempt — better to keep the previous
    // (or rendered-fallback) preview than upload a card missing its headshot.
    const fallbackSrc = new Map<string, string>();
    const proxiedPhoto = captureData.photoUrl;
    if (proxiedPhoto && cardData.photoUrl && proxiedPhoto !== cardData.photoUrl) {
      fallbackSrc.set(proxiedPhoto, cardData.photoUrl);
    }
    const proxiedLogo = (captureData as { logoUrl?: string | null }).logoUrl;
    const originalLogo = (cardData as { logoUrl?: string | null }).logoUrl;
    if (proxiedLogo && originalLogo && proxiedLogo !== originalLogo) {
      fallbackSrc.set(proxiedLogo, originalLogo);
    }
    let inlined = await inlineImages(el, fallbackSrc);
    if (!inlined) {
      await new Promise((r) => setTimeout(r, 400)); // transient proxy hiccup — one retry
      inlined = await inlineImages(el, fallbackSrc);
    }
    if (!inlined) return null;

    // A card that HAS a headshot must show one in the capture. inlineImages
    // reports success over `results.every(...)`, which is vacuously true for an
    // empty list — so a node that somehow rendered no <img> at all passed the
    // check and shipped a photo-less card. Assert the thing we actually care
    // about instead: a decoded, embedded photo is present. Rejecting keeps the
    // previous preview (or the server-rendered fallback, which embeds the photo
    // itself) rather than storing a card with an empty photo panel.
    if (cardData.photoUrl) {
      const embeddedPhoto = Array.from(el.querySelectorAll("img")).some(
        (img) => (img.currentSrc || img.src || "").startsWith("data:") && img.naturalWidth > 0,
      );
      if (!embeddedPhoto) return null;
    }

    // Wait for web fonts before rasterizing so text can't bake in a fallback
    // font (wrong metrics / clipped) or unpainted glyphs; then let reflow settle.
    try { await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* fonts API absent */ }
    await new Promise((r) => setTimeout(r, 200)); // let fonts/reflow settle

    // Render the node NATIVELY larger (transform scale) rather than bumping
    // pixelRatio: foreignObject rasterizes at 1x and pixelRatio only upscales
    // (blurry), so scaling the node up keeps text crisp at full resolution.
    // No cacheBust: the node was just freshly rendered (nothing stale to bust),
    // and appending cache-bust queries to every resource is a common hang cause.
    const { toPng } = await import("html-to-image");
    const w = el.offsetWidth || NATURAL;
    const h = el.offsetHeight || NATURAL;
    const SCALE = 4;
    const raster = () => Promise.race([
      toPng(el, {
        width: w * SCALE,
        height: h * SCALE,
        pixelRatio: 1,
        cacheBust: false,
        backgroundColor: CARD_BG,
        style: { transform: `scale(${SCALE})`, transformOrigin: "top left" },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20000)),
    ]);
    const dataUrl = await raster();
    if (!dataUrl || dataUrl.length < 5000) return null; // blank / timed out

    // Pre-flight: a real card capture is landscape (~1.35–1.75:1). Anything
    // else means the template didn't lay out (e.g. a browser without
    // aspect-ratio support captured a square) — treat as a failed attempt so
    // we retry and, failing that, keep the previous/fallback preview instead
    // of poisoning storage with a wrong image.
    const dims = pngDims(dataUrl);
    if (!dims) return null;
    const ratio = dims.w / Math.max(1, dims.h);
    if (ratio < 1.25 || ratio > 2.4) return null;

    // The name, logo and photo must be IN the picture, not just in the DOM —
    // WebKit can paint the card before they decode (lib/capture-verify).
    if (!(await capturePainted(el, cardData.name ?? "", dataUrl, w, raster))) return null;

    return dataUrl;
  }

  async function captureAndUpload() {
    if (!username || !/^[a-z0-9-]{1,40}$/i.test(username)) return;
    if (capturingRef.current) return;
    capturingRef.current = true;
    try {
      // Retry a couple of times — a first attempt can time out while fonts/images
      // warm up; a retry then succeeds. The OG route serves a rendered fallback
      // until a real capture lands, so previews never break in the meantime.
      let dataUrl: string | null = null;
      for (let attempt = 0; attempt < 3 && !dataUrl; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
        dataUrl = await renderOnce().catch(() => null);
      }
      if (!dataUrl) return;
      const res = await fetch("/api/card-share-image", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl, username, v: SHARE_CAPTURE_VERSION }),
      });
      if (res.ok) {
        try { localStorage.setItem(hashKey, contentSig); } catch { /* ignore */ }
        // The edge may be holding the stand-in render for this version (the
        // Share button warmed it before this capture existed). One fetch is
        // what swaps it for the real card, so make it now rather than leave
        // it to the next person's messenger.
        warmSharePreview(`${window.location.origin}/${username}`);
      }
    } catch {
      /* best-effort — the OG route falls back to a rendered approximation */
    } finally {
      capturingRef.current = false;
    }
  }

  // On load / whenever this card's content changes: if the stored capture is
  // already current, render nothing and do nothing. Only when it's stale do we
  // mount the off-screen card and (re)generate — so the share preview always
  // matches the current card, without re-rendering the template every visit.
  useEffect(() => {
    let prev = "";
    try { prev = localStorage.getItem(hashKey) || ""; } catch { /* ignore */ }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      // This device captured this exact content before. That is not proof the
      // server still HAS it: every save deletes the stored capture, and a
      // device whose note already matches never re-captures. Ask the server;
      // only a capture it will actually serve counts as up to date.
      if (prev === contentSig) {
        try {
          const r = await fetch(`/api/card-share-image?username=${encodeURIComponent(username)}`, { cache: "no-store" });
          if (!r.ok) return; // signed out / not this owner's card — nothing to do
          const { current } = (await r.json()) as { current?: boolean };
          if (current) return; // up to date — nothing to render or capture
        } catch {
          return;
        }
        if (cancelled) return;
      }

      // Resolve the photo/logo to data URLs BEFORE the card is rendered, so the
      // <img> elements are born with an embedded source. Each falls back from
      // the same-origin proxy to the raw URL, and to null (the template then
      // draws its initials avatar, which is honest — better than an empty
      // panel). Failure here is not fatal: the render still gets the proxied
      // URL and inlineImages remains as the backstop.
      const [photoUrl, logoUrl] = await Promise.all([
        (async () => {
          const raw = cardData.photoUrl;
          if (!raw) return null;
          return (await fetchAsDataUrl(proxy(raw) as string)) ?? (await fetchAsDataUrl(raw));
        })(),
        (async () => {
          const raw = (cardData as { logoUrl?: string | null }).logoUrl;
          if (!raw) return null;
          return (await fetchAsDataUrl(proxy(raw) as string)) ?? (await fetchAsDataUrl(raw));
        })(),
      ]);
      if (cancelled) return;
      setResolved({ photoUrl, logoUrl });
      setNeedsCapture(true);
      timer = setTimeout(() => { captureAndUpload(); }, 800);
    })();

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, contentSig]);

  if (!needsCapture) return null;

  // Hidden, off-screen render of the card EXACTLY as the public page shows it
  // (withoutSocials for standard templates; QR kept; natural sizing).
  // inert as well as aria-hidden: this is a real card, and it contains links.
  // aria-hidden alone left them in the tab order — you could Tab into a card
  // nobody can see (axe: aria-hidden-focus).
  //
  // Square corners, no shadow: the picture IS the card, edge to edge. Messages,
  // WhatsApp and Slack round the preview themselves, at their own radius, so
  // the card's own rounded corners showed the page colour and the drop shadow
  // as light wedges and a grey halo in every corner (owner, 2026-10-06: "make
  // sure … it fits the corners properly, and that it looks very clean").
  // !important because each template sets its shadow inline.
  return (
    <div aria-hidden inert style={{ position: "absolute", left: -10000, top: 0, width: NATURAL, pointerEvents: "none", opacity: 0.01 }}>
      <style>{`.sc-share-capture > *, .sc-share-capture .sc-card { border-radius: 0 !important; box-shadow: none !important; }`}</style>
      <div ref={cardRef} className="sc-share-capture" style={{ width: NATURAL, background: CARD_BG }}>
        <Template data={template === "custom" ? captureData : withoutSocials(captureData)} />
      </div>
    </div>
  );
}
