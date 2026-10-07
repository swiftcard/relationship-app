// ── A link's preview, asked for from the browser ────────────────────────────
//
// One fetcher for every surface that shows a link's own preview picture: the
// Swift Links tiles (SwiftLinkButtons) and the editor's thumbnails
// (LinkPreviewThumb). Same answer in both, so what the owner sees beside a
// link in the editor is what visitors get on the page.
//
// It never throws and never gives up on the first stumble: a network blip or
// a 429 used to be stored as "this link has no picture" for as long as the
// page stayed open. One retry, a moment later, then an honest empty answer —
// which every caller turns into its designed fallback, never a broken box.

export type LinkPreview = { image: string | null; favicon: string | null; title: string | null };

const EMPTY: LinkPreview = { image: null, favicon: null, title: null };
const RETRY_AFTER_MS = 1500;

async function ask(url: string): Promise<LinkPreview | null> {
  try {
    const r = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
    if (!r.ok) return null;
    const d = (await r.json()) as Partial<LinkPreview>;
    return {
      image: typeof d.image === "string" ? d.image : null,
      favicon: typeof d.favicon === "string" ? d.favicon : null,
      title: typeof d.title === "string" ? d.title : null,
    };
  } catch {
    return null;
  }
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  const first = await ask(url);
  if (first) return first;
  await new Promise((r) => setTimeout(r, RETRY_AFTER_MS));
  return (await ask(url)) ?? EMPTY;
}
