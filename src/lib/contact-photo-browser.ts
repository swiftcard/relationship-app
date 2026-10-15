// The picture a saved contact carries — BROWSER SIDE.
//
// Same result as the server's contactPhotoFromBytes (lib/contact-photo), drawn
// on a canvas: a CONTACT_PHOTO_EDGE square JPEG under CONTACT_PHOTO_MAX_BYTES —
// a headshot filling it, a logo whole in the middle on white (dark behind a
// near-white logo). Used when Save Contact builds the file in the browser (a
// computer, or a phone with no signal and no saved copy). An upload used to go
// in as it was: past 700KB it was dropped, and a PNG logo could run past what
// iCloud keeps, so the contact lost its picture after saving.
//
// Checked in Chromium and WebKit, and read back by Apple's Contacts framework,
// in tests/render/contact-photo-apple.test.ts.

import {
  contactLogoBackground, visibleLuminance,
  CONTACT_PHOTO_EDGE, CONTACT_PHOTO_MAX_BYTES, CONTACT_PHOTO_QUALITIES, CONTACT_LOGO_BOX,
  type ContactImageKind, type VCardPhoto,
} from "@/lib/vcard";

/** A picture (as a Blob) → the contact picture, or null when it can't be drawn. */
export async function toContactPhoto(blob: Blob, kind: ContactImageKind): Promise<VCardPhoto | null> {
  const src = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = src;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    const edge = CONTACT_PHOTO_EDGE;
    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    if (kind === "logo") {
      const box = Math.round(edge * CONTACT_LOGO_BOX);
      const s = Math.min(box / w, box / h);
      const dw = Math.round(w * s);
      const dh = Math.round(h * s);
      // Its visible pixels decide the tile: a near-white logo goes on dark.
      let lum: number | null = null;
      try {
        const probe = document.createElement("canvas");
        probe.width = Math.max(1, Math.round(dw / 8));
        probe.height = Math.max(1, Math.round(dh / 8));
        const pctx = probe.getContext("2d");
        if (pctx) {
          pctx.drawImage(img, 0, 0, probe.width, probe.height);
          lum = visibleLuminance(pctx.getImageData(0, 0, probe.width, probe.height).data);
        }
      } catch { /* white it is */ }
      ctx.fillStyle = contactLogoBackground(lum);
      ctx.fillRect(0, 0, edge, edge);
      ctx.drawImage(img, Math.round((edge - dw) / 2), Math.round((edge - dh) / 2), dw, dh);
    } else {
      // Fills the square, centred — the crop the card's round headshot shows.
      const s = Math.max(edge / w, edge / h);
      const dw = w * s;
      const dh = h * s;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, edge, edge);
      ctx.drawImage(img, (edge - dw) / 2, (edge - dh) / 2, dw, dh);
    }
    for (const q of CONTACT_PHOTO_QUALITIES) {
      const m = canvas.toDataURL("image/jpeg", q / 100).match(/^data:(image\/jpeg);base64,(.+)$/);
      if (m && Math.floor((m[2].length * 3) / 4) <= CONTACT_PHOTO_MAX_BYTES) return { base64: m[2], mime: m[1] };
    }
    return null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(src);
  }
}
