"use client";

import { useEffect, useState } from "react";
import { AI_COLOR_SWATCHES, AI_THEMES, type AiTheme } from "@/lib/ai-card-design";
import type { AiDesignBrief } from "@/components/card-templates/types";

// ── AI design: the owner's choices ──────────────────────────────────────────
// Owner, 2026-09-23: pressing AI design "will then make the user choose the
// color and themes that they want for their card and whether they want their
// headshot and logo to be on their card as well". Three short questions on one
// sheet, then Generate. Nothing is sent until they press it.

const MAX_COLORS = 2;

export default function AiDesignSheet({
  initial,
  hasPhoto,
  hasLogo,
  busy,
  error,
  teamBrand = false,
  onGenerate,
  onClose,
}: {
  initial: AiDesignBrief | null;
  hasPhoto: boolean;
  hasLogo: boolean;
  busy: boolean;
  error: string | null;
  teamBrand?: boolean;
  onGenerate: (brief: Omit<AiDesignBrief, "variant">) => void;
  onClose: () => void;
}) {
  const [colors, setColors] = useState<string[]>(initial?.colors ?? []);
  const [theme, setTheme] = useState<AiTheme | null>((initial?.theme as AiTheme | undefined) ?? null);
  const [headshot, setHeadshot] = useState(initial ? initial.headshot : hasPhoto);
  const [logo, setLogo] = useState(initial ? initial.logo : hasLogo);
  const [custom, setCustom] = useState("#2563eb");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function toggleColor(c: string) {
    const v = c.toLowerCase();
    setColors((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : cur.length >= MAX_COLORS ? [cur[1], v] : [...cur, v]));
  }

  const head = "text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-gray-400";
  const toggle = (on: boolean, disabled: boolean) =>
    `relative w-12 h-7 rounded-full shrink-0 transition-colors ${disabled ? "bg-[var(--sc-fill-3)] opacity-50" : on ? "bg-[var(--sc-green)]" : "bg-[var(--sc-fill-3)]"}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center sm:px-4 pt-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] sm:pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))]"
      role="dialog"
      aria-modal="true"
      aria-label="AI design"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] sm:max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur px-5 pt-4 pb-3 border-b border-gray-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-white flex items-center gap-2">
              <span aria-hidden>✨</span> AI design
            </p>
            <p className="text-[0.75rem] text-gray-400 mt-0.5">
              {teamBrand
                ? "Choose the look — AI designs the team's card, and every teammate's fills it with their own details."
                : "Choose the look — AI designs a card for you. You can move, resize and restyle anything after."}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-gray-500 hover:text-white text-lg leading-none disabled:opacity-40">✕</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* 1 — Colours */}
          <section>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <p className={head}>1 · Your colours</p>
              <p className="text-[0.6875rem] text-gray-500">{colors.length ? `${colors.length} of ${MAX_COLORS}` : "Pick 1–2, or none and AI chooses"}</p>
            </div>
            <div className="grid grid-cols-8 gap-2">
              {AI_COLOR_SWATCHES.map((c) => {
                const on = colors.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    aria-pressed={on}
                    onClick={() => toggleColor(c)}
                    className="sc-tap-sq aspect-square rounded-xl transition-transform hover:scale-105 relative"
                    style={{ background: c, boxShadow: on ? "0 0 0 2px #0b0f16, 0 0 0 4px #3b82f6" : "inset 0 0 0 1px rgba(148,163,184,.35)" }}
                  >
                    {on && (
                      <span className="absolute inset-0 flex items-center justify-center text-[0.75rem] font-bold" style={{ color: parseInt(c.slice(1), 16) > 0x999999 ? "#111827" : "#ffffff" }}>
                        {colors.indexOf(c) + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              <label className="flex items-center gap-2 text-[0.75rem] text-gray-400">
                <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Pick any colour" className="sc-tap-sq w-8 h-8 rounded bg-transparent border border-gray-700" />
                Any colour
              </label>
              <button type="button" onClick={() => toggleColor(custom)} className="sc-tap text-[0.75rem] font-semibold px-3 py-1.5 rounded-lg border bg-gray-800 border-gray-600 text-gray-100 hover:border-gray-400">
                {colors.includes(custom.toLowerCase()) ? "Remove it" : "Use it"}
              </button>
              {colors.length > 0 && (
                <button type="button" onClick={() => setColors([])} className="text-[0.75rem] text-gray-500 hover:text-gray-300 ml-auto">Clear</button>
              )}
            </div>
          </section>

          {/* 2 — Theme */}
          <section>
            <p className={`${head} mb-2`}>2 · Theme</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {AI_THEMES.map((t) => {
                const on = theme === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTheme(t.key)}
                    className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${on ? "border-blue-500 bg-blue-600/15" : "border-gray-700 bg-gray-800/60 hover:border-gray-500"}`}
                  >
                    <span className={`block text-[0.8125rem] font-semibold ${on ? "text-white" : "text-gray-100"}`}>{t.label}</span>
                    <span className="block text-[0.6875rem] text-gray-400 leading-snug mt-0.5">{t.blurb}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 3 — What goes on it */}
          <section>
            <p className={`${head} mb-2`}>3 · On your card</p>
            <div className="rounded-xl border border-gray-800 divide-y divide-gray-800">
              {([
                ["Headshot", headshot, setHeadshot, hasPhoto, teamBrand ? "Each teammate's own photo" : hasPhoto ? "Your photo" : "Add a photo in your details first"],
                ["Logo", logo, setLogo, hasLogo, hasLogo ? (teamBrand ? "Your company logo" : "Your logo") : "Add a logo in your details first"],
              ] as const).map(([label, on, set, available, hint]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className={`text-[0.8125rem] font-medium ${available ? "text-white" : "text-gray-500"}`}>{label}</p>
                    <p className="text-[0.6875rem] text-gray-500">{hint}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on && available}
                    aria-label={`${label} on the card`}
                    disabled={!available}
                    onClick={() => set(!on)}
                    className={toggle(on && available, !available)}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.06)] transition-transform ${on && available ? "translate-x-5" : ""}`} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {error && <p className="text-[0.75rem] text-amber-400" role="alert">{error}</p>}
        </div>

        <div className="sticky bottom-0 bg-gray-900/95 backdrop-blur px-5 py-3 border-t border-gray-800 flex items-center gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={!theme || busy}
            onClick={() => theme && onGenerate({ theme, colors, headshot: headshot && hasPhoto, logo: logo && hasLogo })}
            className="flex-1 flex items-center justify-center gap-2 text-[0.875rem] font-semibold text-white bg-gradient-to-r from-blue-600 to-violet-600 hover:brightness-110 rounded-xl px-4 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? (
              <>
                <span className="block w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" aria-hidden />
                Designing your card…
              </>
            ) : theme ? "Generate my design" : "Pick a theme to continue"}
          </button>
          <button type="button" onClick={onClose} disabled={busy} className="text-[0.8125rem] text-gray-400 hover:text-gray-200 px-3 py-3 disabled:opacity-40">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
