import type { Metadata } from "next";

// The contact page itself is a client component (form state), so its metadata
// lives here.
export const metadata: Metadata = {
  title: "Contact Us — SwiftCard",
  alternates: { canonical: "/contact" },
  description:
    "Questions about SwiftCard, help with your account, or teams and partnership inquiries — send us a message and we'll reply within 24 hours.",
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
