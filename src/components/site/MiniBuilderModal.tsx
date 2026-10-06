"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

// Shared chrome for the homepage "mini builders" (card / SwiftLink / signature).
// A visitor steps through a handful of fields — only what a preview needs — with
// a live preview beside them, then hits "Make it live" to continue in the real
// builder with everything they typed carried over. The caller owns the field
// state; this component only renders the wizard shell, progress, live preview,
// and navigation. Portaled to <body> so the fixed overlay isn't trapped by the
// transformed reveal-animation ancestors on the page.

export type MiniStep = {
  title: string;
  subtitle?: string;
  content: React.ReactNode;
  canAdvance?: boolean; // false disables Next/Make-it-live on this step
  /** On mobile, show the live preview ABOVE the form for this step (used by the
   *  design step, so edits to template/colours/font are visible as you make
   *  them instead of being pushed to the bottom of the sheet). Desktop is
   *  unchanged — the preview is always pinned beside the form there. */
  previewFirst?: boolean;
};

export default function MiniBuilderModal({
  open,
  onClose,
  eyebrow,
  step,
  setStep,
  steps,
  preview,
  pinnedPreview,
  previewCaption,
  onLaunch,
  onStartOver,
  launching = false,
  launchLabel = "Make it live →",
  hidePreviewOnMobile = false,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  step: number;
  setStep: (n: number) => void;
  steps: MiniStep[];
  preview: React.ReactNode;
  /** What the PHONE pins at the top on preview-first steps, when `preview` is
   *  too tall to pin whole (the Swift Links page). Defaults to `preview`. */
  pinnedPreview?: React.ReactNode;
  previewCaption?: string;
  onLaunch: () => void;
  /** Explicitly throw the whole draft away and start from a blank builder.
   *  Closing does NOT do this — the three builders share one draft and a
   *  visitor moving between products must not lose what they already typed. */
  onStartOver?: () => void;
  launching?: boolean;
  launchLabel?: string;
  /** Hides this shared preview column on mobile only (still shown on desktop,
   *  where it's pinned beside the form regardless of step). Used by the card
   *  builder's last step (the template picker), which drops its OWN inline
   *  copy of `preview` right next to the template choices instead — on mobile
   *  that reads better than the picker followed by nav buttons followed by
   *  the preview all the way at the bottom of the sheet. */
  hidePreviewOnMobile?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const total = steps.length;
  const current = steps[Math.min(step, total - 1)];
  const isLast = step >= total - 1;
  const canGo = current.canAdvance !== false;

  return createPortal(
    <>
    {/* Dim + blur as their OWN non-scrolling layer, behind the scroll container.
        backdrop-filter on the SAME element as overflow-y-auto silently kills
        touch scrolling on iOS Safari — this shell hosts all three homepage
        "see how it would look" builders, so that would freeze the whole
        interactive funnel on iPhone. Same split as SignatureDemo's popup. */}
    <div
      className="fixed inset-0 z-[94]"
      style={{ background: "rgba(4,7,15,0.74)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      aria-hidden
    />
    <div
      className="fixed inset-0 z-[95] overflow-y-auto"
      onClick={onClose}
    >
      <div className="min-h-full flex items-start sm:items-center justify-center py-6 px-4">
        <div
          // overflow-CLIP, not overflow-hidden: hidden makes this box a scroll
          // container, and a sticky child then sticks to IT (which never
          // scrolls) instead of the overlay — the pinned preview would scroll
          // away like any other block. clip rounds the corners the same way.
          className="relative w-full min-w-0 max-w-3xl rounded-[var(--rd-r-2xl)] overflow-clip shadow-[var(--rd-sh-lg)]"
          style={{ background: "#0E1017", border: "1px solid rgba(255,255,255,0.10)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3.5 right-3.5 z-30 w-9 h-9 flex items-center justify-center rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>

          {/* Mobile-only preview ABOVE the form on preview-first steps (the
              design step), pinned to the top of the screen while the controls
              scroll under it (owner, 2026-09-16: "hover at the top and while
              you scroll it'll still be there"). Desktop pins the side preview
              below instead. */}
          {current.previewFirst && (
            <div
              className="md:hidden sticky top-0 z-20 flex flex-col items-center px-14 pt-3 pb-4 border-b border-white/10"
              style={{ background: "radial-gradient(120% 100% at 50% 0%, rgba(37,99,235,0.14), transparent 60%), #0A0B10" }}
            >
              <span className="text-white/70 text-[0.6875rem] font-semibold uppercase tracking-widest mb-2">Live preview</span>
              <div className="w-full flex items-center justify-center">{pinnedPreview ?? preview}</div>
            </div>
          )}

          <div className="grid md:grid-cols-2 min-w-0">
            {/* ── Left: form ─────────────────────────────── */}
            <div className="p-6 sm:p-8 min-w-0">
              <div className="flex items-center gap-2 mb-5">
                <span className="rd-pill rd-pill-d"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--rd-aurora)" }} />{eyebrow}</span>
              </div>

              {/* progress */}
              <div className="flex items-center gap-1.5 mb-5">
                {steps.map((_, i) => (
                  <span key={i} className="h-1.5 rounded-full flex-1 transition-colors" style={{ background: i <= step ? "var(--rd-aurora)" : "rgba(255,255,255,0.12)" }} />
                ))}
              </div>

              <p className="text-white/40 text-[0.75rem] font-medium mb-1">Step {step + 1} of {total}</p>
              <h3 className="text-white font-bold text-[1.25rem] leading-tight">{current.title}</h3>
              {current.subtitle && <p className="text-white/50 text-[0.84375rem] mt-1.5 leading-relaxed">{current.subtitle}</p>}

              {/* Keyed by step so each new step fades in (globals.css sc-step-in)
                  instead of snapping; the fields are controlled by the sketch,
                  so remounting them loses nothing. */}
              <div key={step} className="mt-5 space-y-3.5 sc-step-in">{current.content}</div>

              {/* nav */}
              <div className="mt-7 flex items-center gap-3">
                {step > 0 && (
                  <button onClick={() => setStep(step - 1)} className="rd-btn rd-btn-ghost-d text-[0.875rem] px-4 py-2.5">Back</button>
                )}
                {isLast ? (
                  <button
                    onClick={onLaunch}
                    disabled={!canGo || launching}
                    className="rd-btn rd-btn-aurora text-[0.875rem] px-5 py-2.5 flex-1 disabled:opacity-50"
                  >
                    {launching ? "Opening…" : launchLabel}
                  </button>
                ) : (
                  <button
                    onClick={() => canGo && setStep(step + 1)}
                    disabled={!canGo}
                    className="rd-btn rd-btn-primary text-[0.875rem] px-5 py-2.5 flex-1 disabled:opacity-40"
                  >
                    Continue
                  </button>
                )}
              </div>
              {isLast && (
                <p className="text-white/35 text-[0.71875rem] mt-3 leading-relaxed">
                  We&apos;ll carry over everything you entered — you&apos;ll just add the finishing touches.
                </p>
              )}

              {onStartOver && (
                <button
                  type="button"
                  onClick={onStartOver}
                  className="mt-4 text-white/35 hover:text-white/70 text-[0.71875rem] underline underline-offset-2 transition-colors"
                >
                  Start over with a blank one
                </button>
              )}
            </div>

            {/* ── Right: live preview ────────────────────── */}
            <div className={`${hidePreviewOnMobile || current.previewFirst ? "hidden md:flex" : "flex"} relative min-w-0 flex-col items-center justify-center md:justify-start p-6 sm:p-8 border-t md:border-t-0 md:border-l border-white/10`} style={{ background: "radial-gradient(120% 100% at 50% 0%, rgba(37,99,235,0.14), transparent 60%), #0A0B10" }}>
              {/* Desktop: at the TOP of its column and pinned there while the
                  form scrolls (owner, 2026-09-16), not floating in the middle
                  of a tall column where the design controls push it off-screen. */}
              <div className="w-full flex flex-col items-center md:sticky md:top-6">
                <span className="text-white/35 text-[0.6875rem] font-semibold uppercase tracking-widest">Live preview</span>
                <div className="w-full flex items-center justify-center mt-4">{preview}</div>
                {previewCaption && <p className="text-white/40 text-[0.75rem] mt-4 text-center">{previewCaption}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>,
    document.body,
  );
}
