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
          if (key === "cssText") return (text ??= fullCssText(target));
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
