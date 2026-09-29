import Link from "next/link";
import { PlanGate } from "@/components/PlanGate";
import { ProTag } from "@/components/ui/DesignControls";

// The entry point to the custom designer, as the seventh tile of the template
// gallery (TemplatePicker). It used to be a full-width banner ABOVE the six
// templates, which gave the advanced Pro path more weight than the choice
// nearly everyone actually makes. Pro-gated. Used by the new-card wizard and the
// edit form through TemplatePicker.
//
// The copy describes what the designer ACTUALLY does now. It used to promise a
// blank canvas you drag and resize elements on, which is the designer that was
// replaced — nothing is dragged any more and nothing starts blank.

export const CUSTOM_DESIGN_BLURB =
  "Photograph a card you like and AI rebuilds it with your details — or have AI design one for you. Then tap anything on it to move, resize or restyle it.";

/**
 * The row's face: a slim full-width strip under the six thumbnails. As a
 * seventh card-shaped tile it sat alone on its own row as a large empty box —
 * the one thing in the gallery with nothing to show.
 */
export function CustomDesignTileFace({ selected, unlocked, proTag = false }: { selected: boolean; unlocked: boolean; /** Free account's Edit card only. */ proTag?: boolean }) {
  return (
    <div
      className={`w-full min-h-[52px] rounded-xl flex items-center gap-3 px-3 py-2.5 border ${
        selected ? "border-blue-500/60 bg-blue-600/10" : "border-gray-700 border-dashed bg-gray-900"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth={1.7} className="w-5 h-5 shrink-0" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
      </svg>
      <span className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="min-w-0 text-[0.8125rem] font-semibold text-gray-200 truncate">Custom design</span>
        {proTag && <ProTag />}
      </span>
      {/* The small PRO tag shows wherever the row is LOCKED — Get Started, the
          homepage builders, a Free account's Add card and Edit card (owner,
          2026-09-18: shown everywhere, locked, open only to Pro and Office). */}
      <span className={`text-[0.6875rem] font-semibold shrink-0 ${selected ? "text-blue-300" : "text-gray-400"}`}>
        {selected ? "Selected" : unlocked ? "Design →" : "Locked"}
      </span>
    </div>
  );
}

/** The upgrade line under the gallery when the designer is locked. */
export function CustomDesignUpsell() {
  // /upgrade, not /pricing: this only ever renders inside the card editor, so
  // the reader is signed in. Every sibling upsell in this same panel already
  // goes to /upgrade; this one alone bounced people to the marketing page,
  // which re-offers the Free plan they're already on and sells a trial that
  // in-product upgrades deliberately don't include.
  return (
    <PlanGate
      feature="custom-designer"
      nativeCopy="Pro feature — The custom card designer is only available on the Pro plan"
    >
      <Link href="/upgrade" className="block text-center text-[0.6875rem] text-blue-400 hover:text-blue-300 mt-2">
        Make it unmistakably yours — unlock the custom designer with Pro →
      </Link>
    </PlanGate>
  );
}
