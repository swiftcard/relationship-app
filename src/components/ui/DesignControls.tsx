"use client";

import { useId } from "react";

// ── The Design editor's control vocabulary ───────────────────────────────────
//
// WHY THIS FILE EXISTS. Every design surface in the app grew its own controls
// in place, so the Design tab ended up speaking five dialects at once. Measured
// at 390px on 2026-09-15, one panel (TemplateStyleControls) held 66 interactive
// controls in SEVEN different font sizes, and "selected" was drawn five
// different ways depending on which section you were in:
//
//   templates grid   solid blue fill, white text
//   logo shape       grey fill on a grey track   ← barely visible at all
//   font pills       blue border + 10% blue tint
//   finish swatches  blue border + 10% blue tint
//   "Default" chip   blue border, blue text, no fill
//   ground swatches  a 2px blue box-shadow ring
//
// None of that was a decision; it is what happens when six sections are written
// on six different days. One vocabulary, defined once, is the only thing that
// stops it happening a seventh time.
//
// THE RULES THIS ENCODES
//
//   • A Switch is for a setting that is ON or OFF and nothing else. If there
//     are three states or three options, it is a Segmented, not a switch with
//     a friend.
//   • Segmented is for 2-4 mutually exclusive choices that fit on one row.
//     Beyond that a grid of cards reads better than a squeezed segment.
//   • Selected has exactly TWO forms, and which one depends on what the
//     control's face is showing:
//       - a control whose face is a LABEL (font pill, segment, template,
//         "Default") is FILLED blue with white text;
//       - a control whose face IS THE PREVIEW (colour swatch, Look tile,
//         finish tile) takes a blue RING with a gap, because filling it would
//         paint over the very thing being chosen.
//     Two forms, one meaning. What is banned is the third, fourth and fifth
//     form the panel had grown: a 10% tint, a bare outline, a grey-on-grey.
//   • Three type sizes. Section 11px, label 13px, help 11px. That is the whole
//     scale; anything else is a new dialect.
//   • 44px minimum tap target on touch devices (.sc-tap / .sc-tap-sq in
//     globals.css, applied on any-pointer: coarse so desktop keeps its
//     density).
//
// Everything here is presentational and controlled — the caller owns the value.

/**
 * Section 11px · label 13px · help 11px. The entire type scale.
 *
 * Written in REM, not px, and that is not cosmetic: the root font-size is
 * driven by --sc-text-scale, which the native shell sets from iOS Dynamic Type
 * (MainViewController). A px-pinned size renders identically at the 16px default
 * and then refuses to grow when someone turns Larger Text on — pinned by
 * tests/accessibility-invariants.test.ts, which caught exactly that in the
 * first draft of this file.
 */
export const dsType = {
  section: "text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-gray-500",
  label: "text-[0.8125rem] font-semibold text-gray-200",
  help: "text-[0.6875rem] text-gray-500 leading-snug",
  control: "text-[0.8125rem]",
} as const;

/**
 * A group signpost, one level above field labels.
 *
 * The rule reaching to the end of the row is what makes a run of sections read
 * as a structure rather than a list — you can see where one ends without
 * reading it.
 */
export function SectionHeading({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-1">
      <span className={`${dsType.section} shrink-0`}>{children}</span>
      {hint && <span className="text-[0.6875rem] text-gray-600 truncate min-w-0">{hint}</span>}
      <span className="flex-1 h-px bg-gray-800" />
    </div>
  );
}

/**
 * The light-blue PRO tag on a design control a Free account can try but not
 * keep (owner, 2026-09-18: "how do these users know which features are pro
 * features?"). Every control still works and previews on Free and Save
 * Changes is still where Pro is enforced (ProRequiredDialog) — the tag only
 * says, in advance, which of the choices that dialog will name. One component,
 * so Card design and Social design tag identically.
 *
 * A SOLID pale blue with dark text, set inline: tags sit on the dark panel,
 * on the light theme, on the Social design swatch well (light grey) and on
 * Look tiles of any colour, and a translucent tint vanishes on half of those.
 * Inline colours also keep the light theme's class remaps off it.
 *
 * `data-ds="badge"`: deliberately smaller than any label, which the design
 * type-scale render test allows for badges only.
 */
export function ProTag() {
  return (
    <span
      data-ds="badge"
      className="inline-flex items-center shrink-0 rounded-full px-1.5 py-[3px] text-[0.5625rem] font-bold leading-none tracking-wide"
      style={{ background: "#BAE6FD", color: "#0C4A6E" }}
    >
      PRO
    </span>
  );
}

/**
 * One labelled control: label, one line of help, the control.
 *
 * Sections used to repeat this markup each with their own margins, which is
 * exactly how they drifted out of alignment. One component, one rhythm.
 */
export function Field({
  label,
  help,
  trailing,
  children,
}: {
  label: string;
  help?: string;
  /** A PRO tag or similar, pinned to the right of the label row. */
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <p className={dsType.label}>{label}</p>
        {trailing}
      </div>
      {help && <p className={`${dsType.help} mb-2`}>{help}</p>}
      {children}
    </div>
  );
}

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** Optional glyph. Kept to one character-ish so segments stay even. */
  icon?: React.ReactNode;
  /** Optional marker after the label — e.g. a dot saying "a Pro value is set in here". */
  badge?: React.ReactNode;
};

/**
 * 2-4 mutually exclusive choices, one row.
 *
 * Buttons with aria-pressed rather than a radiogroup: a radiogroup owes the
 * user roving-tabindex arrow-key navigation, and a half-implemented one is
 * worse for a screen-reader than an honest row of toggle buttons. The group
 * carries the accessible name.
 *
 * Selected is a FILLED segment. The previous logo-shape control used a grey
 * fill on a grey track, which at a glance told you nothing about which of the
 * two was active.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name for the group — required, and never rendered. */
  label: string;
  /** "sm" for dense inline rows (inside an expanded block editor). */
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-3 py-1.5" : "px-3 py-2";
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex w-full items-stretch gap-1 rounded-xl bg-gray-800/60 p-1 border border-gray-700"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`sc-tap flex-1 min-w-0 ${pad} rounded-lg ${dsType.control} font-semibold transition-colors flex items-center justify-center gap-1.5 ${
              active
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-700/50"
            }`}
          >
            {o.icon}
            <span className="truncate">{o.label}</span>
            {o.badge}
          </button>
        );
      })}
    </div>
  );
}

/**
 * ON or OFF. The only control in the design editor allowed to be a switch.
 *
 * Label and switch are one <button>-adjacent row so the whole row is the target
 * — a 38px track alone is a small thing to hit with a thumb, and the label is
 * the part people actually aim at.
 */
export function Switch({
  checked,
  onChange,
  label,
  help,
  disabled,
  disabledReason,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help?: string;
  disabled?: boolean;
  /** Shown as the title when disabled, so the reason isn't a mystery. */
  disabledReason?: string;
}) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={help ? `${id}-help` : undefined}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={() => onChange(!checked)}
      className="sc-tap w-full flex items-center gap-3 rounded-xl border border-gray-700 bg-gray-800/40 px-3 py-2.5 text-left transition-colors hover:border-gray-600 disabled:opacity-40"
    >
      <span className="min-w-0 flex-1">
        <span id={`${id}-label`} className={`block ${dsType.label}`}>{label}</span>
        {help && <span id={`${id}-help`} className={`block ${dsType.help} mt-0.5`}>{help}</span>}
      </span>
      <span
        aria-hidden
        className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${checked ? "bg-[var(--sc-green)]" : "bg-[var(--sc-fill-3)]"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.06)] transition-transform ${checked ? "translate-x-5" : ""}`}
        />
      </span>
    </button>
  );
}

/**
 * Advanced controls, out of the way but one tap from reachable.
 *
 * Native <details>, deliberately. It works with no JavaScript at all, which is
 * this codebase's standing rule for anything interactive before hydration
 * (AGENTS.md), it is keyboard- and screen-reader-correct for free, and it needs
 * no state in a component tree that already has plenty.
 */
export function MoreOptions({
  label = "More options",
  hint,
  badge,
  lead,
  defaultOpen = false,
  children,
}: {
  label?: string;
  /** What's inside, in a few words, so the closed row isn't a mystery box. */
  hint?: string;
  /** A marker after the label, e.g. "something in here is set". */
  badge?: React.ReactNode;
  /** Visual before the label (thumbnails of what's inside). */
  lead?: React.ReactNode;
  /**
   * Starts open. Read ONCE: React sets the attribute at mount and never
   * re-applies it unless the value changes, so pass a value computed at mount
   * (see the editors' Photos section) — a live value would fight the user.
   */
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen || undefined} className="group rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
      <summary className="sc-tap flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden select-none hover:bg-gray-800/40 transition-colors">
        <span className="flex items-center gap-2 min-w-0">
          {lead}
          <span className="min-w-0">
            <span className={`flex items-center gap-1.5 ${dsType.label}`}>{label}{badge}</span>
            {hint && <span className={`block ${dsType.help} truncate`}>{hint}</span>}
          </span>
        </span>
        <span aria-hidden className="text-gray-500 text-[0.6875rem] transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-4">{children}</div>
    </details>
  );
}

export type DesignStep = {
  key: string;
  label: string;
  help?: string;
  /** The long explanation, as a tooltip over the whole step. */
  title?: string;
  /** A PRO tag or similar beside the label. */
  trailing?: React.ReactNode;
  body: React.ReactNode;
};

/**
 * One numbered path through a design panel — Card design and Social design
 * both read as 1, 2, 3… down the page (owner, 2026-09-16: "you labeled all the
 * rest of the steps and you made the UI very clean"). The number is the "where
 * do I go next"; one column, read down, nothing behind a tab or a fold.
 * Shared so the two panels can never number, space or label differently.
 */
export function DesignSteps({ steps, label, name }: { steps: DesignStep[]; label: string; /** Lets a live preview follow the step being edited (data-design-steps). */ name?: string }) {
  return (
    <ol className="bg-gray-900 border border-gray-800 rounded-2xl divide-y divide-gray-800" aria-label={label} data-design-steps={name}>
      {steps.map((st, i) => (
        <li key={st.key} className="flex gap-3 p-4" title={st.title} data-design-step={st.key}>
          <span
            aria-hidden
            className="mt-px w-6 h-6 shrink-0 rounded-full bg-blue-600 text-white text-[0.6875rem] font-bold flex items-center justify-center tabular-nums"
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <Field label={st.label} help={st.help} trailing={st.trailing}>
              {st.body}
            </Field>
          </div>
        </li>
      ))}
    </ol>
  );
}
