"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mailtoHref, smsHref, type MessageKind } from "@/lib/prospect-preview/messages";

/**
 * One message, ready to send by hand. The words can be changed here first;
 * the button opens the founder's own Messages or Mail app with the recipient
 * and the words filled in, and marks the preview as sent (time and channel).
 * Nothing is sent by SwiftCard: the person presses send in their own app.
 *
 * The button is a real link, so before hydration it still opens the app with
 * the words as written (it just can't record the send until the page is live;
 * "Mark it sent" below does that by hand).
 */
export default function SendMessage({ id, kind, to, subject, body, button, blocked }: {
  id: string;
  kind: MessageKind;
  /** A phone number for the texts, an email address for the email. */
  to: string;
  subject?: string;
  body: string;
  button: string;
  /** Why this can't go yet (no email on file, not published); null when it can. */
  blocked: string | null;
}) {
  const router = useRouter();
  const [words, setWords] = useState(body);
  const [topic, setTopic] = useState(subject ?? "");
  const href = kind === "email" ? mailtoHref(to, topic, words) : smsHref(to, words);

  return (
    <div className="flex flex-col gap-3">
      {kind === "email" && (
        <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} aria-label="Subject" className="sc-field w-full px-3 py-2" />
      )}
      <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={kind === "email" ? 11 : 5} maxLength={2000} aria-label="Message" className="sc-field w-full px-3 py-2" data-message={kind} />
      {blocked ? (
        <p className="sc-t-footnote adm-muted" data-blocked>{blocked}</p>
      ) : (
        <div>
          <a
            href={href}
            data-send={kind}
            className="sc-btn sc-btn-filled"
            onClick={() => {
              // keepalive: the tap is about to leave for another app.
              void fetch(`/api/admin/card-builder/${id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "sent", kind, words }),
                keepalive: true,
              }).then(() => router.refresh()).catch(() => {});
            }}
          >
            {button}
          </a>
        </div>
      )}
    </div>
  );
}
