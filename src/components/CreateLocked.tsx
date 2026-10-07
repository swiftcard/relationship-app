import Link from "next/link";

// Kept apart from CreateLinkBox: next/link needs the Next runtime, and the
// box itself is also bundled on its own (tests, replicas) without one.

/** What a Free account sees on the Create + side (the web branch of its
 *  PlanGate — the iPhone app shows the neutral in-app notice instead). */
export default function CreateLocked() {
  return (
    <div className="bg-gray-900 border border-gray-800/80 rounded-2xl px-5 py-8 text-center">
      <div className="mx-auto w-11 h-11 rounded-2xl bg-blue-600/10 flex items-center justify-center text-blue-500">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
      </div>
      <p className="mt-3 text-white text-sm font-semibold">Link anything with Pro</p>
      <p className="mt-1 text-gray-500 text-xs leading-relaxed max-w-[300px] mx-auto">Paste your own email signature or add a picture, and every part of it opens your SwiftCard.</p>
      <Link href="/upgrade" className="mt-4 inline-block text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-full transition-colors">Upgrade to Pro →</Link>
    </div>
  );
}
