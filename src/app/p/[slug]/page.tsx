import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PUBLIC_PAGE_META } from "@/lib/universal-links";
import { paddedLogoSrc, previewVersion } from "@/lib/prospect-preview/card";
import { SLUG_RE } from "@/lib/prospect-preview/input";
import { ogTitle } from "@/lib/prospect-preview/opener";
import { previewState } from "@/lib/prospect-preview/real-view";
import { getPreviewBySlug } from "@/lib/prospect-preview/store";
import PreviewBeacon from "./PreviewBeacon";
import PreviewView from "./PreviewView";

// ── /p/<slug>: a preview card built for one sales prospect ──────────────────
// Made in admin → Card Builder and sent to the prospect by hand. UNLISTED: it
// is noindex, in no sitemap, linked from nowhere, and its address ends in a
// random tail. It answers 404 once it expires (14 days unless staff chose
// otherwise), is paused or is deleted.
//
// The page request records NOTHING. A view is what PreviewBeacon reports once
// a person has really looked (lib/prospect-preview/gate.ts), so a link-preview
// fetch or a mail scanner can never ring the owner's phone.
//
// Dynamic: expiry is a clock, and a page cached past it would outlive its link.

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

async function load(raw: string) {
  const slug = raw.toLowerCase();
  if (!SLUG_RE.test(slug)) return null;
  const preview = await getPreviewBySlug(slug);
  return preview && previewState(preview) === "live" ? preview : null;
}

/** Where the one button goes: the Office demo booking, told which preview it
 *  came from (owner, 2026-11-15; lib/prospect-preview/booking.ts). */
const bookUrl = (slug: string) => `/demo?ref=${encodeURIComponent(slug)}`;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await load(slug);
  const hidden = { robots: { index: false, follow: false }, itunes: null } as const;
  if (!p) return { title: "SwiftCard", ...hidden };

  // Owner, 2026-11-16: the preview in iMessage says it is THEIRS: "Dana's card, made for you".
  const title = ogTitle(p.owner_name);
  const description = `${p.owner_name} · ${p.office_name}`;
  // Named explicitly: once a page sets openGraph itself, Next no longer adds
  // the opengraph-image file beside it. The ?v= changes whenever what the
  // picture shows changes, so a messenger never keeps an old one.
  const image = `${APP_URL}/p/${p.slug}/opengraph-image?v=${previewVersion(p)}`;
  return {
    title,
    description,
    ...hidden,
    // The iOS app's webview never keeps a public page (NativeAppBridge).
    other: { [PUBLIC_PAGE_META]: "card" },
    openGraph: {
      title,
      description,
      url: `${APP_URL}/p/${p.slug}`,
      siteName: "SwiftCard",
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: `${p.owner_name}'s card` }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function ProspectPreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const preview = await load(slug);
  if (!preview) notFound();
  return (
    <>
      <PreviewBeacon slug={preview.slug} />
      <PreviewView preview={preview} bookUrl={bookUrl(preview.slug)} logoSrc={paddedLogoSrc(preview, false)} />
    </>
  );
}
