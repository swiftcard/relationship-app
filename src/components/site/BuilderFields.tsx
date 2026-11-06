"use client";

import { useState } from "react";
import type { SketchSocials, SketchLink } from "./useProductSketch";
import { socialInput } from "@/lib/social-input";
import { PLAN_LIMITS } from "@/lib/plan";
import SocialHandleField from "@/components/SocialHandleField";
import AddLinkForm from "@/components/AddLinkForm";
import LinkListEditor from "@/components/LinkListEditor";
import { withHttps } from "@/lib/link-list";

// Small form primitives shared by the three homepage product builders, styled
// to match the dark builder shell. Kept in one place so the card, SwiftLink and
// signature flows stay visually identical and a change lands everywhere.

export const inputCls =
  "w-full bg-[#15171F] border border-white/10 text-white placeholder-white/30 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors";

export function Field({
  label,
  prefix,
  ...props
}: { label: string; prefix?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="block text-white/55 text-[0.75rem] font-medium mb-1.5">{label}</span>
      <div className="relative">
        {prefix && <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 text-sm">{prefix}</span>}
        <input className={inputCls} style={prefix ? { paddingLeft: 26 } : undefined} {...props} />
      </div>
    </label>
  );
}

export function TextArea({ label, hint, ...props }: { label: string; hint?: React.ReactNode } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="block text-white/55 text-[0.75rem] font-medium mb-1.5">
        {label}{props.required && <span className="text-red-400 ml-0.5" aria-hidden="true">*</span>}
      </span>
      <textarea className={`${inputCls} resize-none`} rows={3} {...props} />
      {hint && <span className="block text-white/70 text-[0.6875rem] mt-1.5 leading-snug">{hint}</span>}
    </label>
  );
}

// The SAME row as the real builder and the card editor (SocialHandleField,
// "site" tone): the platform icon, and a box that shows the start of the link
// so the username obviously goes after it (owner, 2026-09-29). The
// mini-builders keep their own subset and order.
const MINI_SOCIAL_KEYS: (keyof SketchSocials)[] = ["linkedin", "instagram", "tiktok", "twitter", "facebook", "youtube"];
const SOCIALS = MINI_SOCIAL_KEYS.map((k) => socialInput(k)!);

export function SocialFields({
  socials,
  onChange,
  only,
}: {
  socials: SketchSocials;
  onChange: (k: keyof SketchSocials, v: string) => void;
  /** Restrict to a product's supported set (e.g. a signature shows fewer). */
  only?: (keyof SketchSocials)[];
}) {
  const list = only ? SOCIALS.filter((s) => only.includes(s.key as keyof SketchSocials)) : SOCIALS;
  return (
    <div className="space-y-3">
      <div>
        <span className="block text-white/55 text-[0.75rem] font-medium">Social profiles</span>
        <p className="text-white/70 text-[0.6875rem] leading-snug mt-0.5">Type your username, or paste your profile link.</p>
      </div>
      {list.map((s) => (
        <SocialHandleField
          key={s.key}
          spec={s}
          variant="site"
          id={`mini-social-${s.key}`}
          value={socials[s.key as keyof SketchSocials]}
          onChange={(v) => onChange(s.key as keyof SketchSocials, v)}
        />
      ))}
    </div>
  );
}

// "Additional links" — the same list, the same add flow, the same section
// headers and the same Free limit as the real builder's Socials step
// (/cards/new), so what a visitor does here is exactly what they will do there
// (owner, 2026-09-16: "it should be the exact same as how it is in the main one").
export function LinkButtons({
  links,
  onChange,
  label = "Link buttons",
  hint = "Buttons on your page that open any website.",
}: {
  links: SketchLink[];
  onChange: (links: SketchLink[]) => void;
  label?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useState<SketchLink>({ label: "", url: "" });
  // A visitor builds as a guest, and a guest's card is Free until they choose
  // a plan — the same cap the wizard applies to them.
  const atLinkCap = links.length >= PLAN_LIMITS.FREE_MAX_LINKS;

  function add() {
    if (atLinkCap) return;
    const l = draft.label.trim();
    const u = withHttps(draft.url);
    if (!l || !u) return;
    onChange([...links, { label: l, url: u }]);
    setDraft({ label: "", url: "" });
  }

  return (
    <div>
      <span className="block text-white/55 text-[0.75rem] font-medium mb-1">{label}</span>
      <p className="text-white/70 text-[0.6875rem] mb-2 leading-snug">{hint}</p>

      {/* The same list as the real builder (LinkListEditor): in page order,
          drag a row by its grip, tap a link to edit it in place, and
          "+ Add a section header" under it, above the add form. */}
      <div className="mb-2.5">
        <LinkListEditor links={links} onChange={onChange} variant="site" canAddHeader />
      </div>

      {atLinkCap ? (
        <p className="text-[0.6875rem] text-white/50 bg-[#15171F] border border-white/10 rounded-xl px-3 py-2.5 leading-relaxed">
          Free includes {PLAN_LIMITS.FREE_MAX_LINKS} extra links. Pro unlocks unlimited extra links. You&apos;ll choose your plan before your page goes live.
        </p>
      ) : (
        // The same form as the real builder (AddLinkForm): tappable ideas that
        // show what a link is for, then "Button text" and "Web address".
        <AddLinkForm
          variant="site"
          value={draft}
          onChange={(d) => setDraft(d)}
          onAdd={add}
          addClass="bg-blue-600 hover:bg-blue-500 text-white border border-blue-500"
          idPrefix="mini-link"
        />
      )}
    </div>
  );
}
