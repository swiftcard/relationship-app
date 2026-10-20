"use client";

import { useEffect, useState } from "react";
import { safeNextPath } from "@/lib/safe-next";

// Where an editor's LinkedIn window lands (lib/linkedin-photo-return). It does
// no work of its own: the photo is already stored under the editor's ticket,
// and the editor picks it up as soon as it is looked at again. This window
// only closes.
//
// It must never become a second copy of the editor. LinkedIn's sign-in page
// cuts window.opener (COOP), so this cannot tell whether it is a popup; when
// the browser won't let a script close it (a phone's new tab, mostly), it says
// where to go and offers the page here only as an explicit link — which also
// picks the photo up, since the ticket lives in this site's storage.
export default function LinkedInConnectedPage() {
  const [stuck, setStuck] = useState(false);
  const [hereHref, setHereHref] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const status = sp.get("status");
    const back = safeNextPath(sp.get("to")) ?? "/profile";
    window.close();
    const t = setTimeout(() => {
      setFailed(status === "error" || status === "nophoto");
      setHereHref(back);
      setStuck(true);
    }, 600);
    return () => clearTimeout(t);
  }, []);

  return (
    <main className="sc-app min-h-screen bg-gray-950 grid place-items-center px-6">
      <div className="text-center max-w-xs">
        {!stuck ? (
          <p className="text-gray-300 text-sm">Finishing up with LinkedIn…</p>
        ) : (
          <>
            <p className="text-white text-sm font-semibold">
              {failed ? "LinkedIn didn't send a photo" : "Your LinkedIn photo is ready"}
            </p>
            <p className="text-gray-400 text-xs mt-2 leading-relaxed">
              {failed
                ? "Close this window and go back to your SwiftCard tab to try again."
                : "Close this window and go back to your SwiftCard tab. Your photo opens there, ready to crop."}
            </p>
            {hereHref && (
              <a href={hereHref} className="inline-block mt-4 text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2">
                Open SwiftCard here instead
              </a>
            )}
          </>
        )}
      </div>
    </main>
  );
}
