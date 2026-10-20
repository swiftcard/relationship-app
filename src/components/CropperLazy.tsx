"use client";

// Isolates react-image-crop (+ its CSS) into its own module so next/dynamic
// can defer loading it until a crop is actually needed — most visitors to
// pages using ImageUpload never open the cropper (performance audit).
//
// A real, draggable/resizable crop rectangle (corner + edge handles), not just
// pan-and-zoom: the user can reshape the selection itself, then move it, then
// resize it again — the standard desktop/mobile "crop tool" interaction.
import { useRef, useState, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import ReactCrop, { centerCrop, makeAspectCrop, convertToPixelCrop, cropToCanvas, type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

export type AspectOption = { label: string; value: number };

type Props = {
  src: string;
  title: string;
  aspect: number;
  circular: boolean;
  aspectOptions?: AspectOption[];
  onAspectChange?: (value: number) => void;
  busy: boolean;
  error: string;
  onApply: (canvas: HTMLCanvasElement) => void;
  onCancel: () => void;
};

export default function CropModal({ src, title, aspect, circular, aspectOptions, onAspectChange, busy, error, onApply, onCancel }: Props) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const titleId = useId();
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);

  // A fresh, centered crop at the given aspect — used on image load AND
  // whenever the aspect preset (Square/Wide/Banner) changes, since a crop
  // drawn for one aspect isn't valid for another.
  function resetCropForAspect(a: number) {
    const img = imgRef.current;
    if (!img) return;
    const { width, height } = img;
    if (!width || !height) return;
    const next = centerCrop(makeAspectCrop({ unit: "%", width: 90 }, a, width, height), width, height);
    setCrop(next);
    // Computed synchronously here (not left to react-image-crop's onComplete,
    // which only fires after a user drag/resize) so Apply/Enter always have a
    // valid crop ready, even if the user never touches the image.
    setCompletedCrop(convertToPixelCrop(next, width, height));
  }

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    imgRef.current = e.currentTarget;
    resetCropForAspect(aspect);
  }

  useEffect(() => {
    if (imgRef.current) resetCropForAspect(aspect);
  }, [aspect]);

  function handleApply() {
    const img = imgRef.current;
    if (!img || !completedCrop || !completedCrop.width || !completedCrop.height || busy) return;
    const canvas = document.createElement("canvas");
    cropToCanvas(img, canvas, completedCrop).then(() => onApply(canvas));
  }

  // Capture phase, and the key stops here: Enter and Esc belong to the crop
  // while it is open. The homepage builder closes itself on Esc (a document
  // listener), so Esc used to cancel the crop AND throw away the builder.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        handleApply();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  // Portaled to <body>, above every layer the site uses (owner, 2026-10-19:
  // in the homepage builders the live preview covered half the photo being
  // cropped, and the builder's own "Continue" button showed through). Rendered
  // in place, this sat INSIDE whatever opened it: the builder modal (z-95, its
  // own stacking context), the editor's pinned preview, so a fixed z-50 could
  // never rise above them. At <body> it covers the whole screen, and the only
  // ways out are "Apply" and "Cancel".
  return createPortal(
    <div className="fixed inset-0 z-[10050] bg-black flex flex-col" style={{ touchAction: "none" }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 shrink-0" style={{ paddingTop: "env(safe-area-inset-top, 16px)", paddingBottom: 12 }}>
        {/* Inline white, not .text-white: the light theme turns that class
            near-black, which put "Cancel" and the title dark-on-black here
            (2026-09-22 signup review). Apply already sets its colour inline. */}
        <button type="button" onClick={onCancel} className="font-medium text-sm py-2 px-1" style={{ color: "#fff" }}>
          Cancel
        </button>
        <p id={titleId} className="font-semibold text-sm" style={{ color: "#fff" }}>{title}</p>
        <button
          type="button"
          onClick={handleApply}
          disabled={busy}
          className="text-sm font-bold py-2 px-4 rounded-full transition-colors disabled:opacity-50"
          style={{ background: "#2563eb", color: "#fff" }}
        >
          {busy ? "Saving…" : "Apply"}
        </button>
      </div>

      {/* Error — rendered INSIDE the modal so a failure (bad file, network,
          server rejection) is never silently invisible behind the overlay. */}
      {error && (
        <div className="px-5 shrink-0 mb-2">
          <p className="text-red-400 text-xs bg-red-950/40 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>
        </div>
      )}

      {/* Crop area — fills remaining space; the image sits at its natural
          aspect and the crop rectangle (drag to move, drag any handle to
          resize) sits on top of it. */}
      <div className="relative flex-1 overflow-hidden flex items-center justify-center p-4">
        <ReactCrop
          crop={crop}
          onChange={(_pixelCrop, percentCrop) => setCrop(percentCrop)}
          onComplete={(pixelCrop) => setCompletedCrop(pixelCrop)}
          aspect={aspect}
          circularCrop={circular}
          ruleOfThirds
          minWidth={20}
          minHeight={20}
          className="max-w-full max-h-full"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            // An address (not a local blob:) is a photo already on the page;
            // CORS-loaded so cropToCanvas can export it (ImageUpload sourceForCrop).
            crossOrigin={/^https?:/.test(src) ? "anonymous" : undefined}
            alt="Crop preview"
            onLoad={onImageLoad}
            style={{ maxWidth: "100%", maxHeight: "calc(100vh - 220px)", display: "block" }}
          />
        </ReactCrop>
      </div>

      {/* Bottom controls */}
      <div className="px-8 shrink-0" style={{ paddingTop: 20, paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)" }}>
        {/* Logo shape presets — square or rectangular */}
        {aspectOptions && onAspectChange && (
          <div className="flex items-center justify-center gap-2 mb-4">
            {aspectOptions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => onAspectChange(a.value)}
                className="text-xs font-semibold px-3.5 py-1.5 rounded-full transition-colors"
                style={{
                  background: Math.abs(aspect - a.value) < 0.01 ? "#2563eb" : "rgba(255,255,255,0.1)",
                  color: "#fff",
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        <p className="text-center text-gray-600 text-xs">Drag the corners or edges to crop · drag inside to move</p>
        <p className="text-center text-gray-700 text-[0.6875rem] mt-1">Press Enter to apply · Esc to cancel</p>
      </div>
    </div>,
    document.body,
  );
}
