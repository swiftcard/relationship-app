import PreviewClient from "./PreviewClient";

export const metadata = {
  title: "Preview — SwiftCard",
  alternates: { canonical: "/preview" },
  description: "See how SwiftCard works, live: switch cards, open a Swift Links page, and preview your card and email signature.",
};

export default function PreviewPage() {
  return <PreviewClient />;
}
