import NativeSplash from "@/components/NativeSplash";
import TimezoneSync from "@/components/TimezoneSync";
import NativeRequestBoundary from "@/components/NativeRequestBoundary";

// Why a layout exists for /dashboard at all: it hosts the iOS shell's launch
// animation. A cold launch loads "/" and src/proxy.ts redirects the shell here
// (or to /login) before any HTML is sent, so THIS is the first page a launch
// paints — the splash markup must be in its initial HTML to hand off from the
// static iOS launch image without a jump. It used to sit in the root layout,
// but its headers()/cookies() reads forced every marketing page dynamic; see
// the note in src/app/layout.tsx. NativeSplash renders nothing on the website
// and nothing on in-app navigations (Sec-Fetch-Site: same-origin), and the
// layout renders in the first flush — before the page's data fetches — so the
// first-frame guarantee is preserved.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NativeSplash />
      {/* Renders nothing. Teaches the server which timezone this person is in,
          so quiet hours (10pm-8am) are THEIR night — see TimezoneSync. Here
          because the dashboard is where every signed-in session lands, the iOS
          shell included, and it is behind the login wall in src/proxy.ts. */}
      <TimezoneSync />
      {/* The app's gates render the app's branch from the first frame
          (audit NS-04, components/NativeRequestBoundary). */}
      <NativeRequestBoundary>{children}</NativeRequestBoundary>
    </>
  );
}
