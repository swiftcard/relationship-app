import NativeRequestBoundary from "@/components/NativeRequestBoundary";

// The card builder and Edit card are signed-in app screens: their Pro gates must render the app's
// branch from the very first frame inside the shell, never the website's
// "Upgrade to Pro" for the moment before hydration (audit NS-04,
// components/NativeRequestBoundary). These pages read the session cookie
// already, so reading the request here costs no static rendering.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <NativeRequestBoundary>{children}</NativeRequestBoundary>;
}
