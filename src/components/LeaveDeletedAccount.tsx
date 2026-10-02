"use client";

import { useState } from "react";
import Link from "next/link";
import { releaseDevice } from "@/lib/device-sign-out";

// "Back to swiftcard.me" on /account-deleted. The case it exists for is a
// deleted account that is still SIGNED IN — the person who deleted, came back
// later and signed in, and was sent here to be offered a reopen. Used on the
// signed-out branch too: releasing an absent session is harmless, and it
// clears any auth cookie the delete left behind.
//
// A plain link to "/" did nothing for them in the app: the shell's "/" sends a
// signed-in visitor to /dashboard, and /dashboard sends a deleted account
// straight back to /account-deleted — the tap landed on the same screen. On
// the website "/" loaded, but its "Dashboard" button looped the same way.
//
// Choosing to leave means letting go of the session: the same release as Sign
// out, then a hard navigation to "/". Signed out, the app's "/" opens the
// sign-in screen and the website's "/" is the homepage. Reopening is still one
// sign-in away — this screen comes back the moment they sign in again.
//
// Before hydration the href is the fallback, which is no worse than before:
// nothing is lost or leaked by landing back on this page. Once hydrated, the
// preventDefault below stops Link from doing its own client-side navigation.
export default function LeaveDeletedAccount({ className }: { className: string }) {
  const [busy, setBusy] = useState(false);

  async function leave(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    await releaseDevice();
    window.location.replace("/");
  }

  return (
    <Link href="/" onClick={leave} aria-disabled={busy} className={className}>
      Back to swiftcard.me
    </Link>
  );
}
