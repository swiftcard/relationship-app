"use client";

import { useEffect, useState } from "react";
import ShareCardCapture from "@/components/ShareCardCapture";
import type { CardData } from "@/components/card-templates/types";

// The share-preview capture for a card that was JUST made, mounted on the
// "Your card is live!" screens. Those screens offer Share link straight away,
// and the link's preview is a picture of the real card only once this capture
// has been uploaded; until then messengers get the server-drawn stand-in. The
// card's data comes from the server (api/card-share-image/source), built the
// way the public page builds it, not from the wizard's form state.
export default function NewCardShareCapture({ username }: { username: string | null | undefined }) {
  const slug = (username ?? "").toLowerCase();
  const [card, setCard] = useState<{ data: CardData; template: string } | null>(null);

  useEffect(() => {
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) return;
    let cancelled = false;
    fetch(`/api/card-share-image/source?username=${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.data && typeof j.template === "string") setCard(j); })
      .catch(() => { /* best-effort: the stand-in still serves */ });
    return () => { cancelled = true; };
  }, [slug]);

  if (!card) return null;
  return <ShareCardCapture key={`share-${slug}`} cardData={card.data} template={card.template} username={slug} />;
}
