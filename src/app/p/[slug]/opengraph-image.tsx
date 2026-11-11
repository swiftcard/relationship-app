import { notFound } from "next/navigation";
import { renderPreviewOg } from "@/lib/prospect-preview/og";
import { previewState } from "@/lib/prospect-preview/real-view";
import { getPreviewBySlug } from "@/lib/prospect-preview/store";

// The link preview of a Card Builder preview: the owner's card, with their
// name and logo (lib/prospect-preview/og.tsx). Gone when the preview is: an
// expired link must not keep unfurling as a live card.
//
// The route-segment config must be literal (Next analyzes it statically) and
// stay identical in twitter-image.tsx beside this file.

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const alt = "Your SwiftCard preview";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const preview = await getPreviewBySlug(slug.toLowerCase());
  if (!preview || previewState(preview) !== "live") notFound();
  return renderPreviewOg(preview);
}
