// ── Browser side of the signed-upload road (see api/upload/sign) ────────────
//
// The browser resizes the picture, asks /api/upload/sign for a signed URL and
// PUTs the file straight to storage. No function ever receives the file.
//
// EVERY function here answers "it didn't work" with null rather than an
// error, and its caller then takes the original road (/api/upload,
// /api/card-share-image, /api/card-signature), which is unchanged. So the
// worst this file can do, in a browser or app webview that cannot resize or
// cannot reach storage, is cost one extra small request.

import {
  IMMUTABLE_CACHE_SECONDS, MAX_IMAGE_UPLOAD_BYTES, captureShapeOk, isImageUploadType, maxDimFor,
  type ImageUploadField,
} from "@/lib/upload-rules";

/** A definite "no" from the server (wrong type, not allowed, slow down):
 *  trying the other road would only be refused the same way. */
export class DirectUploadRefused extends Error {
  status: number;
  constructor(status: number, message?: unknown) {
    super(typeof message === "string" ? message : "Upload failed. Please try again.");
    this.status = status;
  }
}

type Signed = { signedUrl: string; path: string; url: string };

async function sign(body: Record<string, unknown>, signal?: AbortSignal): Promise<Signed | null> {
  const r = await fetch("/api/upload/sign", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  const d = await r.json().catch(() => ({}));
  if (r.ok && d?.signedUrl && d?.url && d?.path) return d as Signed;
  // 401 is a guest (the original route takes guests); 5xx/404 is this road
  // being unavailable. Any other 4xx is a real refusal.
  if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 404 && r.status !== 408) {
    throw new DirectUploadRefused(r.status, d?.error);
  }
  return null;
}

async function put(signedUrl: string, blob: Blob, headers: Record<string, string>, signal?: AbortSignal): Promise<boolean> {
  const r = await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": blob.type, ...headers }, body: blob, signal });
  return r.ok;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; w: number; h: number; done: () => void }> {
  // from-image: a phone photo is stored sideways with a "rotate me" note;
  // this turns it upright, as sharp's .rotate() does on the server.
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
    } catch { /* fall through to <img> */ }
  }
  const src = URL.createObjectURL(file);
  const img = new Image();
  img.src = src;
  await img.decode();
  return { source: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(src) };
}

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const px = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return true;
  return false;
}

/**
 * The picture as /api/upload would have stored it: turned upright, no larger
 * than the field's longest edge, never enlarged, a logo as PNG (keeps
 * transparency) and a photo as JPEG. A GIF passes through untouched (it may
 * be animated). Re-drawing also drops the camera's EXIF, location included.
 * Returns null when this browser cannot do it.
 */
export async function resizeForUpload(file: Blob, field: ImageUploadField): Promise<Blob | null> {
  if (!isImageUploadType(file.type)) return null;
  if (file.type === "image/gif") return file;
  if (typeof document === "undefined") return null;
  try {
    const { source, w, h, done } = await decode(file);
    try {
      if (!w || !h) return null;
      const scale = Math.min(1, maxDimFor(field) / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(source, 0, 0, cw, ch);
      // A linked picture keeps its look: a PNG, or anything see-through,
      // stays PNG; photos become JPEG like the rest.
      const keepPng = field === "logo" ||
        (field === "create" && (file.type === "image/png" || hasTransparency(ctx, cw, ch)));
      return keepPng ? await canvasBlob(canvas, "image/png") : await canvasBlob(canvas, "image/jpeg", 0.85);
    } finally {
      done();
    }
  } catch {
    return null;
  }
}

/**
 * Upload one picture straight to storage. Returns its public URL and storage
 * path, or null when the caller should use /api/upload instead. Throws
 * DirectUploadRefused for a definite no, and lets an abort (timeout) through.
 */
export async function directImageUpload(
  file: Blob,
  field: ImageUploadField,
  { signal, resize = true }: { signal?: AbortSignal; resize?: boolean } = {},
): Promise<{ url: string; path: string } | null> {
  try {
    const blob = resize ? await resizeForUpload(file, field) : file;
    if (!blob || !isImageUploadType(blob.type) || blob.size <= 0 || blob.size > MAX_IMAGE_UPLOAD_BYTES) return null;
    const signed = await sign({ target: "media", field, contentType: blob.type, size: blob.size }, signal);
    if (!signed) return null;
    const ok = await put(signed.signedUrl, blob, { "Cache-Control": `max-age=${IMMUTABLE_CACHE_SECONDS}` }, signal);
    return ok ? { url: signed.url, path: signed.path } : null;
  } catch (e) {
    if (e instanceof DirectUploadRefused || signal?.aborted) throw e;
    return null;
  }
}

/** Save a directly-uploaded photo/logo to its account or card column. */
export async function commitDirectUpload(path: string, field: "photo" | "logo", cardId?: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const r = await fetch("/api/upload/sign", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commit: { path, field, card_id: cardId } }),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok && !!d?.url, url: d?.url, error: d?.error };
}

function dataUrlToPng(dataUrl: string): Blob | null {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) return null;
  const bin = atob(dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // The checks the older routes make on the server: really a PNG, and
  // card-shaped (a square or portrait capture means the card never laid out).
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const view = new DataView(bytes.buffer);
  if (!captureShapeOk(view.getUint32(16), view.getUint32(20))) return null;
  return new Blob([bytes], { type: "image/png" });
}

/**
 * Store a card capture (the share preview or the email signature picture)
 * straight in storage. True when it is stored; false when the caller should
 * POST it to the older route instead, which also gives that route's own
 * answer for anything refused here.
 */
export async function directCaptureUpload(target: "share" | "signature", dataUrl: string, username: string, v: number): Promise<boolean> {
  try {
    const blob = dataUrlToPng(dataUrl);
    if (!blob) return false;
    const signed = await sign({ target, username, v });
    if (!signed) return false;
    // Same one-minute cache the older routes store a capture with: the name
    // is reused on every save, so this one must not be kept for long.
    return await put(signed.signedUrl, blob, { "Cache-Control": "max-age=60", "x-upsert": "true" });
  } catch {
    return false;
  }
}
