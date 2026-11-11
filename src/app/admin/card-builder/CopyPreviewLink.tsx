"use client";

import { useState } from "react";

/** Copies a preview's link, to paste into a text or an email to the prospect. */
export default function CopyPreviewLink({ link, filled = false }: { link: string; filled?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`sc-btn sc-btn-sm ${filled ? "sc-btn-filled" : "sc-btn-gray"}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard blocked: let them copy it by hand rather than do nothing.
          window.prompt("Copy the preview link:", link);
        }
      }}
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
