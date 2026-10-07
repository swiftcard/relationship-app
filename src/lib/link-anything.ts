// ── Create + : make anything open your SwiftCard (browser only) ─────────────
//
// The owner pastes something — an email signature from Gmail / Outlook / Apple
// Mail / Word, a block of text — and gets back the SAME thing, looking exactly
// the same, where every word and every picture opens one link (owner,
// 2026-10-07: "if anyone clicks anywhere on that email signature, it takes the
// person to the link").
//
// How "looks exactly the same" holds up in every mail app:
//   1. The paste is parsed inertly (DOMParser runs nothing) and stripped of
//      anything that could act: scripts, frames, forms, event handlers,
//      javascript: URLs, remote CSS.
//   2. It is RENDERED in a sandboxed iframe (no allow-scripts) with its own
//      <style> rules, so Outlook's class-based markup resolves the way it did
//      where it was copied from.
//   3. It is rebuilt from that render as plain, allow-listed tags with the
//      COMPUTED styles written inline — the only styling every mail client
//      keeps. Inherited values are written only where they change, others
//      only where they differ from the default, so the HTML stays small.
//   4. Every text run is wrapped in <a href=LINK> carrying its own colour and
//      no underline (mail apps otherwise paint links blue and underlined), and
//      every picture in <a href=LINK>. Per-run links, not one link around a
//      table: Outlook on Windows ignores a link wrapped around a table.
//      Existing links become plain text first — one link everywhere, as asked.
//
// Pictures: http(s) ones stay where they are; data:/blob: ones (a screenshot
// pasted from Apple Mail, say) are returned as `pending` for the caller to
// upload, because no mail app keeps an inline picture; cid:/file: ones point at
// a file on the sender's own computer and cannot be kept — they are counted in
// `dropped` so the person can be told.

import { EMAIL_MAX_WIDTH } from "@/lib/create-link";
import { pixelsOf } from "@/lib/capture-verify";

export const MAX_PASTE_CHARS = 400_000;
const MAX_ELEMENTS = 3000;
export const MAX_IMAGES = 8;

/** The base the paste is rendered on when it names no font of its own —
 *  close to Gmail's and Outlook's defaults. */
const BASE_FONT = "Arial, Helvetica, sans-serif";
const BASE_SIZE = "13px";
const BASE_COLOR = "#222222";
const RENDER_WIDTH = 640;

export class TooMuchError extends Error {}

export type PendingImage = { img: HTMLImageElement; src: string };
export type Linked = {
  /** The linked content, ready to serialize (`root.outerHTML`). */
  root: HTMLElement;
  /** Pictures that must be uploaded before the HTML can leave this page. */
  pending: PendingImage[];
  /** Pictures that could not be kept (cid:, file:, …). */
  dropped: number;
};

// ── 1. Inert parse + strip ───────────────────────────────────────────────────

const STRIP = "script,noscript,template,iframe,frame,frameset,object,embed,applet,meta,link,base,title,form,input,button,select,textarea,option,video,audio,source,track,canvas,svg,math,map,area,dialog,portal";
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "background", "poster", "xlink:href", "data", "lowsrc", "dynsrc", "longdesc"]);

function cleanCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/expression\s*\(/gi, "x(")
    .replace(/(behavior|-moz-binding)\s*:[^;"]*/gi, "")
    .replace(/position\s*:\s*(fixed|sticky)/gi, "position:static");
}

/** A full HTML document holding the paste, safe to render in a sandbox. */
export function renderableDocument(html: string): string {
  if (html.length > MAX_PASTE_CHARS) throw new TooMuchError();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const styles = Array.from(doc.querySelectorAll("style")).map((s) => cleanCss(s.textContent ?? ""));
  doc.querySelectorAll(`style,${STRIP}`).forEach((n) => n.remove());
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      if (name.startsWith("on") || name === "srcset" || name === "style" && /expression|javascript:/i.test(a.value)) { el.removeAttribute(a.name); continue; }
      if (URL_ATTRS.has(name) && !(name === "src" && el.tagName === "IMG") && name !== "href") { el.removeAttribute(a.name); continue; }
      if ((name === "href" || name === "src") && /^\s*(javascript|vbscript|data:text)/i.test(a.value)) el.removeAttribute(a.name);
      if (name === "style") el.setAttribute("style", cleanCss(a.value));
    }
    // A picture that lives only on the sender's computer (cid:, file:) can't
    // load anywhere; point it at nothing so the render doesn't try. It is
    // still counted as `dropped` below.
    if (el.tagName === "IMG" && !/^(https?:|data:image\/|blob:)/i.test(el.getAttribute("src") ?? "")) el.setAttribute("src", "about:blank");
  }
  const base = `html,body{margin:0;padding:0;background:#fff}body{font-family:${BASE_FONT};font-size:${BASE_SIZE};color:${BASE_COLOR};width:${RENDER_WIDTH - 16}px;padding:8px}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}</style>${styles.map((s) => `<style>${s}</style>`).join("")}</head><body>${doc.body.innerHTML}</body></html>`;
}

/** Plain text → the same pipeline: escaped, line breaks kept. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div>${text.replace(/\r\n?/g, "\n").split("\n").map(esc).join("<br>")}</div>`;
}

// ── 2. Render in a sandbox ───────────────────────────────────────────────────

/**
 * Render the cleaned document offscreen and resolve with the frame once its
 * pictures have loaded (or 3s passed). The frame is `sandbox="allow-same-origin"`:
 * readable from here so styles can be computed, unable to run any script.
 * The caller must `remove()` it.
 */
export function renderOffscreen(docHtml: string): Promise<HTMLIFrameElement> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${RENDER_WIDTH}px;height:600px;border:0;opacity:0;pointer-events:none`;
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      const imgs = Array.from(frame.contentDocument?.images ?? []);
      await Promise.race([
        Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise<void>((r) => { i.onload = i.onerror = () => r(); })))),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      resolve(frame);
    };
    frame.addEventListener("load", () => { void finish(); }, { once: true });
    frame.srcdoc = docHtml;
    document.body.appendChild(frame);
    setTimeout(() => { void finish(); }, 5000);
  });
}

// ── 3 + 4. Rebuild with inline styles, link everything ──────────────────────

const KEEP = new Set(["TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "CAPTION", "COLGROUP", "COL", "DIV", "P", "SPAN", "BR", "HR", "B", "STRONG", "I", "EM", "U", "S", "SMALL", "SUB", "SUP", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "IMG"]);
const DEFAULT_DISPLAY: Record<string, string> = {
  TABLE: "table", THEAD: "table-header-group", TBODY: "table-row-group", TFOOT: "table-footer-group", TR: "table-row",
  TD: "table-cell", TH: "table-cell", CAPTION: "table-caption", COLGROUP: "table-column-group", COL: "table-column",
  LI: "list-item", IMG: "inline", SPAN: "inline", B: "inline", STRONG: "inline", I: "inline", EM: "inline", U: "inline",
  S: "inline", SMALL: "inline", SUB: "inline", SUP: "inline", BR: "inline",
};
const ATTRS: Record<string, string[]> = {
  TABLE: ["width", "border", "cellpadding", "cellspacing", "align", "bgcolor"],
  TR: ["align", "valign", "bgcolor"],
  TD: ["width", "height", "align", "valign", "colspan", "rowspan", "bgcolor", "nowrap"],
  TH: ["width", "height", "align", "valign", "colspan", "rowspan", "bgcolor", "nowrap"],
  COL: ["width", "span"], COLGROUP: ["width", "span"],
};
const INHERITED = ["color", "font-family", "font-size", "font-style", "font-weight", "line-height", "letter-spacing", "text-align", "text-transform", "white-space"];
const SIDES = ["top", "right", "bottom", "left"] as const;

/** rgb()/rgba() → #rrggbb (Outlook on Windows reads hex most reliably). */
export function hex(c: string): string | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(c);
  if (!m) return c && c !== "transparent" ? c : null;
  if (m[4] !== undefined && parseFloat(m[4]) < 0.05) return null;
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

function styleFor(cs: CSSStyleDeclaration, parent: CSSStyleDeclaration | null, tag: string, explicitWidth: boolean): string {
  const out: string[] = [];
  for (const p of INHERITED) {
    const v = cs.getPropertyValue(p);
    if (!v || (parent && parent.getPropertyValue(p) === v)) continue;
    if (p === "color") { const h = hex(v); if (h) out.push(`color:${h}`); continue; }
    if ((p === "letter-spacing" || p === "line-height") && v === "normal" && !parent) continue;
    out.push(`${p}:${v}`);
  }
  const bg = hex(cs.getPropertyValue("background-color"));
  if (bg) out.push(`background-color:${bg}`);
  for (const box of ["margin", "padding"] as const) {
    const v = SIDES.map((s) => cs.getPropertyValue(`${box}-${s}`));
    if (v.some((x) => x && x !== "0px")) out.push(`${box}:${v.join(" ")}`);
  }
  for (const s of SIDES) {
    const st = cs.getPropertyValue(`border-${s}-style`);
    const w = cs.getPropertyValue(`border-${s}-width`);
    if (st && st !== "none" && st !== "hidden" && w && w !== "0px") out.push(`border-${s}:${w} ${st} ${hex(cs.getPropertyValue(`border-${s}-color`)) ?? "#000000"}`);
  }
  const radius = cs.getPropertyValue("border-radius");
  if (radius && !/^0px( 0px)*$/.test(radius)) out.push(`border-radius:${radius}`);
  const deco = cs.getPropertyValue("text-decoration-line");
  if (deco && deco !== "none") out.push(`text-decoration:${deco}`);
  const va = cs.getPropertyValue("vertical-align");
  if (va && va !== "baseline" && !(DEFAULT_DISPLAY[tag] === "table-cell" && va === "middle")) out.push(`vertical-align:${va}`);
  const display = cs.getPropertyValue("display");
  const def = DEFAULT_DISPLAY[tag] ?? "block";
  if (display && display !== def && display !== "contents") out.push(`display:${display}`);
  if (tag === "TABLE" && cs.getPropertyValue("border-collapse") === "collapse") out.push("border-collapse:collapse");
  if (explicitWidth) {
    const w = cs.getPropertyValue("width");
    if (w && w !== "auto") out.push(`width:${w}`);
  }
  const mw = cs.getPropertyValue("max-width");
  if (mw && mw !== "none") out.push(`max-width:${mw}`);
  if ((tag === "UL" || tag === "OL")) {
    const lst = cs.getPropertyValue("list-style-type");
    if (lst && lst !== (tag === "UL" ? "disc" : "decimal")) out.push(`list-style-type:${lst}`);
  }
  return out.join(";");
}

function isBlockish(display: string): boolean {
  return /^(block|flex|grid|list-item|table|flow-root)/.test(display);
}

/**
 * Rebuild the rendered paste as linked, inline-styled, allow-listed HTML.
 * `href` goes on every link (the caller may swap it later by string).
 */
export function linkEverything(frame: HTMLIFrameElement, href: string): Linked {
  const win = frame.contentWindow!;
  const srcBody = frame.contentDocument!.body;
  const out = document.implementation.createHTMLDocument("");
  const pending: PendingImage[] = [];
  let dropped = 0;
  let count = 0;

  const link = (style: string) => {
    const a = out.createElement("a");
    a.setAttribute("href", href);
    a.setAttribute("target", "_blank");
    a.setAttribute("style", style);
    return a;
  };

  const root = out.createElement("div");
  const bodyCs = win.getComputedStyle(srcBody);
  root.setAttribute("style", [
    `font-family:${bodyCs.getPropertyValue("font-family")}`,
    `font-size:${bodyCs.getPropertyValue("font-size")}`,
    `color:${hex(bodyCs.getPropertyValue("color")) ?? BASE_COLOR}`,
  ].join(";"));

  const walk = (srcParent: Element, outParent: Element, parentCs: CSSStyleDeclaration) => {
    for (const node of Array.from(srcParent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        if (!text.trim()) { if (text) outParent.appendChild(out.createTextNode(text)); continue; }
        const a = link(`color:${hex(parentCs.getPropertyValue("color")) ?? BASE_COLOR};text-decoration:none`);
        a.textContent = text;
        outParent.appendChild(a);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as HTMLElement;
      const tag = el.tagName.toUpperCase();
      if (++count > MAX_ELEMENTS) throw new TooMuchError();
      const cs = win.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;

      if (tag === "BR") { outParent.appendChild(out.createElement("br")); continue; }

      if (tag === "IMG") {
        const img = el as HTMLImageElement;
        const src = img.currentSrc || img.getAttribute("src") || "";
        const kind = /^https?:\/\//i.test(src) ? "keep" : /^(data:image\/|blob:)/i.test(src) ? "upload" : "drop";
        if (kind === "drop") { dropped++; continue; }
        const r = img.getBoundingClientRect();
        let w = Math.round(r.width) || Number(img.getAttribute("width")) || img.naturalWidth || 0;
        let h = Math.round(r.height) || Number(img.getAttribute("height")) || img.naturalHeight || 0;
        if (w > EMAIL_MAX_WIDTH) { h = Math.round((h * EMAIL_MAX_WIDTH) / w); w = EMAIL_MAX_WIDTH; }
        const o = out.createElement("img");
        o.setAttribute("src", kind === "keep" ? src : "");
        const alt = img.getAttribute("alt");
        if (alt) o.setAttribute("alt", alt);
        if (w) o.setAttribute("width", String(w));
        if (h) o.setAttribute("height", String(h));
        const own = styleFor(cs, parentCs, "IMG", false);
        o.setAttribute("style", [own, "border:0", w ? `width:${w}px;max-width:100%;height:auto` : ""].filter(Boolean).join(";"));
        if (kind === "upload") pending.push({ img: o, src });
        const a = link("text-decoration:none;border:0");
        a.appendChild(o);
        outParent.appendChild(a);
        continue;
      }

      const outTag = KEEP.has(tag) ? tag : isBlockish(cs.display) ? "DIV" : "SPAN";
      const o = out.createElement(outTag);
      for (const name of ATTRS[outTag] ?? []) {
        const v = el.getAttribute(name);
        if (v !== null && /^[\w%#.\- ]{0,40}$/.test(v)) o.setAttribute(name, v);
      }
      // A width the author set inline is kept as its computed px; a width
      // attribute rides along above for the tags that allow one. Anything
      // else stays fluid, as it was.
      const style = styleFor(cs, parentCs, outTag, !!el.style.width);
      if (style) o.setAttribute("style", style);
      if (outTag === "HR") { outParent.appendChild(o); continue; }
      walk(el, o, cs);
      // An emptied inline wrapper (its only content was dropped) is noise.
      if (!o.hasChildNodes() && (outTag === "SPAN" || outTag === "B" || outTag === "STRONG" || outTag === "I" || outTag === "EM" || outTag === "U" || outTag === "SMALL")) continue;
      outParent.appendChild(o);
    }
  };

  walk(srcBody, root, bodyCs);
  if (pending.length > MAX_IMAGES) throw new TooMuchError();
  return { root, pending, dropped };
}

/** Swap the link every part of `html` opens (placeholder → share link). */
export function relink(html: string, from: string, to: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return html.split(`href="${esc(from)}"`).join(`href="${esc(to)}"`);
}

/** A lone picture, linked, at its natural size up to the email width. */
export function pictureHtml(url: string, naturalW: number, naturalH: number, href: string, alt = ""): string {
  let w = naturalW, h = naturalH;
  if (w > EMAIL_MAX_WIDTH) { h = Math.round((h * EMAIL_MAX_WIDTH) / w); w = EMAIL_MAX_WIDTH; }
  const doc = document.implementation.createHTMLDocument("");
  const div = doc.createElement("div");
  const a = doc.createElement("a");
  a.setAttribute("href", href);
  a.setAttribute("target", "_blank");
  a.setAttribute("style", "text-decoration:none;border:0");
  const img = doc.createElement("img");
  img.setAttribute("src", url);
  if (alt) img.setAttribute("alt", alt);
  img.setAttribute("width", String(w));
  img.setAttribute("height", String(h));
  img.setAttribute("style", `display:block;border:0;width:${w}px;max-width:100%;height:auto`);
  a.appendChild(img);
  div.appendChild(a);
  return div.outerHTML;
}

// ── The share preview picture of a pasted signature ─────────────────────────

const SNAP_SCALE = 2;

/** Something was actually drawn: a few pixels that aren't the white
 *  background. A blank raster (WebKit painting before it's ready) is not a
 *  picture of anything; a byte count can't tell a short signature from one. */
async function hasInk(dataUrl: string): Promise<boolean> {
  const px = await pixelsOf(dataUrl);
  if (!px) return false;
  let ink = 0;
  for (let i = 0; i < px.data.length; i += 4) {
    if (px.data[i + 3] > 0 && (px.data[i] < 235 || px.data[i + 1] < 235 || px.data[i + 2] < 235)) ink++;
    if (ink > 12) return true;
  }
  return false;
}

async function toDataUrl(src: string): Promise<string | null> {
  if (src.startsWith("data:")) return src;
  const candidates = [src];
  if (/^https?:\/\//.test(src)) candidates.push(`/api/img-proxy?url=${encodeURIComponent(src)}`);
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) continue;
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    } catch { /* next */ }
  }
  return null;
}

/**
 * A PNG of the linked content as it will look in an email — the picture its
 * share link previews with in texts and social apps. Drawn from a shadow root,
 * so none of this app's own CSS can touch it (the page's Tailwind reset would
 * otherwise change margins, image display and table borders). Pictures are
 * inlined and DECODED first and the first raster is thrown away: WebKit — every
 * iPhone — paints the SVG before its images otherwise (lib/card-png).
 */
export async function snapshotPng(html: string): Promise<Blob> {
  // The OUTER box is parked offscreen; the captured host inside it is not
  // positioned at all. html-to-image copies the captured node's own computed
  // style into the picture — a host that was itself left:-10000px drew its
  // content 10,000px outside the frame: a blank PNG (seen in WebKit).
  const outer = document.createElement("div");
  outer.setAttribute("aria-hidden", "true");
  outer.style.cssText = "position:fixed;left:-10000px;top:0;pointer-events:none";
  const host = document.createElement("div");
  outer.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>:host{all:initial;display:inline-block;background:#ffffff;padding:16px}</style>${html}`;
  document.body.appendChild(outer);
  try {
    await Promise.all(Array.from(shadow.querySelectorAll("img")).map(async (img) => {
      const src = img.getAttribute("src") || "";
      const data = src ? await toDataUrl(src) : null;
      if (data) {
        await new Promise<void>((resolve) => { img.onload = img.onerror = () => resolve(); img.src = data; setTimeout(resolve, 3000); });
      }
      try { await img.decode(); } catch { /* the size check below decides */ }
    }));
    try { await document.fonts?.ready; } catch { /* fonts API absent */ }
    await new Promise((r) => setTimeout(r, 120));
    const { toPng } = await import("html-to-image");
    const w = Math.ceil(host.getBoundingClientRect().width) || EMAIL_MAX_WIDTH;
    const h = Math.ceil(host.getBoundingClientRect().height) || 200;
    const raster = () => toPng(host, {
      width: w * SNAP_SCALE,
      height: h * SNAP_SCALE,
      pixelRatio: 1,
      cacheBust: false,
      backgroundColor: "#ffffff",
      style: { transform: `scale(${SNAP_SCALE})`, transformOrigin: "top left" },
    });
    await raster().catch(() => null); // primes WebKit's decode; never used
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 250 * attempt));
      const url = await raster().catch(() => null);
      if (url && (await hasInk(url))) {
        const [head, body] = url.split(",");
        const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
        const bin = atob(body);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type });
      }
    }
    throw new Error("snapshot failed");
  } finally {
    outer.remove();
  }
}

/** A saved creation (localStorage) is shown again only if it is still exactly
 *  what this file makes: no scripts, frames or styles, no event handlers, and
 *  every link and picture an http(s) address. */
export function isSafeLinkedHtml(html: string): boolean {
  if (!html || html.length > MAX_PASTE_CHARS) return false;
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (doc.querySelector(`style,${STRIP}`)) return false;
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      if (name.startsWith("on") || name === "srcset") return false;
      if ((name === "href" || name === "src") && !/^https?:\/\//i.test(a.value.trim())) return false;
      if (name === "style" && /url\s*\(|expression|javascript:/i.test(a.value)) return false;
    }
  }
  return true;
}

/** Every visible text run and picture in `root` sits inside a link to `href`
 *  (the promise the page makes; also asserted by the tests). */
export function everythingLinked(root: Element, href: string): boolean {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const inLink = (n.parentElement?.closest("a")?.getAttribute("href") ?? null) === href;
    if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() && !inLink) return false;
    if (n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === "IMG" && !inLink) return false;
    if (n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === "A" && (n as Element).getAttribute("href") !== href) return false;
  }
  return true;
}
