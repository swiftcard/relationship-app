"use client";

import { useEffect, useState } from "react";
import { detectNativeApp } from "@/lib/platform";
import { shareNatively } from "@/lib/native-share";
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
  /**
   * Heat the link preview (lib/share-preview.ts). Off for the marketing demos:
   * their URL is a made-up card (swiftcard.me/alexmorgan), so on production
   * every homepage view fetched a card page that answers 404 — wasted server
   * work, and the nightly sweep's http-404 finding (2026-10-06).
   */
  warm?: boolean;
};

// `title` and `text` are accepted for backwards compatibility but intentionally
// not shared — see handleShare: only the bare URL guarantees the rich card
// preview. (`text` was the WhatsApp message of the old computer menu.)
export default function ShareButton({
  url,
  label = "Share Card",
  variant = "primary",
  ownCard = false,
  warm = true,
}: Props) {
  const [status, setStatus] = useState<"idle" | "copied">("idle");

  // Records only — the rating sheet is never requested from a tap.
  function shared() {
    if (ownCard) import("@/lib/app-review").then((m) => m.noteReviewMoment("card_shared")).catch(() => {});
  }

  // Heat the link preview before anyone asks for it — once when the button
  // appears, again on tap. See lib/share-preview.ts for the headshot bug this
  // prevents; the tap is the last moment we can act before the messenger
  // fetches the image on its own clock.
  useEffect(() => { if (warm) warmSharePreview(url); }, [url, warm]);

  async function handleShare() {
    if (warm) warmSharePreview(url);
    // Native shell: WKWebView often lacks navigator.share — use the native
    // share sheet via the Capacitor plugin. Falls through to the web paths
    // only when the plugin is missing (an old shell build). Closing the sheet
    // ends it: falling through on that opened a second sheet, and the owner
    // had to close it twice (lib/native-share.ts).
    //
    // The signup nudge fires AFTER the share resolves, never before: firing on
    // tap rendered the popup BEHIND the OS share sheet, where it burned its
    // once-per-session slot without ever being seen — and a cancelled share is
    // no conversion moment at all. (The popup host only mounts on public
    // pages, so this stays a no-op on the owner's dashboard.)
    if (detectNativeApp()) {
      const result = await shareNatively({ url });
      if (result === "shared") {
        shared();
        triggerSignupNudge("share_card");
      }
      if (result !== "unavailable") return;
    }
    // Every device opens its OWN share sheet: a phone's, and on a computer the
    // Mac or Windows share panel (owner, 2026-10-20: "When I press Share link
    // on the computer, a share sheet doesn't pop up, which it should"). This
    // reverses 2026-10-07, when computers copied the link instead. A browser
    // with no share sheet at all (Firefox, Chrome on Linux) copies the link and
    // says "Link copied!", so a click never does nothing.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        // Share ONLY the link. iMessage (and most messengers) render the rich
        // card preview only when the message is the bare URL — sharing extra
        // text makes it a plain text message with a link and no preview.
        await navigator.share({ url });
        shared();
        triggerSignupNudge("share_card");
        return;
      } catch (e) {
        // AbortError: they closed the sheet. InvalidStateError: a second click
        // while the sheet is still open. Both are answers, not failures.
        const name = (e as { name?: string } | null)?.name;
        if (name === "AbortError" || name === "InvalidStateError") {
          return; // user cancelled — nothing completed, nothing to nudge about
        }
        // Anything else means the sheet never opened (a Windows share panel
        // that refuses, a policy-blocked browser): copy instead.
      }
    }
    await copyLink();
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

  const isPrimary = variant === "primary";
  const isGhost = variant === "ghost";

  if (status === "copied") {
    return (
      // Ghost (the dashboard's Share link, which lands here wherever the
      // browser has no share sheet) takes theme classes, not inline #d1d5db: in the app's
      // light theme that inline grey sat on cream and read as disabled
      // (2026-09-23 free-account review) — the classes remap to readable ones.
      <button
        disabled
        className={`w-full flex items-center justify-center gap-2 font-semibold py-3 px-6 rounded-full text-sm${isGhost ? " bg-blue-500/10 border border-transparent text-blue-400" : ""}`}
        style={isGhost
          ? undefined
          : isPrimary
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

  return (
    <button
      onClick={handleShare}
      className={`w-full flex items-center justify-center gap-2 font-semibold py-3 px-6 rounded-full transition-colors text-sm${isGhost ? " bg-blue-500/10 border border-transparent text-blue-400 hover:text-blue-300 hover:bg-blue-500/15" : ""}`}
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
