import { linkedPicturePreview } from "@/lib/create-link-preview";
import cardPreview from "../../../card/[username]/opengraph-image";

// The link preview of a Create + share link: the picture the owner linked
// (lib/create-link-preview). Anything off falls back to the card's own
// preview, which goes dark by itself for a card that is down.
//
// The route-segment config must be literal (Next analyzes it statically) and
// stay identical in twitter-image.tsx beside this file.

export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const alt = "Tap to open their SwiftCard";

export default async function Image({ params }: { params: Promise<{ username: string; id: string }> }) {
  const { username: raw, id } = await params;
  const username = raw.toLowerCase();
  const jpg = await linkedPicturePreview(username, id);
  if (jpg) {
    return new Response(new Uint8Array(jpg), {
      headers: {
        "Content-Type": "image/jpeg",
        // The picture behind an id never changes; a card going down is caught
        // by the next fetch after a day.
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
        "X-SC-Preview": "linked",
      },
    });
  }
  return cardPreview({ params: Promise.resolve({ username }) });
}
