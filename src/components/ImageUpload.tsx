"use client";

import { useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { AspectOption } from "@/components/CropperLazy";

// Deferred: the cropper only renders after a visitor picks a file (see the
// rawSrc-gated block below) — most page loads using this component never
// need it, including the marketing homepage's mini-builders (performance
// audit).
const CropModal = dynamic(() => import("@/components/CropperLazy"), { ssr: false });

type Props = {
  field: "photo" | "logo";
  currentUrl: string | null;
  label: string;
  /** Optional small helper text rendered directly under the label. */
  hint?: string;
  shape?: "circle" | "square";
  cardId?: string;
  defer?: boolean;
  large?: boolean;
  /** Guest mode: a signed-out user can't POST /api/upload (401). Instead of
      uploading, we hand the cropped image back as a base64 data: URL — it renders
      as the preview and rides along in the guest draft's `images` map until the
      draft is claimed and the real upload happens under the new account. */
  guest?: boolean;
  /** Bumped by the page when it has just applied a photo from OUTSIDE this
      tile (the LinkedIn import coming back). Each new value scrolls the tile
      into view and opens the crop tool on `currentUrl`, so the visitor fits it
      and taps Apply — Cancel keeps the photo as it came. */
  adjustKey?: number;
  onUploaded: (url: string) => void;
};

const LOGO_ASPECTS: AspectOption[] = [
  { label: "Square", value: 1 },
  { label: "Wide", value: 16 / 9 },
  { label: "Banner", value: 3 },
];

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("read failed"));
    fr.readAsDataURL(blob);
  });
}

// Downscale a canvas so its longest edge is at most `maxEdge`, preserving
// aspect ratio (so wide/rectangular logos aren't squished into a square).
// react-image-crop's cropToCanvas() already produced a full-resolution crop —
// this keeps the uploaded file size reasonable.
function downscaleCanvas(source: HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
  let w = source.width;
  let h = source.height;
  if (Math.max(w, h) <= maxEdge) return source;
  if (w >= h) { h = Math.round((h / w) * maxEdge); w = maxEdge; }
  else { w = Math.round((w / h) * maxEdge); h = maxEdge; }
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")!.drawImage(source, 0, 0, w, h);
  return out;
}

/** True once `src` has actually decoded to a picture with pixels. */
function decodes(src: string, cors = false): Promise<boolean> {
  const img = new Image();
  if (cors) img.crossOrigin = "anonymous";
  img.src = src;
  return img.decode().then(() => img.naturalWidth > 0, () => false);
}

// The picture the crop tool opens on, for a photo already on the page.
// react-image-crop draws it on a canvas, which a plain cross-origin <img>
// would taint, so it is pulled as a local blob: first. In Safari that copy
// came back undecodable for a photo the page had just shown (the LinkedIn
// import): the cropper opened on a broken image (WebKit, 2026-10-20). So the
// copy skips the cache and is checked to decode; failing that, the cropper
// loads the address itself with crossOrigin (our storage answers CORS), which
// keeps the canvas clean (CropperLazy sets crossOrigin for http sources).
async function sourceForCrop(url: string): Promise<string> {
  try {
    const res = await fetch(url, { mode: "cors", cache: "no-store" });
    if (res.ok) {
      const local = URL.createObjectURL(await res.blob());
      if (await decodes(local)) return local;
      URL.revokeObjectURL(local);
    }
  } catch { /* fall through to the address itself */ }
  if (/^https?:/.test(url) && (await decodes(url, true))) return url;
  throw new Error("unreadable");
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))),
      "image/jpeg",
      0.92
    );
  });
}

export default function ImageUpload({ field, currentUrl, label, hint, shape = "square", cardId, defer, large, guest, adjustKey, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [rawSrc, setRawSrc] = useState<string | null>(null);
  // Logos can be square or rectangular — let the user pick the frame that fits.
  const [logoAspect, setLogoAspect] = useState(1);

  // Reflect an image applied from OUTSIDE this component in the tile — e.g. the
  // "Suggest my company logo" picker sets the parent's logo URL, which arrives
  // here as a new `currentUrl`. Without this the tile kept its mount-time value
  // and still showed "Upload / Tap to select" even though the card preview had
  // the logo, so it looked like nothing applied. Skip while a local upload/crop
  // is in flight so we never clobber the user's in-progress choice.
  useEffect(() => {
    if (uploadStatus === "uploading" || rawSrc) return;
    // Deliberate sync from an EXTERNAL source (the parent's picker). `preview`
    // is also driven locally by upload/crop, so it can't be derived during
    // render — hence the two guards above rather than a plain derived value.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external-source sync, guarded above
    setPreview(currentUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync ONLY on external currentUrl changes; the guards are read as current-render snapshots.
  }, [currentUrl]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (rawSrc) URL.revokeObjectURL(rawSrc);
    setRawSrc(URL.createObjectURL(file));
    setErrorMsg("");
    setUploadStatus("idle");
    e.target.value = "";
  }

  function cancelCrop() {
    if (rawSrc) URL.revokeObjectURL(rawSrc);
    setRawSrc(null);
    setUploadStatus("idle");
    setErrorMsg("");
  }

  async function applyCrop(canvas: HTMLCanvasElement) {
    if (!rawSrc || uploadStatus === "uploading") return;
    setUploadStatus("uploading");
    setErrorMsg("");

    try {
      const blob = await canvasToBlob(downscaleCanvas(canvas, 800));

      // Guest: no server upload — keep the image as a base64 data URL locally.
      if (guest) {
        const dataUrl = await blobToDataURL(blob);
        setPreview(dataUrl);
        URL.revokeObjectURL(rawSrc);
        setRawSrc(null);
        setUploadStatus("idle");
        onUploaded(dataUrl);
        return;
      }

      const file = new File([blob], `${field}.jpg`, { type: "image/jpeg" });
      const form = new FormData();
      form.append("file", file);
      form.append("field", field);
      if (cardId) form.append("card_id", cardId);
      if (defer) form.append("defer", "true");

      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErrorMsg(json.error ?? "Upload failed. Try again.");
        setUploadStatus("error");
        return;
      }

      setPreview(json.url);
      URL.revokeObjectURL(rawSrc);
      setRawSrc(null);
      setUploadStatus("idle");
      onUploaded(json.url);
    } catch {
      setErrorMsg("Upload failed. Check your connection and try again.");
      setUploadStatus("error");
    }
  }

  // Re-open the crop tool on the photo that is already applied — a LinkedIn
  // or Google import lands without ever passing through it, so until now the
  // only way to reframe one was to find the file and upload it again. See
  // sourceForCrop for how the picture is handed to the cropper.
  async function adjustCurrent(url: string | null = preview) {
    if (!url || uploadStatus === "uploading") return;
    try {
      const src = await sourceForCrop(url);
      if (rawSrc) URL.revokeObjectURL(rawSrc);
      setRawSrc(src);
      setErrorMsg("");
      setUploadStatus("idle");
    } catch {
      setErrorMsg("Couldn't open that photo to adjust it. Upload it again instead.");
      setUploadStatus("error");
    }
  }

  // The page just applied a photo from outside (LinkedIn) — open it in the crop
  // tool. Two frames late so it lands after any scroll-to-top the page does on
  // the same render (the card wizard resets scroll when its step changes, and a
  // return restores the step), then the photo is centred under the cropper.
  useEffect(() => {
    if (!adjustKey || !currentUrl) return;
    const url = currentUrl;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      void adjustCurrent(url);
      inner = requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "center" }));
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per adjustKey; currentUrl is read as this render's value
  }, [adjustKey]);

  async function handleRemove() {
    // Persisted images (account photo/logo, or a saved card logo) are cleared
    // server-side. Guest images were never uploaded, so just clear locally.
    if (!defer && !guest) {
      try {
        await fetch("/api/upload", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field, card_id: cardId }),
        });
      } catch {
        /* ignore — still clear locally */
      }
    }
    setPreview(null);
    setUploadStatus("idle");
    onUploaded("");
  }

  const isCircle = shape === "circle";
  const isLogo = field === "logo";
  // Logos get a wider box so rectangular marks fit; photos stay square.
  const boxSize = isLogo ? "w-36 h-24" : large ? "w-24 h-24" : "w-20 h-20";

  return (
    <>
      {/* Full-screen crop modal */}
      {rawSrc && (
        <CropModal
          src={rawSrc}
          title={isCircle ? "Adjust profile photo" : "Adjust logo"}
          aspect={isLogo ? logoAspect : 1}
          circular={isCircle}
          aspectOptions={isLogo ? LOGO_ASPECTS : undefined}
          onAspectChange={isLogo ? setLogoAspect : undefined}
          busy={uploadStatus === "uploading"}
          error={uploadStatus === "error" ? errorMsg : ""}
          onApply={applyCrop}
          onCancel={cancelCrop}
        />
      )}

      {/* Normal upload widget */}
      <div ref={rootRef}>
        <label className="text-xs text-gray-500 block mb-1">{label}</label>
        {hint && <p className="text-[0.6875rem] text-gray-500 mb-2 leading-snug">{hint}</p>}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            // Icon-only: without a name VoiceOver said "button" and Voice
            // Control had nothing to match. `label` is the field's own word
            // ("Logo", "Photo"), so the spoken name matches what is on screen.
            aria-label={preview ? `Change ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
            className={`${boxSize} overflow-hidden border-2 border-dashed flex items-center justify-center shrink-0 transition-all hover:border-blue-500`}
            style={{
              borderRadius: isCircle ? "9999px" : "12px",
              borderColor: "var(--sc-separator-opaque, #374151)",
              background: "var(--sc-fill, #111827)",
            }}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt={label}
                className="w-full h-full"
                style={{ objectFit: isLogo ? "contain" : "cover", padding: isLogo ? 6 : 0, borderRadius: isCircle ? "9999px" : "10px" }}
              />
            ) : (
              <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
              </svg>
            )}
          </button>

          <div>
            <div className="flex items-center gap-3 mb-1">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploadStatus === "uploading"}
                className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
              >
                {uploadStatus === "uploading" ? "Uploading…" : preview ? "Change" : "Upload"}
              </button>
              {preview && uploadStatus !== "uploading" && (
                <button
                  type="button"
                  onClick={() => adjustCurrent()}
                  className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Adjust
                </button>
              )}
              {preview && uploadStatus !== "uploading" && (
                <button
                  type="button"
                  onClick={handleRemove}
                  className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-[0.6875rem] text-gray-600">JPG, PNG · max 5 MB</p>
            <p className="text-[0.6875rem] text-gray-500 mt-0.5">Tap to select · then drag corners to crop</p>
            {uploadStatus === "error" && (
              <p className="text-[0.6875rem] text-red-400 mt-1">{errorMsg}</p>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </div>
    </>
  );
}
