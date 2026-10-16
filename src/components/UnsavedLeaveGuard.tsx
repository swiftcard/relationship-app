"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDialogA11y } from "@/lib/use-dialog-a11y";

// ── In-app links ask before dropping unsaved edits (audit C02-A39) ──────────
//
// The editor's unsaved-changes guard was `beforeunload`, which only fires when
// the whole document goes: a reload, a closed tab, a plain link. Next's <Link>
// navigates inside the page, so every in-app link walked straight past it: the
// header's "Dashboard", "Upgrade to Pro" under the link cap, and the Pro
// dialog's "Start my free trial" — a Free user who had just designed a Pro
// card lost it on the way to buying Pro.
//
// While `when` is true, a click on any same-origin link that leaves this page
// is held (capture phase, so it runs before <Link>'s own handler) and asked
// about first. Links inside an element marked data-leave-ok (the editor's own
// "Discard") are already a decision and go straight through. Modified clicks
// (new tab, new window) leave this page as it is and are not held.

export default function UnsavedLeaveGuard({ when }: { when: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const leaving = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  useDialogA11y(pending !== null, () => setPending(null), panelRef, stayRef);

  useEffect(() => {
    if (!when) return;
    const onClick = (e: MouseEvent) => {
      if (leaving.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || a.closest("[data-leave-ok]")) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      // Another site is a full page load, which beforeunload already asks about.
      if (url.origin !== window.location.origin) return;
      // Same page (a #section, or the very same address): nothing is lost.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [when]);

  if (pending === null) return null;

  const leave = () => {
    leaving.current = true;
    const to = pending;
    setPending(null);
    router.push(to);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="leave-guard-title">
      <div className="absolute inset-0 bg-black/60" onClick={() => setPending(null)} aria-hidden="true" />
      <div ref={panelRef} className="relative w-full sm:max-w-sm mx-0 sm:mx-4 rounded-t-2xl sm:rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <h2 id="leave-guard-title" className="text-white font-semibold text-base">Leave without saving?</h2>
        <p className="text-gray-400 text-sm mt-1.5">Your changes to this card haven&apos;t been saved yet.</p>
        <div className="flex gap-2 mt-5">
          <button ref={stayRef} type="button" onClick={() => setPending(null)} className="flex-1 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 px-4 py-2.5 rounded-full transition-colors">
            Keep editing
          </button>
          <button type="button" onClick={leave} className="flex-1 text-sm font-semibold text-white bg-gray-800 hover:bg-gray-700 px-4 py-2.5 rounded-full transition-colors">
            Leave without saving
          </button>
        </div>
      </div>
    </div>
  );
}
