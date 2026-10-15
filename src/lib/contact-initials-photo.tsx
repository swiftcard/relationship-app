// The initials picture for a saved contact — SERVER SIDE.
//
// Owner order 2026-09-25: a contact saved from a SwiftCard carries the
// person's headshot, else their logo, else their INITIALS. This draws the
// third one for the server vCard (the QR scan and the iOS app both save
// through api/card/[username]/vcard, where there is no canvas). The browser's
// Save Contact button draws the same tile on a canvas; the colours and the
// initials come from lib/vcard so the two can't drift.
//
// Satori via next/og on the Node runtime — the same renderer the wallet strip
// and the per-card OG image already use in production. Best-effort like every
// other contact picture: any failure returns null and the contact still saves.

import { ImageResponse } from "next/og";
import { CONTACT_INITIALS_BG, CONTACT_INITIALS_FG, CONTACT_PHOTO_EDGE, contactInitials, type VCardPhoto } from "@/lib/vcard";
import { contactPhotoFromBytes } from "@/lib/contact-photo";

export async function renderInitialsPhoto(name: string | null | undefined): Promise<VCardPhoto | null> {
  const initials = contactInitials(name);
  if (!initials) return null;
  try {
    const size = CONTACT_PHOTO_EDGE;
    const png = Buffer.from(
      await new ImageResponse(
        (
          // Full-bleed square: Contacts crops it to a circle itself.
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: CONTACT_INITIALS_BG,
              color: CONTACT_INITIALS_FG,
              fontSize: Math.round(size * (initials.length > 1 ? 0.38 : 0.46)),
              fontWeight: 600,
              letterSpacing: "0.02em",
              fontFamily: "sans-serif",
            }}
          >
            {initials}
          </div>
        ),
        { width: size, height: size },
      ).arrayBuffer(),
    );
    if (!png.byteLength) return null;
    // The same square JPEG every saved contact picture is (lib/contact-photo);
    // keep the PNG if sharp is unavailable.
    return (await contactPhotoFromBytes(png, "headshot")) ?? { base64: png.toString("base64"), mime: "image/png" };
  } catch {
    return null;
  }
}
