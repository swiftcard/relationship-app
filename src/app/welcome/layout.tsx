import NativeRequestBoundary from "@/components/NativeRequestBoundary";

// /welcome is the plan step, and in the iPhone and Android apps it must never
// paint the website's chooser — Stripe prices, the Office per-seat total,
// buttons bound for Stripe — not even for one frame (App Store 3.1.1; the
// Android app sells nothing). PlanCards mounts after WelcomePlan's intent
// effect, and without this boundary its first render was the WEBSITE branch
// until its own mount effect flipped `native` (2026-11-04 review). Same
// boundary as /upgrade, /dashboard and /cards (audit NS-04,
// components/NativeRequestBoundary). /welcome is force-dynamic already, so
// reading the request costs no static rendering.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <NativeRequestBoundary>{children}</NativeRequestBoundary>;
}
