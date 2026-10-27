// ── Disclosure: promotion always says who is talking ────────────────────────
// The voice is "a normal person who uses SwiftCard", but undisclosed promotion
// breaks the FTC endorsement rules and most platforms' terms. So every draft
// that mentions SwiftCard carries the owner's disclosure line (Settings →
// Disclosure, on by default). A comment that never mentions the product needs
// none. propose() applies this to every outward draft; tests pin it.

const PRODUCT = /\bswift\s?card\b|swiftcard\.me/i;

export function isPromotional(text: string): boolean {
  return PRODUCT.test(text);
}

/** "I built…", "we made…", "I'm building…", "which I built", "my app": the writer says it's theirs. */
const OWNS = /\b(i|we)(?:'m|'re| am| are)?\s+(?:the one who\s+)?(work on|work at|built|build|building|made|make|making|run|started|founded|co-?founded)\b|\bwhich (i|we) (built|made|run)\b|\b(my|our) (own )?(app|tool|product|company|startup)\b/i;

function alreadyDisclosed(text: string, disclosure: string): boolean {
  const t = text.toLowerCase();
  if (disclosure && t.includes(disclosure.toLowerCase())) return true;
  // Said naturally, in the sentence that names SwiftCard (the voice asks for that instead of a tacked-on line).
  return text.split(/(?<=[.!?])\s+|\n+/).some((s) => PRODUCT.test(s) && OWNS.test(s));
}

export function applyDisclosure(text: string, opts: { on: boolean; disclosure: string }): string {
  if (!opts.on || !opts.disclosure.trim() || !isPromotional(text) || alreadyDisclosed(text, opts.disclosure)) return text;
  return `${text.trimEnd()}\n\n${opts.disclosure.trim()}`;
}

export function hasRequiredDisclosure(text: string, opts: { on: boolean; disclosure: string }): boolean {
  return !opts.on || !isPromotional(text) || alreadyDisclosed(text, opts.disclosure);
}
