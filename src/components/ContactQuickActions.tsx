"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

// ── Call · Text · Email, one tap each, on every contact row ─────────────────
//
// Owner, 2026-09-29: the three round buttons that lived on the dashboard's
// Quick Contacts rows (removed with that section) now sit on every row of the
// Contacts page. Same look — green, blue, purple circles — and same rules:
//
//  • A button exists only when there is something to act on: no phone, no
//    Call and no Text; no email, no Email. Hidden, never a dead button.
//  • Plain tel: / sms: / mailto: links, built exactly as Quick Contacts built
//    them (the number reduced to digits and +). Nothing is recorded — tapping
//    Call is not proof a call happened (the ShareMyInfoButton rule).
//  • They live INSIDE a clickable row, so a click or Enter/Space on one must
//    never also open the contact.
//
// The row never receives a Free account's locked contacts (filtered on the
// server, contacts/page.tsx), so these can't expose anyone hidden.
//
// Colours come from globals.css (.sc-qa-*): the dark theme keeps the original
// shades; the light theme darkens them, since the original green and purple
// were under 3:1 on white.

/** Digits and a leading +, the same rule as ShareMyInfoButton's smsHref. */
function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

function stop(e: MouseEvent | KeyboardEvent) {
  e.stopPropagation();
}

function Action({ href, label, tone, children }: { href: string; label: string; tone: "call" | "text" | "email"; children: ReactNode }) {
  return (
    <a
      href={href}
      title={label}
      aria-label={label}
      onClick={stop}
      onKeyDown={stop}
      className={`sc-qa sc-qa-${tone} relative flex items-center justify-center w-9 h-9 max-[359px]:w-8 max-[359px]:h-8 rounded-full border shrink-0 transition-colors`}
    >
      {children}
    </a>
  );
}

export default function ContactQuickActions({
  name,
  phone,
  email,
}: {
  name: string;
  phone?: string | null;
  email?: string | null;
}) {
  const tel = dialable((phone ?? "").trim());
  const mail = (email ?? "").trim();
  if (!tel && !mail) return null;
  const who = name.trim() || "contact";

  return (
    // 36px circles; 32px on the narrowest phones (under 360px, e.g. a 320px
    // iPhone SE), where three full-size ones left the name ~68px.
    <div className="flex items-center gap-1.5 max-[359px]:gap-1 shrink-0" data-contact-actions="">
      {tel && (
        <Action href={`tel:${tel}`} label={`Call ${who}`} tone="call">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
          </svg>
        </Action>
      )}
      {tel && (
        <Action href={`sms:${tel}`} label={`Text ${who}`} tone="text">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        </Action>
      )}
      {mail && (
        <Action href={`mailto:${mail}`} label={`Email ${who}`} tone="email">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0l-9.75 6.75L2.25 6.75" />
          </svg>
        </Action>
      )}
    </div>
  );
}
