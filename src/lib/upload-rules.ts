// ── The rules every image upload follows, in one place ──────────────────────
//
// Two roads lead to the same bucket:
//   • /api/upload — the original multipart route. The file passes through a
//     function, which resizes it with sharp. Still there, unchanged, for
//     guests and as the fallback when the direct road fails.
//   • /api/upload/sign — hands the browser a signed URL so the (already
//     resized) file goes STRAIGHT to storage and never through a function.
//
// Both must agree on what a picture may be, or the road taken would decide
// what gets stored. tests/direct-upload.test.ts holds the two together.

export const IMAGE_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageUploadType = (typeof IMAGE_UPLOAD_TYPES)[number];

/** 5 MB, the same cap /api/upload applies. */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

export const IMAGE_UPLOAD_FIELDS = ["photo", "logo", "hero", "link", "pagebg", "cardbg", "create"] as const;
export type ImageUploadField = (typeof IMAGE_UPLOAD_FIELDS)[number];

export const EXT_BY_IMAGE_TYPE: Record<ImageUploadType, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
};

export function isImageUploadField(v: unknown): v is ImageUploadField {
  return typeof v === "string" && (IMAGE_UPLOAD_FIELDS as readonly string[]).includes(v);
}

export function isImageUploadType(v: unknown): v is ImageUploadType {
  return typeof v === "string" && (IMAGE_UPLOAD_TYPES as readonly string[]).includes(v);
}

/** Longest edge kept for each field: the numbers /api/upload resizes to. */
export function maxDimFor(field: ImageUploadField): number {
  if (field === "photo") return 1000;
  if (field === "pagebg" || field === "create") return 1600;
  if (field === "cardbg") return 1400;
  if (field === "hero" || field === "link") return 1200;
  return 800;
}

/**
 * Every upload is stored under a new, time-stamped name and never rewritten,
 * so a browser may keep it for a year. Storage's default was one hour, which
 * had every returning visitor download the same headshot and logo again.
 */
export const IMMUTABLE_CACHE_SECONDS = "31536000";

/** A card capture (share preview, email signature) must be a landscape PNG. */
export function captureShapeOk(width: number, height: number): boolean {
  const ratio = width / Math.max(1, height);
  return width >= 300 && ratio >= 1.25 && ratio <= 2.4;
}
