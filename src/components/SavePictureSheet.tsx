"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { canShareFile, pngFile, saveImage, sharePicture, type SaveResult } from "@/lib/save-image";

type Pending = { blob: Blob; filename: string };

/**
 * Save a drawn PNG; when the phone needs a fresh tap to open its share sheet
 * (see lib/save-image), `sheet` becomes the picture with a Save button.
 * Render `sheet` anywhere — it portals to <body>.
 */
export function useSavePicture(): { save: (blob: Blob, filename: string) => Promise<SaveResult>; sheet: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const save = useCallback(async (blob: Blob, filename: string) => {
    const result = await saveImage(blob, filename);
    if (result === "needs-tap") setPending({ blob, filename });
    return result;
  }, []);
  const sheet = pending ? <SavePictureSheet {...pending} onClose={() => setPending(null)} /> : null;
  return { save, sheet };
}

function SavePictureSheet({ blob, filename, onClose }: Pending & { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(true, onClose, panelRef);
  const imgRef = useRef<HTMLImageElement>(null);
  const [file] = useState(() => pngFile(blob, filename));
  const [shareable] = useState(() => canShareFile(file));

  useEffect(() => {
    // Set on the node, not through state: the URL only lives as long as this
    // effect, and must be revoked with it.
    const url = URL.createObjectURL(blob);
    if (imgRef.current) imgRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  async function save() {
    const result = await sharePicture(file);
    if (result !== "needs-tap") onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center px-4 pt-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))]"
      style={{ background: "rgba(2, 6, 23, 0.88)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-picture-title"
        className="w-full max-w-sm bg-gray-950 border border-gray-800 rounded-2xl p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <p id="save-picture-title" className="text-white font-semibold text-sm">Your picture is ready</p>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-2 w-10 h-10 flex items-center justify-center rounded-full text-gray-500 hover:text-white hover:bg-gray-800 text-xl leading-none transition-colors">×</button>
        </div>
        {/* sc-selectable: the app turns the long-press menu off everywhere
            else (globals.css), and holding the picture is how it gets saved
            when the share sheet isn't available. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL of a picture drawn in the page */}
        <img
          ref={imgRef}
          alt={filename}
          className="sc-selectable block w-full max-h-[50dvh] object-contain rounded-lg"
          style={{ WebkitTouchCallout: "default" }}
        />
        {shareable && (
          <button
            type="button"
            onClick={save}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-full font-bold text-sm text-white bg-blue-600 hover:bg-blue-500 transition-colors"
          >
            Save picture
          </button>
        )}
        <p className="mt-3 text-center text-gray-400 text-xs">
          {shareable ? "Or press and hold the picture to save it." : "Press and hold the picture, then tap Save to Photos."}
        </p>
      </div>
    </div>,
    document.body,
  );
}
