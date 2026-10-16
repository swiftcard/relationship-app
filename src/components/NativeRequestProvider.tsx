"use client";

import { createContext, type ReactNode } from "react";

// What the SERVER knew about this request: did it come from the app shell
// (lib/native-request — the SwiftCardApp user-agent token or the sc_shell
// cookie)? Handed to useIsNativeApp (lib/platform) as its starting value, so
// the gates render the app's branch in the server HTML and the first client
// render alike. Without it every full page load in the app painted the WEB
// branch — "Upgrade to Pro", the referral promo — for the 1–3 s before
// hydration, then swapped (audit NS-04). Provided by NativeRequestBoundary on
// the signed-in screens; absent (false) everywhere else, which is exactly the
// old behaviour.
export const NativeRequestContext = createContext(false);

export default function NativeRequestProvider({ native, children }: { native: boolean; children: ReactNode }) {
  return <NativeRequestContext.Provider value={native}>{children}</NativeRequestContext.Provider>;
}
