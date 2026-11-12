import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PUBLIC_PAGE_META } from "@/lib/universal-links";
import { paddedLogoSrc, previewVersion } from "@/lib/prospect-preview/card";
import { SLUG_RE } from "@/lib/prospect-preview/input";
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

/** Where the one button goes. https only; the booking page if it isn't set. */
function calendarUrl(): string {
  const v = (process.env.PROSPECT_CALENDAR_URL ?? "").trim();
  return /^https:\/\/\S+$/.test(v) ? v : "/demo";
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await load(slug);
  const hidden = { robots: { index: false, follow: false }, itunes: null } as const;
  if (!p) return { title: "SwiftCard", ...hidden };

  const title = `${p.owner_name} · ${p.office_name}`;
  const description = `A digital business card made for ${p.owner_name} at ${p.office_name}. Tap to see it.`;
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
      <PreviewView preview={preview} calendarUrl={calendarUrl()} logoSrc={paddedLogoSrc(preview, false)} />
    </>
  );
}
