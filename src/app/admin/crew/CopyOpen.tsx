"use client";

import { useState } from "react";

// "Copy & open": copies the approved draft, then opens the post it answers.
// Before hydration it is still a working link (opens the post), so the button
// never does nothing.
export default function CopyOpen({ text, href }: { text: string; href: string | null }) {
  const [copied, setCopied] = useState(false);
  const label = copied ? "Copied" : href ? "Copy & open" : "Copy";
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* the link still opens; the text is right there to select */
    }
  }
  const cls = "inline-flex items-center justify-center min-h-10 px-3 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500";
  if (!href) {
    return (
      <button type="button" onClick={copy} className={cls}>
        {label}
      </button>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => void copy()} className={cls}>
      {label}
    </a>
  );
}
