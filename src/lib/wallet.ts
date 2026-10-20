import { PKPass } from "passkit-generator";
import { X509Certificate } from "node:crypto";
import type { WalletDesign } from "@/lib/wallet-strip";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export type WalletCard = {
  username: string;
  name: string;
  title?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  cardUrl: string; // full https URL the pass barcode/link points at
  /**
   * The card's nickname (cards.label) — "Malve Capital", "Personal".
   *
   * This is what names the pass, not the person's name. Someone with three
   * cards has three passes all reading "Aaron Lavi — SwiftCard", which is
   * exactly as useful as no name at all. Falls back to the person's name for
   * a card that never got a nickname.
   */
  label?: string | null;
};

// Pass images are committed under /public/wallet and served by the CDN — fetched
// here rather than read from disk (files in /public aren't on the serverless FS).
async function loadAsset(name: string): Promise<Buffer> {
  const res = await fetch(`${APP_URL}/wallet/${name}`);
  if (!res.ok) throw new Error(`wallet asset ${name}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Build a SIGNED .pkpass for a card. Only called when hasWalletConfig() is true,
// so the Apple certificate env vars are guaranteed present.
//
// With `design` (the normal path): a storeCard whose band is composed from the
// card's own colours, textures and parts, and whose chrome is the card's
// details side — one continuous surface on a single-colour card, the card's
// second colour on a two-tone one (wallet-palette). Without it: the original
// fixed navy generic pass, kept as the degrade path so a strip-render failure
// still ships a pass.
/**
 * Days until the Pass Type ID certificate expires (null if unreadable).
 * Apple issues these for about a year; an expired one turns every "Add to
 * Apple Wallet" into a 500 with no warning, so the builder logs at 30 days.
 */
export function passCertDaysLeft(pem: string | undefined = process.env.APPLE_PASS_CERT_PEM): number | null {
  if (!pem) return null;
  try {
    const cert = new X509Certificate(pem);
    return Math.floor((new Date(cert.validTo).getTime() - Date.now()) / 86_400_000);
  } catch {
    return null;
  }
}

let certWarnedAt = 0;
function warnIfCertExpiring(): void {
  // Once an hour per instance is plenty — this is a heads-up, not telemetry.
  if (Date.now() - certWarnedAt < 3_600_000) return;
  const days = passCertDaysLeft();
  if (days === null) return;
  if (days < 0) console.error(`[wallet] Pass Type ID certificate EXPIRED ${-days} days ago — renew it in the Apple Developer portal and update APPLE_PASS_CERT_PEM/KEY_PEM (keep WALLET_AUTH_SECRET set so installed passes keep updating).`);
  else if (days <= 30) console.warn(`[wallet] Pass Type ID certificate expires in ${days} days — renew it before then.`);
  certWarnedAt = Date.now();
}

/**
 * Apple draws secondary fields on ONE row (~375pt shared). "PHONE" + a long
 * email on that row gets the email cut to "firstname.lastn…". Past this
 * length the email takes the row alone and the phone moves to the auxiliary
 * row beneath it — still on the face, never truncated.
 */
export const EMAIL_SHARES_ROW_MAX = 24;

export async function buildPkpass(card: WalletCard, design?: WalletDesign): Promise<Buffer> {
  warnIfCertExpiring();
  const { passAuthToken } = await import("@/lib/wallet-registry");
  const authToken = passAuthToken(card.username);
  const webServiceUrl = `${APP_URL}/api/wallet`;

  // NO logo.png and NO logoText — owner's call, 2026-08-12. That asset is the
  // lightning-bolt SwiftCard wordmark, and Apple draws it across the top of the
  // pass face, above the band. It put our brand on the one surface that is
  // supposed to be the cardholder's, and it competed with the name for the
  // first thing the eye lands on. The pass is somebody's business card; the
  // "Made with SwiftCard" line lives in the card page's Save Contact section
  // (it appears once a visitor saves), not here.
  //
  // icon.png STAYS. It is required by Apple (a pass without it fails
  // validation) but never appears on the pass face — only in the lock-screen
  // and notification presentations.
  const [icon, icon2, icon3] = await Promise.all([
    loadAsset("icon.png"),
    loadAsset("icon@2x.png"),
    loadAsset("icon@3x.png"),
  ]);

  const files: Record<string, Buffer> = {
    "icon.png": icon,
    "icon@2x.png": icon2,
    "icon@3x.png": icon3,
    ...(design
      ? { "strip.png": design.strips.x1, "strip@2x.png": design.strips.x2, "strip@3x.png": design.strips.x3 }
      : {}),
  };

  const pass = new PKPass(
    files,
    {
      wwdr: process.env.APPLE_WWDR_PEM as string,
      signerCert: process.env.APPLE_PASS_CERT_PEM as string,
      signerKey: process.env.APPLE_PASS_KEY_PEM as string,
      signerKeyPassphrase: process.env.APPLE_PASS_KEY_PASSWORD || undefined,
    },
    {
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID as string,
      teamIdentifier: process.env.APPLE_TEAM_ID as string,
      serialNumber: card.username,
      organizationName: "SwiftCard",
      description: `${(card.label ?? "").trim() || card.name} | SwiftCard`,
      // No logoText either — it is the text equivalent of the wordmark and
      // lands in the same place on the pass face. `organizationName` above is
      // not drawn there; it names the pass's issuer in Settings and in the
      // system prompt when a pass is added, which is where it belongs.
      foregroundColor: design?.theme.foregroundColor ?? "rgb(255, 255, 255)",
      backgroundColor: design?.theme.backgroundColor ?? "rgb(13, 27, 62)",
      labelColor: design?.theme.labelColor ?? "rgb(147, 197, 253)",
      // The update channel. With these two keys iOS registers the pass against
      // our web service on add, and a silent push can bring a redesign to a
      // pass someone is already carrying — without them a pass is frozen at
      // whatever it looked like the day it was downloaded, forever.
      //
      // Both or neither: a webServiceURL without a token makes every device
      // call an endpoint that can only 401 them.
      ...(webServiceUrl && authToken
        ? { webServiceURL: webServiceUrl, authenticationToken: authToken }
        : {}),
    }
  );

  // QR of the card URL — scanning the pass opens the live card on the other
  // person's phone. (Phone-to-phone NFC is not possible for a Wallet pass:
  // the nfc key requires Apple's VAS partner certification, and iPhones can't
  // read passes off other iPhones anyway. The scan IS the tap.)
  //
  // On EVERY tier, bare included — owner's final spec 2026-08-11: card art up
  // top, Apple's big QR filling the bottom. (It was briefly removed as a
  // duplicate of the QR inside the card art; the real pass then read as
  // empty, and the in-art QR renders too small to scan reliably anyway.)
  pass.setBarcodes({
    message: card.cardUrl,
    format: "PKBarcodeFormatQR",
    messageEncoding: "iso-8859-1",
    altText: "Scan to connect",
  });

  if (design) {
    // storeCard = the strip-capable layout. The band carries the identity
    // (name, title, company in the card's own colours), so the fields below it
    // hold only the contact details.
    //
    // These rows are not decoration. Between the band and Apple's barcode block
    // sits a third of the pass that nothing else can fill, and the previous
    // design left it deliberately empty — which is most of why the pass read as
    // unfinished. Two rows of real information, on the same surface the band
    // ends on, is what makes the whole face look composed.
    pass.type = "storeCard";
    const longEmail = !!card.email && card.email.length > EMAIL_SHARES_ROW_MAX;
    if (card.phone && !longEmail) pass.secondaryFields.push({ key: "phone", label: "PHONE", value: prettyPhone(card.phone) });
    if (card.email) pass.secondaryFields.push({ key: "email", label: "EMAIL", value: card.email });
    if (card.phone && longEmail) pass.auxiliaryFields.push({ key: "phone", label: "PHONE", value: prettyPhone(card.phone) });
  } else {
    pass.type = "generic";
    pass.primaryFields.push({ key: "name", label: "", value: card.name });
    if (card.title) pass.secondaryFields.push({ key: "title", label: "TITLE", value: card.title });
    if (card.company) pass.secondaryFields.push({ key: "company", label: "COMPANY", value: card.company });
    if (card.phone) pass.auxiliaryFields.push({ key: "phone", label: "PHONE", value: prettyPhone(card.phone) });
    if (card.email) pass.auxiliaryFields.push({ key: "email", label: "EMAIL", value: card.email });
  }

  // The back of the pass (the "..." button) is the only place with room for
  // detail, and it was nearly empty — just a bare URL. Someone who opens it
  // should find everything the card holds and understand what the pass is FOR,
  // since a Wallet pass with no explanation reads like a coupon that failed.
  pass.backFields.push({
    key: "about",
    label: "About this pass",
    value:
      "Your SwiftCard, ready to share. Show the QR code on the front and the other person's camera opens your live card — no app needed on their side. Edit your card at any time and this pass keeps pointing at the current version.",
  });
  pass.backFields.push({ key: "open", label: "Your card", value: card.cardUrl });
  if (card.phone) pass.backFields.push({ key: "phone-back", label: "Phone", value: prettyPhone(card.phone) });
  if (card.email) pass.backFields.push({ key: "email-back", label: "Email", value: card.email });
  if (card.website) pass.backFields.push({ key: "website", label: "Website", value: card.website });

  return pass.getAsBuffer();
}

/**
 * Human-readable US phone formatting for the pass.
 *
 * Deliberately a local copy rather than an import of formatPhone() from
 * card-templates/shared.tsx: that module also exports React components, and
 * this file runs inside a serverless route where pulling a component module in
 * for four lines of string work is the wrong trade. Anything that is not a
 * recognisable US number is returned untouched, so international numbers are
 * never mangled.
 */
function prettyPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
}
