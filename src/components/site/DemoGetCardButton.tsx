import Link from "next/link";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";

/**
 * The live card page's "Create your free SwiftCard" button (src/app/[username]/
 * page.tsx, under "Share this card" on every card since 2026-08-25), for the
 * marketing mockups of that page. Same gradient, glow and ringed brand mark.
 *
 * It points at the builder, never at https://swiftcard.me/?src=card: from the
 * homepage that only reloaded the page you were on, and from a preview deploy
 * or localhost it ejected you onto the live site mid-demo.
 */
export default function DemoGetCardButton() {
  return (
    <Link
      href="/cards/new"
      className="mt-2 w-full flex items-center justify-center gap-2 font-bold py-3 px-6 rounded-full text-sm text-white transition-all hover:brightness-110"
      style={{
        background: "linear-gradient(90deg, #1D4ED8 0%, #2563EB 55%, #0EA5E9 100%)",
        boxShadow: "0 8px 20px -6px rgba(29,78,216,0.45), inset 0 1px 0 rgba(255,255,255,0.25)",
      }}
    >
      <span
        className="shrink-0 rounded-[5px] overflow-hidden"
        style={{ boxShadow: "0 0 0 1.5px rgba(255,255,255,0.9), 0 1px 3px rgba(15,23,42,0.35)" }}
        aria-hidden="true"
      >
        <SwiftCardIcon size={18} />
      </span>
      <span className="truncate">Create your free SwiftCard</span>
    </Link>
  );
}
