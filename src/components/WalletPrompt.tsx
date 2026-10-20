"use client";

import { useEffect, useState } from "react";
import AddToWalletButton from "@/components/AddToWalletButton";
import AddToGoogleWalletButton from "@/components/AddToGoogleWalletButton";
import { track, trackCta } from "@/lib/events";

// THE NEW-CARD WALLET PROMPT (owner, 2026-10-19): a brand-new card opens with
// "Add to Apple Wallet" (iPhone app) or "Add to Google Wallet" (Android) at the
// top of the Share box, above Show QR — a new user does not yet know the
// option lives behind "Other ways to share". Pressing the button OR the X ends
// it for that card for good, on every device; the option itself stays in
// Other ways to share.
//
// WHO SEES IT is decided on the server (dashboard/page.tsx walletPromptKind):
// the card was made after the feature shipped, its wallet_prompt_done_at is
// empty, and the device is the iPhone app or an Android phone. This component
// only draws it and records the ending. A Mac running the iPhone app is hidden
// by CSS before paint (.sc-wallet-prompt, globals.css) — PassKit can't add a
// pass there, and only the shell's data-sc-mac flag can tell.
//
// The Share box is rendered twice (phone and desktop copies, one display:none),
// so ending it here tells the other copy through a window event.
const DONE_EVENT = "sc:wallet-prompt-done";

export default function WalletPrompt({ cardId, username, kind }: { cardId: string; username: string; kind: "apple" | "google" }) {
  const [open, setOpen] = useState(true);
  // Unmounted once the collapse has finished, so nothing invisible is left in
  // the tab order or the Share box's spacing.
  const [gone, setGone] = useState(false);

  useEffect(() => {
    function onDone(e: Event) {
      if ((e as CustomEvent<{ cardId?: string }>).detail?.cardId === cardId) setOpen(false);
    }
    window.addEventListener(DONE_EVENT, onDone);
    return () => window.removeEventListener(DONE_EVENT, onDone);
  }, [cardId]);

  useEffect(() => {
    if (open) return;
    // A timer, not transitionend: the hidden copy never runs its transition,
    // and reduced motion has none to end.
    const t = setTimeout(() => setGone(true), 260);
    return () => clearTimeout(t);
  }, [open]);

  if (gone) return null;

  function finish(how: "added" | "dismissed") {
    if (!open) return;
    // keepalive: on "added" the pass opens at the same moment (a navigation on
    // the web, a system sheet in the app), and a plain fetch can be cancelled
    // by it. The record is what keeps the prompt gone on every other device.
    fetch(`/api/cards/${encodeURIComponent(cardId)}/wallet-prompt`, { method: "POST", keepalive: true }).catch(() => {});
    const method = kind === "apple" ? "apple_wallet" : "google_wallet";
    if (how === "added") {
      track("wallet_pass_added", { placement: "new_card_wallet_prompt", method });
    } else {
      trackCta("wallet_prompt_dismiss", "new_card_wallet_prompt", { method });
    }
    window.dispatchEvent(new CustomEvent(DONE_EVENT, { detail: { cardId } }));
  }

  const walletName = kind === "apple" ? "Apple Wallet" : "Google Wallet";

  return (
    // Collapses instead of vanishing, so Show QR glides up rather than jumping.
    // The Share box's space-y-2 puts its gap on this element's bottom margin
    // (Tailwind 4 spaces with margin-block-end), so the margin closes with the
    // height and nothing shifts when it unmounts.
    <div
      className="sc-wallet-prompt grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0, ...(open ? {} : { marginBottom: 0 }) }}
      inert={!open}
      data-wallet-prompt={kind}
    >
      <div className="min-h-0 overflow-hidden">
        <section
          aria-label={`Add your card to ${walletName}`}
          className="relative rounded-2xl p-4"
          style={{ background: "var(--sc-tint-soft, rgba(37,99,235,0.10))" }}
        >
          {/* A full 44px target, sitting in the corner the panel's padding
              leaves free. */}
          <button
            type="button"
            onClick={() => finish("dismissed")}
            aria-label="Dismiss"
            className="absolute top-1 right-1 w-11 h-11 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-gray-800/60 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-4 h-4" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          {/* pr-9 keeps the heading clear of the X at every width. */}
          <div className="flex items-start gap-2.5 pr-9">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 mt-px shrink-0 text-blue-400" aria-hidden="true">
              <rect x="3" y="6" width="18" height="13" rx="3" />
              <path d="M3 10h18M16 14.5h2" />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white leading-snug">Keep your card in {walletName}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-snug">Show it straight from {walletName}, even with no signal.</p>
            </div>
          </div>

          <div className="mt-3">
            {kind === "apple" ? (
              <AddToWalletButton username={username} onPress={() => finish("added")} />
            ) : (
              <AddToGoogleWalletButton username={username} onPress={() => finish("added")} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
