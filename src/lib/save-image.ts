import { detectNativeApp } from "@/lib/platform";

// Saving a PNG we drew in the page — the card or its QR — so it lands where
// the person expects a picture to land.
//
// THE BUG THIS EXISTS FOR. In the iOS app both downloads used to open the
// share sheet with the card LINK, because WKWebView ignores an <a download>
// of a generated image. "Download card (PNG)" sent a URL and the QR button was
// relabelled "Share QR link" — neither gave you a picture (owner, 2026-10-06).
//
// On a phone, and always in the app, the image goes to the share sheet as a
// FILE: iOS then offers "Save Image" (Photos), Android "Save"/"Download". This
// is the Web Share API, so it reaches every installed build without a native
// plugin (Info.plist already carries NSPhotoLibraryAddUsageDescription).
// On a computer it is an ordinary download.
//
// iOS only opens a share sheet shortly after a tap. A capture that takes too
// long comes back NotAllowedError — "needs-tap": the caller shows the picture
// with its own Save button (SavePictureSheet), whose tap is fresh.

export type SaveResult = "saved" | "cancelled" | "needs-tap";

/** True where a picture should go through the share sheet, not a download. */
export function prefersShareSheet(): boolean {
  if (typeof window === "undefined") return false;
  if (detectNativeApp()) return true;
  return navigator.maxTouchPoints > 0 && window.matchMedia?.("(pointer: coarse)").matches === true;
}

export function pngFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: "image/png" });
}

export function canShareFile(file: File): boolean {
  return typeof navigator !== "undefined"
    && typeof navigator.share === "function"
    && typeof navigator.canShare === "function"
    && navigator.canShare({ files: [file] });
}

/** The share sheet with the picture in it. */
export async function sharePicture(file: File): Promise<SaveResult> {
  try {
    await navigator.share({ files: [file] });
    return "saved";
  } catch (e) {
    // AbortError: they closed the sheet — that is an answer, not a failure.
    if ((e as { name?: string } | null)?.name === "AbortError") return "cancelled";
    return "needs-tap";
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export async function saveImage(blob: Blob, filename: string): Promise<SaveResult> {
  if (prefersShareSheet()) {
    const file = pngFile(blob, filename);
    if (canShareFile(file)) return sharePicture(file);
    // The app cannot follow a download at all; show the picture instead.
    if (detectNativeApp()) return "needs-tap";
    // A phone browser without file sharing still downloads.
  }
  downloadBlob(blob, filename);
  return "saved";
}
