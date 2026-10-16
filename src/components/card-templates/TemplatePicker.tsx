"use client";

// The template gallery at the top of the Card design tab — shared by the edit
// form and the new-card wizard, which had each grown their own copy.
//
// It replaced six text buttons ("Classic Pro", "Modern Bold"…). Choosing a
// template is the biggest decision on the tab, and a name told you nothing
// about it: people tapped through all six while watching a preview that was
// often scrolled off-screen. Every tile is now the REAL template, drawn with the
// owner's own details and their current colours — so what a tile shows is
// exactly what tapping it produces (style carries across a template switch, as
// it always has; the "Original" Look undoes that in one tap).
//
// Custom design is a slim row UNDER the six rather than a banner above them:
// an advanced Pro path, one option among seven.
//
// THE ROW IS ON EVERY CARD-DESIGN SCREEN, and it is only ever OPEN to a paying
// account (owner, 2026-09-18: "I want custom design to be shown with a very
// small pro tag but I want it to be locked. The only time someone can ever
// access custom design is in the actual dashboard if they pay for the Pro or
// Office plan."). So there is no longer a way to leave it out: Get Started, the
// homepage builders, Add card, Edit card and Office Branding all draw the same
// seven options. Locked, it carries the small PRO tag, reads "Locked" and does
// nothing when tapped; the caller decides only whether it is open.
//
// Tile markup: the thumbnail is an inert picture and the BUTTON is a sibling
// laid over it, never its ancestor. A template renders real <a> links, and an
// <a> inside a <button> is invalid HTML (and a hydration warning), inert or not.

import { memo, useDeferredValue } from "react";
import CardScaler from "@/components/CardScaler";
import InertPreview from "@/components/InertPreview";
import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import type { CardData } from "@/components/card-templates/types";
import { SectionHeading } from "@/components/ui/DesignControls";
import { CUSTOM_DESIGN_BLURB, CustomDesignTileFace, CustomDesignUpsell } from "@/components/CustomDesignCard";
import { metaForTemplate } from "@/lib/template-style-presets";

export const PRESET_TEMPLATES = [
  { id: "classic-pro",    label: "Classic Pro",    Component: ClassicPro },
  { id: "modern-bold",    label: "Modern Bold",    Component: ModernBold },
  { id: "photo-first",    label: "Photo First",    Component: PhotoFirst },
  { id: "local-business", label: "Local Business", Component: LocalBusiness },
  { id: "luxury-minimal", label: "Luxury Minimal", Component: LuxuryMinimal },
  { id: "logo-first",     label: "Logo First",     Component: LogoFirst },
] as const;

/** Same offset ring the swatches and Looks use: a tile whose face IS the preview takes the ring, not a fill. */
// A tint ring with a gap the colour of the surface it sits on (tokens from globals.css).
const RING = "0 0 0 2px var(--sc-bg-tertiary, #0b0f16), 0 0 0 4px var(--sc-tint, #3b82f6)";

const Thumb = memo(function Thumb({
  Component,
  data,
}: {
  Component: React.ComponentType<{ data: CardData }>;
  data: CardData;
}) {
  return (
    <InertPreview className="rounded-xl overflow-hidden">
      <CardScaler>
        <Component data={data} />
      </CardScaler>
    </InertPreview>
  );
});

function Tile({
  label,
  selected,
  disabled = false,
  showLabel = true,
  className = "",
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  /** False when the face already carries its own name. */
  showLabel?: boolean;
  className?: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="relative rounded-xl transition-shadow" style={{ boxShadow: selected ? RING : undefined }}>
        {children}
        <button
          type="button"
          onClick={() => { if (!disabled) onSelect(); }}
          disabled={disabled}
          aria-pressed={selected}
          aria-label={label}
          className="sc-tap absolute inset-0 w-full rounded-xl cursor-pointer disabled:cursor-default hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        />
      </div>
      {showLabel && (
        <p className={`mt-1.5 text-[0.6875rem] leading-tight truncate ${selected ? "text-blue-300 font-semibold" : "text-gray-400"}`}>
          {label}
        </p>
      )}
    </div>
  );
}

export default function TemplatePicker({
  template,
  onSelect,
  data,
  customUnlocked,
  notice,
  upsell = true,
  proTags = false,
}: {
  template: string;
  onSelect: (id: string) => void;
  /** The card's live preview data, socials already stripped for the presets. */
  data: CardData;
  /** Whether the Custom row can be opened: a signed-in Pro or Office account only. */
  customUnlocked: boolean;
  /** Optional one-line note under the heading (the wizard's Free-preview notice). */
  notice?: React.ReactNode;
  /** The "unlock the custom designer with Pro →" line under a LOCKED row. Only
   *  where the reader is signed in and can leave for /upgrade without losing
   *  anything — the card editor. Off in the card builder (the plan step comes
   *  at its end, and a link away would drop the card being built), in the
   *  homepage builders and on marketing pages. */
  upsell?: boolean;
  /** Light-blue PRO tags on the design steps of a Free account's Edit card
   *  (owner, 2026-09-18). The Custom row carries its tag whenever it is locked,
   *  with or without this. */
  proTags?: boolean;
}) {
  // Seven real cards re-render on every colour tap. Deferring their data keeps
  // the main preview — the one the owner is actually watching — instant, while
  // the thumbnails catch up a frame later.
  const deferred = useDeferredValue(data);
  const customSelected = template === "custom";
  const caption = customSelected
    ? customUnlocked
      ? CUSTOM_DESIGN_BLURB
      // A downgraded account's saved custom design: kept, but buildCardData
      // renders it as Classic Pro everywhere while the plan is Free. Say so.
      : "Your custom design is saved. While you're on Free, your card shows as Classic Pro."
    : metaForTemplate(template).blurb;

  return (
    <div>
      <SectionHeading hint="Tap one to try it">Template</SectionHeading>
      {notice && <div className="mt-2">{notice}</div>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-3.5 mt-3">
        {PRESET_TEMPLATES.map(({ id, label, Component }) => (
          <Tile key={id} label={label} selected={template === id} onSelect={() => onSelect(id)}>
            <Thumb Component={Component} data={deferred} />
          </Tile>
        ))}
        {/* Full width, one slim row: an option with no picture to show does
            not get a card-sized box of its own. */}
        <Tile label={customUnlocked ? "Custom design" : "Custom design (Pro, locked)"} selected={customSelected} disabled={!customUnlocked} showLabel={false} className="col-span-full" onSelect={() => onSelect("custom")}>
          <CustomDesignTileFace selected={customSelected} unlocked={customUnlocked} proTag={proTags || !customUnlocked} />
        </Tile>
      </div>
      <p className="text-[0.6875rem] text-gray-500 leading-snug mt-3">{caption}</p>
      {!customUnlocked && upsell && <CustomDesignUpsell />}
    </div>
  );
}
