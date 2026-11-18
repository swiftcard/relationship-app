import type { ContactKind } from "@/lib/link-brand";

// The mark for a contact link (an email, a phone number, a text): an envelope,
// a handset or a speech bubble. Such a link has no site, so there is no logo
// to load and no hostname to take a monogram letter from.
const PATHS: Record<ContactKind, string> = {
  email: "M3 6.75A1.75 1.75 0 014.75 5h14.5A1.75 1.75 0 0121 6.75v10.5A1.75 1.75 0 0119.25 19H4.75A1.75 1.75 0 013 17.25V6.75zm.9.35l8.1 5.65 8.1-5.65",
  phone: "M5.5 3.5h3l1.5 4-2 1.25a11 11 0 006.25 6.25L15.5 13l4 1.5v3a2 2 0 01-2 2A15.5 15.5 0 013.5 5.5a2 2 0 012-2z",
  text: "M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H9l-4.5 4v-4H5.5A1.5 1.5 0 014 14.5v-9z",
};

export default function ContactGlyph({ kind, size = 16, color = "currentColor", opacity = 1 }: {
  kind: ContactKind;
  size?: number;
  color?: string;
  opacity?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeOpacity={opacity}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-contact-glyph={kind}
    >
      <path d={PATHS[kind]} />
    </svg>
  );
}
