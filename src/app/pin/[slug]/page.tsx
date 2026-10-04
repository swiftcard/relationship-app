import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PIN_IDEAS, pinIdea } from "@/lib/pinterest-pins";
import PinPicture from "./PinPicture";

// ── /pin/<slug>: the picture behind a Pinterest pin ─────────────────────────
// A 1000×1500 page that scripts/pinterest-pins.mjs screenshots: the headline
// people search for, a real card (the homepage persona wearing the template),
// and the address. Static, noindex — it exists to be photographed, not found.
// Static so nothing here can ever revert the marketing site to dynamic.

export const dynamic = "force-static";

export function generateStaticParams() {
  return PIN_IDEAS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const idea = pinIdea(slug);
  return { title: idea ? `${idea.headline} | SwiftCard` : "SwiftCard", robots: { index: false, follow: false } };
}

export default async function PinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const idea = pinIdea(slug);
  if (!idea) notFound();
  return <PinPicture idea={idea} />;
}
