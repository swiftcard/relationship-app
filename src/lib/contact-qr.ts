// The Contact QR — the one SwiftCard code that works with NO signal on either
// phone.
//
// Every other code SwiftCard draws (Show QR, the card's printed QR, the Wallet
// pass, the widget, the watch, an NFC tag) carries a LINK, and a link needs
// internet on the phone that scans it. At a conference with no service that is
// a dead end. A vCard written into the QR itself is not: the scanning phone's
// camera reads the contact straight out of the code and offers "Add to
// Contacts" with no network at all (iOS Camera and Android's camera/Lens both
// do this natively). The contact carries the card link, tagged
// ?source=contact_qr, so the full card is one tap away once they have signal.
//
// What it leaves out, and why: a PHOTO is tens of kilobytes and a QR tops out
// near 2 KB, so there is no picture; the bio (NOTE) and socials would make the
// code too dense to scan off a phone screen. Everything else matches the vCard
// the card page's Save Contact button hands over, field for field — a contact
// saved by scanning and one saved by tapping must be the same contact.

import { escapeVCardValue, normalizeVCardUrl, type VCardAddress, type VCardPhone } from "@/lib/vcard";
import { unitLine } from "@/lib/address-unit";
import { withSource } from "@/lib/share-source";

/**
 * About 450 bytes keeps the code at QR version 16 or below at error-correction
 * level M (81×81 modules) — dense, but it still reads off a phone screen at
 * arm's length. A typical card (name, title, company, two phones, email,
 * website, address, card link) is ~330.
 */
export const CONTACT_QR_MAX_BYTES = 450;

export type ContactQrPerson = {
  name: string;
  title?: string | null;
  company?: string | null;
  email?: string | null;
  phones?: VCardPhone[] | null;
  /** Legacy single phone — used only when `phones` is empty. */
  phone?: string | null;
  website?: string | null;
  address?: VCardAddress | null;
  /** The card link, already tagged with its source. */
  cardUrl: string;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/**
 * A `cards` row (or a legacy profile-card row) → the contact the Contact QR
 * carries. Field for field the resolution in
 * src/app/api/card/[username]/vcard/route.ts, which is what Save Contact hands
 * a phone — so both ways of getting someone's contact give the same contact.
 */
export function contactPersonFromCardRow(row: Record<string, unknown>, appUrl: string): ContactQrPerson | null {
  const username = str(row.username)?.toLowerCase();
  if (!username) return null;
  const custom = (row.customization ?? {}) as Record<string, unknown>;
  const phones = (Array.isArray(custom.phones) ? custom.phones : [])
    .filter((p): p is VCardPhone => !!(p as VCardPhone)?.number?.trim());
  const addr = (custom.address ?? {}) as Record<string, unknown>;
  return {
    name: str(row.name) ?? username,
    title: str(row.title),
    company: str(row.company),
    email: str(row.email),
    phone: str(row.phone),
    phones: phones.length ? phones : undefined,
    website: str(row.website),
    address: {
      street: str(addr.street),
      unit: str(addr.unit),
      city: str(addr.city),
      state: str(addr.state),
      zip: str(addr.zip),
    },
    cardUrl: withSource(`${appUrl.replace(/\/+$/, "")}/${username}`, "contact_qr"),
  };
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * The Contact QR is drawn in the card's own QR colours, like every other code.
 * But it is four or five times denser than the link QR, and a pairing that a
 * 33×33 link code survives can fail at 77×77. Below 7:1 contrast it falls back
 * to dark on white, so the code always scans.
 */
export function contactQrColors(bg: string, fg: string): { bg: string; fg: string } {
  const a = luminance(bg);
  const b = luminance(fg);
  if (a === null || b === null || a <= b) return { bg: "#ffffff", fg: "#111827" };
  return (a + 0.05) / (b + 0.05) >= 7 ? { bg, fg } : { bg: "#ffffff", fg: "#111827" };
}

/**
 * The vCard text the Contact QR encodes. When a card holds more than fits,
 * the least-needed fields go first — address, then website, then phones past
 * the second, then title, then the remaining extra phone and the company —
 * while the name, a way to reach them and the card link always stay.
 */
export function buildContactQr(person: ContactQrPerson): string {
  const esc = escapeVCardValue;
  const allPhones = (Array.isArray(person.phones) ? person.phones : []).filter((p) => p?.number?.trim());

  const draw = (o: { address: boolean; website: boolean; maxPhones: number; title: boolean; company: boolean }) => {
    const name = (person.name || "").trim();
    const parts = name.split(" ");
    const first = parts[0] ?? "";
    const rest = parts.slice(1).join(" ");
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${esc(name)}`, `N:${esc(rest)};${esc(first)};;;`];
    if (o.title && person.title) lines.push(`TITLE:${esc(person.title)}`);
    if (o.company && person.company) lines.push(`ORG:${esc(person.company)}`);
    if (allPhones.length) {
      for (const p of allPhones.slice(0, o.maxPhones)) {
        // Same typing as buildVCard: an "Office" number is WORK, anything else CELL.
        const type = String(p.label).toLowerCase() === "office" ? "WORK" : "CELL";
        lines.push(`TEL;TYPE=${type}:${esc(p.number)}`);
      }
    } else if (person.phone) {
      lines.push(`TEL:${esc(person.phone)}`);
    }
    if (person.email) lines.push(`EMAIL;TYPE=WORK:${esc(person.email)}`);
    if (o.website && person.website) lines.push(`URL:${esc(normalizeVCardUrl(person.website))}`);
    lines.push(`URL;type=SwiftCard:${esc(person.cardUrl)}`);
    const a = person.address;
    if (o.address && a && (a.street || a.city || a.state || a.zip)) {
      const street = [a.street, unitLine(a.unit)].filter(Boolean).join(" ");
      lines.push(`ADR;TYPE=WORK:;;${esc(street)};${esc(a.city)};${esc(a.state)};${esc(a.zip)};`);
    }
    lines.push("END:VCARD");
    return lines.join("\r\n");
  };

  const steps = [
    { address: true, website: true, maxPhones: 99, title: true, company: true },
    { address: false, website: true, maxPhones: 99, title: true, company: true },
    { address: false, website: false, maxPhones: 99, title: true, company: true },
    { address: false, website: false, maxPhones: 2, title: true, company: true },
    { address: false, website: false, maxPhones: 2, title: false, company: true },
    { address: false, website: false, maxPhones: 1, title: false, company: true },
    { address: false, website: false, maxPhones: 1, title: false, company: false },
  ];
  let out = "";
  for (const s of steps) {
    out = draw(s);
    if (bytes(out) <= CONTACT_QR_MAX_BYTES) return out;
  }
  return out;
}
