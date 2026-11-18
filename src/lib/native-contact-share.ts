import { detectNativeApp } from "@/lib/platform";

/**
 * A texted card link carries the owner's contact card (iPhone app 1.0.7+).
 *
 * WHY (owner report, 2026-11-18): a card link texted to someone the owner had
 * just met arrived dead, not tappable and with no preview, while the same link
 * worked perfectly for the owner's partner. iMessage switches off links in a
 * message from a number the recipient hasn't saved, and doesn't load their
 * preview, until the recipient replies or saves the sender. Nothing in the link
 * can change that. A contact card attached to the text DOES arrive: one tap,
 * "Create New Contact", and the owner is a known sender. The link turns
 * tappable and the preview loads.
 *
 * Only the app can attach a file to a text (an sms: link carries none, and a
 * browser share sheet can't give a file to Messages alone), so this talks to
 * the shell's ContactShare plugin (ios/App/App/ContactShare.swift). On the
 * website, on Android and in app versions before 1.0.7 the plugin is absent:
 * every function answers "unavailable" and the caller runs the share it always
 * ran. "cancelled" is the person closing the sheet, and is final, the same rule
 * as lib/native-share.ts (no second sheet).
 *
 * Pinned by tests/contact-card-share.test.ts.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export type ContactShareResult = "shared" | "cancelled" | "unavailable";

type Answer = { result?: unknown } | undefined;
type ContactSharePlugin = {
  prepare?: (o: { vcardUrl: string; fileName: string }) => Promise<unknown>;
  share?: (o: { url: string; vcardUrl: string; fileName: string }) => Promise<Answer>;
  text?: (o: { phone: string; body: string; vcardUrl: string; fileName: string }) => Promise<Answer>;
};

/** The card's public contact file (app/api/card/[username]/vcard). Pinned to
 *  the SwiftCard domain like every link we hand out: the shell downloads it
 *  itself, outside the webview. */
export function contactCardFileUrl(slug: string): string {
  return `${APP_URL}/api/card/${encodeURIComponent(slug.trim().toLowerCase())}/vcard`;
}

/** The file's name is what Messages shows under the card: the owner's name. */
function fileNameFor(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n || "Contact";
}

function plugin(): ContactSharePlugin | null {
  if (typeof window === "undefined" || !detectNativeApp()) return null;
  const p = (window as unknown as { Capacitor?: { Plugins?: { ContactShare?: ContactSharePlugin } } })
    .Capacitor?.Plugins?.ContactShare;
  return p && typeof p.share === "function" && typeof p.text === "function" ? p : null;
}

/** True when this app can attach the contact card. Synchronous, so a caller
 *  can still choose the sms: link while the tap is live. */
export function canShareContactCard(): boolean {
  return plugin() !== null;
}

/** Download the card ahead of the tap, so the sheet opens without waiting. */
export function prepareContactCard(opts: { slug: string; name?: string | null }): void {
  const p = plugin();
  if (!p?.prepare || !opts.slug) return;
  void p.prepare({ vcardUrl: contactCardFileUrl(opts.slug), fileName: fileNameFor(opts.name) }).catch(() => {});
}

const answer = (a: Answer): ContactShareResult => (a?.result === "shared" ? "shared" : "cancelled");

/** The share sheet: Messages gets the link and the contact card, every other
 *  app gets the link alone. */
export async function shareLinkWithContact(opts: { url: string; slug: string; name?: string | null }): Promise<ContactShareResult> {
  const p = plugin();
  if (!p?.share || !opts.slug) return "unavailable";
  try {
    return answer(await p.share({ url: opts.url, vcardUrl: contactCardFileUrl(opts.slug), fileName: fileNameFor(opts.name) }));
  } catch {
    // The plugin never rejects a share it opened; a rejection means it could
    // not open one, so today's share runs instead.
    return "unavailable";
  }
}

/** Messages, addressed to `phone`, `body` written, the contact card attached. */
export async function textWithContact(opts: { phone: string; body: string; slug: string; name?: string | null }): Promise<ContactShareResult> {
  const p = plugin();
  if (!p?.text || !opts.slug) return "unavailable";
  try {
    return answer(await p.text({ phone: opts.phone, body: opts.body, vcardUrl: contactCardFileUrl(opts.slug), fileName: fileNameFor(opts.name) }));
  } catch {
    // UNAVAILABLE: this device can't send texts. The sms: link is the fallback.
    return "unavailable";
  }
}
