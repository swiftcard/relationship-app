"use client";

import { useRef, useState } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import QRDownloadButton from "@/components/QRDownloadButton";
import CopyButton from "@/components/CopyButton";
import NFCWriter from "@/components/NFCWriter";
import AddToWalletButton from "@/components/AddToWalletButton";
import DownloadCardButton from "@/components/DownloadCardButton";
import { useCardCapture } from "@/components/CardCaptureContext";
import { qrScanUrl } from "@/lib/share-source";

// Traffic attribution for everything QR in here lives in lib/share-source —
// every surface that renders a QR of the same card must agree, or the QR
// number in Traffic reads zero again. The CARD LINK field keeps the plain URL
// for copying.

/**
 * One list, the same on a phone, in the app and on a computer (owner,
 * 2026-10-06): Apple Wallet first, then the two pictures, then the link, then
 * NFC. The big QR picture that sat here on desktop is gone — Show QR, right
 * above this button, already shows it full size.
 *
 * @param walletUsername Card slug to offer "Add to Apple Wallet" for, or
 *   undefined to omit it. Optional because the wallet certificates may not be
 *   configured, and because /preview renders this modal for a sample card that
 *   nobody should be putting in their Wallet.
 */
export default function MoreShareOptions({ url, walletUsername }: { url: string; walletUsername?: string }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Escape closes, focus lands inside, and returns to "Other ways to share"
  // afterwards. The popup used to be reachable only by mouse.
  useDialogA11y(open, () => setOpen(false), panelRef);
  const qrUrl = qrScanUrl(url);
  // null unless a card registered a capturable node next to us. /preview also
  // renders this modal and draws its card in an <iframe>, so there is nothing
  // to rasterize there — it offers the QR picture only.
  const capture = useCardCapture();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full py-2.5 transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
        </svg>
        Other ways to share
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 pt-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))]" style={{ background: "rgba(0,0,0,0.6)" }} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="share-options-title" className="w-full max-w-sm bg-gray-950 border border-gray-800 rounded-2xl p-5 max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <p id="share-options-title" className="text-white font-semibold text-sm">Share options</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="-mr-2 -mt-2 w-10 h-10 flex items-center justify-center rounded-full text-gray-500 hover:text-white hover:bg-gray-800 text-xl leading-none transition-colors">×</button>
            </div>

            <div className="space-y-5">
              {/* Apple Wallet — first (owner, 2026-10-06: "I don't like how
                  it's on the bottom"). It still lives only here, not in the
                  Your Card box beside the primary share action. */}
              {walletUsername && (
                <section data-share-option="wallet">
                  <SectionLabel title="Apple Wallet" hint="your card on your iPhone, ready to scan" />
                  <AddToWalletButton username={walletUsername} />
                </section>
              )}

              {/* Pictures — both save a real PNG, in the app too
                  (lib/save-image). The QR is the same tile Show QR draws. */}
              <section data-share-option="pictures">
                <SectionLabel title="Save as a picture" hint="for a slide, a flyer or your lock screen" />
                <div className="space-y-2">
                  {capture && (
                    <DownloadCardButton
                      cardRef={capture.cardRef}
                      filename={capture.filename}
                      compact
                      prepare
                      label="Download card (PNG)"
                    />
                  )}
                  <QRDownloadButton url={qrUrl} compact />
                </div>
              </section>

              <section data-share-option="link">
                <SectionLabel title="Card link" hint="put it in your bio" />
                <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700/60 rounded-xl px-3 py-2.5">
                  <svg viewBox="0 0 16 16" fill="#3b82f6" className="w-3.5 h-3.5 shrink-0"><path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8S12.42 0 8 0zm1 11.93V13H7v-1.07A6.003 6.003 0 012.07 7H4v-.5h-.93A6.003 6.003 0 017 1.07V2h2v1.07A6.003 6.003 0 0113.93 6.5H12V7h1.93A6.003 6.003 0 019 11.93z" /></svg>
                  <span className="text-blue-400 text-xs truncate flex-1">{url.replace("https://", "")}</span>
                  <CopyButton text={url} />
                </div>
              </section>

              {/* NFC card / tag — program a physical tag so a tap opens this
                  card. Writes directly on Android Chrome; everywhere else the
                  component hands over the link + a free NFC-app path. */}
              <section data-share-option="nfc">
                <SectionLabel title="NFC card" hint="tap any phone to open your card" />
                <NFCWriter url={url} />
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SectionLabel({ title, hint }: { title: string; hint: string }) {
  return (
    <p className="mb-2 text-[0.6875rem] leading-snug">
      <span className="text-gray-400 font-semibold uppercase tracking-wide">{title}</span>
      <span className="text-gray-600"> · {hint}</span>
    </p>
  );
}
