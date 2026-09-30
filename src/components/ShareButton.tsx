"use client";

import { useEffect, useState } from "react";
import { detectNativeApp } from "@/lib/platform";
import { warmSharePreview } from "@/lib/share-preview";
import { triggerSignupNudge } from "@/lib/nudge";

type Props = {
  url: string;
  title?: string;
  text?: string;
  label?: string;
  /** "ghost" is the dashboard's quiet outline, in Tailwind classes so the
      light theme remaps it (the inline-styled "secondary" is for public and
      marketing surfaces, whose colours never change). */
  variant?: "primary" | "secondary" | "ghost";
  /**
   * The signed-in owner sharing their OWN card (the dashboard). Completed shares
   * then count toward the App Store rating moment — see lib/app-review.ts. Off
   * everywhere else: a visitor sharing someone else's card is not our user's win.
   */
  ownCard?: boolean;
};

// `title` is accepted for backwards compatibility but intentionally not shared —
// see handleShare: only the bare URL guarantees the rich card preview.
export default function ShareButton({
  url,
  text = "Save my contact and connect with me instantly.",
  label = "Share Card",
  variant = "primary",
  ownCard = false,
}: Props) {
  const [status, setStatus] = useState<"idle" | "copied" | "menu">("idle");

  // Records only — the rating sheet is never requested from a tap.
  function shared() {
    if (ownCard) import("@/lib/app-review").then((m) => m.noteReviewMoment("card_shared")).catch(() => {});
  }

  // Heat the link preview before anyone asks for it — once when the button
  // appears, again on tap. See lib/share-preview.ts for the headshot bug this
  // prevents; the tap is the last moment we can act before the messenger
  // fetches the image on its own clock.
  useEffect(() => { warmSharePreview(url); }, [url]);

  async function handleShare() {
    warmSharePreview(url);
    // Native shell: WKWebView often lacks navigator.share — use the native
    // share sheet via the Capacitor plugin. Falls through to the web paths on
    // any failure (plugin missing in an old shell build, user cancel throws).
    //
    // The signup nudge fires AFTER the share resolves, never before: firing on
    // tap rendered the popup BEHIND the OS share sheet, where it burned its
    // once-per-session slot without ever being seen — and a cancelled share is
    // no conversion moment at all. (The popup host only mounts on public
    // pages, so this stays a no-op on the owner's dashboard.)
    if (detectNativeApp()) {
      try {
        const { Share } = await import("@capacitor/share");
        await Share.share({ url });
        shared();
        triggerSignupNudge("share_card");
        return;
      } catch { /* fall through to web share / menu */ }
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        // Share ONLY the link. iMessage (and most messengers) render the rich
        // card preview only when the message is the bare URL — sharing extra
        // text makes it a plain text message with a link and no preview.
        await navigator.share({ url });
        shared();
        triggerSignupNudge("share_card");
        return;
      } catch {
        return; // user cancelled — nothing completed, nothing to nudge about
      }
    }
    setStatus("menu");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
      shared();
      triggerSignupNudge("share_card");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      window.prompt("Copy your card link:", url);
      setStatus("idle");
    }
  }

  function shareWhatsApp() {
    const msg = encodeURIComponent(`${text}\n${url}`);
    window.open(`https://wa.me/?text=${msg}`, "_blank", "noopener,noreferrer");
    shared();
    triggerSignupNudge("share_card");
    setStatus("idle");
  }

  const isPrimary = variant === "primary";
  const isGhost = variant === "ghost";

  if (status === "copied") {
    return (
      <button
        disabled
        className="w-full flex items-center justify-center gap-2 font-semibold py-3 px-6 rounded-full text-sm"
        style={isPrimary
          ? { background: "linear-gradient(to right, #16a34a, #15803d)", color: "#fff" }
          : { background: "transparent", border: "1px solid #374151", color: "#d1d5db" }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        Link copied!
      </button>
    );
  }

  if (status === "menu") {
    return (
      <div className="w-full flex flex-col gap-2">
        <button
          onClick={shareWhatsApp}
          className="w-full flex items-center justify-center gap-2 font-semibold py-3 px-6 rounded-full text-sm transition-colors"
          style={{ background: "#25D366", color: "#fff" }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          Share on WhatsApp
        </button>
        {/* Theme classes, not inline #d1d5db: inside the app's light theme the
            inline light grey sat on cream and read as disabled (2026-09-23
            free-account review). The classes are the same colours on dark and
            on public pages; the light theme remaps them to readable ones. */}
        <button
          onClick={copyLink}
          className="w-full flex items-center justify-center gap-2 font-semibold py-3 px-6 rounded-full text-sm transition-colors bg-transparent border border-gray-700 text-gray-300"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy link
        </button>
        <button
          onClick={() => setStatus("idle")}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors text-center py-1"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleShare}
      className={`w-full flex items-center justify-center gap-2 font-semibold py-3 px-6 rounded-full transition-colors text-sm${isGhost ? " bg-transparent border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800" : ""}`}
      style={
        isGhost
          ? undefined
          : isPrimary
            ? { background: "var(--sc-accent, #2563eb)", color: "var(--sc-accent-text, #fff)" }
            : { background: "transparent", border: "1px solid #374151", color: "#d1d5db" }
      }
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
      </svg>
      {label}
    </button>
  );
}
