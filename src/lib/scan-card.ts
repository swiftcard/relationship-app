// Client-side business-card scanning. Mobile camera photos are huge (several MB,
// 4000px+), which makes the AI scan slow and can make the request hang. We
// downscale + JPEG-compress first, and time the request out so the UI never gets
// stuck on a spinner.

export type ScannedCard = {
  name?: string;
  title?: string;
  company?: string;
  phone?: string;
  email?: string;
  website?: string;
};

/** 403 AI_CONSENT_REQUIRED — the user hasn't allowed (or has declined) AI. Not a paywall.
 *
 *  The message names the SwiftCard APP on purpose. The standing AI switch lives
 *  in Settings → Notifications and preferences, and AiConsentSetting renders
 *  NOTHING on the web — the question is only ever asked inside the app, though a
 *  decline made there is honoured everywhere server-side. So "turn them on in
 *  Settings" sent a web user hunting for a switch that is not on their screen
 *  (audit 2026-09-29). This sentence is true on both platforms. */
export class AiConsentRequiredError extends Error {
  constructor(message = "AI features are off for your account. Turn them back on in the SwiftCard app, under Settings → Notifications and preferences.") { super(message); this.name = "AiConsentRequiredError"; }
}

export class ProRequiredError extends Error {
  constructor(message = "Scanning business cards is a Pro feature.") { super(message); this.name = "ProRequiredError"; }
}

/** The card came back with nothing on it we could use — usually a blurry or far-away photo. */
export class EmptyScanError extends Error {
  constructor(message = "Couldn't find any contact details on that card.") { super(message); this.name = "EmptyScanError"; }
}

const SCAN_TIMEOUT_MS = 45_000;

/**
 * `photo` is either a picked file (any size — compressed here) or the
 * scanner camera's capture, which is already cropped to the card and
 * JPEG-compressed (components/CardScanCamera) and goes up as it is: no second
 * decode, no second compression, nothing to wait for.
 */
export async function scanBusinessCard(photo: Blob, opts: { prepared?: boolean } = {}): Promise<ScannedCard> {
  const { base64, mediaType } = opts.prepared
    ? { base64: (await readAsDataURL(photo)).split(",")[1] ?? "", mediaType: photo.type || "image/jpeg" }
    : await compressToBase64(photo);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const res = await fetch("/api/scanner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, mediaType }),
      signal: controller.signal,
    });
    // 403 = the scanner isn't on this plan (it's Pro-only). 402 is kept for
    // safety in case a metered response ever comes back from an older deploy.
    if (res.status === 402 || res.status === 403) {
      const data = await res.json().catch(() => ({} as { message?: string; code?: string }));
      if (data.code === "AI_CONSENT_REQUIRED") throw new AiConsentRequiredError(data.message || undefined);
      throw new ProRequiredError(data.message || undefined);
    }
    if (!res.ok) throw new Error("scan_failed");
    const card = (await res.json()) as ScannedCard;
    // A green "Filled from the card" over four empty fields is worse than an
    // honest "try again".
    if (!card?.name && !card?.email && !card?.phone && !card?.company) throw new EmptyScanError();
    return card;
  } finally {
    clearTimeout(timer);
  }
}

async function compressToBase64(file: Blob): Promise<{ base64: string; mediaType: string }> {
  const dataUrl = await readAsDataURL(file);
  try {
    const img = await loadImage(dataUrl);
    const MAX = 1600;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (Math.max(w, h) > MAX) {
      const s = MAX / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx || !w || !h) return rawFrom(dataUrl);
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", 0.82);
    // Guard against a blank/failed canvas export.
    if (!out || out.length < 1000) return rawFrom(dataUrl);
    return { base64: out.split(",")[1], mediaType: "image/jpeg" };
  } catch {
    // Any decode/canvas failure → send the original bytes rather than nothing.
    return rawFrom(dataUrl);
  }
}

function rawFrom(dataUrl: string): { base64: string; mediaType: string } {
  const [prefix, b64] = dataUrl.split(",");
  const mediaType = prefix.split(":")[1]?.split(";")[0] || "image/jpeg";
  return { base64: b64, mediaType };
}

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read_failed"));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_failed"));
    img.src = src;
  });
}
