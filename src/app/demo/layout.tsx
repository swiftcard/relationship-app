import type { Metadata } from "next";

// /demo and /demo/manage are client pages, so their metadata lives here. Not
// for search: the way in is the Book a demo button on the pricing page's
// Office card (this page is what that button opens before the page has
// hydrated), and the links in the booking emails.
export const metadata: Metadata = {
  title: "Book a demo | SwiftCard",
  description: "Book a 30-minute SwiftCard Office demo on Google Meet. Pick a time that works for you.",
  robots: { index: false, follow: false },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
