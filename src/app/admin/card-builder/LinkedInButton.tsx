"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * LinkedIn, by hand: one tap copies the words and opens the person's public
 * profile in a new tab; the owner pastes and sends there themselves. SwiftCard
 * has no LinkedIn access of any kind and sends nothing (owner's rule,
 * 2026-11-13: "no automated LinkedIn access or sending").
 *
 * A real link, so before hydration it still opens the profile; the words are
 * printed beside it to copy by hand.
 */
export default function LinkedInButton({ id, kind, words, profile, children, className = "sc-btn sc-btn-gray" }: {
  id: string;
  kind: "linkedin_note" | "linkedin_dm";
  words: string;
  /** https://www.linkedin.com/in/… */
  profile: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  return (
    <a
      href={profile}
      target="_blank"
      rel="noopener noreferrer"
      data-linkedin={kind}
      className={className}
      onClick={() => {
        // Both start inside the tap, so the clipboard write is allowed and the tab still opens.
        void navigator.clipboard?.writeText(words).then(() => setCopied(true)).catch(() => {});
        void fetch(`/api/admin/card-builder/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sent", kind, words }),
          keepalive: true,
        }).then(() => router.refresh()).catch(() => {});
      }}
    >
      {copied ? "Copied. Paste it on LinkedIn" : children}
    </a>
  );
}
