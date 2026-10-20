"use client";

// ── The card's Look picker: Original, then Solid / Gradient / Glass ──────────
//
// Owner, 2026-10-14: the card's Look step was a flat grid of small "Aa" chips,
// and Social design's Look picker — three rows that each drop down to a set of
// big preview tiles — was the one people liked. "I want to do that same exact
// thing for card design." So this is that control, on the card:
//
//   • Three rows, Solid → Gradient → Glass, in Social design's order, all
//     closed on arrival; one open at a time. A closed row still names the
//     look the card is wearing, so nothing is hidden by being folded.
//   • Opening a row keeps it under your finger (components/ui/useOpenInPlace,
//     shared with the Social design picker).
//   • Each tile is a MINIATURE CARD in this template's own layout — the
//     two-panel split, the header stripe, the photo panel — painted with the
//     look's real background and finish, an "Aa" where the name goes in the
//     look's own colour and font, and the look's name underneath. A tile is
//     what you get.
//   • "Original" sits above the three rows, never folded: the one-tap way back
//     to the template exactly as it ships.
//
// Glass is the painted Frosted finish over a deep wash, never a live blur:
// a card is also a PNG, a link preview, a Wallet pass and an email signature,
// and none of those can blur (see lib/card-finishes).
//
// Every tile works and previews on every plan. On a Free account's Edit card
// (`proTags`) the Looks built on a Pro finish carry the PRO tag, and a row
// made only of them — Glass — carries it on the row itself, as Social design
// does. Save Changes is still the wall (proFeaturesInUse → ProRequiredDialog).

import { useState } from "react";
import type { TemplateStyle } from "./shared";
import { isDarkBg } from "./shared";
import { ProTag } from "@/components/ui/DesignControls";
import { useOpenInPlace } from "@/components/ui/useOpenInPlace";
import { composePanelBackground, getFinish, isFreeFinish } from "@/lib/card-finishes";
import {
  CARD_LOOK_FAMILIES, looksInFamily,
  type Look, type LookFamily, type TemplateMeta,
} from "@/lib/template-style-presets";

// Is this Look exactly what the card is wearing right now?
//
// Every field a Look SETS has to be compared, or the highlight lies. Once Looks
// gained a finish and a second surface, comparing only bg/text/font meant
// picking "Sea Glass" and then switching the finish to Carbon left Sea Glass
// still lit up — the panel claiming a preset that no longer described the card.
// Undefined on both sides counts as a match: a Look without a finish means Flat,
// which is what an unset finish renders as. The title, company, details and
// accent count too: a Look sets them (or hands them back to the template), so a
// card with its own colour for any of them is no longer that Look.
export function looksActive(value: TemplateStyle, look: Look): boolean {
  const same = (a?: string, b?: string) => (a ?? undefined) === (b ?? undefined);
  return (
    value.bgColor === look.bg &&
    value.textColor === look.text &&
    same(value.fontFamily, look.font) &&
    same(value.finish, look.finish) &&
    same(value.surfaceColor, look.surface) &&
    same(value.titleColor, look.title) &&
    same(value.companyColor, look.company) &&
    same(value.infoColor, look.info) &&
    same(value.accentColor, look.accent)
  );
}

/** Every key a Look sets — and so every key "Original" hands back to the template. */
export function isOriginal(value: TemplateStyle): boolean {
  return (
    value.bgColor === undefined &&
    value.textColor === undefined &&
    value.fontFamily === undefined &&
    value.finish === undefined &&
    value.surfaceColor === undefined &&
    value.titleColor === undefined &&
    value.companyColor === undefined &&
    value.infoColor === undefined &&
    value.accentColor === undefined
  );
}

/** The colours one miniature card is painted with. */
type Paint = {
  bg: string;
  finish?: string;
  surface: string;
  text: string;
  title: string;
  company: string;
  /** The details ink, when the Look sets one; unset follows the ground. */
  info?: string;
  accent: string;
  font?: string;
};

/**
 * How each template is laid out, as far as a thumbnail needs to know:
 * which part the brand colour (`bg`) paints, where the name sits, and the
 * accent marks the template draws (a bar along the bottom, a strip down the
 * edge).
 */
type Layout = "split" | "stripe" | "photo" | "full" | "strip";
function layoutOf(template?: string): Layout {
  if (template === "classic-pro") return "split";
  if (template === "local-business") return "stripe";
  if (template === "photo-first") return "photo";
  if (template === "luxury-minimal") return "strip";
  return "full";
}

/**
 * The phone, email and address: an icon dot in the accent beside a line in
 * the details ink — so a tile shows the two colours a card wears most.
 */
function DetailRows({ ground, paint }: { ground: string; paint: Paint }) {
  const ink = paint.info ?? (isDarkBg(ground) ? "#ffffff" : "#0f172a");
  return (
    <span className="flex flex-col gap-[3px]">
      {["w-4/5", "w-3/5", "w-2/3"].map((w) => (
        <span key={w} className="flex items-center gap-[3px]">
          <span className="block h-[4px] w-[4px] shrink-0 rounded-full" style={{ background: paint.accent }} />
          <span className={`block h-[3px] ${w} rounded-full`} style={{ background: ink, opacity: 0.6 }} />
        </span>
      ))}
    </span>
  );
}

/**
 * The name, as an "Aa" in the look's own colour and font, over a title stroke
 * in the title's ink. Not the look's name: on the two-panel templates the name
 * sits in under half a 150px tile, which cut "Sea Glass" to "Sea…". The name
 * is the caption under the card instead, where it always fits.
 */
function NameBlock({ paint, small = false, company = false }: { paint: Paint; small?: boolean; company?: boolean }) {
  return (
    <span className={`block min-w-0 ${small ? "text-center" : ""}`}>
      {company && <span className="mb-1 block h-[3px] w-5 rounded-full" style={{ background: paint.company }} />}
      <span
        className={`block font-extrabold leading-none ${small ? "text-[0.6875rem]" : "text-[0.9375rem]"}`}
        style={{ color: paint.text, fontFamily: paint.font }}
      >
        Aa
      </span>
      <span className={`mt-1 block h-[3px] w-6 rounded-full ${small ? "mx-auto" : ""}`} style={{ background: paint.title }} />
    </span>
  );
}

/** The short company line some templates set at the top of the details side. */
function CompanyLine({ paint }: { paint: Paint }) {
  return <span className="mb-1.5 block h-[3px] w-1/2 rounded-full" style={{ background: paint.company }} />;
}

/**
 * A miniature of the card a Look produces, in this template's layout.
 *
 * A schematic rather than the real template: twenty-six real cards, each
 * measuring and fitting its own text, would make opening a row slow on a
 * phone. What matters in a tile is the material, the colours and where they
 * fall on the card, and those are exact — the brand surface is painted with
 * composePanelBackground, the same call every template makes — down to the
 * accent on the icons and the bar.
 */
function MiniCard({ layout, paint }: { layout: Layout; paint: Paint }) {
  const brand = composePanelBackground(paint.bg, paint.finish);
  return (
    // A specimen: it shows a design, it does not label anything, so the
    // panel's type-scale rule (two label sizes) does not apply inside it.
    <span data-ds="specimen" className="relative flex w-full aspect-[1.75/1] overflow-hidden" style={{ background: brand }}>
      {layout === "split" && (
        <>
          <span className="flex w-[46%] flex-col justify-center px-2">
            <span className="mb-1 block h-[2px] w-3 rounded-full" style={{ background: paint.accent }} />
            <NameBlock paint={paint} />
          </span>
          <span className="flex flex-1 items-center px-2" style={{ background: paint.surface }}>
            <span className="w-full"><DetailRows ground={paint.surface} paint={paint} /></span>
          </span>
          <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: paint.accent }} />
        </>
      )}
      {layout === "stripe" && (
        <span className="flex w-full flex-col">
          <span className="flex h-[42%] items-center px-2">
            <NameBlock paint={paint} />
          </span>
          <span className="flex flex-1 flex-col justify-center px-2" style={{ background: paint.surface }}>
            <CompanyLine paint={paint} />
            <DetailRows ground={paint.surface} paint={paint} />
          </span>
          <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: paint.accent }} />
        </span>
      )}
      {layout === "photo" && (
        <>
          <span className="flex w-[44%] flex-col items-center justify-center gap-1 px-1.5" style={{ background: paint.surface }}>
            <span className="block h-[34%] aspect-square rounded-full" style={{ background: isDarkBg(paint.surface) ? "rgba(255,255,255,0.22)" : "rgba(15,23,42,0.12)" }} />
            <NameBlock paint={paint} small />
          </span>
          <span className="flex flex-1 flex-col justify-center px-2">
            <CompanyLine paint={paint} />
            <DetailRows ground={paint.bg} paint={paint} />
          </span>
        </>
      )}
      {(layout === "full" || layout === "strip") && (
        <span className="flex w-full flex-col justify-center gap-2 px-2.5">
          <NameBlock paint={paint} company />
          <DetailRows ground={paint.bg} paint={paint} />
        </span>
      )}
      {layout === "strip" && <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: paint.accent }} />}
    </span>
  );
}

/**
 * A MiniCard drawn at tile size and scaled down to a thumbnail.
 *
 * Owner, 2026-10-15: Original's little picture "doesn't even fit correctly".
 * It was the tile's layout squeezed into 56px — the same 15px "Aa", gaps and
 * padding in a third of the room — so the name ran off the top and the lines
 * off the bottom. Scaling the whole drawing keeps every proportion of the
 * tiles below it, so the thumbnail is the same card, smaller.
 */
const THUMB_DRAWN_PX = 160;
function MiniThumb({ layout, paint, widthPx }: { layout: Layout; paint: Paint; widthPx: number }) {
  return (
    <span className="relative block aspect-[1.75/1] overflow-hidden" style={{ width: widthPx }}>
      <span
        className="absolute left-0 top-0 block origin-top-left"
        style={{ width: THUMB_DRAWN_PX, transform: `scale(${widthPx / THUMB_DRAWN_PX})` }}
      >
        <MiniCard layout={layout} paint={paint} />
      </span>
    </span>
  );
}

const RING_ON = "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.25)]";

function LookTile({
  look,
  layout,
  meta,
  active,
  proTags,
  onPick,
}: {
  look: Look;
  layout: Layout;
  meta: TemplateMeta;
  active: boolean;
  proTags: boolean;
  onPick: () => void;
}) {
  // A Look built on a Pro finish SHOWS its finish here and applies on tap,
  // so the card previews exactly as it would. Save Changes names it
  // (lib/plan.ts proFeaturesInUse); the PRO tag says so beforehand.
  const needsPro = proTags && !!look.finish && !isFreeFinish(look.finish);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      title={look.finish ? `${look.name} — ${getFinish(look.finish).name.toLowerCase()} finish` : look.name}
      className={`relative block w-full rounded-xl overflow-hidden border-2 text-left transition-all hover:scale-[1.02] ${
        active ? RING_ON : "border-transparent"
      }`}
      style={active ? undefined : { boxShadow: "inset 0 0 0 1px rgba(127,127,127,0.35)" }}
    >
      {/* The FINISH rides along, not just the colour: a Look whose whole
          point is the material must show it before you pick it. */}
      <MiniCard layout={layout} paint={paintOf(meta, look)} />
      <span className={`block px-2 py-1.5 text-[0.6875rem] leading-tight truncate bg-gray-900/60 ${active ? "text-blue-300 font-semibold" : "text-gray-300"}`}>
        {look.name}
      </span>
      {needsPro && <span className="absolute top-1 right-1"><ProTag /></span>}
    </button>
  );
}

/** A Look's colours with the template's own filling every gap it leaves. */
function paintOf(
  meta: TemplateMeta,
  p: Pick<Look, "bg" | "text" | "finish" | "surface" | "title" | "company" | "info" | "accent" | "font">,
): Paint {
  return {
    bg: p.bg,
    finish: p.finish,
    surface: p.surface ?? meta.surface?.fallback ?? "#ffffff",
    text: p.text,
    title: p.title ?? meta.title.fallback,
    company: p.company ?? meta.company.fallback,
    info: p.info,
    accent: p.accent ?? meta.accent.fallback,
    font: p.font,
  };
}

/** Three overlapping dots of a row's first looks — what "Glass" means, before you open it. */
function FamilyChips({ looks }: { looks: Look[] }) {
  return (
    <span className="flex -space-x-1 shrink-0">
      {looks.slice(0, 3).map((l) => (
        <span
          key={l.name}
          className="w-4 h-4 rounded-full ring-1 ring-gray-900"
          style={{ background: composePanelBackground(l.bg, l.finish) }}
        />
      ))}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      aria-hidden
      className={`w-3.5 h-3.5 shrink-0 text-gray-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

export default function CardLookPicker({
  template,
  meta,
  value,
  onPick,
  onOriginal,
  proTags = false,
}: {
  template?: string;
  meta: TemplateMeta;
  value: TemplateStyle;
  onPick: (look: Look) => void;
  onOriginal: () => void;
  /** Tag the Looks built on a Pro finish (Free account, Edit card). */
  proTags?: boolean;
}) {
  const layout = layoutOf(template);
  const originalActive = isOriginal(value);
  const current = meta.looks.find((l) => looksActive(value, l));
  // Every row starts CLOSED, as on Social design: people pick Solid, Gradient
  // or Glass themselves, and a closed row still names the current look.
  const [open, setOpen] = useState<LookFamily | null>(null);
  const { rowRefs, groupRefs, noteTap } = useOpenInPlace<LookFamily>(open);

  function toggle(fam: LookFamily, isOpen: boolean) {
    noteTap(fam, isOpen);
    setOpen(isOpen ? null : fam);
  }

  // The template as it ships: its own details ink, accent and second surface.
  const original = paintOf(meta, { bg: meta.bg.fallback, text: meta.text.fallback, info: meta.info.fallback });

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden divide-y divide-gray-800">
      {/* ORIGINAL — the template exactly as it ships. It writes nothing new:
          only the unset values the "Default" chips below already write. */}
      <button
        type="button"
        onClick={onOriginal}
        aria-pressed={originalActive}
        title="The template's own colors, font and finish"
        className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
          originalActive ? "bg-gray-800/50" : "hover:bg-gray-800/30"
        }`}
      >
        <span
          className={`shrink-0 rounded-md overflow-hidden border-2 ${originalActive ? "border-blue-500" : "border-transparent"}`}
          style={originalActive ? undefined : { boxShadow: "inset 0 0 0 1px rgba(127,127,127,0.35)" }}
        >
          <MiniThumb layout={layout} paint={original} widthPx={64} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[0.8125rem] font-semibold ${originalActive ? "text-blue-300" : "text-gray-200"}`}>Original</span>
          <span className="block text-[0.6875rem] text-gray-500 leading-snug">The template&apos;s own colors, font and finish.</span>
        </span>
      </button>

      {CARD_LOOK_FAMILIES.map((fam) => {
        const looks = looksInFamily(meta, fam.id);
        if (!looks.length) return null;
        const isOpen = open === fam.id;
        const holds = current?.family === fam.id ? current : undefined;
        // A whole row is Pro when every look in it is — Glass, built on the
        // Frosted finish. The tag goes on the row so you know before opening.
        const famPro = proTags && looks.every((l) => !!l.finish && !isFreeFinish(l.finish));
        return (
          <div key={fam.id} ref={(el) => { groupRefs.current[fam.id] = el; }}>
            <button
              ref={(el) => { rowRefs.current[fam.id] = el; }}
              type="button"
              onClick={() => toggle(fam.id, isOpen)}
              aria-expanded={isOpen}
              className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                isOpen ? "bg-gray-800/50" : "hover:bg-gray-800/30"
              }`}
            >
              <FamilyChips looks={looks} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[0.8125rem] font-semibold text-gray-200">{fam.name}</span>
                  {famPro && <ProTag />}
                  {holds && <span className="text-[0.6875rem] font-semibold text-blue-300 truncate">{holds.name}</span>}
                </span>
                <span className="block text-[0.6875rem] text-gray-500 leading-snug">{fam.blurb}</span>
              </span>
              <Chevron open={isOpen} />
            </button>
            {isOpen && (
              <div className="grid grid-cols-2 gap-2 px-2.5 pb-2.5 pt-0.5">
                {looks.map((look) => (
                  <LookTile
                    key={look.name}
                    look={look}
                    layout={layout}
                    meta={meta}
                    active={looksActive(value, look)}
                    proTags={proTags}
                    onPick={() => onPick(look)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
