// ── Owner media uploads (photo or short video) ──────────────────────────────
//
// One uploader, two very different transports, because a video cannot ride the
// same road as a photo:
//
//   • Photos go through /api/upload as multipart. That route decodes, rotates
//     and re-encodes with sharp, so the stored file is a sane size — a phone
//     photo arrives at 3-5 MB and 4000px.
//   • Videos go straight to storage through a signed URL from
//     /api/upload/link-video. The platform caps a function's request body at
//     ~4.5 MB and even a ten-second clip is bigger, so nothing large may pass
//     through a function at all.
//
// Extracted from LinkButtonsControls (2026-09-10) when the Swift Links PAGE
// background gained the same photo-or-video picker. Two copies of this would
// mean two places for the size limits, the allow-lists and the 401 wording to
// drift, and the copy nobody remembered to update is the one that breaks.
//
// `field` is the SERVER's allow-list value — it becomes part of the storage
// object key, so /api/upload rejects anything not on its list rather than
// letting a caller invent a path.

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

/** Fields /api/upload accepts for a deferred (no DB write) image upload. */
export type UploadField = "hero" | "link" | "pagebg" | "cardbg" | "create";

export type UploadedMedia = { url: string; type: "image" | "video" };

export class UploadError extends Error {
  status: number;
  constructor(status: number, message?: unknown) {
    super(typeof message === "string" ? message : "Upload failed — please try again.");
    this.status = status;
  }
}

export function isAllowedMedia(file: File): boolean {
  return IMAGE_TYPES.includes(file.type) || VIDEO_TYPES.includes(file.type);
}

/** The one message for a rejected file type — shown by every picker. */
export const WRONG_TYPE_MESSAGE =
  "Use a JPG, PNG, WebP or GIF photo, or an MP4, MOV or WebM video.";

/**
 * Upload a photo or a short video and return the public URL to persist.
 *
 * Throws UploadError, whose `status` lets the caller tell a guest's 401 (which
 * needs "sign in first", not "upload failed") apart from a real failure.
 */
export async function uploadMedia(file: File, field: UploadField): Promise<UploadedMedia> {
  if (VIDEO_TYPES.includes(file.type)) {
    const r = await fetch("/api/upload/link-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: file.type, size: file.size }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d?.signedUrl || !d?.url) throw new UploadError(r.status, d?.error);
    const put = await fetch(d.signedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!put.ok) throw new UploadError(put.status);
    return { url: d.url, type: "video" };
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("field", field);
  // defer=true: return the URL for the caller to store in customization
  // instead of writing it to a column on the profile/card.
  fd.append("defer", "true");
  const r = await fetch("/api/upload", { method: "POST", body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d?.url) throw new UploadError(r.status, d?.error);
  return { url: d.url, type: "image" };
}

/**
 * The message to show for a failed upload.
 *
 * A guest in the card wizard has no session, so every upload route answers 401.
 * Parroting "Unauthorized" tells them nothing; this says what to do.
 */
export function uploadErrorMessage(e: unknown): string {
  const status = e instanceof UploadError ? e.status : 0;
  if (status === 401) return "Sign in to upload — finish creating your card first, then add it here.";
  return e instanceof Error && e.message ? e.message : "Upload failed — please try again.";
}
