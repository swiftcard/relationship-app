// ── How much a card can hold ─────────────────────────────────────────────────
//
// Owner, 2026-10-02: details must always fill the card, never overlap, and
// never cover or be cut off by the QR — "even if every single field is added".
// That promise needs a ceiling: with unlimited phone numbers and unlimited
// text, some card always ends up with text too small to read. So the card
// SHOWS at most this much. Every template is measured at exactly these limits
// (tests/render/card-every-template.test.ts), so anything inside them is
// guaranteed to fit.
//
// The editor stops typing at these lengths, the save routes clamp to them,
// and the templates clamp again when they render — so a card saved before
// the limits existed, or imported from a scanned card, still fits. Nothing
// stored is ever deleted: a 5th phone number stays saved, it just isn't
// printed on the card.

/** Phone numbers printed on the card (more can be saved). */
export const MAX_CARD_PHONES = 4;

/** Characters per field. */
export const CARD_FIELD_MAX = {
  name: 60,
  title: 80,
  company: 60,
  email: 80,
  website: 80,
  phone: 30,
  fax: 30,
  /** Each line of the address (street, unit, city/state/zip). */
  addressLine: 60,
} as const;

/** Address lines printed on the card. */
export const MAX_ADDRESS_LINES = 3;

export type CardField = keyof typeof CARD_FIELD_MAX;

/** A value cut to its field's limit (trimmed; never throws on null). */
export function clampField(field: CardField, value: string | null | undefined): string {
  const v = (value ?? "").trim();
  const max = CARD_FIELD_MAX[field];
  return v.length > max ? v.slice(0, max).trimEnd() : v;
}

/** An address as printed: at most MAX_ADDRESS_LINES lines, each clamped. */
export function clampAddress(value: string | null | undefined): string {
  return (value ?? "")
    .split("\n")
    .map((l) => clampField("addressLine", l))
    .filter(Boolean)
    .slice(0, MAX_ADDRESS_LINES)
    .join("\n");
}

/**
 * A card write, clamped to the limits — the save routes' backstop for an
 * older client, the API, or anything else that skips the editor's maxLength.
 * Only the fields the card prints are touched; everything else passes through.
 */
export function clampCardWrite<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const f of ["name", "title", "company", "phone", "email", "website"] as const) {
    if (typeof out[f] === "string") out[f] = clampField(f, out[f] as string);
  }
  const c = out.customization;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const cust: Record<string, unknown> = { ...(c as Record<string, unknown>) };
    if (typeof cust.fax === "string") cust.fax = clampField("fax", cust.fax);
    if (Array.isArray(cust.phones)) {
      cust.phones = cust.phones.map((p) =>
        p && typeof p === "object" && typeof (p as { number?: unknown }).number === "string"
          ? { ...(p as object), number: clampField("phone", (p as { number: string }).number) }
          : p);
    }
    const a = cust.address;
    if (a && typeof a === "object" && !Array.isArray(a)) {
      const addr: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      for (const k of ["street", "city"]) if (typeof addr[k] === "string") addr[k] = clampField("addressLine", addr[k] as string);
      if (typeof addr.unit === "string") addr.unit = (addr.unit as string).trim().slice(0, 20);
      if (typeof addr.zip === "string") addr.zip = (addr.zip as string).trim().slice(0, 10);
      cust.address = addr;
    }
    out.customization = cust;
  }
  return out as T;
}
