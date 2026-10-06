// ── Did the name, logo and photo actually PAINT in a card capture? ───────────
//
// ShareCardCapture's other checks inspect the DOM, and the DOM was always fine.
// What went out missing a name or a logo was the RASTER: html-to-image draws
// the card through an SVG <foreignObject>, and WebKit — the iPhone app and
// Safari, where owners mostly are — can paint that SVG before its embedded
// images and web-font glyphs have decoded. That draw comes back with the name
// or the logo simply absent, and it was uploaded as the share preview.
//
// So the pixels are verified. Rasterise the card a second time with those
// elements hidden (visibility only, so nothing moves) and compare: wherever the
// name or an image sits, the real capture must differ from the hidden one. If
// it doesn't, that element never painted and the capture is rejected (the
// retry is the redraw WebKit needs). Fails OPEN wherever it cannot measure, so
// a card this can't read still gets its capture.
//
// Browser-only and import-free: tests/render/share-capture-verify.test.ts
// runs these exact functions inside Chromium and WebKit.

export type Box = { x: number; y: number; w: number; h: number };

/** Boxes (relative to `el`) that must show ink, and the nodes to hide for the reference raster. */
export function mustPaint(el: HTMLElement, name: string): { boxes: Box[]; hide: HTMLElement[] } {
  const origin = el.getBoundingClientRect();
  const boxes: Box[] = [];
  const hide: HTMLElement[] = [];
  for (const img of Array.from(el.querySelectorAll("img"))) {
    const r = img.getBoundingClientRect();
    const cs = getComputedStyle(img);
    if (r.width < 8 || r.height < 8 || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) continue;
    boxes.push({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
    hide.push(img);
  }
  const words = name
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .map((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu"));
  if (words.length) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const text = n.textContent ?? "";
      const parent = n.parentElement;
      if (!parent || !words.some((re) => re.test(text))) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || getComputedStyle(parent).visibility === "hidden") continue;
      boxes.push({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
      hide.push(parent);
    }
  }
  return { boxes, hide };
}

/** Decode a PNG data URL to pixels; null when the browser can't. */
export async function pixelsOf(dataUrl: string): Promise<ImageData | null> {
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(); img.src = dataUrl; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  } catch {
    return null;
  }
}

/** True when at least 1% of the box (scaled by k) differs between the two rasters. */
export function paintedIn(a: ImageData, b: ImageData, box: Box, k: number): boolean {
  const x0 = Math.max(0, Math.floor(box.x * k)), y0 = Math.max(0, Math.floor(box.y * k));
  const x1 = Math.min(a.width, Math.ceil((box.x + box.w) * k)), y1 = Math.min(a.height, Math.ceil((box.y + box.h) * k));
  let total = 0, changed = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * a.width + x) * 4;
      const d = (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])) / 3;
      total++;
      if (d > 8) changed++;
    }
  }
  return total === 0 || changed / total >= 0.01;
}

/** Do two boxes overlap (by more than a hairline)? */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
}

/**
 * Verify a capture of `el` (`dataUrl`, drawn at `el`'s width `w` × scale) by
 * re-rasterising with the must-paint elements hidden. False only when some
 * element provably did not paint.
 *
 * Elements that overlap are hidden in SEPARATE reference rasters. A name set
 * over the headshot (Photo First, Local Business) hidden together with that
 * headshot would always "differ" — the photo under it changed — so a missing
 * name passed. Each group holds only elements that don't touch, so whatever
 * changes inside a box can only be that element.
 */
export async function capturePainted(
  el: HTMLElement,
  name: string,
  dataUrl: string,
  w: number,
  raster: () => Promise<string | null>,
): Promise<boolean> {
  const { boxes, hide } = mustPaint(el, name);
  if (!boxes.length) return true;
  const groups: number[][] = [];
  boxes.forEach((box, i) => {
    // Two text runs in one element are hidden together, so they share a
    // group; otherwise the first group nothing in which it touches.
    const home = groups.find((g) => g.some((j) => hide[j] === hide[i]))
      ?? groups.find((g) => g.every((j) => !overlaps(boxes[j], box)));
    if (home) home.push(i); else groups.push([i]);
  });
  const a = await pixelsOf(dataUrl);
  if (!a) return true;
  for (const group of groups) {
    const nodes = Array.from(new Set(group.map((i) => hide[i])));
    const was = nodes.map((node) => node.style.visibility);
    nodes.forEach((node) => { node.style.visibility = "hidden"; });
    let without: string | null = null;
    try { without = await raster(); } finally { nodes.forEach((node, i) => { node.style.visibility = was[i]; }); }
    const b = without ? await pixelsOf(without) : null;
    if (!b || a.width !== b.width || a.height !== b.height) continue;
    const k = a.width / w;
    if (!group.every((i) => paintedIn(a, b, boxes[i], k))) return false;
  }
  return true;
}
