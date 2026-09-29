import type { ReactNode } from "react";

// ── A boxed group of fields ─────────────────────────────────────────────────
//
// Owner, 2026-09-29: Card info and Socials were one long flat column of boxes,
// "a whole mishmash" to someone new. Each group now sits in its own soft box
// with a short heading, so the page reads as three or four clear chunks
// instead of twelve fields.
//
// Gray classes only (bg-gray-900/40, border-gray-800), so the light theme's
// existing remaps (globals.css) and the iOS shell restyle it like every other
// panel. One component for the create-card wizard and the card editor so the
// two cannot drift.

export default function FormSection({
  title,
  note,
  trailing,
  labelFor,
  required,
  children,
  id,
}: {
  title: ReactNode;
  /** One short line under the heading. Keep it to a sentence. */
  note?: ReactNode;
  /** Right side of the heading row (a Managed tag, a small action). */
  trailing?: ReactNode;
  /** Render the heading as the <label> for this control (a single-field section). */
  labelFor?: string;
  /** Show the red required mark after the heading. */
  required?: boolean;
  children: ReactNode;
  id?: string;
}) {
  const headingCls = "text-[0.8125rem] font-semibold text-white";
  const heading = (
    <>
      {title}
      {required && <span className="text-red-400 ml-0.5" aria-hidden="true">*</span>}
    </>
  );
  return (
    <section data-form-section={id} className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 space-y-3.5">
      <div>
        <div className="flex items-center justify-between gap-2 min-w-0">
          {labelFor ? (
            <label htmlFor={labelFor} className={headingCls}>{heading}</label>
          ) : (
            <h2 className={headingCls}>{heading}</h2>
          )}
          {trailing && <div className="shrink-0">{trailing}</div>}
        </div>
        {note && <p className="text-gray-500 text-[0.6875rem] leading-snug mt-0.5">{note}</p>}
      </div>
      {children}
    </section>
  );
}
