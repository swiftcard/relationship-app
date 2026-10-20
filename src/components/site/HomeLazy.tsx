"use client";

import dynamic from "next/dynamic";
import Deferred from "@/components/Deferred";
import WideDemo from "@/components/site/WideDemo";

// ── The homepage's heavy replicas: code AND markup arrive only when needed ──
//
// Deferred (components/Deferred) keeps a block out of the server HTML until it
// is near the viewport. That alone still shipped every block's JavaScript in
// the page's first chunks — TeamsDashboard, DashboardDemo, the six-persona
// showcase and the gallery are ~400 KB of code a phone parsed before the hero
// was interactive, and Lighthouse's model charges all of it against the LCP
// (page-weight pass, 2026-10-14). Each component here is a dynamic import with
// ssr:false inside a Deferred, so its chunk is fetched the moment the block
// mounts and not before. The page.tsx copy around them stays server-rendered.
//
// ssr:false is safe here precisely because Deferred never renders children on
// the server: nothing below ever had server HTML to hydrate.

const HeroShowcase = dynamic(() => import("@/components/site/HeroShowcase"), { ssr: false });
const TemplateGallery = dynamic(() => import("@/components/site/TemplateGallery"), { ssr: false });
const SwiftLinksPhone = dynamic(() => import("@/components/site/SwiftLinksPhone"), { ssr: false });
const SignatureDemo = dynamic(() => import("@/components/site/SignatureDemo"), { ssr: false });
const DashboardDemo = dynamic(() => import("@/components/site/DashboardDemo"), { ssr: false });
const ShareWaysPhones = dynamic(() => import("@/components/site/ShareWaysPhones"), { ssr: false });
const WatchShareImage = dynamic(() => import("@/components/site/WatchShareImage"), { ssr: false });
const TeamsDashboard = dynamic(() => import("@/components/site/TeamsDashboard"), { ssr: false });
const HomeCardPhone = dynamic(() => import("@/components/site/HomeCardPhone"), { ssr: false });
const ShareScene = dynamic(() => import("@/components/site/HowItWorksScenes").then((m) => m.ShareScene), { ssr: false });
const SaveScene = dynamic(() => import("@/components/site/HowItWorksScenes").then((m) => m.SaveScene), { ssr: false });
const LeadScene = dynamic(() => import("@/components/site/HowItWorksScenes").then((m) => m.LeadScene), { ssr: false });

/** The desktop hero showcase: after load + idle, and only at xl where the CSS shows it. */
export function LazyHeroShowcase() {
  return (
    <Deferred when="idle" media="(min-width: 1280px)">
      <HeroShowcase />
    </Deferred>
  );
}

/** LinkedIn is handing a photo back to the card builder, which lives in the gallery. */
const cardBuilderReturn = () => new URLSearchParams(window.location.search).get("builder") === "card";

export function LazyTemplateGallery({ linkedinEnabled }: { linkedinEnabled: boolean }) {
  // Built at once on a ?builder=card return: deferred, the card builder never
  // mounted to read it, and the visitor came back from LinkedIn to the top of
  // the homepage with the builder shut and no photo.
  return (
    <Deferred minHeight={640} now={cardBuilderReturn}>
      <TemplateGallery linkedinEnabled={linkedinEnabled} />
    </Deferred>
  );
}

export function LazySwiftLinksPhone() {
  return (
    <Deferred minHeight={560} className="flex justify-center w-full">
      <SwiftLinksPhone />
    </Deferred>
  );
}

export function LazySignatureDemo() {
  return (
    <Deferred minHeight={420}>
      <SignatureDemo />
    </Deferred>
  );
}

export function LazyDashboardDemo() {
  return (
    <Deferred minHeight={520}>
      {/* naturalHeight: the mock's height at its design width, held while its
          chunk downloads (measured 2026-10-14) — see WideDemo. */}
      <WideDemo minWidth={760} naturalHeight={740}>
        <DashboardDemo />
      </WideDemo>
    </Deferred>
  );
}

export function LazyShareWaysPhones() {
  return (
    <Deferred minHeight={520} className="flex justify-center w-full">
      <ShareWaysPhones light />
    </Deferred>
  );
}

export function LazyWatchShareImage() {
  return (
    <Deferred minHeight={380} className="flex justify-center w-full">
      <WatchShareImage />
    </Deferred>
  );
}

export function LazyTeamsDashboard() {
  return (
    <Deferred minHeight={520}>
      <WideDemo minWidth={820} naturalHeight={914}>
        <TeamsDashboard />
      </WideDemo>
    </Deferred>
  );
}

/** The closing panel's real card: one copy for desktop, one for phones, each built only at its width. */
export function LazyHomeCardPhone({ width, media }: { width?: number; media: string }) {
  return (
    <Deferred media={media}>
      <HomeCardPhone width={width} />
    </Deferred>
  );
}

const SCENES = { share: ShareScene, save: SaveScene, lead: LeadScene } as const;

/** One "How it works" scene; the stage around it has a fixed height (home.css). */
export function LazyScene({ scene }: { scene: keyof typeof SCENES }) {
  const Scene = SCENES[scene];
  return (
    <Deferred rootMargin="200px 0px" className="w-full h-full grid place-items-center">
      <Scene />
    </Deferred>
  );
}
