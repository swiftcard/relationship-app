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

function alreadyDisclosed(text: string, disclosure: string): boolean {
  const t = text.toLowerCase();
  if (disclosure && t.includes(disclosure.toLowerCase())) return true;
  return /\b(i|we) (work on|work at|built|make|run|founded|co-?founded) swift\s?card\b/i.test(text);
}

export function applyDisclosure(text: string, opts: { on: boolean; disclosure: string }): string {
  if (!opts.on || !opts.disclosure.trim() || !isPromotional(text) || alreadyDisclosed(text, opts.disclosure)) return text;
  return `${text.trimEnd()}\n\n${opts.disclosure.trim()}`;
}

export function hasRequiredDisclosure(text: string, opts: { on: boolean; disclosure: string }): boolean {
  return !opts.on || !isPromotional(text) || alreadyDisclosed(text, opts.disclosure);
}
