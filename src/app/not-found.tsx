import Link from "next/link";
import SwiftCardLogo from "@/components/SwiftCardLogo";
import HomeLink from "@/components/site/HomeLink";
import NotFoundPath from "@/components/site/NotFoundPath";

// Almost every 404 on this domain is a mistyped or outdated card/share link —
// SwiftCard's whole product is people passing around card URLs, so a typo
// (swiftcard.me/menash instead of /menash1) is the single most common way
// anyone ends up here. That's free, warm traffic currently hitting a dead
// end — this turns it into a signup instead of a bounce.
export default function NotFound() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-cream flex flex-col items-center justify-center px-6 py-16 text-center">
      {/* Depth instead of a flat cream sheet: a soft brand glow + faint dot grid. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 45% at 50% 38%, rgba(29,78,216,0.10), transparent 70%), radial-gradient(circle, rgba(15,23,42,0.07) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 22px 22px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, #000 40%, transparent 85%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, #000 40%, transparent 85%)",
        }}
      />

      <div className="relative flex w-full max-w-md flex-col items-center">
        <HomeLink aria-label="SwiftCard home" className="mb-10">
          <SwiftCardLogo size={30} />
        </HomeLink>

        {/* The "missing card": a blank, dashed business card with a ? badge. */}
        <div aria-hidden className="relative mb-9">
          <div className="absolute inset-0 translate-x-3 translate-y-2 rotate-6 rounded-2xl border border-[#E4DDD4] bg-white/50" />
          <div className="relative -rotate-3 w-56 sm:w-64 aspect-[1.75] rounded-2xl border-2 border-dashed border-[#CFC4B4] bg-white/80 shadow-[0_20px_40px_-20px_rgba(15,23,42,0.25)] backdrop-blur p-5 flex flex-col justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[#EFE8DD]" />
              <div className="flex-1 space-y-2">
                <div className="h-2.5 w-3/4 rounded-full bg-[#E6DDD0]" />
                <div className="h-2 w-1/2 rounded-full bg-[#EFE8DD]" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-2 w-2/3 rounded-full bg-[#EFE8DD]" />
              <div className="h-2 w-2/5 rounded-full bg-[#EFE8DD]" />
            </div>
          </div>
          <div className="absolute -right-3 -top-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand text-lg font-bold text-white shadow-lg shadow-blue-700/30 ring-4 ring-cream">
            ?
          </div>
        </div>

        <h1 className="text-[1.75rem] sm:text-3xl font-bold tracking-tight text-slate-900 mb-3">
          Couldn&apos;t find that card
        </h1>
        <p className="text-slate-600 text-[0.9375rem] leading-relaxed mb-5 max-w-sm text-balance">
          The link might be mistyped, or the card may have moved.
        </p>

        <NotFoundPath />

        <div className="flex w-full flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
          <Link
            href="/cards/new"
            className="bg-brand hover:bg-brand-dark text-white font-semibold px-7 py-3.5 rounded-full text-sm transition-colors shadow-lg shadow-blue-700/20"
          >
            Create your free card →
          </Link>
          <HomeLink className="border border-[#D9CFC1] bg-white/70 hover:bg-white text-slate-800 font-semibold px-7 py-3.5 rounded-full text-sm transition-colors">
            Go to homepage
          </HomeLink>
        </div>

        <p className="mt-8 text-xs text-slate-500">
          Card links look like <span className="font-mono text-slate-700">swiftcard.me/FirstLast-Company</span> — check the spelling.
        </p>
      </div>
    </main>
  );
}
