"use client";

import { useState } from "react";

export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions, non-secure context) — same fallback as
      // ShareButton: let them copy by hand instead of a button that does nothing.
      window.prompt("Copy:", text);
    }
  }

  return (
    <button
      onClick={copy}
      className="text-xs font-semibold px-3 py-1.5 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-200 hover:text-white transition-colors shrink-0"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
