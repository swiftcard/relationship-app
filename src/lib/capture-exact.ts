// ── Every card picture at the card's real type sizes ─────────────────────────
//
// Owner, 2026-10-07: the Swift Signature "has to look exactly like the card
// they created. The spacing, the colors … on one the logo's a little bigger and
// there's more spacing between stuff."
//
// The cause was inside html-to-image (1.11.13, clone-node.js). Copying each
// element's computed style into the picture, it ROUNDS EVERY FONT SIZE DOWN and
// takes another 0.1px off:
//
//     if (name === 'font-size' && value.endsWith('px'))
//       value = `${Math.floor(parseFloat(value)) - 0.1}px`
//
// Card rows are sized to the exact room they have (container-query units in
// card-templates/shared), so they land on fractions: a 19.8px phone number was
// drawn at 18.9px, a 13.9px email at 12.9px. Line heights and every box are
// copied as they are, so each row stayed where it was with smaller text in it —
// more air between the rows, and the logo (an image, untouched) looking bigger
// beside the shrunken name. Every picture of a card had it: the signature, the
// texted-link preview, Download PNG.
//
// The library skips that branch when the computed style carries a cssText —
// it then copies the declaration whole, exact. No engine fills it in any more
// (Chromium and WebKit both return ""), so for the node being captured we hand
// the library one built from the same computed values. Everything else about
// the capture is unchanged. Scoped to the captured node and only for the
// duration of the call; any other getComputedStyle caller is untouched.
// tests/render/card-capture-exact.test.ts holds the picture to the card.
//
// Owner, 2026-10-20: a new Photo First card's signature had "MOBILE" on top of
// the email and the email broken into "…malvecapital.co / m". The library also
// copies every box's width, and card rows are sized to fill theirs exactly
// (the email was 204.6px of text in a 204.6px box). Drawn inside the picture,
// text can come out a fraction of a pixel wider than on the page, and with no
// room to spare it wraps: the next line lands on the row below, whose box is
// copied at its own height and doesn't move. So text the card didn't wrap is
// told not to wrap in the picture either (keepLines below). A tenth of a
// pixel past the box is invisible; a line break is not.

import type { Options } from "html-to-image/lib/types";
import { within } from "@/lib/time-limit";

const roots = new Set<Node>();
let nativeGetComputedStyle: typeof window.getComputedStyle | null = null;

/** The whole computed declaration as text, which the library copies exactly. */
function fullCssText(cs: CSSStyleDeclaration): string {
  let text = "";
  for (let i = 0; i < cs.length; i++) {
    const name = cs[i];
    text += `${name}: ${cs.getPropertyValue(name)}${cs.getPropertyPriority(name) ? " !important" : ""}; `;
  }
  return text;
}

const drawn = (rects: Iterable<DOMRect>) => Array.from(rects).filter((r) => r.width > 0 && r.height > 0);

/** A text-only element (an email, a name, an address) the card drew without
 *  wrapping: one box per line, and no more lines than the text itself breaks
 *  into. Counted, not overlap-tested: glyph boxes overlap between the lines
 *  of a tightly-leaded name. Comments are allowed (hydrated text carries
 *  them); any child element means it isn't text-only and is left alone. */
function textKeepsLines(elt: Element, cs: CSSStyleDeclaration): string {
  const nodes = Array.from(elt.childNodes);
  const text = elt.textContent ?? "";
  if (!text.trim() || !nodes.every((n) => n.nodeType === Node.TEXT_NODE || n.nodeType === Node.COMMENT_NODE)) return "";
  const keepsBreaks = /pre|break-spaces/.test(cs.whiteSpace);
  const range = document.createRange();
  range.selectNodeContents(elt);
  const lines = drawn(range.getClientRects()).length;
  if (!keepsBreaks) return lines === 1 ? "white-space: nowrap; " : "";
  // An address keeps its own breaks and gains none. That takes the longhand:
  // the `white-space` shorthand has no "keep breaks, collapse spaces, don't
  // wrap". An engine without it (iOS before 17.4) is left as it was.
  const collapse = cs.getPropertyValue("white-space-collapse");
  if (!collapse || lines !== text.split("\n").filter((l) => l.trim()).length) return "";
  return `white-space-collapse: ${collapse}; text-wrap-mode: nowrap; `;
}

/** A wrapping flex row (a phone number and its "MOBILE") whose items all sat
 *  on one line in the card: items on one flex line share a band, and flex
 *  lines never overlap. Only plain `wrap` with the default align-content,
 *  where one flex line lays out exactly as `nowrap` does. */
function rowKeepsLine(elt: Element, cs: CSSStyleDeclaration): string {
  if (!cs.display.endsWith("flex") || cs.flexWrap !== "wrap" || !/^(normal|stretch)$/.test(cs.alignContent)) return "";
  const boxes = drawn(Array.from(elt.children, (c) => c.getBoundingClientRect()));
  const oneLine = boxes.length > 1 && Math.max(...boxes.map((b) => b.top)) < Math.min(...boxes.map((b) => b.bottom));
  return oneLine ? "flex-wrap: nowrap; " : "";
}

/** Appended to an element's copied style so the picture wraps nothing the
 *  card didn't. Later declarations win. */
function keepLines(elt: Element, cs: CSSStyleDeclaration): string {
  return textKeepsLines(elt, cs) + rowKeepsLine(elt, cs);
}

/** Inside a captured node — through shadow roots, which contains() doesn't see into. */
function inCapture(node: Node): boolean {
  let n: Node | null = node;
  while (n) {
    for (const r of roots) if (r.contains(n)) return true;
    const top = n.getRootNode();
    n = top instanceof ShadowRoot ? top.host : null;
  }
  return false;
}

function hold(root: Node): () => void {
  roots.add(root);
  if (!nativeGetComputedStyle) {
    const native = window.getComputedStyle;
    nativeGetComputedStyle = native;
    window.getComputedStyle = function (elt: Element, pseudo?: string | null) {
      const cs = native.call(window, elt, pseudo);
      if (pseudo || cs.cssText || !inCapture(elt)) return cs;
      let text: string | null = null;
      return new Proxy(cs, {
        get(target, key) {
          if (key === "cssText") return (text ??= fullCssText(target) + keepLines(elt, target));
          const v = Reflect.get(target, key, target);
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    } as typeof window.getComputedStyle;
  }
  return () => {
    roots.delete(root);
    if (!roots.size && nativeGetComputedStyle) {
      window.getComputedStyle = nativeGetComputedStyle;
      nativeGetComputedStyle = null;
    }
  };
}

/** html-to-image's toPng, with every font drawn at its real size. */
export async function toPngExact(node: HTMLElement, options?: Options, timeoutMs = 20_000): Promise<string> {
  // Never waits forever: the library's createImage calls `img.decode()` with
  // no rejection handler and then waits for a requestAnimationFrame, so a
  // decode WebKit refuses (or a tab in the background) left the promise
  // pending for good, with the getComputedStyle patch above still installed.
  // Past `timeoutMs` it rejects and lets go of the patch; every caller already
  // treats a failed picture as one to retry or fall back from.
  const { toPng } = await import("html-to-image");
  const release = hold(node);
  try {
    return await within(toPng(node, options), timeoutMs);
  } finally {
    release();
  }
}
