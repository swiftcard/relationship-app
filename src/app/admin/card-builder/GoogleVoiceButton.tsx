"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MessageKind } from "@/lib/prospect-preview/messages";

/**
 * Google Voice, by hand, built like LinkedInButton: one tap copies the words
 * (the opener with its link) and opens Google Voice on this prospect's number
 * in a new tab; the owner pastes and presses send there, from their Google
 * Voice number. SwiftCard never drives Google Voice: no browser automation,
 * no scraping, no unofficial API (owner's rule, 2026-11-17, the same as
 * LinkedIn's). The tap is recorded as sent, channel google_voice.
 *
 * A real link, so before hydration it still opens Google Voice; the words are
 * printed beside it to copy by hand. `disabled`: today's Google Voice cap is
 * reached, so it is a label, not a link.
 */
export default function GoogleVoiceButton({ id, kind = "opener", words, href, disabled = false, children = "Send from Google Voice", className = "sc-btn sc-btn-gray" }: {
  id: string;
  kind?: Extract<MessageKind, "opener" | "nudge_no_view" | "nudge_viewed">;
  words: string;
  /** https://voice.google.com/… for their number (lib/prospect-preview/google-voice.ts). */
  href: string;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  if (disabled) return <span className={`${className} opacity-50`} aria-disabled="true" data-google-voice-capped>Today&apos;s Google Voice cap is reached</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-google-voice={kind}
      className={className}
      onClick={() => {
        // Both start inside the tap, so the clipboard write is allowed and the tab still opens.
        void navigator.clipboard?.writeText(words).then(() => setCopied(true)).catch(() => {});
        void fetch(`/api/admin/card-builder/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sent", kind, channel: "google_voice", words }),
          keepalive: true,
        // Refreshed a moment later: the row then leaves the list, and "Copied" should be read first.
        }).then(() => setTimeout(() => router.refresh(), 4000)).catch(() => {});
      }}
    >
      {copied ? "Copied. Paste and send in Google Voice" : children}
    </a>
  );
}
