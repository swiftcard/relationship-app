"use client";

import { useState } from "react";

/** Copies a demo's reschedule link (to paste into a reply or a text). */
export default function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="sc-btn sc-btn-sm sc-btn-gray"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          window.prompt("Copy the reschedule link:", link);
        }
      }}
    >
      {copied ? "Copied" : "Copy reschedule link"}
    </button>
  );
}
