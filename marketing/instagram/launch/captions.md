# SwiftCard Instagram launch: the three pinned posts

> **2026-10-18 — v2 pinned posts (`pinned-v2/`) replace the dark carousel covers below as the pinned trio.**
> Light, single-image, one persona: Daniel Whitfield, Director of Sales, Northwind Partners (fictional; the
> headshot is the site's own Unsplash-licensed `public/showcase/dana.jpg`). Everything on the phone and the
> card is the real product rendered with the app's own code: `src/capture-persona.ts` (PhotoFirst, photo
> shape Circle on SwiftCard navy, accent blue; the card page; the Swift Links page on the Midnight look with
> exactly three links), then `src/render-v2.mjs`. `pinned-v2/grid-preview.png` shows the row at thumbnail size.
> **Pinned order is now One card · One link · One tap** (matches the bio "Everything you are. 1 Card. 1 Link. 1 Tap.").
> Pin **One tap** first, **One link** second, **One card** last. The covers carry no bullets on purpose; the captions
> below carry the detail. No verified seal on the Swift Links page: the live page shows one on paid pages, but
> SwiftCard does not verify identity.

## Before you post
- **Bio:** Everything you are. One card. One link.
- **Bio link:** `swiftcard.me/go/ig_bio`. This is the tracked link, so signups from Instagram show up as Instagram in Agent Flow instead of "direct".
- **Post and pin order:** Instagram shows the most recently pinned post first (top left). Post all three, then pin them in this order:
  1. Pin **One link** (Post 3) first. It ends up on the right.
  2. Pin **One tap** (Post 2) second. It ends up in the middle.
  3. Pin **One card** (Post 1) last. It ends up on the left.

  Read left to right, the top row then says: One card. One tap. One link.
- **Upload the slides in file-name order** (01, 02, 03, 04). Every slide is 1080×1350 (4:5). Leave the crop at "original" when uploading.

---

## Post 1: One card.
Files: `post-1-one-card/01-cover.png` … `04-cta.png`

**Caption**

Your number, your email, your links, your socials, your photo. All on one card that never runs out and never goes out of date.

Pick a design that looks like your business, put your details on it, and share it. Whoever you hand it to can save you to their phone in one tap, with no app to download.

Paper cards end up in a drawer. This one ends up in their contacts.

Make yours free. Link in bio.

**Hashtags**
#digitalbusinesscard #businesscard #networking #realtor #smallbusiness #entrepreneur #qrcode #swiftcard

---

## Post 2: One tap.
Files: `post-2-one-tap/01-cover.png` … `04-cta.png`

**Caption**

Share your card any way you like: a QR code, your Apple Wallet, an NFC tag, or just your link in a text.

It opens in their browser. One tap on Save Contact and you're in their phone. They don't need the app.

They can also send their details back to you. They land in your SwiftCard contacts, tagged with how you met (QR scan, NFC tap, Swift Links or your email signature), so you know who to follow up with.

Make yours free. Link in bio.

**Hashtags**
#digitalbusinesscard #networking #leadgeneration #applewallet #nfc #qrcode #salestips #swiftcard

---

## Post 3: One link.
Files: `post-3-one-link/01-cover.png` … `04-cta.png`

**Caption**

Your link in bio, built in.

Every SwiftCard comes with Swift Links: one page with your photo, your bio, every social, and buttons for whatever you want people to do next. Book a call, see your work, join your list.

The same profile is on your card, in your email signature and in your bio. Update it once and it changes everywhere.

Make yours free. Link in bio.

(The Free plan includes Swift Links with all your socials and 2 extra links. The big featured tiles and unlimited links are on Pro.)

**Hashtags**
#linkinbio #digitalbusinesscard #personalbrand #creator #smallbusiness #emailsignature #networking #swiftcard

---

## Notes
- One person runs through all three posts: **Maya Castillo**, the realtor from the homepage. Her card, card page, Swift Links, email signature and Apple Wallet pass are all the real product, captured from the live site. She and the other people shown are SwiftCard's demo personas with 555 phone numbers, so no real person or business appears.
- The CTA says "link in bio", not "Comment CARD". The Instagram comment bot is still off and waiting on the Meta app, so a "Comment CARD" post would get comments nobody answers.
- To rebuild: run `src/capture.mjs` (the six cards), `src/capture-maya.mjs` and `src/capture-maya-sig.mjs` (Maya's pages, from the live site), then `src/render.mjs`. Edit the copy and layout in `src/slides.html`. The Wallet pass is the real `WalletPassFace` component rendered with Maya's card by `src/wallet-pass-maya.tsx`.
