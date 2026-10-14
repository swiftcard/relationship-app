import type { Metadata } from "next";

// The templates page itself is a client component (interactive gallery), so its
// metadata lives here.
export const metadata: Metadata = {
  title: "Templates — SwiftCard",
  alternates: { canonical: "/templates" },
  description:
    "Design your SwiftCard with AI — from your headshot, logo and colors, or from a card design you love — or pick one of six designer templates. Scannable QR and Save Contact built in.",
};

export default function TemplatesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
