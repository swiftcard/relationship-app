"use client";

import { useEffect, useRef, useState } from "react";
import { useSavePicture } from "@/components/SavePictureSheet";
import { captureCardPng } from "@/lib/card-png";
import { prefersShareSheet } from "@/lib/save-image";

interface Props {
  cardRef: React.RefObject<HTMLDivElement | null>;
  filename?: string;
  /** The card's name, which the PNG is checked for (lib/card-png). */
  cardName?: string;
  compact?: boolean;
  /** Overrides the idle label. Compact defaults to a bare "Download", which is
      ambiguous where it sits next to "Download QR (PNG)" in the share modal.
      Never overrides the working/error states — those must stay readable. */
  label?: string;
  /** Capture as soon as this mounts on a phone, so the tap can open the share
      sheet while iOS still counts it as the tap (lib/save-image). For the
      share modal, which mounts its buttons only when it opens. */
  prepare?: boolean;
}

/**
 * A picture of the card, exactly as the Your Card box draws it (lib/card-png).
 * In the app it saves a PICTURE too — it used to share the card link instead,
 * because WKWebView can't follow a download (owner, 2026-10-06: "it's
 * literally just supposed to download a perfect picture of their SwiftCard").
 */
export default function DownloadCardButton({ cardRef, filename = "swiftcard.png", cardName = "", compact = false, label: labelOverride, prepare = false }: Props) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const loading = status === "working";
  const { save, sheet } = useSavePicture();
  const prepared = useRef<Promise<Blob> | null>(null);

  function capture(): Promise<Blob> {
    if (prepared.current) return prepared.current;
    const el = cardRef.current;
    const png = el ? captureCardPng(el, cardName) : Promise.reject(new Error("no card"));
    png.catch(() => { if (prepared.current === png) prepared.current = null; });
    prepared.current = png;
    return png;
  }

  useEffect(() => {
    if (prepare && prefersShareSheet()) capture().catch(() => {});
    // Once per mount: the modal remounts this every time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepare]);

  async function handleDownload() {
    if (!cardRef.current || loading) return;
    setStatus("working");
    try {
      const png = await capture();
      await save(png, filename);
      setStatus("idle");
    } catch {
      // Show it failed instead of silently doing nothing.
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2500);
    } finally {
      // The button under the card stays mounted while the card is edited
      // elsewhere; never hand out yesterday's picture from it.
      if (!prepare) prepared.current = null;
    }
  }

  const spinner = (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  );
  const icon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
  const idleLabel = labelOverride ?? (compact ? "Download" : "Download card as image");
  const label = loading ? "Saving…" : status === "error" ? "Couldn't save — retry" : idleLabel;

  // w-full, NOT flex-1. This button used to sit in a `flex` row beside a
  // "Preview" link, so flex-1 sized it. The Preview link was removed and the row
  // became a plain block, which left flex-1 inert — and a button is shrink-to-fit
  // by default even at display:flex, so it collapsed to the width of the word
  // "Download" and sat there looking broken next to the full-width Wallet button
  // below it. w-full doesn't care what the parent is.
  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={handleDownload}
          disabled={loading}
          className={`w-full flex items-center justify-center gap-1.5 text-xs font-semibold border rounded-full py-2 transition-colors disabled:opacity-50 ${
            status === "error"
              ? "text-amber-300 bg-amber-950/40 border-amber-800/50"
              : "text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border-gray-700"
          }`}
        >
          {loading ? spinner : icon}
          {label}
        </button>
        {sheet}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleDownload}
        disabled={loading}
        className={`flex items-center gap-2 w-full justify-center border font-semibold py-2.5 rounded-full transition-colors text-sm disabled:opacity-50 ${
          status === "error"
            ? "text-amber-300 border-amber-800/60"
            : "border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white"
        }`}
      >
        {loading ? spinner : icon}
        {label}
      </button>
      {sheet}
    </>
  );
}
