"use client";

// "Spread the word" — one-tap sharing of the user's REFERRAL link (so every
// share can earn them a free month) across the channels people actually use.
// Native share sheet first on mobile; explicit per-network intents as the grid.

import { useState } from "react";
import { detectNativeApp, useIsNativeApp } from "@/lib/platform";
import { shareNatively } from "@/lib/native-share";

const PITCH = "I use SwiftCard as my digital business card — one tap to share my info and it auto-saves every contact. Grab a free one:";

export default function GrowShare({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const native = useIsNativeApp();

  const enc = encodeURIComponent;
  const text = `${PITCH} `;

  const targets: { label: string; color: string; href: string; icon: React.ReactNode }[] = [
    {
      label: "X",
      color: "#000000",
      href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(link)}`,
      icon: <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />,
    },
    {
      label: "LinkedIn",
      color: "#0A66C2",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(link)}`,
      icon: <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />,
    },
    {
      label: "WhatsApp",
      color: "#25D366",
      href: `https://wa.me/?text=${enc(text + link)}`,
      icon: <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.488" />,
    },
    {
      label: "Email",
      color: "#6b7280",
      href: `mailto:?subject=${enc("You should try SwiftCard")}&body=${enc(text + "\n\n" + link)}`,
      icon: <path d="M1.5 8.67v8.58a3 3 0 003 3h15a3 3 0 003-3V8.67l-8.928 5.493a3 3 0 01-3.144 0L1.5 8.67z M22.5 6.908V6.75a3 3 0 00-3-3h-15a3 3 0 00-3 3v.158l9.714 5.978a1.5 1.5 0 001.572 0L22.5 6.908z" />,
    },
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  async function nativeShare() {
    // In the iOS shell this button did nothing: WKWebView may not expose
    // navigator.share at all (so it fell through to copy(), which flips the
    // label on a DIFFERENT button and looks like nothing happened), and when it
    // does exist a rejection was swallowed as "cancelled". The Capacitor plugin
    // is the real native share sheet — the same path ShareButton and
    // ShareMyInfoButton already take. Only a missing plugin falls through:
    // closing the sheet used to open the web sheet right after it
    // (lib/native-share.ts).
    if (detectNativeApp()) {
      if ((await shareNatively({ text: PITCH, url: link })) !== "unavailable") return;
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ text: PITCH, url: link }); return; } catch { /* cancelled */ }
    }
    copy();
  }

  return (
    <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5">
      <p className="text-gray-200 text-sm font-medium mb-1">Spread the word</p>
      <p className="text-gray-500 text-xs mb-4 leading-relaxed">
        {native
          ? "Share your invite anywhere — help more people discover SwiftCard."
          : "Share your invite anywhere — every friend who joins moves you toward a free month of Pro."}
      </p>

      <button
        type="button"
        onClick={nativeShare}
        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold py-3 rounded-full transition-colors mb-3"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" /></svg>
        Share invite
      </button>

      <div className="grid grid-cols-4 gap-2 mb-2">
        {targets.map((t) => (
          <a
            key={t.label}
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-gray-800/60 hover:bg-gray-800 border border-gray-700/60 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill={t.color === "#000000" ? "#e5e7eb" : t.color} className="w-5 h-5">{t.icon}</svg>
            <span className="text-[0.625rem] text-gray-400 font-medium">{t.label}</span>
          </a>
        ))}
      </div>

      <button
        type="button"
        onClick={copy}
        className="w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-xs font-semibold py-2.5 rounded-full transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
        {copied ? "Copied ✓" : "Copy invite link"}
      </button>
    </div>
  );
}
