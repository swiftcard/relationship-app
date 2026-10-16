"use client";

import { useSyncExternalStore } from "react";

// Shows the link the visitor actually typed, so a typo is easy to spot. Read
// from window on the client only (server snapshot = null) on purpose: reading
// headers() in the 404 would make it, and the static marketing build around
// it, dynamic.
const noop = () => () => {};
function readPath(): string | null {
  let p = window.location.pathname;
  try { p = decodeURIComponent(p); } catch { /* malformed %-escape: show raw */ }
  p = p.replace(/^\/+/, "");
  if (!p) return null;
  return p.length > 48 ? `${p.slice(0, 47)}…` : p;
}

export default function NotFoundPath() {
  const path = useSyncExternalStore(noop, readPath, () => null);
  if (!path) return null;
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#E4DDD4] bg-white/70 px-3.5 py-1.5 font-mono text-xs text-slate-500 backdrop-blur mb-6">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
      <span className="truncate">
        swiftcard.me/<span className="text-slate-900">{path}</span>
      </span>
    </div>
  );
}
