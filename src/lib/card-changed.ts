// "Did anything the card actually SHOWS change?"
//
// Two cached artifacts are snapshots of the card — the share-preview PNG that
// iMessage/WhatsApp render for a card link, and the Swift Signature PNG that
// automated emails sign off with. Both must be invalidated when the card
// changes, and the owner must be nudged to re-copy their signature.
//
// The trap is the inverse: doing that when NOTHING changed. Opening the editor
// and pressing Save, or an office admin reviewing an employee's card and
// saving it untouched, would otherwise delete both PNGs and drop a "your card
// changed" notification about an edit that never happened.
//
// Two routes need this rule — the owner's own save (api/cards/[id]) and an
// office admin's save (api/office/cards/[id]) — so it lives here. A second copy
// is how they drift apart, and the drift is invisible: the wrong answer is a
// notification, not an error.

import { SOCIAL_KEYS, cardShowsSocials, isLinksPageOnlyKey } from "./signature-content";

/** Fields rendered ON the card. `label` is an internal name and is NOT one. */
export const ON_CARD_SCALARS = [
  "name", "title", "company", "phone", "email", "website",
  "linkedin", "instagram", "twitter", "tiktok", "template", "logo_url",
] as const;

/**
 * Stable, key-order-independent JSON. Postgres jsonb does not preserve key
 * order, so a re-saved-but-identical customization blob comes back reordered
 * and a naive JSON.stringify comparison reports a design change every time.
 */
export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    return Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((o, k) => {
      o[k] = canonicalize((v as Record<string, unknown>)[k]);
      return o;
    }, {});
  }
  return v;
}

/**
 * The blob without its CLEARED keys — null, undefined or "".
 *
 * The editor sends every design key it knows on every save, `null` for "not
 * set". So the first save of a card made before a key existed adds, say,
 * `titleColor: null` where the stored blob has no such key at all. Both mean
 * the template's own value (templateStyle reads null, "" and absent alike),
 * and the scalars above already compare `?? ""`. Without this, that save read
 * as a change: both PNGs thrown away and the owner told to re-copy a signature
 * that had not changed — once per card, every time a design key is added.
 */
function withoutCleared(cust: unknown): unknown {
  if (!cust || typeof cust !== "object" || Array.isArray(cust)) return cust;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cust as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

/**
 * True only when a submitted field holds a value DIFFERENT from the stored one.
 *
 * `before` must be a row selected before the write, and it must include every
 * column in `scalars` — a column missing from the select reads as undefined and
 * makes any non-empty submitted value look like a change, which is the exact
 * false positive this exists to prevent.
 */
export function cardContentChanged(
  before: Record<string, unknown>,
  updates: Record<string, unknown>,
  scalars: readonly string[] = ON_CARD_SCALARS,
): boolean {
  for (const k of scalars) {
    // `k in updates` matters: a field the form didn't submit is not a change,
    // even if the stored value is non-empty.
    if (k in updates && String(updates[k] ?? "") !== String(before[k] ?? "")) return true;
  }
  if ("customization" in updates) {
    return (
      JSON.stringify(canonicalize(withoutCleared(updates.customization ?? {}))) !==
      JSON.stringify(canonicalize(withoutCleared(before.customization ?? {})))
    );
  }
  return false;
}

/**
 * The customization blob is a grab bag: card design (colors, font, photo) and
 * on-card info (bio, phones, address, extra socials) share it with the Swift
 * Links list (`links`) and internal `_`-prefixed bookkeeping (_claimDraftId…).
 * The email-signature image renders NONE of the latter — so editing your
 * links, or an internal flag churning, must not tell the owner "you changed
 * your card, re-copy your signature" (owner bug report 2026-08-25: the nudge
 * fired for edits the signature doesn't show).
 */
function stripSignatureIrrelevant(cust: unknown, keepSocials: boolean): unknown {
  if (!cust || typeof cust !== "object" || Array.isArray(cust)) return cust;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cust as Record<string, unknown>)) {
    // Swift Links page keys (links, bio, every link* style, hideCardLink) —
    // the same rule the signature capture uses, so they can't disagree.
    if (k.startsWith("_") || isLinksPageOnlyKey(k)) continue;
    // Socials kept in customization (facebook, snapchat, youtube).
    if (!keepSocials && (SOCIAL_KEYS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Like cardContentChanged, but answering the SIGNATURE's question: did
 * anything the signature/card visual actually shows change? The owner's rule
 * (2026-09-24): "Update your signature" is for the card and card design only —
 * never Socials or Social design. So the customization diff ignores `links`,
 * every Swift Links page key and `_`-internal keys, and social handles count
 * only on a card that actually draws them (cardShowsSocials — a Custom card
 * with a socials block). Use this to gate the signature_stale notification
 * (and the signature PNG invalidation). Wallet passes and the share-preview
 * capture DO show links, so they keep the full cardContentChanged.
 */
export function signatureContentChanged(
  before: Record<string, unknown>,
  updates: Record<string, unknown>,
  scalars: readonly string[] = ON_CARD_SCALARS,
): boolean {
  const pick = (k: string) => (k in updates ? updates[k] : before[k]);
  // Before OR after: a card that drew socials and no longer does changed its
  // layout, which the customization diff below reports on its own.
  const keepSocials =
    cardShowsSocials(pick("template"), pick("customization")) ||
    cardShowsSocials(before.template, before.customization);
  for (const k of scalars) {
    if (!keepSocials && (SOCIAL_KEYS as readonly string[]).includes(k)) continue;
    if (k in updates && String(updates[k] ?? "") !== String(before[k] ?? "")) return true;
  }
  if ("customization" in updates) {
    return (
      JSON.stringify(canonicalize(withoutCleared(stripSignatureIrrelevant(updates.customization ?? {}, keepSocials)))) !==
      JSON.stringify(canonicalize(withoutCleared(stripSignatureIrrelevant(before.customization ?? {}, keepSocials))))
    );
  }
  return false;
}
