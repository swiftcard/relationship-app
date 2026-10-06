import type { CardData } from "@/components/card-templates/types";
import { CARD_FIELD_MAX, MAX_CARD_PHONES } from "@/lib/card-limits";

// ── Card content people can actually produce ─────────────────────────────────
//
// Shared by the every-template sweep. Production-true on purpose:
//   • phone labels are the two the editor offers (mobile, office);
//   • logos and headshots are real images with real aspect ratios — a missing
//     "/demo/avatar.svg" renders as a broken 0×0 image and proves nothing;
//   • "everything" means every field at the limits in lib/card-limits, which
//     is exactly the ceiling the product promises to fit.

const svg = (w: number, h: number, fill: string) =>
  "data:image/svg+xml;utf8," +
  // width/height make it behave like an uploaded PNG, which always carries its
  // own pixel size (uploads are JPEG/PNG/WebP/GIF only — api/upload ALLOWED).
  // A viewBox-only SVG has no intrinsic size and renders as a dot in any frame
  // sized only by max-width/max-height, which no real logo ever does.
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`);

export const LOGOS: Record<string, string> = {
  banner: svg(500, 100, "#e11d48"),
  square: svg(200, 200, "#0ea5e9"),
  crest: svg(100, 200, "#16a34a"),
};
export const HEADSHOT = svg(300, 300, "#a855f7");

/** A string of exactly `n` characters that reads like the real thing. */
function fill(seed: string, n: number): string {
  let s = seed;
  while (s.length < n) s += seed;
  return s.slice(0, n).trimEnd().padEnd(n, "x");
}

const ph = (number: string, label: "mobile" | "office") => ({ number, label, showOnCard: true });

export const BASE: CardData = {
  name: "Alex Morgan",
  title: "Realtor",
  company: "Coastline Realty",
  phone: "",
  email: "",
  website: "",
  initials: "AM",
  photoUrl: null,
  logoUrl: null,
  cardUrl: "swiftcard.me/card/alexmorgan",
};

const PHONE = "(415) 555-0188";
const EMAIL = "alex@coastlinerealty.com";
const WEBSITE = "coastlinehomes.com";
const ADDR = "1200 Ocean Ave, Suite 400\nSan Francisco, CA 94122";

// ── Values at the limits ─────────────────────────────────────────────────────
const L = CARD_FIELD_MAX;
export const MAX = {
  name: fill("Bartholomew Alexander Fitzgerald-Montgomery Whitfield ", L.name),
  title: fill("Senior Vice President of Business Development & Strategic Partnerships ", L.title),
  company: fill("Northwind Commercial Real Estate Advisors International ", L.company),
  // Unbroken where people's addresses are unbroken: the local part and domain.
  email: fill("bartholomew.fitzgerald-montgomery", L.email - "@northwind-advisors.com".length) + "@northwind-advisors.com",
  website: "www." + fill("northwind-commercial-real-estate-advisors-international-", L.website - "www.".length - ".com".length) + ".com",
  phone: fill("+1 (512) 555-0147 ext. 889123456", L.phone),
  fax: fill("+1 (415) 555-0100 ext. 7788991", L.fax),
  address: [
    fill("1200 Ocean Avenue, Suite 400, Building C North Tower ", L.addressLine),
    fill("Kensington Court Mansions, Cromwell Road Apartments ", L.addressLine),
    fill("San Francisco, CA 94122-4471 United States of America ", L.addressLine),
  ].join("\n"),
};

const maxPhones = Array.from({ length: MAX_CARD_PHONES }, (_, i) =>
  ph(MAX.phone.replace(/\d(?=\D*$)/, String(i)), i % 2 ? "office" : "mobile"));

/** From one thing on the card to everything at the limits. */
export const SCENARIOS: Array<[string, CardData]> = [
  // ── one thing ──────────────────────────────────────────────────────────
  ["name only", BASE],
  ["name only, no title or company", { ...BASE, title: "", company: "" }],
  // ── every two-field pair ───────────────────────────────────────────────
  ["phone + email", { ...BASE, phone: PHONE, email: EMAIL }],
  ["phone + website", { ...BASE, phone: PHONE, website: WEBSITE }],
  ["phone + address", { ...BASE, phone: PHONE, address: ADDR }],
  ["email + website", { ...BASE, email: EMAIL, website: WEBSITE }],
  ["email + address", { ...BASE, email: EMAIL, address: ADDR }],
  ["phone + fax", { ...BASE, phone: PHONE, customization: { fax: "(415) 555-0100" } }],
  ["two phones", { ...BASE, customization: { phones: [ph(PHONE, "mobile"), ph("(415) 555-0199", "office")] } }],
  // ── ordinary ───────────────────────────────────────────────────────────
  ["typical", { ...BASE, phone: PHONE, email: EMAIL, website: WEBSITE }],
  ["typical + address + logo + photo", { ...BASE, phone: PHONE, email: EMAIL, website: WEBSITE, address: ADDR,
    logoUrl: LOGOS.square, photoUrl: HEADSHOT }],
  ["typical + banner logo", { ...BASE, phone: PHONE, email: EMAIL, website: WEBSITE, logoUrl: LOGOS.banner }],
  ["typical + crest logo", { ...BASE, phone: PHONE, email: EMAIL, website: WEBSITE, logoUrl: LOGOS.crest }],
  // ── each limit on its own ──────────────────────────────────────────────
  ["longest name only", { ...BASE, name: MAX.name }],
  ["longest title only", { ...BASE, title: MAX.title, phone: PHONE }],
  ["longest company only", { ...BASE, company: MAX.company, phone: PHONE, logoUrl: LOGOS.banner }],
  ["longest email only", { ...BASE, email: MAX.email }],
  ["longest website only", { ...BASE, website: MAX.website }],
  ["longest address only", { ...BASE, address: MAX.address }],
  ["four phones at the limit", { ...BASE, customization: { phones: maxPhones } }],
  // ── everything at the limits ───────────────────────────────────────────
  ["everything, ordinary lengths", { ...BASE, phone: "", email: EMAIL, website: WEBSITE, address: ADDR,
    logoUrl: LOGOS.square, photoUrl: HEADSHOT,
    customization: { fax: "(415) 555-0100", phones: [ph(PHONE, "mobile"), ph("(415) 555-0199", "office"),
      ph("(415) 555-0177", "mobile"), ph("(415) 555-0166", "office")] } }],
  ["everything at the limits", { ...BASE, name: MAX.name, title: MAX.title, company: MAX.company,
    email: MAX.email, website: MAX.website, address: MAX.address,
    logoUrl: LOGOS.banner, photoUrl: HEADSHOT,
    customization: { fax: MAX.fax, phones: maxPhones } }],
  ["everything at the limits, crest logo", { ...BASE, name: MAX.name, title: MAX.title, company: MAX.company,
    email: MAX.email, website: MAX.website, address: MAX.address,
    logoUrl: LOGOS.crest, photoUrl: HEADSHOT,
    customization: { fax: MAX.fax, phones: maxPhones } }],
];

/** Every typeface an owner can pick, plus the unset default. */
export const FONTS: Array<[string, string | undefined]> = [
  ["default", undefined],
  ["sans", "var(--font-geist-sans), system-ui, sans-serif"],
  ["serif", "Georgia, 'Times New Roman', serif"],
  ["mono", "'Courier New', ui-monospace, monospace"],
  ["rounded", "'Trebuchet MS', system-ui, sans-serif"],
];

export function withFont(data: CardData, fontFamily: string | undefined): CardData {
  return fontFamily ? { ...data, customization: { ...(data.customization ?? {}), fontFamily } } : data;
}
