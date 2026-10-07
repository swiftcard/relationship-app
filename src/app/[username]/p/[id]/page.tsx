import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import CardPage, { generateMetadata as cardMetadata } from "../../page";
import { CREATE_SOURCE, isCreateId } from "@/lib/create-link";

// The address every part of a Create + creation opens (lib/create-link): the
// owner pasted a signature or dropped a picture on the Links page, and each
// click on it — in an email, a doc, or tapped from a text — lands here.
//
// It IS the card page, not a redirect to it. Link scrapers (iMessage,
// WhatsApp, Slack, LinkedIn) follow redirects and read the page they end on,
// so a redirect would show the card's preview and lose the owner's picture.
// Rendering the card here keeps the picture as this address's preview (the
// opengraph-image beside this file) and shows the visitor the card itself.
//
// Tracked as source "create_link" unless the link carries its own.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

type Params = Promise<{ username: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { username: raw, id } = await params;
  const username = raw.toLowerCase();
  if (!isCreateId(id)) return { title: "SwiftCard", robots: { index: false, follow: false } };
  const base = await cardMetadata({ params: Promise.resolve({ username }) });
  return {
    ...base,
    // One canonical page per card; these are its shareable copies.
    alternates: { canonical: `${APP_URL}/${username}` },
    robots: { index: false, follow: true },
    // The image itself comes from the opengraph-image / twitter-image files in
    // this folder — file-based metadata wins over these objects by design, and
    // the deepest folder's file is the one used.
    ...(base.openGraph ? { openGraph: { ...base.openGraph, url: `${APP_URL}/${username}/p/${id}`, images: undefined } } : {}),
    ...(base.twitter ? { twitter: { ...base.twitter, images: undefined } } : {}),
  };
}

export default async function CreateLinkPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<{ source?: string | string[]; [key: string]: string | string[] | undefined }>;
}) {
  const { username: raw, id } = await params;
  if (!isCreateId(id)) notFound();
  const username = raw.toLowerCase();
  // The card page 308s a mixed-case slug to its own root URL; do it here
  // first so the /p/<id> part (and its picture preview) survives.
  if (raw !== username) permanentRedirect(`/${username}/p/${id}`);
  const query = await searchParams;
  return CardPage({
    params: Promise.resolve({ username }),
    searchParams: Promise.resolve({ ...query, source: query.source ?? CREATE_SOURCE }),
  });
}
