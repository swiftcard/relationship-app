"use client";

import type { DesignHistory } from "@/lib/use-design-history";

// Pro custom-card designer.
//
// TWO WAYS IN, ONE CARD (owner, 2026-09-23): "Custom design will just be the
// copy … or AI design."
//
//   • Copy a card or template you like — photograph your paper card inside a
//     green-when-it-fits outline (components/CardScanCamera) or upload a
//     design. The server cuts the card out of the picture, redraws its ARTWORK
//     as a clean digital image and measures where everything sat; what comes
//     back is a free design — that artwork under your own details as real
//     elements — which you approve in a preview and then edit like any AI
//     design (lib/card-flatten, lib/design-transfer). Since 2026-10-08 nothing
//     is a frozen picture any more; a card saved with the old exact-copy image
//     (faceImage) still renders exactly as approved.
//   • AI design — choose colours, a theme, and whether your headshot and logo go
//     on it; AI designs the card (components/AiDesignSheet → /api/design-generate
//     → lib/ai-card-design). "Try another" makes a different one from the same
//     choices.
//
// Either way the result is a FREE design — positioned elements — and the owner
// fine-tunes it right on the card: tap anything, drag to move, drag the corner
// to resize, restyle font and colour (components/FreeCardEditor). The eight
// Looks, the Style box and "What's on your card" were removed in the same
// change; a card already saved with them still renders exactly as it was.
//
// The preview is the REAL renderer inside CardScaler at the same 460 design
// width the public card page uses, so what you arrange is what publishes.
//
// On desktop this is a WORKSPACE: the card is pinned on the left, the actions
// and the fine-tune panel sit in a column beside it, and the page's own preview
// column stands down (designerIsCanvas in the editor and the wizard).

import { useEffect, useRef, useState } from "react";
import type { AiDesignBrief, CardData, CustomLayout } from "@/components/card-templates/types";
import CustomCard, { CustomBlockCard, FaceCard, FreeCard } from "@/components/card-templates/CustomCard";
import CardScaler from "@/components/CardScaler";
import FreeCardEditor from "@/components/FreeCardEditor";
import AiDesignSheet from "@/components/AiDesignSheet";
import CardScanCamera from "@/components/CardScanCamera";
import { buildPreset, hasBlocks, normalizeCustomLayout } from "@/lib/custom-layout";
import { compositionOf, freeFromBlocks, type DesignContext } from "@/lib/ai-card-design";

export default function CustomCardDesigner({
  layout,
  data,
  onChange,
  // Copying a card costs an image-model call, so its routes require a session
  // AND a paid plan. The wizard also opens this designer for someone building
  // their FIRST card (owner, 2026-09-30), who the Copy routes answer 401/403 —
  // so the caller says whether Copy is available (canScan) and the button
  // teaches rather than breaks.
  //
  // AI design is open wherever this designer is: it only renders for someone
  // allowed into Custom design — Pro, Office, or a first card — and
  // /api/design-generate lets exactly those through.
  canScan = true,
  teamBrand = false,
  undo: tabUndo,
}: {
  layout: CustomLayout;
  data: CardData;
  onChange: (layout: CustomLayout) => void;
  canScan?: boolean;
  /**
   * Designing the look a WHOLE TEAM inherits (Office Branding). A photo then
   * copies only the LAYOUT, as an editable design each member's card fills with
   * their own details — never the exact-copy image, which is one person's card
   * with their details baked in (lib/custom-layout teamCustomLayout).
   */
  teamBrand?: boolean;
  /**
   * The Card design tab's own Undo (lib/use-design-history), which already
   * records every layout change along with colours, fonts and photos. When
   * given, this designer's Undo IS that one — one Undo on the tab, not two that
   * disagree. Office Branding passes none and keeps the local one.
   */
  undo?: DesignHistory;
}) {
  const history = useRef<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  /** A copied design awaiting the owner's verdict: the editable layout the
   *  server built (artwork + their details). Holds the source upload too, so
   *  "Try again" never asks them to find the same file twice. `artwork` is
   *  false when the artwork pass failed and only the measured layout came. */
  const [transfer, setTransfer] = useState<{ src: string; b64: string; layout: CustomLayout; artwork: boolean; checklist: string[] } | null>(null);
  /** Copy tapped: "Take a photo of your card" or "Upload an image". */
  const [copyChoice, setCopyChoice] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // An EMPTY layout (no blocks, no elements) — Custom just chosen — becomes the
  // starter card once, exactly as before: the live card already renders it as
  // that, so filling it in changes nothing anyone can see.
  const norm = normalizeCustomLayout(layout);
  const isFree = !hasBlocks(layout) && norm.elements.length > 0;
  const upgraded = useRef(false);
  useEffect(() => {
    if (hasBlocks(layout) || isFree || upgraded.current) return;
    upgraded.current = true;
    const base = buildPreset("ink");
    onChange({ ...base, ...layout, blocks: base.blocks, elements: [] });
  }, [layout, isFree, onChange]);

  function commit(next: CustomLayout) {
    if (tabUndo) { onChange(next); return; }
    history.current.push(JSON.stringify(layout));
    if (history.current.length > 50) history.current.shift();
    setCanUndo(true);
    onChange(next);
  }
  function undo() {
    const prev = history.current.pop();
    if (!prev) return;
    setCanUndo(history.current.length > 0);
    onChange(JSON.parse(prev) as CustomLayout);
  }
  const undoAvailable = tabUndo ? tabUndo.canUndo : canUndo;
  const runUndo = () => (tabUndo ? tabUndo.undo() : undo());

  /** What the design engine needs to size every line — the owner's own details. */
  function designContext(): DesignContext {
    return {
      name: data.name ?? "", title: data.title ?? "", company: data.company ?? "",
      phone: data.phone ?? "", email: data.email ?? "", website: data.website ?? "", address: data.address ?? "",
      // A team design places a headshot slot every member fills with their own photo.
      hasPhoto: teamBrand || !!data.photoUrl,
      hasLogo: !!data.logoUrl,
    };
  }

  /** Decode an upload and re-encode it at ≤1400px. A phone photo is 4-6MB and
   *  carries no more information about a card than 1400px does — slow to
   *  upload and billed by the token. Null = the browser can't decode the file
   *  (an iPhone library HEIC, a PDF picked through "All files"). */
  async function toJpeg(file: Blob): Promise<{ b64: string; dataUrl: string } | null> {
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read"));
        reader.readAsDataURL(file);
      });
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("decode"));
        i.src = dataUrl;
      });
      const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      const jpeg = canvas.toDataURL("image/jpeg", 0.82);
      return { b64: jpeg.split(",")[1] ?? "", dataUrl: jpeg };
    } catch {
      return null;
    }
  }

  /** The copy: the server cuts the card out of the picture, redraws its
   *  artwork and measures it, and answers with an editable free design
   *  carrying the owner's own details. The owner approves a preview before
   *  anything touches the card. The upload's b64 is kept so "Try again"
   *  doesn't make them find the file twice. */
  async function transferDesign(source: { b64: string; dataUrl: string }) {
    setScanError(null);
    setScanNote(null);
    setScanning(true);
    // Nothing downstream is guaranteed to answer: without a deadline the button
    // spins until the platform gives up on the function, which is a long time
    // to watch a spinner. The pipeline can run several generation+verify
    // passes (full rebuild retries, then the hybrid artwork engine), so the
    // deadline tracks the route's own 180s budget — cutting off at 55s was
    // itself the "it errored" the owner reported (2026-08-26): the server was
    // still working on a good copy when the client hung up.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 150_000);
    try {
      const res = await fetch("/api/design-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: source.b64,
          mediaType: "image/jpeg",
          identity: {
            name: data.name, title: data.title, company: data.company,
            phone: data.phone, email: data.email, website: data.website, address: data.address,
          },
          photoUrl: data.photoUrl ?? undefined,
          logoUrl: data.logoUrl ?? undefined,
        }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setScanError(
          res.status === 401 ? "Sign in first — copying a card design needs an account."
          : res.status === 403 ? ((j as { code?: string; message?: string }).code === "AI_CONSENT_REQUIRED" ? ((j as { message?: string }).message ?? "AI features are off. Turn them on in Settings.") : "Copying a card design is a Pro feature.")
          : res.status === 429 ? "Too many copies just now — try again in a minute."
          : (j as { error?: string }).error === "no_ai" ? "Copying a design is unavailable right now."
          : "Couldn't rebuild that design. Try again, or try a cleaner image.",
        );
        return;
      }
      const { layout: copied, artwork, checklist } = (await res.json()) as { layout?: CustomLayout; artwork?: boolean; checklist?: string[] };
      if (!copied?.elements?.length) {
        setScanError("Couldn't rebuild that design. Try again, or try a cleaner image.");
        return;
      }
      setTransfer({ src: source.dataUrl, b64: source.b64, layout: normalizeCustomLayout(copied), artwork: artwork === true, checklist: checklist ?? [] });
    } catch (e) {
      setScanError(
        (e as { name?: string })?.name === "AbortError"
          ? "That took too long. Try again in a moment."
          : "That didn't work. Try another image.",
      );
    } finally {
      clearTimeout(timer);
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /** The TEAM path — copy the LAYOUT alone (colours, font, panel) as a design
   *  every member's card fills with their own details. Never the artwork image
   *  or one person's arrangement; see teamBrand. */
  async function scanLayoutOnly(b64: string) {
    setScanError(null);
    setScanNote(null);
    setScanning(true);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 45_000);
    try {
      const res = await fetch("/api/scan-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: b64, mediaType: "image/jpeg" }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setScanError(
          res.status === 401 ? "Sign in first — copying a card layout needs an account."
          : res.status === 403 ? ((j as { code?: string; message?: string }).code === "AI_CONSENT_REQUIRED" ? ((j as { message?: string }).message ?? "AI features are off. Turn them on in Settings.") : "Copying a card layout is a Pro feature.")
          : res.status === 429 ? "Too many copies just now — try again in a minute."
          : res.status === 422 ? "Couldn't read that image. Try a straight-on shot in good light."
          : (j as { error?: string }).error === "no_ai" ? "Copying a layout is unavailable right now."
          : "That didn't work. Try another image.",
        );
        return;
      }
      const { layout: scanned } = (await res.json()) as { layout?: CustomLayout };
      if (!scanned?.blocks?.length) {
        setScanError("Couldn't read that image. Try a straight-on shot in good light.");
        return;
      }
      // Layout-only replaces the face image too: the owner just chose to edit.
      // Rebuilt as a free design with the copied colours, font and panel, so
      // it is fine-tuned on the card like an AI design (lib/ai-card-design).
      commit(freeFromBlocks({ ...scanned, faceImage: undefined }, designContext()));
      setScanNote("Layout copied. Your own details are untouched — fine-tune anything on the card below, or Undo.");
    } catch (e) {
      setScanError(
        (e as { name?: string })?.name === "AbortError"
          ? "That took too long. Try again in a moment."
          : "That didn't work. Try another image.",
      );
    } finally {
      clearTimeout(timer);
      setScanning(false);
    }
  }

  /** Entry point from the file input and the camera. */
  async function scanPrintedCard(file: Blob) {
    setScanError(null);
    const prepared = await toJpeg(file);
    if (!prepared) {
      setScanError("We couldn't open that file. Pick a JPG or PNG, or take a photo.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    // A team brand never gets the exact-copy image — see teamBrand.
    if (teamBrand) await scanLayoutOnly(prepared.b64);
    else await transferDesign(prepared);
  }

  /** AI design: send the owner's choices, get a finished free design back. */
  async function generate(choice: Omit<AiDesignBrief, "variant">, variant: number) {
    setAiError(null);
    setScanNote(null);
    setAiBusy(true);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 45_000);
    const ctx = designContext();
    try {
      const res = await fetch("/api/design-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: { ...choice, variant },
          identity: {
            name: ctx.name, title: ctx.title, company: ctx.company,
            phone: ctx.phone, email: ctx.email, website: ctx.website, address: ctx.address,
          },
          hasPhoto: ctx.hasPhoto,
          hasLogo: ctx.hasLogo,
          // "Try another" never hands back the composition on the card now.
          avoid: isFree ? compositionOf(norm) ?? undefined : undefined,
        }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setAiError(
          res.status === 403 ? ((j as { code?: string; message?: string }).code === "AI_CONSENT_REQUIRED" ? ((j as { message?: string }).message ?? "AI features are off. Turn them on in Settings.") : "AI design is a Pro feature.")
          : res.status === 429 ? "Too many designs just now — try again in a minute."
          : (j as { error?: string }).error === "no_ai" ? "AI design is unavailable right now."
          : "Couldn't design that just now. Try again.",
        );
        return;
      }
      const { layout: designed } = (await res.json()) as { layout?: CustomLayout };
      if (!designed?.elements?.length) {
        setAiError("Couldn't design that just now. Try again.");
        return;
      }
      commit(designed);
      setAiOpen(false);
      setScanNote("Here's your AI design. Tap anything on the card to move it, resize it or change its font and colour — or Try another.");
    } catch (e) {
      setAiError(
        (e as { name?: string })?.name === "AbortError"
          ? "That took too long. Try again in a moment."
          : "That didn't work. Try again.",
      );
    } finally {
      clearTimeout(timer);
      setAiBusy(false);
    }
  }

  const brief = isFree ? norm.ai ?? null : null;

  const card = "bg-gray-900 border border-gray-800 rounded-xl";
  const head = "text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-gray-500";
  // The card spans both rows of the left track on desktop and sticks while
  // the controls scroll beside it; on a phone it sits between the two ways in
  // and the fine-tune panel.
  const canvasPlace = "order-2 w-full max-w-[560px] mx-auto lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-6";
  const panelPlace = "order-3 lg:col-start-2 lg:row-start-2";
  const previewData: CardData = { ...data, customization: { ...(data.customization ?? {}), customLayout: layout } };

  if (!isFree && !hasBlocks(layout)) {
    return <div className="h-24 rounded-xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Preparing your design" />;
  }

  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-5 lg:gap-y-3 lg:items-start">
      {/* The two ways in. */}
      <div className={`${card} p-3 space-y-2.5 order-1 lg:col-start-2 lg:row-start-1`}>
        <p className={head}>Custom design</p>
        {/* THE headline feature of the custom designer (owner order 2026-08-26:
            "the best feature we have — make people notice it"). Dressed as the
            hero: animated gradient frame, soft glow, shine sweep. Reduced
            motion turns the animation off; the frame still reads as special. */}
        <style>{`
          @keyframes sc-magic-border { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
          @keyframes sc-magic-glow { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.75; } }
          @keyframes sc-magic-shine { 0% { transform: translateX(-160%) skewX(-18deg); } 60%, 100% { transform: translateX(340%) skewX(-18deg); } }
          .sc-magic-frame { background: linear-gradient(110deg, #2563eb, #7c3aed, #06b6d4, #2563eb); background-size: 300% 300%; animation: sc-magic-border 5s ease-in-out infinite; }
          .sc-magic-halo { animation: sc-magic-glow 2.8s ease-in-out infinite; }
          .sc-magic-shine { animation: sc-magic-shine 4.5s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .sc-magic-frame, .sc-magic-halo, .sc-magic-shine { animation: none; } }
        `}</style>
        <div className="relative">
          {canScan && !scanning && (
            <div className="sc-magic-halo absolute -inset-1 rounded-2xl bg-gradient-to-r from-blue-600/40 via-violet-600/40 to-cyan-500/40 blur-md pointer-events-none" aria-hidden="true" />
          )}
          <div className={`relative rounded-xl p-[1.5px] ${canScan ? "sc-magic-frame" : "bg-gray-800"}`}>
            <button
              type="button"
              onClick={() => { if (canScan) setCopyChoice((v) => !v); }}
              aria-expanded={canScan ? copyChoice : undefined}
              disabled={scanning || !canScan}
              className={`relative overflow-hidden w-full rounded-[10.5px] px-3.5 py-3.5 text-left transition-colors ${
                canScan ? "bg-gray-950 hover:bg-gray-900 disabled:opacity-70" : "bg-gray-950/90 cursor-default"
              }`}
            >
              {canScan && !scanning && (
                <span className="sc-magic-shine pointer-events-none absolute top-0 bottom-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" aria-hidden="true" />
              )}
              <span className="flex items-center gap-3">
                <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${canScan ? "bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-[0_0_14px_rgba(99,102,241,0.45)]" : "bg-gray-800 text-gray-500"}`}>
                  {scanning ? (
                    <span className="block w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  ) : (
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.2V5.6A2.6 2.6 0 015.6 3h2.6M15.8 3h2.6A2.6 2.6 0 0121 5.6v2.6M21 15.8v2.6a2.6 2.6 0 01-2.6 2.6h-2.6M8.2 21H5.6A2.6 2.6 0 013 18.4v-2.6M7 12h10" />
                    </svg>
                  )}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[0.84375rem] font-semibold ${canScan ? "text-white" : "text-gray-400"}`}>
                    {scanning ? (teamBrand ? "Copying the layout…" : "Rebuilding it with your details…") : "Copy a card or template you like"}
                    {canScan && !scanning && (
                      <span className="ml-1.5 text-[0.5625rem] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 text-white align-middle tracking-wide">✨ MAGIC</span>
                    )}
                    {!canScan && (
                      <span className="ml-1.5 text-[0.5625rem] font-bold px-1.5 py-0.5 rounded-full bg-blue-600 text-white align-middle">PRO</span>
                    )}
                  </span>
                  <span className="block text-[0.6875rem] text-gray-400 leading-snug mt-0.5">
                    {teamBrand
                      ? "Take a photo of a card or upload a design you like. We copy its layout as editable blocks, and every teammate's card fills it with their own details."
                      : canScan
                      ? "Take a photo of your paper card, or upload a design you like. We find the card in the picture and redraw it as a clean digital card — same colors, artwork and layout — with YOUR details and logo on it. Approve the preview, then move, resize and restyle anything."
                      : "On Pro, upload a card design you like and we'll rebuild it exactly, with your details on it."}
                  </span>
                </span>
              </span>
            </button>
          </div>
        </div>

        {/* Copy's two ways in (owner, 2026-10-06). Most people copy their OWN
            paper card, so the camera comes first: a card-shaped outline that
            turns green when the card fits it, and only the card is sent
            (components/CardScanCamera). Upload stays for a template found
            online — a photo already in the library can't be re-photographed. */}
        {copyChoice && canScan && !scanning && (
          <div className="space-y-1.5" data-copy-choice>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setCopyChoice(false); setScanError(null); setCameraOpen(true); }}
                className="sc-tap flex items-center justify-center gap-1.5 text-[0.78125rem] font-semibold px-2.5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.5A2.5 2.5 0 015.5 6h1.6l1.2-1.8A1.5 1.5 0 019.55 3.5h4.9a1.5 1.5 0 011.25.7L16.9 6h1.6A2.5 2.5 0 0121 8.5v9a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5v-9z" />
                  <circle cx="12" cy="12.5" r="3.5" />
                </svg>
                Take a photo of your card
              </button>
              <button
                type="button"
                onClick={() => { setCopyChoice(false); fileRef.current?.click(); }}
                className="sc-tap flex items-center justify-center gap-1.5 text-[0.78125rem] font-semibold px-2.5 py-2.5 rounded-lg border bg-gray-800 border-gray-600 text-gray-100 hover:text-white hover:border-gray-400"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2.5" />
                  <circle cx="9" cy="10" r="1.6" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 16l-5-5-8 8" />
                </svg>
                Upload an image
              </button>
            </div>
            <p className="text-[0.65625rem] text-gray-500 leading-snug">
              Lay your card on a plain surface and fit it inside the outline — it turns green when it fits.
            </p>
          </div>
        )}

        {/* AI design — the second way in (owner, 2026-09-23). Dressed exactly
            like Copy above, so the two read as a pair: same frame, glow and
            shine. Always open here — see canScan above. */}
        <div className="relative">
          {!aiBusy && (
            <div className="sc-magic-halo absolute -inset-1 rounded-2xl bg-gradient-to-r from-violet-600/40 via-fuchsia-500/35 to-blue-600/40 blur-md pointer-events-none" aria-hidden="true" />
          )}
          <div className="relative rounded-xl p-[1.5px] sc-magic-frame">
            <button
              type="button"
              onClick={() => { setAiError(null); setAiOpen(true); }}
              disabled={aiBusy || scanning}
              className="relative overflow-hidden w-full rounded-[10.5px] px-3.5 py-3.5 text-left transition-colors bg-gray-950 hover:bg-gray-900 disabled:opacity-70"
            >
              {!aiBusy && (
                <span className="sc-magic-shine pointer-events-none absolute top-0 bottom-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" aria-hidden="true" />
              )}
              <span className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-[0_0_14px_rgba(168,85,247,0.45)]">
                  {aiBusy ? (
                    <span className="block w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  ) : (
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                    </svg>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-[0.84375rem] font-semibold text-white">
                    {aiBusy ? "Designing your card…" : "AI design"}
                    {!aiBusy && (
                      <span className="ml-1.5 text-[0.5625rem] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white align-middle tracking-wide">✨ NEW</span>
                    )}
                  </span>
                  <span className="block text-[0.6875rem] text-gray-400 leading-snug mt-0.5">
                    {teamBrand
                      ? "Pick colours and a theme — AI designs the team's card, and every teammate's card fills it with their own details."
                      : "Pick your colours, a theme, and whether your headshot and logo go on it — AI designs your card. Then move, resize and restyle anything."}
                  </span>
                </span>
              </span>
            </button>
          </div>
        </div>

        {/* Another from the same choices, or change them. */}
        {brief && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={aiBusy || scanning}
              onClick={() => void generate({ theme: brief.theme, colors: brief.colors, headshot: brief.headshot, logo: brief.logo }, brief.variant + 1)}
              className="sc-tap text-[0.8125rem] font-semibold px-3 py-1.5 rounded-lg border bg-gray-800 border-gray-600 text-gray-100 hover:text-white hover:border-gray-400 disabled:opacity-50"
            >
              ↻ Try another
            </button>
            <button
              type="button"
              disabled={aiBusy || scanning}
              onClick={() => { setAiError(null); setAiOpen(true); }}
              className="sc-tap text-[0.8125rem] font-medium px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-50"
            >
              Change choices
            </button>
          </div>
        )}
        {aiError && !aiOpen && <p className="text-[0.6875rem] text-amber-400" role="alert">{aiError}</p>}

        {/* NO `capture` attribute. With capture="environment" a phone opens
            straight into the camera, which makes the whole "or a template you
            found online" half of this feature unreachable — you cannot
            photograph an image that is already in your camera roll. Without it
            the OS offers camera AND library, so both routes work. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void scanPrintedCard(f); }}
        />
        {scanError && <p className="text-[0.6875rem] text-amber-400">{scanError}</p>}
        {scanNote && <p className="text-[0.6875rem] text-emerald-400">{scanNote}</p>}

        {/* Exact design active: the card is the approved image, so the block
            controls below are dormant — say so where the owner is looking,
            with the way out right next to the statement. */}
        {layout.faceImage && !teamBrand && (
          <div className="rounded-lg border border-blue-500/40 bg-blue-950/30 px-3 py-2.5 flex items-center gap-3">
            <p className="text-[0.6875rem] text-blue-200 leading-snug flex-1">
              Exact design is on — your card shows the approved image. Remove it to go back to your own design.
            </p>
            <button
              type="button"
              onClick={() => commit({ ...layout, faceImage: undefined })}
              className="text-[0.6875rem] font-semibold text-white bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg px-2.5 py-1.5 shrink-0"
            >
              Remove
            </button>
          </div>
        )}

        {/* ── The approval gate. The owner compares the original and the copy
               side by side — the copy is the REAL card renderer drawing the
               editable design, so what they approve is what lands on the
               canvas — and only their tap writes the card. ── */}
        {transfer && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center px-4 pt-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))]" role="dialog" aria-modal="true" aria-label="Approve your copied card design">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-2xl w-full max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] overflow-y-auto p-4 sm:p-5 space-y-4">
              <p className="text-sm font-semibold text-white">Your card, in that design — check it before it goes on</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[0.65625rem] text-gray-500 mb-1.5">The design you uploaded</p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                  <img src={transfer.src} alt="The design you uploaded" className="w-full rounded-lg border border-gray-800" />
                </div>
                <div>
                  <p className="text-[0.65625rem] text-gray-500 mb-1.5">Rebuilt with your details</p>
                  <div className="rounded-lg border border-blue-500/50 overflow-hidden" data-transfer-preview>
                    <CardScaler>
                      <FreeCard data={{ ...data, customization: { ...(data.customization ?? {}), customLayout: transfer.layout } }} layout={transfer.layout} placeholder />
                    </CardScaler>
                  </div>
                </div>
              </div>
              {!transfer.artwork && (
                <p className="text-[0.6875rem] text-amber-400" role="status">
                  We copied the layout and colours but couldn&apos;t redraw the artwork cleanly this time — Try again for the artwork, or use this and restyle it.
                </p>
              )}
              {transfer.checklist.length > 0 && (
                <div className="rounded-lg bg-gray-950 border border-gray-800 px-3 py-2.5">
                  <p className="text-[0.6875rem] font-semibold text-gray-300 mb-1">Look closely:</p>
                  <ul className="space-y-0.5">
                    {transfer.checklist.map((item) => (
                      <li key={item} className="text-[0.6875rem] text-gray-400 flex gap-1.5">
                        <span className="text-blue-400 shrink-0">✓</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    // A copy replaces any old frozen exact-copy image too.
                    commit({ ...transfer.layout, faceImage: undefined });
                    setTransfer(null);
                    setScanNote("Design copied. Tap anything on the card to move it, resize it or change its font and colour — or Undo.");
                  }}
                  className="text-[0.78125rem] font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-2"
                >
                  Use this design
                </button>
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => { const t = transfer; setTransfer(null); if (t) void transferDesign({ b64: t.b64, dataUrl: t.src }); }}
                  className="text-[0.78125rem] font-semibold text-gray-200 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 disabled:opacity-60"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={() => setTransfer(null)}
                  className="text-[0.75rem] text-gray-400 hover:text-gray-200 px-2 py-2 ml-auto"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>


      {isFree && !(norm.faceImage && !teamBrand) ? (
        <FreeCardEditor
          layout={norm}
          data={data}
          commit={commit}
          undo={{ canUndo: undoAvailable, run: runUndo }}
          canvasClassName={canvasPlace}
          panelClassName={panelPlace}
        />
      ) : (
        <>
          {/* ── The card, before there is a design to fine-tune (or while an
                 approved exact design is on). Pinned on desktop. ── */}
          <div className={canvasPlace}>
            <div className="rounded-2xl border border-gray-800 bg-[radial-gradient(120%_90%_at_50%_0%,#141a26_0%,#0b0f17_70%)] p-4 sm:p-6">
              <CardScaler>
                {/* An approved exact design IS the card — show it (the live
                    renderer makes the same face-first choice). */}
                {norm.faceImage && !teamBrand
                  ? <FaceCard data={previewData} src={norm.faceImage} />
                  : hasBlocks(layout) ? <CustomBlockCard data={previewData} placeholder /> : <CustomCard data={previewData} />}
              </CardScaler>
            </div>
            <p className="text-[0.6875rem] text-gray-500 mt-2 min-w-0">
              {norm.faceImage && !teamBrand ? "Your approved exact design." : "Your starting card."}
            </p>
          </div>
          <div className={`${card} p-3 space-y-2 ${panelPlace}`}>
            <div className="flex items-center justify-between gap-2">
              <p className={head}>Fine-tune</p>
              <button
                type="button"
                onClick={runUndo}
                disabled={!undoAvailable}
                className="text-[0.6875rem] px-2.5 py-1 rounded-lg border border-gray-700 text-gray-300 disabled:opacity-40 hover:border-gray-500 shrink-0"
              >
                ↶ Undo
              </button>
            </div>
            <p className="text-[0.75rem] text-gray-400 leading-snug">
              {norm.faceImage && !teamBrand
                ? "Your card is the exact design you approved. Remove it above to go back to your own design, or use AI design for a new one."
                : canScan
                ? "Use AI design or copy a card you like — then tap anything on your card to move it, resize it or change its font and colour."
                // Copy is locked here (a first card) — never point at it.
                : "Use AI design — then tap anything on your card to move it, resize it or change its font and colour."}
            </p>
          </div>
        </>
      )}

      {cameraOpen && (
        <CardScanCamera
          title="Photograph your card"
          onCapture={(photo) => { setCameraOpen(false); void scanPrintedCard(photo); }}
          onClose={() => setCameraOpen(false)}
          onPickPhoto={() => { setCameraOpen(false); fileRef.current?.click(); }}
        />
      )}

      {aiOpen && (
        <AiDesignSheet
          initial={brief}
          hasPhoto={designContext().hasPhoto}
          hasLogo={designContext().hasLogo}
          busy={aiBusy}
          error={aiError}
          teamBrand={teamBrand}
          onGenerate={(choice) => void generate(choice, brief ? brief.variant + 1 : 0)}
          onClose={() => { if (!aiBusy) { setAiOpen(false); setAiError(null); } }}
        />
      )}
    </div>
  );
}
