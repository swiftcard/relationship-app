"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import CopyButton from "@/components/CopyButton";
import { useIsNativeApp } from "@/lib/platform";

// Program a physical NFC tag so a tap opens this card. Web NFC can WRITE tags
// only on Android Chrome; everywhere else (iPhone especially) we hand the user
// the link to write with a free NFC app. Either way the tag just holds the card
// URL — which already works — so there's nothing server-side to "turn on".
type Status = "idle" | "writing" | "done" | "error";

const noSubscribe = () => () => {};
/** How long a write waits for a tag before giving up. */
const WRITE_TIMEOUT_MS = 60_000;
const hasWebNfc = () => "NDEFReader" in window;

export default function NFCWriter({ url }: { url: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");
  // Inside the iOS shell WKWebView has no Web NFC, so a "Write to a tag"
  // button could only ever fail after the tap (App Review 2.1 "broken
  // control"). Native gets just the manual path, which genuinely works.
  const isNative = useIsNativeApp();
  // The same is true of every browser without Web NFC — Safari on an iPhone,
  // and every computer. They used to get the blue button anyway, and learned
  // only after tapping it that it could not work there (owner, 2026-10-07:
  // everything has to make sense for the device it is on). So the button
  // exists exactly where it can write, and everywhere else the app path IS
  // the instruction. false on the server and at hydration, so markup matches.
  const canWrite = useSyncExternalStore(noSubscribe, hasWebNfc, () => false) && !isNative;
  // Tag taps get their own analytics source (the dashboard's traffic-source
  // breakdown already knows "nfc_card") — appended only if the caller didn't
  // pass query params of its own.
  const tagUrl = url.includes("?") ? url : `${url}?source=nfc_card`;

  // A write waits for a tag until it gets one. With no way to stop it the
  // button stayed "Waiting for a tag…" until a reload, and the next tag that
  // brushed the phone — one in a pocket — was written (audit C02-011). So it
  // can be cancelled (the same button), gives up after a minute, and stops
  // when the page goes away.
  const pending = useRef<AbortController | null>(null);
  const timedOut = useRef(false);
  useEffect(() => () => pending.current?.abort(), []);

  async function write() {
    if (pending.current) { pending.current.abort(); return; } // tap again = cancel
    const ctrl = new AbortController();
    pending.current = ctrl;
    timedOut.current = false;
    const timer = setTimeout(() => { timedOut.current = true; ctrl.abort(); }, WRITE_TIMEOUT_MS);
    setStatus("writing");
    setMsg("Hold a blank NFC tag against the back of your phone… Tap the button again to cancel.");
    try {
      const Reader = (window as unknown as { NDEFReader: new () => { write: (m: unknown, o?: { signal?: AbortSignal }) => Promise<void> } }).NDEFReader;
      const reader = new Reader();
      await reader.write({ records: [{ recordType: "url", data: tagUrl }] }, { signal: ctrl.signal });
      setStatus("done");
      setMsg("Done! Tapping this tag now opens your card.");
    } catch (e) {
      if (pending.current !== ctrl) return; // unmounted
      setStatus("error");
      const m = e instanceof Error ? `${e.name} ${e.message}` : "";
      setMsg(timedOut.current
        ? "No tag found — tap “Write to a tag” to try again."
        : /cancel|abort/i.test(m)
          ? "Canceled — tap “Write to a tag” again when you’re ready."
          : "Couldn’t write. Turn NFC on, and use a blank or rewritable tag.");
    } finally {
      clearTimeout(timer);
      if (pending.current === ctrl) pending.current = null;
    }
  }

  return (
    <div>
      <p className="text-gray-300 text-[0.8125rem] leading-relaxed mb-3">
        Buy any blank NFC tag or card, write your link to it once, then a phone tap opens your card — no app for them.
      </p>

      {canWrite && (
      <button
        type="button"
        onClick={write}
        className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-full py-2.5 transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 8.32a7.43 7.43 0 010 7.36M9 5.5a11 11 0 010 13M4.5 12h.01" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 4.5v15a2 2 0 002 2h3a2 2 0 002-2v-15a2 2 0 00-2-2h-3a2 2 0 00-2 2z" />
        </svg>
        {status === "writing" ? "Waiting for a tag… (tap to cancel)" : "Write to a tag"}
      </button>
      )}

      {canWrite && status !== "idle" && (
        <p className={`text-xs mt-2 ${status === "done" ? "text-emerald-400" : status === "error" ? "text-amber-400" : "text-gray-400"}`}>
          {msg}
        </p>
      )}

      {/* The link to write — on every device. Where the button exists it is
          the fallback; everywhere else it is the way. */}
      <div className={canWrite ? "mt-3 pt-3 border-t border-gray-800" : ""}>
        <p className="text-gray-500 text-[0.6875rem] mb-1.5">
          {canWrite
            ? "Or write it yourself with an NFC app — use this link:"
            : "Write it with a free NFC app on your phone, like NFC Tools — use this link:"}
        </p>
        <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700/60 rounded-xl px-3 py-2.5">
          <span className="text-blue-400 text-xs truncate flex-1">{tagUrl.replace(/^https?:\/\//, "")}</span>
          <CopyButton text={tagUrl} />
        </div>
      </div>
    </div>
  );
}
