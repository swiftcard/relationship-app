"use client";

import { useEffect } from "react";

// ── The address bar holds the card's plain link, never how THIS visit came ───
//
// ?source=, ?save= and ?shared= are read on the server (the page's props) and
// mean something only for the request that carried them. Left in the address
// bar, they travelled with every copy of it: the owner clicked their own Swift
// Signature, copied the address and texted it as "my card link", and every
// person who opened it was recorded "from your Swift Signature" (owner,
// 2026-10-23). The same went for a forwarded QR scan ("QR code scan"), a
// forwarded ?save=1 (the next person's phone was handed the contact as if they
// had scanned), and a forwarded ?shared=1 (a stranger told "already shared").
//
// Rendered for the owner too: their own visit isn't counted, but their copy of
// the address is exactly what gets passed on. Everything else in the query
// (?embed=, ?ct= — CardEventTracker takes that one) is left alone.
// vv: the desktop visit a "Scan to save" QR hands to the phone (2026-11-05) —
// one scan's, never a forwarded link's.
const ONE_VISIT_PARAMS = ["source", "save", "shared", "vv"] as const;

export default function CleanShareUrl() {
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      let changed = false;
      for (const p of ONE_VISIT_PARAMS) {
        if (url.searchParams.has(p)) {
          url.searchParams.delete(p);
          changed = true;
        }
      }
      if (changed) window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      /* the address stays as it was */
    }
  }, []);
  return null;
}
