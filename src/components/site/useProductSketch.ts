"use client";

import { useCallback, useEffect, useState } from "react";
import type { TemplateStyle } from "@/components/card-templates/shared";
import type { CardLink } from "@/components/card-templates/types";
import type { SwiftLinkStyle } from "@/components/SwiftLinkDesign";
import { stashSketch, consumePrefill, writePrefill, type CardPrefill } from "@/lib/prefill";
import { resetMarketingSketch } from "@/lib/guest-reset";
import { stashGuestLinkedInStatus } from "@/lib/linkedin-popup";

// ── One sketch, three products ──────────────────────────────────────────────
// The homepage builders ("see how your card / SwiftLink / signature would
// look") all describe the SAME underlying record: a SwiftCard card row already
// carries its SwiftLink and email signature. So they share one state shape
// here, and each builder only ASKS for the subset its own product renders.
//
// Two things fall out of sharing it:
//   • a visitor who sketches a card and then opens the signature builder
//     doesn't retype their name, title, company, photo or colours; and
//   • whatever they end up with hands off to the real wizard intact, colours
//     and fonts included (see CardPrefill / PREFILL_STYLE_KEYS).
//
// Abandoning still wipes everything — closing a builder calls reset(), which
// clears the shared localStorage sketch via resetMarketingSketch, so reopening
// any builder starts blank. An unfinished card in the real builder is never
// touched from here.

export type SketchSocials = {
  linkedin: string;
  instagram: string;
  tiktok: string;
  facebook: string;
  twitter: string;
  youtube: string;
};

/** The sketch carries the REAL link shape (size, row style, media, headers),
 *  so a per-link choice made on the marketing site survives the hand-off
 *  instead of arriving as a bare label + url. */
export type SketchLink = CardLink;

export type Sketch = {
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  bio: string;
  street: string;
  city: string;
  stateRegion: string;
  zip: string;
  headshot: string | null;
  logo: string | null;
  template: string;
  /** Logo plate shape — the same Original/Circle choice the real editor has. */
  logoShape: "auto" | "circle";
  style: TemplateStyle;
  /** Swift Links PAGE design — separate surface, separate keys (see lib/plan). */
  linkStyle: SwiftLinkStyle;
  socials: SketchSocials;
  links: SketchLink[];
  /** Social design's "Link to your business card" switch (the small "View SwiftCard" link). On by default. */
  showCardLink: boolean;
};

export const EMPTY_SOCIALS: SketchSocials = {
  linkedin: "", instagram: "", tiktok: "", facebook: "", twitter: "", youtube: "",
};

export const EMPTY_SKETCH: Sketch = {
  name: "", title: "", company: "", phone: "", email: "", website: "", bio: "",
  street: "", city: "", stateRegion: "", zip: "",
  headshot: null, logo: null,
  // Photo First is the most popular, best-looking default, so the "see how your
  // card / signature would look" live preview leads with it the moment someone
  // starts typing. They can still switch template + colours on the design step.
  template: "photo-first",
  logoShape: "auto",
  style: {},
  linkStyle: {},
  socials: { ...EMPTY_SOCIALS },
  links: [],
  showCardLink: true,
};

// Sketch → the prefill shape the real wizard reads on hand-off.
export function toPrefill(s: Sketch, product: CardPrefill["product"]): CardPrefill {
  return {
    name: s.name.trim(),
    title: s.title.trim(),
    company: s.company.trim(),
    phone: s.phone.trim(),
    email: s.email.trim(),
    website: s.website.trim(),
    bio: s.bio.trim(),
    address: { street: s.street.trim(), city: s.city.trim(), state: s.stateRegion.trim(), zip: s.zip.trim() },
    template: s.template,
    logoShape: s.logoShape,
    ...s.style,
    ...s.linkStyle,
    socials: Object.fromEntries(
      Object.entries(s.socials).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]),
    ),
    links: s.links,
    ...(s.showCardLink ? {} : { hideCardLink: true }),
    headshotUrl: s.headshot,
    logoUrl: s.logo,
    product,
  };
}

// Anything a previous builder already captured this session, back into state —
// so moving card → signature → SwiftLink never re-asks for the same details.
function fromPrefill(p: CardPrefill): Sketch {
  return {
    ...EMPTY_SKETCH,
    name: p.name ?? "",
    title: p.title ?? "",
    company: p.company ?? "",
    phone: p.phone ?? "",
    email: p.email ?? "",
    website: p.website ?? "",
    bio: p.bio ?? "",
    street: p.address?.street ?? "",
    city: p.address?.city ?? "",
    stateRegion: p.address?.state ?? "",
    zip: p.address?.zip ?? "",
    headshot: p.headshotUrl ?? null,
    logo: p.logoUrl ?? null,
    template: p.template ?? "photo-first",
    logoShape: p.logoShape === "circle" ? "circle" : "auto",
    style: {
      accentColor: p.accentColor,
      bgColor: p.bgColor,
      textColor: p.textColor,
      infoColor: p.infoColor,
      fontFamily: p.fontFamily,
      surfaceColor: p.surfaceColor,
      finish: p.finish,
      panelMedia: p.panelMedia,
      panelMediaType: p.panelMediaType,
      panelMediaPoster: p.panelMediaPoster,
      panelDim: p.panelDim,
    },
    linkStyle: {
      linkLook: p.linkLook,
      linkIconShape: p.linkIconShape,
      linkIconFill: p.linkIconFill,
      linkBgColor: p.linkBgColor,
      linkTextColor: p.linkTextColor,
      linkFontFamily: p.linkFontFamily,
      linkAccentColor: p.linkAccentColor,
      linkHeroStyle: p.linkHeroStyle,
      linkHeroContent: p.linkHeroContent,
      linkButtonStyle: p.linkButtonStyle,
      linkButtonColor: p.linkButtonColor,
      linkHeroImage: p.linkHeroImage,
      linkHeroMediaType: p.linkHeroMediaType,
      linkBgMedia: p.linkBgMedia,
      linkBgMediaType: p.linkBgMediaType,
      linkBgDim: p.linkBgDim,
      linkGlass: p.linkGlass,
    },
    socials: { ...EMPTY_SOCIALS, ...(p.socials ?? {}) } as SketchSocials,
    links: p.links ?? [],
    showCardLink: !p.hideCardLink,
  };
}

// ── Back from a guest LinkedIn photo import ──────────────────────────────────
//
// "Connect LinkedIn" in a homepage builder is a full-page hop (no account to
// attach a popup to), and the callback lands on `returnTo` with the imported
// photo as ?li_photo=. Only /cards/new ever read that param — the homepage
// builders sent people back to "/" and then ignored it, so the visitor came
// back to the top of the homepage with the builder closed and no photo (owner,
// 2026-09-22: "LinkedIn profile pictures do not connect properly").
//
// Each builder now returns to /?builder=<product>. This reads that back: the
// matching builder re-opens with the sketch it stashed before the hop, and the
// photo is applied on top. Only our own storage host is accepted — the param
// is never trusted blind (same rule as the wizard's reader).
export function readGuestLinkedInReturn(
  search: string,
  product: CardPrefill["product"],
  storageOrigin: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): { returned: boolean; photo: string | null } {
  const params = new URLSearchParams(search);
  if (params.get("builder") !== product) return { returned: false, photo: null };
  const photo = params.get("li_photo");
  const ok = !!photo && !!storageOrigin && photo.startsWith(`${storageOrigin}/storage/v1/object/public/`);
  return { returned: true, photo: ok ? photo : null };
}

export function useProductSketch(product: CardPrefill["product"], open: boolean) {
  const [sketch, setSketch] = useState<Sketch>(EMPTY_SKETCH);
  const [linkedInReturn, setLinkedInReturn] = useState(false);
  const [returnedPhoto, setReturnedPhoto] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const { returned, photo } = readGuestLinkedInReturn(url.search, product);
    if (!returned) return;
    // A failed import is stripped from the URL below before the suggester is
    // on screen — hand its status over so it can say what happened.
    if (url.searchParams.get("integration") === "linkedin") stashGuestLinkedInStatus(url.searchParams.get("status"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the LinkedIn return URL on mount
    setLinkedInReturn(true);
    if (photo) setReturnedPhoto(photo);
    for (const k of ["builder", "li_photo", "integration", "status"]) url.searchParams.delete(k);
    window.history.replaceState({}, "", url.toString());
  }, [product]);

  const patch = useCallback((p: Partial<Sketch>) => setSketch((prev) => ({ ...prev, ...p })), []);
  const patchStyle = useCallback(
    (p: Partial<TemplateStyle>) => setSketch((prev) => ({ ...prev, style: { ...prev.style, ...p } })),
    [],
  );
  const patchLinkStyle = useCallback(
    (p: Partial<SwiftLinkStyle>) => setSketch((prev) => ({ ...prev, linkStyle: { ...prev.linkStyle, ...p } })),
    [],
  );
  const patchSocial = useCallback(
    (k: keyof SketchSocials, v: string) => setSketch((prev) => ({ ...prev, socials: { ...prev.socials, [k]: v } })),
    [],
  );

  // On open, pick up whatever another builder captured earlier this session.
  // consumePrefill() read-and-removes; the autosave below immediately re-stashes
  // the merged result, so nothing is lost and there's never a stale duplicate.
  //
  // A photo just imported from LinkedIn goes on AFTER the restore, so the
  // stashed sketch's older (or missing) headshot can never overwrite the one
  // the visitor just connected for.
  useEffect(() => {
    if (!open) return;
    const carried = consumePrefill();
    const photo = returnedPhoto;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from the session sketch when the builder opens
    setSketch((prev) => {
      const base = prev === EMPTY_SKETCH && carried ? fromPrefill(carried) : prev;
      return photo ? { ...base, headshot: photo } : base;
    });
    if (photo) setReturnedPhoto(null);
  }, [open, returnedPhoto]);

  // Keep the shared sketch current as they type, so ANY other entry point
  // (another builder, or a generic "Get started" button) carries it too.
  useEffect(() => {
    if (open) stashSketch(toPrefill(sketch, product));
  }, [open, sketch, product]);

  // Hand off to the real wizard (/cards/new), landing on its FIRST step with
  // everything set.
  //
  // The `step: 1` marker tells it to auto-apply this sketch and begin there, so
  // they still walk through every step (socials included). An unfinished card
  // from an earlier visit is NOT deleted here any more: the wizard asks
  // "Continue your card / Start a new card", and "Start a new card" applies
  // this sketch (owner rule 2026-09-16 — nobody loses a card by accident).
  const handOff = useCallback(() => {
    writePrefill({ ...toPrefill(sketch, product), step: 1 });
  }, [sketch, product]);

  // Abandoned → drop the shared sketch AND this builder's fields, so every
  // builder reopens genuinely blank (see resetMarketingSketch).
  const reset = useCallback(() => {
    setSketch(EMPTY_SKETCH);
    resetMarketingSketch();
  }, []);

  return { sketch, patch, patchStyle, patchLinkStyle, patchSocial, handOff, reset, linkedInReturn };
}
