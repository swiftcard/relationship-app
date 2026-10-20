import { isAndroidAppRequest, isNativeRequest } from "@/lib/native-request";

// WHO GETS THE NEW-CARD WALLET PROMPT (components/WalletPrompt) — one pure
// rule, decided on the server so the prompt is in the first HTML and the Share
// box never jumps after hydration.
//
//   • the card is NEW: made on or after the day the prompt shipped. Cards from
//     before were never "just created", and their owners already found Wallet
//     or didn't want it — nobody's dashboard changes overnight.
//   • it hasn't been pressed or closed (cards.wallet_prompt_done_at empty).
//     A row with no such key at all means the column isn't migrated yet:
//     nothing is shown, rather than a prompt that could never be closed.
//   • the device (owner, 2026-10-19):
//       apple  — the iPhone/iPad APP only, never Safari, a Mac or a PC. The
//                Mac build of the iPhone app is filtered by CSS (globals.css
//                .sc-wallet-prompt), the one thing the server can't see.
//       google — any Android phone or tablet, the app or a browser.
//     Each only when that wallet is configured, so it is never a dead button.

/** The day the prompt shipped. Cards created before it never show it. */
export const WALLET_PROMPT_SINCE = "2026-10-19T00:00:00Z";

export type WalletPromptKind = "apple" | "google";

export function walletPromptKind(opts: {
  card: Record<string, unknown> | null;
  userAgent: string | null;
  shellCookie: string | null;
  appleWallet: boolean;
  googleWallet: boolean;
}): WalletPromptKind | null {
  const { card, userAgent, shellCookie } = opts;
  if (!card) return null;
  if (!Object.prototype.hasOwnProperty.call(card, "wallet_prompt_done_at")) return null;
  if (card.wallet_prompt_done_at) return null;
  const created = typeof card.created_at === "string" ? Date.parse(card.created_at) : NaN;
  if (!(created >= Date.parse(WALLET_PROMPT_SINCE))) return null;

  const ua = userAgent ?? "";
  if (/Android/i.test(ua) || isAndroidAppRequest(ua)) return opts.googleWallet ? "google" : null;
  if (isNativeRequest(ua, shellCookie)) return opts.appleWallet ? "apple" : null;
  return null;
}
