"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CardScaler from "@/components/CardScaler";
import InertPreview from "@/components/InertPreview";
import ImageUpload from "@/components/ImageUpload";
import LogoSuggest from "@/components/LogoSuggest";
import ProfilePhotoSuggest from "@/components/ProfilePhotoSuggest";
import TemplateStyleControls from "@/components/card-templates/TemplateStyleControls";
import TemplatePicker from "@/components/card-templates/TemplatePicker";
import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import CustomCard from "@/components/card-templates/CustomCard";
import CustomCardDesigner from "@/components/CustomCardDesigner";
import { DEFAULT_PRESET, buildPreset, normalizeCustomLayout } from "@/lib/custom-layout";
import type { CardData } from "@/components/card-templates/types";
import MiniBuilderModal, { type MiniStep } from "./MiniBuilderModal";
import { useProductSketch } from "./useProductSketch";
import { Field, LogoShapeToggle } from "./BuilderFields";
import { prettyCardSlug } from "@/lib/slug";

// The 6th tile in the Swift Cards template grid: a dashed card outline with a
// "+" that opens the REAL card builder — the same controls the signed-in editor
// uses (TemplateStyleControls for colours/fonts, ImageUpload for the cropped
// headshot/logo, LogoSuggest + ProfilePhotoSuggest for the automatic
// suggestions), just scoped to what a digital card actually renders.
//
// Everything a visitor does here survives into /cards/new and, from there, into
// their account — see useProductSketch → CardPrefill.

const TEMPLATES = [
  { id: "classic-pro", label: "Classic", Component: ClassicPro },
  { id: "modern-bold", label: "Modern", Component: ModernBold },
  { id: "photo-first", label: "Photo", Component: PhotoFirst },
  { id: "local-business", label: "Local", Component: LocalBusiness },
  { id: "luxury-minimal", label: "Luxury", Component: LuxuryMinimal },
  { id: "logo-first", label: "Logo", Component: LogoFirst },
];

// The card face previews the REAL link. prettyCardSlug is the same helper the
// wizard's own "Card URL" hint uses — "Alex Morgan" + "Morgan & Co." becomes
// AlexMorgan-MorganCo, not the old alex-morgan-morgan-co. Routes are
// case-insensitive, so the pretty form is what we show everywhere.

export default function CardMiniBuilder({ linkedinEnabled = false }: { linkedinEnabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [launching, setLaunching] = useState(false);
  const { sketch, patch, patchStyle, handOff, reset, linkedInReturn } = useProductSketch("card", open);
  // Back from the guest LinkedIn photo import (see readGuestLinkedInReturn):
  // re-open on the first step WITHOUT reset, so the stashed sketch and the
  // photo just connected for are both there.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time re-open after the LinkedIn hop
    if (linkedInReturn) { setStep(0); setOpen(true); }
  }, [linkedInReturn]);


  // Custom design: the layout the visitor is building (AI design or the
  // designer), starting from the same preset the real builder opens on.
  const customSelected = sketch.template === "custom";
  const customLayout = sketch.customLayout ? normalizeCustomLayout(sketch.customLayout) : buildPreset(DEFAULT_PRESET);
  const Preview = customSelected ? CustomCard : TEMPLATES.find((t) => t.id === sketch.template)?.Component ?? ClassicPro;
  const addressStr = [
    sketch.street,
    sketch.city,
    [sketch.stateRegion, sketch.zip].filter(Boolean).join(" "),
  ].filter(Boolean).join("\n");

  // The live card, driven straight off the sketch — same CardData shape the
  // real editor and the published page build.
  const data: CardData = {
    name: sketch.name || "Your Name",
    title: sketch.title || "Your Title",
    company: sketch.company || "Your Company",
    phone: sketch.phone || "(555) 000-0000",
    email: sketch.email || "you@email.com",
    website: sketch.website,
    address: addressStr,
    initials: (sketch.name || "Y")[0].toUpperCase(),
    photoUrl: sketch.headshot,
    logoUrl: sketch.logo,
    cardUrl: `swiftcard.me/${prettyCardSlug(sketch.name, sketch.company) || "your-card"}`,
    linkedin: sketch.socials.linkedin,
    instagram: sketch.socials.instagram,
    twitter: sketch.socials.twitter,
    tiktok: sketch.socials.tiktok,
    customization: { ...sketch.style, links: sketch.links, logoShape: sketch.logoShape, ...(customSelected ? { customLayout } : {}) },
  };

  function launch() {
    setLaunching(true);
    handOff();
    router.push("/cards/new");
  }

  // Closing just puts the builder away; opening always starts BLANK (owner
  // decision, Jul 2026): the open button calls reset() so a half-filled sketch
  // from an earlier play never greets the next visit.
  function close() {
    setOpen(false);
    setLaunching(false);
  }

  function startOver() {
    setOpen(false);
    setStep(0);
    setLaunching(false);
    reset();
  }

  const steps: MiniStep[] = [
    {
      title: "Who's on the card?",
      subtitle: "Just the basics — you can change any of it later.",
      canAdvance: sketch.name.trim().length > 0,
      content: (
        <>
          <Field label="Full name" placeholder="Alex Morgan" value={sketch.name} onChange={(e) => patch({ name: e.target.value })} autoFocus />
          <Field label="Title" placeholder="Founder & CEO" value={sketch.title} onChange={(e) => patch({ title: e.target.value })} />
          <Field label="Company" placeholder="Morgan & Co." value={sketch.company} onChange={(e) => patch({ company: e.target.value })} />
        </>
      ),
    },
    {
      title: "How do people reach you?",
      subtitle: "Phone and email get tap-to-call and tap-to-email on the real card.",
      content: (
        <>
          <Field label="Phone" type="tel" placeholder="(555) 123-4567" value={sketch.phone} onChange={(e) => patch({ phone: e.target.value })} autoFocus />
          <Field label="Email" type="email" placeholder="alex@morganco.com" value={sketch.email} onChange={(e) => patch({ email: e.target.value })} />
          <Field label="Website" placeholder="morganco.com" value={sketch.website} onChange={(e) => patch({ website: e.target.value })} />
          <Field label="Street address" placeholder="123 Main Street" value={sketch.street} onChange={(e) => patch({ street: e.target.value })} />
          <div className="grid grid-cols-3 gap-2">
            <Field label="City" placeholder="New York" value={sketch.city} onChange={(e) => patch({ city: e.target.value })} />
            <Field label="State" placeholder="NY" value={sketch.stateRegion} onChange={(e) => patch({ stateRegion: e.target.value })} />
            <Field label="ZIP" placeholder="10001" value={sketch.zip} onChange={(e) => patch({ zip: e.target.value })} />
          </div>
        </>
      ),
    },
    {
      title: "Add your photo & logo",
      subtitle: "A headshot and a company logo make the card unmistakably yours.",
      content: (
        <div className="space-y-5">
          <div>
            <ImageUpload guest field="photo" shape="circle" currentUrl={sketch.headshot} label="Headshot" onUploaded={(u) => patch({ headshot: u || null })} />
            {/* Looks your headshot up from the email you entered. Shows what it
                found and applies nothing until you pick it. */}
            <ProfilePhotoSuggest guest email={sketch.email} linkedinEnabled={linkedinEnabled} returnTo="/?builder=card" onConfirm={(u) => patch({ headshot: u })} />
          </div>
          <div>
            <ImageUpload guest field="logo" shape="square" currentUrl={sketch.logo} label="Company logo" onUploaded={(u) => patch({ logo: u || null })} />
            <LogoSuggest company={sketch.company} email={sketch.email} onConfirm={(u) => patch({ logo: u })} />
            {/* Logo plate shape — the editor's own control, shown only once a
                logo exists, exactly as the editor does it. */}
            {sketch.logo && <LogoShapeToggle value={sketch.logoShape} onChange={(v) => patch({ logoShape: v })} />}
          </div>
        </div>
      ),
    },
    {
      title: "Make it yours",
      subtitle: "Pick a template, then work down the numbered steps — the same design controls as the real editor.",
      previewFirst: true,
      content: (
        <div className="space-y-4">
          {/* EXACTLY the Card design tab (owner, 2026-09-16: "the same order,
              the same everything"): the shared template gallery, then the
              shared numbered design steps. Custom design OPENS here, exactly as
              it does for a guest's first card in the real builder (901ca554):
              AI design works, "Copy a card or template you like" keeps its PRO
              tag (canScan={false} — its routes need a paid account). The
              design rides the hand-off (CardPrefill.customLayout). */}
          <TemplatePicker template={sketch.template} onSelect={(id) => patch({ template: id })} data={data} customUnlocked upsell={false} />
          {customSelected ? (
            <CustomCardDesigner layout={customLayout} data={data} onChange={(l) => patch({ customLayout: l })} canScan={false} />
          ) : (
            <TemplateStyleControls value={sketch.style} onChange={patchStyle} template={sketch.template} hasPhoto={!!sketch.headshot} />
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      {/* The last grid item, after the six templates: one grid cell, exactly
          the size of a template card, on phone and computer alike (owner,
          2026-10-01: "the same exact size" as the cards above it). */}
      <button
        type="button"
        onClick={() => { reset(); setStep(0); setOpen(true); }}
        className="text-left outline-none group"
        data-reveal
        style={{ transitionDelay: "350ms" }}
      >
        <p className="text-[0.84375rem] font-semibold mb-2 text-slate-500 group-hover:text-[#2563EB] transition-colors">Start from scratch</p>
        {/* w-full takes the column's width; aspect 460/263 is CardScaler's
            card (460 wide, 263 tall) so the height matches the templates'.
            Never add a min-height: with an aspect ratio it derives the WIDTH
            and pushes the box off a phone's edge. The content fits a 320px
            phone's 140×80 tile — the title wraps to two lines there and the
            "60 seconds" line only shows from sm up. `relative overflow-hidden`
            clips the glare sweep. The button is outline-none, so keyboard
            focus shows here as a ring, like the templates' focus outline. */}
        <div
          className="relative overflow-hidden w-full aspect-[460/263] rounded-2xl flex flex-col items-center justify-center text-center gap-1.5 sm:gap-2.5 px-2.5 sm:px-4 transition-all duration-200 group-hover:-translate-y-[3px] group-focus-visible:-translate-y-[3px] group-focus-visible:ring-2 group-focus-visible:ring-[#2563EB] group-focus-visible:ring-offset-2"
          style={{ border: "2px dashed #C9BEA8", background: "rgba(37,99,235,0.03)" }}
        >
          {/* Glare sweep — the same shine the SwiftLink featured tiles use. */}
          <span className="rd-ll-shine" aria-hidden="true" />
          <span className="w-7 h-7 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-white shadow-lg transition-transform group-hover:scale-110 shrink-0" style={{ background: "var(--rd-aurora)" }}>
            <svg viewBox="0 0 24 24" className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
          </span>
          <div className="min-w-0">
            <p className="text-slate-800 font-semibold text-[0.8125rem] sm:text-[0.9375rem] leading-tight text-balance">See how your card looks</p>
            <p className="hidden sm:block text-slate-500 text-[0.75rem] leading-tight mt-1">60 seconds · no signup</p>
          </div>
        </div>
      </button>

      <MiniBuilderModal
        open={open}
        onClose={close}
        onStartOver={startOver}
        eyebrow="Build your card"
        step={step}
        setStep={setStep}
        steps={steps}
        onLaunch={launch}
        launching={launching}
        launchLabel="Make it live →"
        previewCaption="This is your real card — recipients open it as a full page in their browser."
        preview={
          <InertPreview className="w-full max-w-[260px]">
            <div className="rounded-[var(--rd-r-lg)] overflow-hidden shadow-[var(--rd-sh-lg)]">
              <CardScaler><Preview data={data} /></CardScaler>
            </div>
          </InertPreview>
        }
      />
    </>
  );
}
