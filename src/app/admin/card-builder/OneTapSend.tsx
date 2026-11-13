"use client";

import { useRouter } from "next/navigation";
import type { MessageKind } from "@/lib/prospect-preview/messages";

/**
 * One tap: opens the founder's own Messages or Mail app with the recipient
 * and the words already filled in, and notes on the preview that it went
 * (Approve queue, Follow up today). SwiftCard sends nothing: the person still
 * presses send in their own app, from their own number.
 *
 * A real link, so before hydration it still opens the app with the words; it
 * just can't record the send until the page is live (the Send screen's "Mark
 * it sent" does that by hand).
 */
export default function OneTapSend({ id, kind, href, children, className = "sc-btn sc-btn-filled" }: {
  id: string;
  kind: MessageKind;
  /** sms:… or mailto:…, made on the server (lib/prospect-preview/messages). */
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <a
      href={href}
      data-one-tap={kind}
      className={className}
      onClick={() => {
        // keepalive: the tap is about to leave for another app.
        void fetch(`/api/admin/card-builder/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sent", kind }),
          keepalive: true,
        }).then(() => router.refresh()).catch(() => {});
      }}
    >
      {children}
    </a>
  );
}
