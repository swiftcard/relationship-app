import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isCardActive } from "@/lib/card-active";
import { buildVCard, cardContactLinks, pickContactImage, type VCardPhone } from "@/lib/vcard";
import { isPaidPlan, PLAN_LIMITS } from "@/lib/plan";
import { cardHeadshot } from "@/lib/card-media";
import { fetchVCardPhoto } from "@/lib/contact-photo";
import { renderInitialsPhoto } from "@/lib/contact-initials-photo";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// Public vCard for a card, served with a `text/vcard` content type.
//
// WHY: inside the native iOS shell a Blob/anchor download no-ops in WKWebView,
// so SaveContactButton hands the user here via the system browser sheet, where
// iOS renders a real "Add to Contacts" preview. On the web the button keeps its
// existing client-side Blob download (which works there), so nothing about the
// public website changes.
//
// Resolution mirrors src/app/card/[username]/page.tsx (cards row is the source
// of truth, legacy profile-card fallback) and honors the same public
// kill-switch via isCardActive (offline / deleted-owner / plan-limit) so a card
// that isn't publicly live can't be exported here either. buildVCard performs
// RFC-6350 escaping, so visitor/owner-supplied fields can't inject vCard lines.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const { username: rawUsername } = await params;
  const username = rawUsername.toLowerCase();
  if (!username) return NextResponse.json({ error: "Missing card" }, { status: 400 });

  if (!(await isCardActive(username))) {
    return NextResponse.json({ error: "Card not available" }, { status: 404 });
  }

  const admin = getAdminSupabase();
  const { data: cardRow } = await admin.from("cards").select("*").eq("username", username).maybeSingle();
  const source = cardRow
    ?? (await admin.from("profiles").select("*").eq("username", username).maybeSingle()).data;
  if (!source) return NextResponse.json({ error: "Card not available" }, { status: 404 });

  const c = source as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
  const custom = (c.customization ?? {}) as Record<string, unknown>;
  const phones = (Array.isArray(custom.phones) ? custom.phones : [])
    .filter((p): p is VCardPhone => !!(p as VCardPhone)?.number?.trim());
  const addr = (custom.address ?? {}) as Record<string, unknown>;

  // Headshot: the card's own, falling back to the account photo — same
  // resolution the card page uses, so the saved contact shows the same face the
  // scanner just looked at. The account photo is only used when the card doesn't
  // pin its own photoUrl (see cardHeadshot). The owner's row also says which
  // plan the card is on, which decides how many Swift Links buttons it shows.
  const { data: owner } = cardRow?.user_id
    ? await admin
        .from("profiles")
        .select("photo_url, plan")
        .eq("id", cardRow.user_id as string)
        .maybeSingle()
    : { data: null };
  let photoUrl = cardHeadshot(custom, null);
  if (!photoUrl && cardRow) {
    photoUrl = cardHeadshot(custom, (owner?.photo_url as string | null) ?? null);
  } else if (!photoUrl && !cardRow) {
    photoUrl = (str(c.photo_url) ?? null) as string | null;
  }
  const paid = isPaidPlan((cardRow ? owner?.plan : c.plan) as string | null | undefined);
  // Headshot first, the card's logo when there is none (owner order
  // 2026-09-24: a contact exchanged through SwiftCard always carries a face or
  // a logo). fetchVCardPhoto is the SSRF-guarded, resized fetch shared with the
  // lead export — the QR path never runs the browser's fetch, so without it a
  // scanned contact saved with no picture while the same card saved from a
  // phone got one.
  const image = pickContactImage(photoUrl, str(c.logo_url));
  const name = str(c.name) ?? username;
  // …and their initials when there is neither, or when the picture they have
  // won't load (owner order 2026-09-25) — the sheet never opens on a blank.
  const photo = (image ? await fetchVCardPhoto(image.url, image.kind) : null)
    ?? (await renderInitialsPhoto(name));

  const vcard = buildVCard(
    {
      name,
      title: str(c.title),
      company: str(c.company),
      email: str(c.email),
      phone: str(c.phone),
      phones: phones.length ? phones : undefined,
      fax: str(custom.fax),
      website: str(c.website),
      // Their SwiftCard itself — so the contact keeps a door back to the full
      // card (design, Swift Links, everything a vCard can't hold).
      cardUrl: `${APP_URL}/${username}`,
      address: {
        street: str(addr.street),
        unit: str(addr.unit),
        city: str(addr.city),
        state: str(addr.state),
        zip: str(addr.zip),
      },
      linkedin: str(c.linkedin),
      instagram: str(c.instagram),
      twitter: str(c.twitter),
      tiktok: str(c.tiktok),
      facebook: str(custom.facebook),
      snapchat: str(custom.snapchat),
      youtube: str(custom.youtube),
      // The Swift Links buttons the card page shows — Free shows its first
      // FREE_MAX_LINKS, exactly as sanitizeCustomizationForPlan trims them there.
      links: cardContactLinks(custom.links, paid ? null : PLAN_LIMITS.FREE_MAX_LINKS),
      // Their Swift Links bio goes into the contact's Notes — the same text
      // the card page shows under "Swift Links".
      note: str(custom.bio),
    },
    photo,
  );

  const slug = (str(c.name) ?? username).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return new NextResponse(vcard, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `inline; filename="${slug || "contact"}.vcf"`,
      "Cache-Control": "no-store",
    },
  });
}
