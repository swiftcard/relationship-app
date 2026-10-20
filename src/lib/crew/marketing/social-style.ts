// ── What the social manager knows ───────────────────────────────────────────
// Distilled from SwiftCard's first Instagram posts (the launch trio "One
// card / One tap / One link" and its light v2 redo), whose sources live in
// marketing/instagram/launch/: captions.md (final captions, bio, pin order,
// rules), src/slides.html and src/pinned-v2.html (the visual system), and the
// render scripts. Keep this in step with captions.md: tests/crew-marketing
// checks that the launch captions are still quoted here.
// Byte-stable on purpose: it is part of a cached system prompt.

export type SocialPlatform = "instagram" | "threads" | "linkedin" | "tiktok" | "pinterest" | "youtube" | "reddit" | "alignable";

export const SOCIAL_PLATFORMS: SocialPlatform[] = ["instagram", "linkedin", "threads", "tiktok", "pinterest", "youtube", "reddit", "alignable"];

export type SizeKey = "portrait" | "vertical" | "pin" | "square";

/** Pixel sizes; one render per size covers every platform that uses it. */
export const SIZES: Record<SizeKey, { w: number; h: number; label: string }> = {
  portrait: { w: 1080, h: 1350, label: "4:5 (Instagram, Threads, LinkedIn)" },
  vertical: { w: 1080, h: 1920, label: "9:16 (TikTok photo mode, Stories)" },
  pin: { w: 1000, h: 1500, label: "2:3 (Pinterest)" },
  square: { w: 1080, h: 1080, label: "1:1 (YouTube community, Reddit, Alignable)" },
};

export const PLATFORM_SIZE: Record<SocialPlatform, SizeKey> = {
  instagram: "portrait",
  threads: "portrait",
  linkedin: "portrait",
  tiktok: "vertical",
  pinterest: "pin",
  youtube: "square",
  reddit: "square",
  alignable: "square",
};

export const CAPTION_RULES: Record<SocialPlatform, string> = {
  instagram: "Instagram: 3 short paragraphs like the launch captions, ending \"Make yours free. Link in bio.\" Then up to 8 hashtags on their own line, always including #swiftcard.",
  linkedin: "LinkedIn: 3 to 6 short lines, first person from the founders, professional and specific, no hashtags or at most 3, end with swiftcard.me.",
  threads: "Threads: under 400 characters, casual, one idea, end with swiftcard.me.",
  tiktok: "TikTok photo post: under 150 characters plus 3 to 5 hashtags.",
  pinterest: "Pinterest: a title under 90 characters on the first line, then a 2 sentence description with natural search words (digital business card, link in bio), then swiftcard.me.",
  youtube: "YouTube community post: under 250 characters, friendly, one question at the end.",
  reddit: "Reddit: a title line, then a plain helpful post that would be welcome on our own profile or a community that allows it. No hashtags, no emoji. Mention it is our product.",
  alignable: "Alignable: neighborly, local-business tone, 2 or 3 sentences, no hard sell.",
};

export const LAUNCH_CAPTIONS = [
  "Your number, your email, your links, your socials, your photo. All on one card that never runs out and never goes out of date.",
  "Share your card any way you like: a QR code, your Apple Wallet, an NFC tag, or just your link in a text.",
  "Your link in bio, built in.",
];

export const SOCIAL_STYLE = `SwiftCard's social style, from its first posts (the launch trio "One card. / One tap. / One link." and the light pinned redo):
- Visual system: light background (white to pale blue with soft blue glows), the SwiftCard lockup top left, a huge two-line headline in Bricolage Grotesque where the last word is in the blue gradient ("One / Card."), a short two-line subline under it, the footer "swiftcard.me · Free to start". The real product is shown, never a mock: a SwiftCard card lifted off the page, or an iPhone showing the Swift Links page or the card page. One fictional persona at a time (Daniel Whitfield, Director of Sales, Northwind Partners); no real people.
- Headlines: 2 to 4 words, a promise you can see ("One Card.", "One Link.", "One Tap."). Sublines: one plain sentence split over two lines ("Everything you are, on one card.").
- Captions: plain and concrete, what it does and what happens next, never hype. Example openings: ${LAUNCH_CAPTIONS.map((c) => `"${c}"`).join(" / ")}
- CTA: "Make yours free. Link in bio." on Instagram (the bio link is the tracked swiftcard.me/go/ig_bio). Never "Comment CARD": no bot answers comments.
- Honesty: never show a verified badge (SwiftCard doesn't verify identity). Say what the Free plan includes and what is Pro when a feature is Pro-only. Only the product facts given may be claimed.
- Formats: a single image, or a slideshow of 3 to 5 slides (cover, 2 or 3 "how it works" slides, a CTA slide). No video yet.`;
