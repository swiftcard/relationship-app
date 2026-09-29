"use client";

import { useRef } from "react";

// ── "Additional links": what one is, and how to add it ──────────────────────
//
// Owner, 2026-09-29: "why would a user just add an additional link when they
// don't even know what it is yet?" The old form was two bare boxes — "Link
// name" and "https://…" — under one line of explanation. A first-time user had
// no idea what to put there, so they put nothing.
//
// Now the form shows WHAT a link is for with tappable examples ("Book a
// meeting", "Leave a review" …). A tap only fills the button text and moves to
// the web address; it never adds anything by itself. The two boxes carry real
// labels — "Button text" and "Web address" — instead of relying on
// placeholders that vanish the moment you type.
//
// One component for the create-card wizard, the card editor, the homepage
// SwiftLink builder and Office Links branding, so they cannot drift apart.

const LINK_IDEAS = ["Book a meeting", "Leave a review", "See my listings", "Watch my video", "Shop now"] as const;

type Variant = "app" | "site";

const TONE: Record<Variant, { label: string; input: string; chip: string; chipOn: string; idle: string }> = {
  app: {
    label: "text-gray-400",
    input: "w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors",
    chip: "border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white",
    chipOn: "border-blue-500 bg-blue-600/15 text-blue-300",
    idle: "border border-dashed border-gray-700 text-gray-400 disabled:opacity-40",
  },
  site: {
    label: "text-white/55",
    input: "w-full bg-[#15171F] border border-white/10 text-white placeholder-white/30 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors",
    chip: "border-white/15 text-white/70 hover:border-white/30 hover:text-white",
    chipOn: "border-blue-400 bg-blue-500/15 text-blue-200",
    idle: "border border-dashed border-white/15 text-white/40 disabled:opacity-60",
  },
};

export default function AddLinkForm({
  value,
  onChange,
  onAdd,
  variant = "app",
  addLabel = "+ Add link",
  addClass = "sc-btn-glow bg-blue-600 hover:bg-blue-500 text-white border border-blue-500",
  ideas = LINK_IDEAS,
  idPrefix = "add-link",
  inert = false,
}: {
  value: { label: string; url: string };
  onChange: (next: { label: string; url: string }) => void;
  onAdd: () => void;
  variant?: Variant;
  addLabel?: string;
  /** Classes for the button once both boxes are filled (Office uses purple). */
  addClass?: string;
  ideas?: readonly string[];
  idPrefix?: string;
  /** Draw the real form but let nothing be typed or added — the marketing
   *  Teams demo, which must never create a link (a link row fetches a preview). */
  inert?: boolean;
}) {
  const t = TONE[variant];
  const urlRef = useRef<HTMLInputElement>(null);
  const ready = !inert && !!value.label.trim() && !!value.url.trim();

  return (
    <div className="space-y-3" data-add-link>
      {/* Examples first — they answer "what is this for?" before anything is
          asked. Wraps to as many rows as the width needs; never scrolls. */}
      <div>
        <p className={`text-[0.6875rem] font-medium mb-1.5 ${t.label}`}>Ideas — tap one to start</p>
        <div className="flex flex-wrap gap-1.5">
          {ideas.map((idea) => {
            const on = value.label === idea;
            return (
              <button
                key={idea}
                type="button"
                aria-pressed={on}
                disabled={inert}
                onClick={() => {
                  onChange({ ...value, label: idea });
                  // Straight to the address, which is the only thing left.
                  // Synchronously, inside the tap: iOS only raises the keyboard
                  // for a focus() that happens within the user's gesture, and a
                  // requestAnimationFrame callback is already outside it. The
                  // box is always rendered, so there is nothing to wait for.
                  urlRef.current?.focus();
                }}
                className={`text-[0.6875rem] font-semibold px-2.5 py-1.5 rounded-full border transition-colors disabled:cursor-default ${on ? t.chipOn : t.chip}`}
              >
                {idea}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-label`} className={`block text-[0.6875rem] font-medium mb-1 ${t.label}`}>Button text</label>
        <input
          id={`${idPrefix}-label`}
          type="text"
          placeholder="e.g. Leave a review"
          readOnly={inert}
          value={value.label}
          onChange={(e) => onChange({ ...value, label: e.target.value })}
          className={t.input}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-url`} className={`block text-[0.6875rem] font-medium mb-1 ${t.label}`}>Web address</label>
        <input
          id={`${idPrefix}-url`}
          ref={urlRef}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="e.g. calendly.com/alex"
          readOnly={inert}
          value={value.url}
          onChange={(e) => onChange({ ...value, url: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter" && ready) { e.preventDefault(); onAdd(); } }}
          className={t.input}
        />
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={!ready}
        className={`w-full text-xs font-semibold py-2.5 rounded-xl transition-colors ${ready ? addClass : t.idle}`}
      >
        {addLabel}
      </button>
    </div>
  );
}
