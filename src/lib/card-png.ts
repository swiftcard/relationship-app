// A PNG of the card exactly as the Your Card box draws it. Shared by the
// "Download" under the card and "Download card (PNG)" in Other ways to share,
// and called ahead of time when that popup opens on a phone (see
// lib/save-image — iOS only lets a share sheet open shortly after the tap).

// Inline every <img> src as a data URL before capturing — html-to-image
// re-fetches images while rasterizing and can drop them otherwise. Falls back
// to the same-origin image proxy when a remote host blocks the direct fetch.
async function inlineImages(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll("img"));
  await Promise.all(imgs.map(async (img) => {
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) return;
    const candidates = [src];
    if (/^https?:\/\//.test(src)) candidates.push(`/api/img-proxy?url=${encodeURIComponent(src)}`);
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) continue;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onloadend = () => resolve(r.result as string);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = dataUrl;
          setTimeout(resolve, 3000);
        });
        return;
      } catch { /* try next candidate */ }
    }
  }));
}

/** Decoded in place rather than fetch(dataUrl): no network stack, no CSP. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Rasterize the card node at 3×. Throws when the capture comes back blank. */
export async function captureCardPng(el: HTMLElement): Promise<Blob> {
  // Neutralize any display scaling so the capture is full resolution.
  const prevTransform = el.style.transform;
  try {
    el.style.transform = "none";
    await inlineImages(el);
    await new Promise((r) => setTimeout(r, 120)); // let reflow settle

    // Same proven recipe as the share/signature captures: html-to-image
    // (handles Tailwind 4's oklch colors, which html2canvas chokes on) with
    // the node rendered natively larger — pixelRatio-only upscaling is blurry.
    const { toPng } = await import("html-to-image");
    const w = el.offsetWidth || 460;
    const h = el.offsetHeight || 263;
    const SCALE = 3;
    const dataUrl = await Promise.race([
      toPng(el, {
        width: w * SCALE,
        height: h * SCALE,
        pixelRatio: 1,
        cacheBust: false,
        style: { transform: `scale(${SCALE})`, transformOrigin: "top left" },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20000)),
    ]);
    if (!dataUrl || dataUrl.length < 5000) throw new Error("blank capture");
    return dataUrlToBlob(dataUrl);
  } finally {
    el.style.transform = prevTransform;
  }
}
