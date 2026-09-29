"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ImageUpload from "@/components/ImageUpload";
import ProfilePhotoSuggest from "@/components/ProfilePhotoSuggest";
import { SwiftLinkStyleControls } from "@/components/SwiftLinkDesign";
import SwiftLinkLivePreview from "@/components/SwiftLinkLivePreview";
import { LinkPageViewport, FullSizeOverlay } from "@/components/PinnedCardPreview";
import { Switch } from "@/components/ui/DesignControls";
import MiniBuilderModal, { type MiniStep } from "./MiniBuilderModal";
import { useProductSketch } from "./useProductSketch";
import { Field, TextArea, SocialFields, LinkButtons } from "./BuilderFields";
import { prettyCardSlug } from "@/lib/slug";

// "See how your SwiftLink would look" builder for the homepage SwiftLinks
// section. Three steps: (1) name, business & profile photo, (2) bio, socials &
// additional links, (3) style your page. The preview is the real link.me-style
// profile driven by what you type; "Make it live" hands off to /cards/new (the
// SwiftLink lives on the same card record) starting at the FIRST wizard step
// with everything prefilled, so the visitor walks through card creation +
// account setup from the beginning.


export default function SwiftLinkMiniBuilder({ linkedinEnabled = false }: { linkedinEnabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [fullPreview, setFullPreview] = useState(false);
  const closeFullPreview = useCallback(() => setFullPreview(false), []);
  const { sketch, patch, patchLinkStyle, patchSocial, handOff, reset, linkedInReturn } = useProductSketch("swiftlink", open);
  // Back from the guest LinkedIn photo import (see readGuestLinkedInReturn):
  // re-open on the first step WITHOUT reset, so the stashed sketch and the
  // photo just connected for are both there.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time re-open after the LinkedIn hop
    if (linkedInReturn) { setStep(0); setOpen(true); }
  }, [linkedInReturn]);


  // The link is derived exactly like the real builder: prettyCardSlug fuses
  // name + business into AlexMorgan-MorganCo. The old local slugify produced
  // alex-morgan-morgan-co, which is not a link this product has issued since
  // the slug format changed — the visitor was shown an address that would not
  // be theirs.
  const handle = prettyCardSlug(sketch.name, sketch.company) || "YourName";

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

  const livePreview = (
    <SwiftLinkLivePreview
      style={sketch.linkStyle}
      name={sketch.name}
      handle={handle}
      company={sketch.company}
      title={sketch.title}
      bio={sketch.bio}
      photoUrl={sketch.headshot}
      // The sketch is shared with the card mini-builder, where a guest can
      // upload a logo — without this, setting one there and coming back
      // here showed initials for a page that would render the logo.
      logoUrl={sketch.logo}
      socials={{
        instagram: sketch.socials.instagram, tiktok: sketch.socials.tiktok,
        linkedin: sketch.socials.linkedin, twitter: sketch.socials.twitter,
        facebook: sketch.socials.facebook, youtube: sketch.socials.youtube,
        website: sketch.website,
      }}
      links={sketch.links}
      paid
      showCardLink={sketch.showCardLink}
    />
  );

  const steps: MiniStep[] = [
    // 1 — name, business & profile photo
    {
      title: "Name your SwiftLink",
      subtitle: "Your link is built from your name and business — this is the page that lives in your bio.",
      canAdvance: sketch.name.trim().length > 0,
      content: (
        <>
          <Field label="Your name" placeholder="Alex Morgan" value={sketch.name} onChange={(e) => patch({ name: e.target.value })} autoFocus />
          <Field label="Business name" placeholder="Morgan & Co." value={sketch.company} onChange={(e) => patch({ company: e.target.value })} />
          <div className="flex items-center gap-2 min-w-0 rounded-xl bg-white border border-slate-200 px-3.5 py-2.5">
            <span className="text-slate-400 text-[0.75rem] shrink-0">Your link</span>
            <span className="min-w-0 text-slate-900 font-semibold text-sm truncate">swiftcard.me/links/{handle}</span>
          </div>
          <div className="pt-1">
            <span className="block text-slate-500 text-[0.75rem] font-medium mb-1.5">Profile photo</span>
            <ImageUpload guest field="photo" shape="circle" currentUrl={sketch.headshot} label="" onUploaded={(u) => patch({ headshot: u || null })} />
            <ProfilePhotoSuggest guest email={sketch.email} linkedinEnabled={linkedinEnabled} returnTo="/?builder=swiftlink" onConfirm={(u) => patch({ headshot: u })} />
            {/* Only used to look your headshot up — never shown on the page. */}
            <Field label="Email (only used to find your headshot)" type="email" placeholder="alex@morganco.com" value={sketch.email} onChange={(e) => patch({ email: e.target.value })} />
          </div>
        </>
      ),
    },
    // 2 — bio, all socials & additional links
    {
      title: "Your bio, socials & links",
      subtitle: "A line about you, the socials you have, and any links you want front and center.",
      // The bio is required, the same as the real builder's Socials step
      // (NewCardWizard requireBio) — Next and "Make it live" wait for it.
      canAdvance: sketch.bio.trim().length > 0,
      content: (
        <div className="space-y-4">
          <TextArea
            label="Bio"
            placeholder="Founder & CEO at Morgan & Co. Helping brands grow"
            value={sketch.bio}
            onChange={(e) => patch({ bio: e.target.value })}
            required
            hint="Who you help and what you do — the first thing people read. AI follow-ups use it too."
            autoFocus
          />
          <SocialFields socials={sketch.socials} onChange={patchSocial} />
          <LinkButtons
            links={sketch.links}
            onChange={(links) => patch({ links })}
            label="Additional links"
            hint="Buttons on your page that open any website."
          />
        </div>
      ),
    },
    // 3 — style your page (the Swift Links page's own design keys)
    {
      title: "Style your page",
      subtitle: "Pick a Look — solid, gradient, or your own photo — then style your social icons and font. Updates live.",
      previewFirst: true,
      // links + onLinksChange turn on the real "Link buttons" section — the
      // same per-link Featured / Grid / Compact picker and Standard / Solid /
      // Outline row styles the Social design tab has. Uploads work for a
      // visitor with no account too (guest uploads, api/upload).
      // EXACTLY Social design (owner, 2026-09-16): the same "View SwiftCard"
      // switch first, then the same shared panel.
      content: (
        <div className="space-y-4">
          <Switch
            checked={sketch.showCardLink}
            onChange={(v) => patch({ showCardLink: v })}
            label={"Show the “View SwiftCard” button"}
            help="The small link at the bottom of your Swift Links page that opens your card."
          />
          <SwiftLinkStyleControls
            value={sketch.linkStyle}
            onChange={patchLinkStyle}
            links={sketch.links}
            onLinksChange={(links) => patch({ links })}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => { reset(); setStep(0); setOpen(true); }}
        className="rd-btn rd-btn-aurora rd-btn-lg mt-2"
        data-reveal
      >
        See how your SwiftLink would look
      </button>

      <MiniBuilderModal
        open={open}
        onClose={close}
        onStartOver={startOver}
        eyebrow="Build your SwiftLink"
        step={step}
        setStep={setStep}
        steps={steps}
        onLaunch={launch}
        launching={launching}
        launchLabel="Make it live →"
        previewCaption="Lives in your Instagram, TikTok, or email bio."
        // The demo phone renders the REAL Swift Links page (SwiftLinkLivePreview
        // → SwiftLinkProfile), scaled to phone width — the exact hero, full bio,
        // real brand social icons and real featured-link cards the published
        // page shows. Zero drift: long bios aren't clamped, every social shows,
        // links look identical to the live page.
        preview={livePreview}
        // Pinned on a phone: the SAME scrollable page viewport Social design
        // uses — follows the step being edited, jumps to any section, opens
        // full size.
        pinnedPreview={<LinkPageViewport onExpand={() => setFullPreview(true)}>{livePreview}</LinkPageViewport>}
      />
      {fullPreview && (
        <FullSizeOverlay label="See your Swift Links page full size" onClose={closeFullPreview}>
          <div className="w-full max-w-[390px]">{livePreview}</div>
        </FullSizeOverlay>
      )}
    </>
  );
}
