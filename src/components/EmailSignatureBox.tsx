"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { CardData } from "@/components/card-templates/types";
import { withoutSocials } from "@/components/card-templates/types";
import { SIGNATURE_STALE_EVENT } from "@/components/LinksPageTabs";

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
const NATURAL = 460;       // same natural card width the public page renders at
const CARD_BG = "#FAF7F2"; // the public card page background (shows at the card's rounded corners)
/** A macrotask break: input queued during a long capture pass runs before the next one. */
const yieldToInput = () => new Promise<void>((r) => setTimeout(r, 0));

type Props = {
  cardData: CardData;
  template: string;
  name: string;
  company: string;
  cardUrl: string;
  /** The on-screen preview's link to the owner's own card (lib/self-pass): opening it is not counted as a view. Never used in the copied signature. */
  previewHref?: string;
  username: string;
  storageUrl: string;
  ogUrl: string;
};

import { legacySignatureContentSigV12, signatureContentSig } from "@/lib/signature-content";
import { escapeHtml } from "@/lib/escape";

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
// otherwise re-fetches each image while rasterizing, which (with cache-busting or
// a slow proxy MISS) was dropping the photo/logo and leaving a blank panel. Once
// the src is a data URL there's nothing to fetch — the image always embeds.
//
// Was previously "best effort": a failed fetch just kept the original (non-data)
// src and moved on, so a transient proxy hiccup silently shipped a signature
// missing the headshot/logo instead of failing loudly. Now every image must
// actually become a data URL (retrying, and falling back to the un-proxied
// source) or the whole capture is rejected by the caller.
async function inlineImages(el: HTMLElement, fallbackSrc: Map<string, string>): Promise<boolean> {
  const imgs = Array.from(el.querySelectorAll("img"));
  const results = await Promise.all(imgs.map(async (img) => {
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) return true; // nothing to inline — not a failure
    const fallback = fallbackSrc.get(src);
    const candidates = fallback ? [src, fallback] : [src];
    for (const candidate of candidates) {
      // A couple of attempts per candidate — proxy/hosts sometimes fail transiently.
      for (let attempt = 0; attempt < 2; attempt++) {
        const dataUrl = await fetchAsDataUrl(candidate);
        if (!dataUrl) continue;
        // Count it embedded ONLY when the data URL actually DECODES (naturalWidth
        // > 0). A proxy that answered 200 with an HTML error page would otherwise
        // pass the old `startsWith("data:")` check yet render as a broken image —
        // exactly the "headshot missing" glitch. A failed decode falls through to
        // the next candidate / retry, and ultimately rejects the whole capture.
        const decoded = await new Promise<boolean>((resolve) => {
          img.onload = () => resolve(img.naturalWidth > 0);
          img.onerror = () => resolve(false);
          img.src = dataUrl;
          setTimeout(() => resolve(img.naturalWidth > 0), 3000);
        });
        if (decoded) return true;
      }
    }
    return false; // every attempt (proxied AND un-proxied) failed to embed this image
  }));
  return results.every(Boolean);
}

function CardPreview({ src, ready, status, onLoad, onError }: {
  src: string | null; ready: boolean; status: "idle" | "working" | "error"; onLoad: () => void; onError: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-700/60 bg-white overflow-hidden relative min-h-[120px] flex items-center justify-center">
      {/* Loaded EAGERLY, never loading="lazy": this image is display:none until
          it has loaded (the placeholder shows instead), and a browser never
          fetches a lazy image that isn't displayed — so it never loaded, and
          the box sat on "Generating your card…" for good (2026-10-07). Eager,
          it loads while the page still shows Swift Links, ready for the switch. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} onLoad={onLoad} onError={onError} alt="Your card" className={`w-full block ${ready ? "" : "hidden"}`} />}
      {!ready && (
        <span className="text-gray-400 text-xs py-10 px-4 text-center">
          {status === "error" ? "Couldn't generate your card. Tap Copy signature to try again." : "Generating your card…"}
        </span>
      )}
    </div>
  );
}

/** A short, stable tag for a content hash — the version on a hosted image URL
 *  whose exact capture time this device didn't record. */
function sigTag(sig: string): string {
  let h = 2166136261;
  for (let i = 0; i < sig.length; i++) h = Math.imul(h ^ sig.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

// Name and company are owner- (or office-) typed and go into HTML the user
// pastes into every outgoing email: escaped, so a "<" or "&" can't break the
// signature and an office value can't inject markup into members' mail.
function buildSignatureHtml(rawName: string, rawCompany: string, rawCardUrl: string, rawImgUrl: string): string {
  const name = escapeHtml(rawName);
  const company = escapeHtml(rawCompany);
  const cardUrl = escapeHtml(rawCardUrl);
  const imgUrl = escapeHtml(rawImgUrl);
  const header = `<div style="font-size:14px;color:#111827;margin-bottom:6px;"><strong>${name}</strong>${company ? ` | ${company}` : ""}</div>`;
  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;"><tr><td style="padding:0;">
${header}
<a href="${cardUrl}" target="_blank" style="text-decoration:none;"><img src="${imgUrl}" alt="${name} — business card" width="360" style="display:block;width:100%;max-width:360px;height:auto;border:0;border-radius:12px;" /></a>
<div style="margin-top:8px;font-size:14px;"><a href="${cardUrl}" target="_blank" style="color:#2563eb;text-decoration:none;font-weight:bold;">Contact me</a></div>
</td></tr></table>`;
}

export default function EmailSignatureBox({ cardData, template, name, company, cardUrl, previewHref, username, storageUrl }: Props) {
  // The Copy button is ALWAYS ready (owner, 2026-10-07: "it's a very simple
  // button to click"). It never waits on the preview and is never greyed out by
  // a capture running in the background: one tap copies straight away when the
  // image is current, and otherwise asks for the copy in that same tap and
  // lets the browser wait for the one capture it needs.
  const [copyState, setCopyState] = useState<"idle" | "copying" | "generating" | "copied" | "error">("idle");
  // The preview and the capture behind it — what the picture shows, never
  // whether you may tap Copy.
  const [capture, setCapture] = useState<"idle" | "working" | "error">("idle");
  // null until mounted: the src is chosen on the client (a device that already
  // holds a fresh image shows that one), so the server never starts a fetch of
  // a URL the client immediately swaps out.
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // The one capture in flight, shared by everyone who needs it (the automatic
  // refresh, a 404'd preview, a tap on Copy) — never two at once.
  const captureRef = useRef<Promise<string | null> | null>(null);
  // False once this box has left the screen: an automatic capture still in
  // flight stops at its next checkpoint instead of running on under the next page.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  const lastUrlRef = useRef<string | null>(null);
  const lastSigRef = useRef<string | null>(null); // content hash the image at lastUrlRef was captured from
  // True when lastUrlRef came from a capture made on this page (not from
  // device memory): if THAT image fails to load, capturing again won't help.
  const capturedHereRef = useRef(false);
  const Template = TEMPLATE_MAP[template] ?? ClassicPro;
  // Freshness is keyed to THIS card's username + a hash of its own content (+ a code
  // version). Re-captures exactly when the CARD IMAGE's content changes — card
  // info, card design, template — and never for Swift Links page edits (bio,
  // links, Looks), which the signature cannot show; see lib/signature-content.
  // Never reuses another card's image. "v12" bump = WebKit warm-up passes +
  // explicit font embed CSS, so WKWebView/Safari captures stop shipping without
  // the photo or in a fallback font.
  const contentSig = signatureContentSig(cardData, template, cardUrl);
  const hashKey = `sc_sighash_${username}`;
  // The cache-busted URL of the last image this device captured, kept with the
  // hash above. When the hash still matches the card, that image IS the card:
  // Copy uses it at once instead of capturing again (which, on a phone, was
  // seconds of work on every first tap — and on an iPhone made that tap fail).
  const urlKey = `sc_sigurl_${username}`;
  // Separate from hashKey (which tracks the last CAPTURE): this tracks the last
  // content the user actually COPIED into their email. If the card design has
  // changed since then, the signature already pasted in their inbox is stale —
  // and email apps cache the old image for ~a day unless they re-copy & paste a
  // fresh (cache-busted) URL. We surface a prompt so they know to do exactly that.
  const copiedKey = `sc_sigcopied_${username}`;
  const [changedSinceCopy, setChangedSinceCopy] = useState(false);
  // The Links page shows one side at a time, so the re-copy note below can sit
  // behind the Swift Links side. Tell the switch, which puts a dot on this tab.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(SIGNATURE_STALE_EVENT, { detail: changedSinceCopy }));
  }, [changedSinceCopy]);

  // Photo/logo through a same-origin proxy so html2canvas can read them.
  const proxy = (u?: string | null) => (u && /^https?:\/\//.test(u) ? `/api/img-proxy?url=${encodeURIComponent(u)}` : u ?? null);
  const captureData = {
    ...cardData,
    photoUrl: proxy(cardData.photoUrl),
    logoUrl: proxy((cardData as { logoUrl?: string | null }).logoUrl),
  } as CardData;

  async function runCapture(): Promise<string | null> {
    // Never capture/upload without a real card identity (defensive: the dashboard
    // only renders this with a selected card, but guard against any path collision).
    if (!username || !/^[a-z0-9-]{1,40}$/i.test(username)) return null;
    if (!aliveRef.current) return null;
    setCapture("working");
    try {
      const el = cardRef.current;
      if (!el) { setCapture("error"); return null; }
      // Wait for the lazy-loaded template to actually render…
      for (let i = 0; i < 80 && el.offsetHeight < 150; i++) await new Promise((r) => setTimeout(r, 100));
      // …then inline the photo/logo as data URLs so they always embed (this is
      // what makes the signature a faithful copy of the real card). Falls back
      // to the un-proxied source if the same-origin proxy fetch fails.
      const fallbackSrc = new Map<string, string>();
      if (captureData.photoUrl && cardData.photoUrl && captureData.photoUrl !== cardData.photoUrl) {
        fallbackSrc.set(captureData.photoUrl, cardData.photoUrl);
      }
      const proxiedLogo = (captureData as { logoUrl?: string | null }).logoUrl;
      const originalLogo = (cardData as { logoUrl?: string | null }).logoUrl;
      if (proxiedLogo && originalLogo && proxiedLogo !== originalLogo) {
        fallbackSrc.set(proxiedLogo, originalLogo);
      }
      let inlined = await inlineImages(el, fallbackSrc);
      if (!inlined) {
        // One retry from scratch — proxy hiccups are usually transient.
        await new Promise((r) => setTimeout(r, 400));
        inlined = await inlineImages(el, fallbackSrc);
      }
      // Refuse to ship a signature that's missing the photo/logo — better to
      // say "couldn't generate" and let a tap try again than silently upload one
      // that's forgotten pieces of the real card.
      if (!inlined) { setCapture("error"); return null; }

      // NO modifications to the card here — the signature is a PIXEL-EXACT copy of
      // the real SwiftCard: same fonts, sizes, placement, photo, logo, and the QR
      // (all rendered by the identical template at the identical NATURAL width the
      // public card page uses). The wording is deliberately NOT enlarged and the QR
      // is deliberately NOT hidden, so it matches the card the visitor sees 1:1.

      // Wait for web fonts to finish loading BEFORE rasterizing — otherwise the
      // capture can bake in a fallback font (wrong metrics, clipped/oddly-wrapped
      // text) or, worse, glyphs that haven't painted yet. Then a short settle so
      // reflow is done and every capture is byte-deterministic.
      try { await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* fonts API absent — best effort */ }
      await new Promise((r) => setTimeout(r, 200));

      // html-to-image renders via the browser engine (SVG foreignObject), so it
      // supports Tailwind v4's oklch() colors — html2canvas does not and was throwing.
      // Render the card NATIVELY larger (transform scale) rather than bumping pixelRatio:
      // foreignObject HTML rasterizes at 1x and pixelRatio only upscales it (blurry), so
      // scaling the node up makes the text crisp at full resolution.
      const { toPng, getFontEmbedCSS } = await import("html-to-image");
      const w = el.offsetWidth || NATURAL;
      const h = el.offsetHeight || NATURAL;
      const SCALE = 4;
      // Resolve @font-face CSS once and pass it explicitly: WebKit won't apply a
      // web font (Geist, via var(--font-geist-sans)) inside the SVG foreignObject
      // unless its data is inlined in the capture itself — without this the text
      // rasterizes in a fallback font with different metrics (overlapping /
      // clipped "messed up" letters).
      const fontEmbedCSS = await getFontEmbedCSS(el).catch(() => undefined);
      const opts = {
        width: w * SCALE,
        height: h * SCALE,
        pixelRatio: 1,
        cacheBust: false, // images are already inlined; cache-busting was dropping the photo
        backgroundColor: CARD_BG, // the card page's background, so corners match exactly
        style: { transform: `scale(${SCALE})`, transformOrigin: "top left" },
        ...(fontEmbedCSS ? { fontEmbedCSS } : {}),
      };
      // WebKit (the iOS shell's WKWebView, and desktop Safari) paints
      // foreignObject lazily: the first draw of the generated SVG routinely
      // skips images and freshly-embedded fonts, which is exactly the
      // "photo missing, letters messed up" signature bug. Two discarded
      // warm-up passes let WebKit decode everything; the third is complete.
      // Chromium/Firefox don't need it, so they skip the extra work.
      const isWebKit = /AppleWebKit/i.test(navigator.userAgent) && !/Chrome|Chromium|Edg\/|Android/i.test(navigator.userAgent);
      // Each pass holds the main thread for a second or more on a phone.
      // Between passes, hand it back so a waiting tap is handled — and if that
      // tap left the page, stop: the next screen must not pay for this one.
      const stillWanted = async () => { await yieldToInput(); return aliveRef.current; };
      if (isWebKit) {
        if (!(await stillWanted())) return null;
        await toPng(el, opts).catch(() => undefined);
        if (!(await stillWanted())) return null;
        await toPng(el, opts).catch(() => undefined);
      }
      if (!(await stillWanted())) return null;
      const dataUrl = await toPng(el, opts);
      if (!dataUrl || dataUrl.length < 5000) { setCapture("error"); return null; } // blank guard
      if (!aliveRef.current) return null;
      const res = await fetch("/api/card-signature", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl, username }),
      });
      if (!res.ok) { setCapture("error"); return null; }

      const url = `${storageUrl}?t=${Date.now()}`;
      lastUrlRef.current = url;
      lastSigRef.current = contentSig;
      capturedHereRef.current = true;
      setDisplaySrc(url);
      setCapture("idle");
      try {
        localStorage.setItem(hashKey, contentSig);
        localStorage.setItem(urlKey, url);
      } catch { /* ignore */ }
      return url;
    } catch {
      setCapture("error");
      return null;
    }
  }

  // Start a capture, or join the one already running.
  function captureAndUpload(): Promise<string | null> {
    if (captureRef.current) return captureRef.current;
    const p = runCapture().finally(() => { captureRef.current = null; });
    captureRef.current = p;
    return p;
  }

  const isFresh = () => lastSigRef.current === contentSig && !!lastUrlRef.current;

  // The capture is seconds of main-thread work on a phone (three passes on
  // WebKit), and it used to start 500ms in — exactly while the page was
  // hydrating and the person reaching for a tab, which then did nothing for
  // several seconds (2026-09-24 speed review). In the background, let the page
  // settle and start when the browser is idle; when the person is looking at
  // this side (delay 0), start now. Copy never waits for this — it joins it.
  function scheduleCapture(delay = 1500): () => void {
    const t = setTimeout(() => {
      // Already current (another trigger got there first) — nothing to redo.
      if (isFresh() || captureRef.current) return;
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric && delay > 0) ric(() => { void captureAndUpload(); }, { timeout: 3000 });
      else void captureAndUpload();
    }, delay);
    return () => clearTimeout(t);
  }

  // On load / whenever THIS card's content changes: regenerate from the real card so the
  // image always matches the currently-selected card. Keyed to username+content hash, so
  // it never reuses or is triggered by a different card.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- image capture only runs client-side
    setMounted(true);
    // Prompt to re-copy only if they've copied at least once AND the card has
    // changed since — a fresh account with no prior copy shows no nag.
    // A mark stored under the v12 hash (which still counted socials) that
    // matches the card as it is now means nothing changed — carry it over, so
    // the hash format change itself never asks anyone to re-copy or re-capture.
    const carry = (key: string): string => {
      const stored = localStorage.getItem(key) || "";
      if (stored && stored.startsWith("v12|") && stored === legacySignatureContentSigV12(cardData, template, cardUrl)) {
        localStorage.setItem(key, contentSig);
        return contentSig;
      }
      return stored;
    };
    try {
      const copied = carry(copiedKey);
      setChangedSinceCopy(!!copied && copied !== contentSig);
    } catch { /* ignore */ }
    let prev = "";
    let savedUrl = "";
    try {
      prev = carry(hashKey);
      savedUrl = localStorage.getItem(urlKey) || "";
    } catch { /* ignore */ }
    if (prev === contentSig) {
      // This device captured this exact content: the hosted image is the card.
      // Copy can use it at once. (A capture from before the URL was remembered
      // gets a version tag from the content, so mail apps still fetch it fresh.)
      const url = savedUrl.startsWith(`${storageUrl}?`) ? savedUrl : `${storageUrl}?v=${sigTag(contentSig)}`;
      lastUrlRef.current = url;
      lastSigRef.current = contentSig;
      capturedHereRef.current = false;
      setDisplaySrc(url);
      return;
    }
    // Unknown or changed content: show whatever is hosted now (usually the
    // card already) and refresh it in the background.
    setDisplaySrc(storageUrl);
    return scheduleCapture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, contentSig]);

  // The hosted image didn't load — never captured (404), or gone. Generate it
  // from the real card; no wrong fallback image. Straight away when this side
  // is on screen, in the background (deferred, as above) when it isn't.
  function onImgError() {
    setPreviewReady(false);
    if (captureRef.current) return; // a capture is on its way; its image replaces this one
    if (capturedHereRef.current && isFresh()) {
      // We just uploaded it and it still won't load: capturing again won't
      // help. Copy still works — the email fetches the image itself.
      setCapture("error");
      return;
    }
    // Device memory said this image was current, but it isn't there: forget
    // that and make a new one.
    lastUrlRef.current = null;
    lastSigRef.current = null;
    try { localStorage.removeItem(hashKey); } catch { /* ignore */ }
    const onScreen = !!boxRef.current && boxRef.current.offsetParent !== null;
    scheduleCapture(onScreen ? 0 : 1500);
  }

  function finishCopy(ok: boolean) {
    if (!aliveRef.current) return;
    if (!ok) { setCopyState("error"); return; }
    setCopyState("copied");
    // They now hold a signature that matches the current design — clear the
    // "re-copy" prompt and remember what content they copied.
    setChangedSinceCopy(false);
    try { localStorage.setItem(copiedKey, contentSig); } catch { /* ignore */ }
    setTimeout(() => { if (aliveRef.current) setCopyState((s) => (s === "copied" ? "idle" : s)); }, 2500);
  }

  // NOT async up front: the clipboard write must be REQUESTED inside the tap.
  // WebKit (the iPhone app, Safari) only allows a clipboard write during the
  // user gesture, and this used to await a capture of several seconds first —
  // so the first tap failed and only a second one worked. When the image is
  // current the write happens at once; when it isn't, the HTML goes into the
  // ClipboardItem as a PROMISE, which the browser holds the tap open for.
  //
  // THE BUTTON USED TO LIE, too: rejections were swallowed and "Copied ✓"
  // shown regardless. A failed write says so, and the next tap tries again.
  function copy() {
    if (copyState === "copying" || copyState === "generating") return;
    const text = () => new Blob([`${name}\n${cardUrl}`], { type: "text/plain" });
    const html = (img: string) => new Blob([buildSignatureHtml(name, company, cardUrl, img)], { type: "text/html" });
    const fresh = isFresh() ? lastUrlRef.current : null;
    setCopyState(fresh ? "copying" : "generating");
    const urlP: Promise<string | null> = fresh ? Promise.resolve(fresh) : captureAndUpload();
    const need = <T,>(make: (u: string) => T) => urlP.then((u) => { if (!u) throw new Error("no signature image"); return make(u); });

    let write: Promise<void>;
    try {
      const item = fresh
        ? new ClipboardItem({ "text/html": html(fresh), "text/plain": text() })
        : new ClipboardItem({ "text/html": need(html), "text/plain": need(() => text()) });
      write = navigator.clipboard.write([item]);
    } catch (e) {
      write = Promise.reject(e);
    }
    write.then(
      () => finishCopy(true),
      async () => {
        // A browser without promise-valued ClipboardItems (or one that refused
        // the first write): wait for the image, then try the plain forms.
        const u = await urlP.catch(() => null);
        if (!u) return finishCopy(false);
        try {
          await navigator.clipboard.write([new ClipboardItem({ "text/html": html(u), "text/plain": text() })]);
          return finishCopy(true);
        } catch { /* next */ }
        try {
          await navigator.clipboard.writeText(buildSignatureHtml(name, company, cardUrl, u));
          return finishCopy(true);
        } catch {
          return finishCopy(false);
        }
      },
    );
  }

  const onLoad = () => { setPreviewReady(true); };

  return (
    <>
      {/* Hidden full-size render of the selected card — captured AS-IS (no font
          scaling, QR kept) so the signature image is a pixel-exact copy of the card.
          html-to-image reads it via the browser engine. */}
      {/* inert as well as aria-hidden: this is a real card parked offscreen for
          image capture, and it contains links. aria-hidden alone left them in
          the tab order — you could Tab into a card nobody can see
          (axe: aria-hidden-focus). */}
      {/* PORTALED to <body>. The Links page shows one side at a time, and this
          box sits on the Swift Signature side — hidden whenever Swift Links is
          showing, which is how the page opens. Inside a display:none panel the
          card has no layout: offsetHeight stays 0 and the capture falls back to
          a 460×460 square, uploaded as the image every follow-up email embeds
          (lib/messaging). On <body> it always has its real size. */}
      {mounted && createPortal(
        <div aria-hidden inert style={{ position: "absolute", left: -10000, top: 0, width: NATURAL, pointerEvents: "none", opacity: 0.01 }}>
          <div ref={cardRef} style={{ width: NATURAL, background: CARD_BG }}>
            <Template data={template === "custom" ? captureData : withoutSocials(captureData)} />
          </div>
        </div>,
        document.body,
      )}

      {/* The signature, shown in place — it used to sit behind a "Preview &
          copy" pop-up, so nobody saw what a Swift Signature was until they'd
          already tapped into it (owner, 2026-10-07). */}
      <div ref={boxRef} className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5">
        {/* Only for someone who already pasted an older design: a first-time
            copier has nothing to refresh, and the note read as a step. */}
        {changedSinceCopy && (
          <p className="mb-3 text-[0.6875rem] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5 leading-relaxed">
            You&apos;ve changed your card design since you last copied your signature. Copy it again and re-paste to refresh it.
          </p>
        )}
        <p className="text-gray-500 text-xs mb-3">Here&apos;s how it looks at the bottom of an email you send:</p>
        <div className="rounded-xl border border-gray-700/60 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-200 text-[0.75rem] text-gray-500 space-y-0.5">
            <p><span className="text-gray-400">To:</span> sarah@acme.com</p>
            <p><span className="text-gray-400">Subject:</span> Great connecting today</p>
          </div>
          <div className="px-4 py-3 text-[0.8125rem] text-gray-800 leading-relaxed">
            <p>Hi Sarah,</p>
            <p className="mt-2">Really enjoyed chatting earlier. My contact info is below in my signature. Let&apos;s keep in touch!</p>
            <p className="mt-2">Best,</p>
            <div className="mt-3">
              <p className="text-[0.875rem] text-gray-900 mb-1.5"><strong>{name}</strong>{company ? ` | ${company}` : ""}</p>
              <a href={previewHref ?? cardUrl} target="_blank" rel="noopener noreferrer" className="block w-[300px] max-w-full"><CardPreview src={displaySrc} ready={previewReady} status={capture} onLoad={onLoad} onError={onImgError} /></a>
              <a href={previewHref ?? cardUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-[0.875rem] font-bold text-blue-600 no-underline">Contact me</a>
            </div>
          </div>
        </div>
        {/* Always tappable — never waits on the preview or a background
            capture. It only pauses while its own copy is in hand. */}
        <button type="button" onClick={copy} disabled={copyState === "copying" || copyState === "generating"}
          aria-live="polite"
          className="w-full mt-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold text-sm py-2.5 rounded-full transition-colors">
          {copyState === "generating" ? "Generating from your card…"
            : copyState === "copying" ? "Copying…"
            : copyState === "copied" ? "Copied ✓ Now paste it in your email"
            : copyState === "error" ? "Couldn't copy — tap to try again"
            : "Copy signature"}
        </button>

        {/* Two steps. "Save" is in step 2 on purpose: an unsaved Gmail
            signature silently disappears, the most common way this fails. */}
        <ol className="mt-4 space-y-2.5">
          <li className="flex gap-2.5">
            <span className="w-5 h-5 rounded-full bg-gray-800 text-gray-300 text-[0.6875rem] font-bold flex items-center justify-center shrink-0">1</span>
            <p className="text-gray-300 text-[0.75rem] leading-relaxed">Tap <strong className="text-white">Copy signature</strong> above.</p>
          </li>
          <li className="flex gap-2.5">
            <span className="w-5 h-5 rounded-full bg-gray-800 text-gray-300 text-[0.6875rem] font-bold flex items-center justify-center shrink-0">2</span>
            <p className="text-gray-300 text-[0.75rem] leading-relaxed">Open your email below, <strong className="text-white">paste</strong> it into the Signature box, and <strong className="text-white">save</strong>.</p>
          </li>
        </ol>

        {/* Open the user's email signature settings directly */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { label: "Gmail", url: "https://mail.google.com/mail/u/0/#settings/general" },
            { label: "Outlook", url: "https://outlook.live.com/mail/0/options/mail/messageContent" },
            { label: "Yahoo", url: "https://mail.yahoo.com/d/settings/1" },
          ].map((p) => (
            <a
              key={p.label}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-[0.6875rem] font-semibold py-2 rounded-xl transition-colors"
            >
              {p.label}
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 opacity-60"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
            </a>
          ))}
        </div>
        {/* Gmail has no link deeper than the General tab, so say where the
            box is and where its Save button hides. Outlook's link lands on
            Signatures itself; work accounts live on a different host. */}
        <div className="mt-3 space-y-1.5 text-[0.6875rem] text-gray-500 leading-relaxed">
          <p><strong className="text-gray-300">Gmail:</strong> scroll down to Signature, paste, then click <strong className="text-gray-300">Save Changes</strong> at the very bottom.</p>
          <p>
            <strong className="text-gray-300">Outlook for work or school?</strong>{" "}
            <a href="https://outlook.office.com/mail/options/mail/messageContent" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2">Open it here</a> instead.
          </p>
          <p>Another email app? Paste it into that app&apos;s signature settings.</p>
        </div>
      </div>
    </>
  );
}
