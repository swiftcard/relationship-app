"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CardScaler from "@/components/CardScaler";
import InertPreview from "@/components/InertPreview";
import ImageUpload from "@/components/ImageUpload";
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
import LogoSuggest from "@/components/LogoSuggest";
import ProfilePhotoSuggest from "@/components/ProfilePhotoSuggest";
import TemplateStyleControls from "@/components/card-templates/TemplateStyleControls";
import TemplatePicker from "@/components/card-templates/TemplatePicker";
import MiniBuilderModal, { type MiniStep } from "./MiniBuilderModal";
import { useProductSketch } from "./useProductSketch";
import { Field, LogoShapeToggle } from "./BuilderFields";
import { prettyCardSlug } from "@/lib/slug";

// "See how your Swift Signature would look" builder for the homepage signature
// section. Your signature IS your card rendered under your name, so it needs the
// same details a card does — name/title/company, email/phone, headshot + logo,
// and a template. Shows the live signature, then hands off to /cards/new
// prefilled; the real signature is generated from the card you finish there.

const TEMPLATES = [
  { id: "classic-pro", label: "Classic", Component: ClassicPro },
  { id: "modern-bold", label: "Modern", Component: ModernBold },
  { id: "photo-first", label: "Photo", Component: PhotoFirst },
  { id: "local-business", label: "Local", Component: LocalBusiness },
  { id: "luxury-minimal", label: "Luxury", Component: LuxuryMinimal },
  { id: "logo-first", label: "Logo", Component: LogoFirst },
];


export default function SignatureMiniBuilder({ linkedinEnabled = false }: { linkedinEnabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [launching, setLaunching] = useState(false);
  const { sketch, patch, patchStyle, handOff, reset, linkedInReturn } = useProductSketch("signature", open);
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

  // A signature renders the card itself, so it shares CardData — but only the
  // fields a signature actually shows (no street address, no card-only extras).
  const data: CardData = {
    name: sketch.name || "Your Name",
    title: sketch.title || "Your Title",
    company: sketch.company || "Your Company",
    phone: sketch.phone || "(555) 000-0000",
    email: sketch.email || "you@email.com",
    website: sketch.website,
    address: "",
    initials: (sketch.name || "Y")[0].toUpperCase(),
    photoUrl: sketch.headshot,
    logoUrl: sketch.logo,
    cardUrl: `swiftcard.me/${prettyCardSlug(sketch.name, sketch.company) || "your-card"}`,
    // No socials: the Swift Signature is a replica of the card, and cards
    // render withoutSocials() — the preview must match the real thing.
    customization: { ...sketch.style, logoShape: sketch.logoShape, ...(customSelected ? { customLayout } : {}) },
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
      title: "Who's signing off?",
      subtitle: "Your Swift Signature is your card under your name — start with the basics.",
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
      title: "Your contact details",
      subtitle: "These sit inside the card so anyone can reach you in one tap.",
      content: (
        <>
          <Field label="Email" type="email" placeholder="alex@morganandco.com" value={sketch.email} onChange={(e) => patch({ email: e.target.value })} autoFocus />
          <Field label="Phone" type="tel" placeholder="(555) 123-4567" value={sketch.phone} onChange={(e) => patch({ phone: e.target.value })} />
          <Field label="Website" placeholder="morganco.com" value={sketch.website} onChange={(e) => patch({ website: e.target.value })} />
        </>
      ),
    },
    {
      title: "Add your photo & logo",
      subtitle: "A headshot and logo make your Swift Signature unmistakably yours.",
      content: (
        <div className="space-y-5">
          <div>
            <ImageUpload guest field="photo" shape="circle" currentUrl={sketch.headshot} label="Headshot" onUploaded={(u) => patch({ headshot: u || null })} />
            <ProfilePhotoSuggest guest email={sketch.email} linkedinEnabled={linkedinEnabled} returnTo="/?builder=signature" onConfirm={(u) => patch({ headshot: u })} />
          </div>
          <div>
            <ImageUpload guest field="logo" shape="square" currentUrl={sketch.logo} label="Company logo" onUploaded={(u) => patch({ logo: u || null })} />
            <LogoSuggest company={sketch.company} email={sketch.email} onConfirm={(u) => patch({ logo: u })} />
            {/* The signature IS the card, so the same plate shape applies. */}
            {sketch.logo && <LogoShapeToggle value={sketch.logoShape} onChange={(v) => patch({ logoShape: v })} />}
          </div>
        </div>
      ),
    },
    // NOTE: no socials step — the Swift Signature is a replica of the CARD, and
    // cards render withoutSocials(); asking for socials here collected fields
    // the signature never shows. Socials belong to the Swift Links page and are
    // collected in the real wizard's Socials step after "Make it live".
    {
      title: "Design your signature",
      subtitle: "Pick a template, then work down the numbered steps — it updates live.",
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
            <TemplateStyleControls value={sketch.style} onChange={patchStyle} template={sketch.template} />
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="flex justify-center mt-8" data-reveal="fade">
        <button
          type="button"
          onClick={() => { reset(); setStep(0); setOpen(true); }}
          className="rd-btn rd-btn-primary rd-btn-lg"
        >
          See how your Swift Signature would look
        </button>
      </div>

      <MiniBuilderModal
        open={open}
        onClose={close}
        onStartOver={startOver}
        eyebrow="Build your Swift Signature"
        step={step}
        setStep={setStep}
        steps={steps}
        onLaunch={launch}
        launching={launching}
        launchLabel="Make it live →"
        previewCaption="Drops into Gmail, Outlook, Apple Mail & more."
        preview={
          <div className="w-[280px] max-w-full rounded-2xl p-4" style={{ background: "#FAF7F2" }}>
            <p className="text-[0.8125rem] text-slate-900 mb-2">
              <strong>{sketch.name || "Your Name"}</strong>
              {sketch.company ? <span className="text-slate-500"> | {sketch.company}</span> : null}
            </p>
            <div className="rounded-2xl overflow-hidden shadow-[0_10px_30px_-14px_rgba(8,10,18,0.5)]">
              <InertPreview><CardScaler><Preview data={data} /></CardScaler></InertPreview>
            </div>
            <p className="mt-2 text-[0.8125rem] font-bold" style={{ color: "#2563eb" }}>Contact me →</p>
          </div>
        }
      />
    </>
  );
}
