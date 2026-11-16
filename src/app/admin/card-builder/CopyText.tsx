"use client";

import { useState } from "react";

/** Copies the opening text (words and link) to paste into a message by hand. */
export default function CopyText({ text, label = "Copy", className = "sc-btn sc-btn-gray sc-btn-block" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      data-copy-text
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard blocked: let them copy it by hand rather than do nothing.
          window.prompt("Copy the text:", text);
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
