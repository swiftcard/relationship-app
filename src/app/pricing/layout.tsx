import type { Metadata } from "next";

// The pricing page itself is a client component (billing toggle state), so its
// metadata lives here.
export const metadata: Metadata = {
  title: "Pricing | SwiftCard",
  alternates: { canonical: "/pricing" },
  description:
    "Simple, honest pricing for SwiftCard. Free forever to start. Upgrade when your network grows. No contracts, cancel anytime.",
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
