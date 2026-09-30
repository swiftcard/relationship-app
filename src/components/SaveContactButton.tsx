"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { createPortal } from "react-dom";
import { getVisitorId, getVisitorInfo, hasSharedWith, markSharedWith, hasSavedContact, markSavedContact } from "@/lib/visitor";
import { triggerSignupNudge, triggerSignupNudgeWhenVisible } from "@/lib/nudge";
import {
  buildVCard, pickContactImage, contactInitials, CONTACT_INITIALS_BG, CONTACT_INITIALS_FG, type VCardPhoto,
} from "@/lib/vcard";
import { openFileViaSystemBrowser } from "@/lib/native-file";
// The QR popup is desktop-only (its button is hidden below md), yet the
// encoder behind MiniQR shipped to every phone that opened a card. Loaded on
// first open instead; phones never resolve it.
const MiniQR = dynamic(() => import("@/components/card-templates/MiniQR").then((m) => m.MiniQR), { ssr: false });
import MadeWithSwiftCard from "@/components/MadeWithSwiftCard";
import { SCAN_SAVED_EVENT } from "@/lib/scan-saved-event";

interface Person {
  name: string;
  title: string;
  company: string;
  email: string;
  phone: string;
  phones?: { number: string; label: string; showOnCard: boolean }[];
  fax?: string;
  website: string;
  address?: { street?: string; unit?: string; city?: string; state?: string; zip?: string };
  linkedin?: string;
  instagram?: string;
  twitter?: string;
  tiktok?: string;
  /** THIS card owner's headshot — embedded in the saved contact when present. */
  photoUrl?: string | null;
  /** The card's company logo — embedded instead when there is no headshot. */
  logoUrl?: string | null;
  /** Their Swift Links bio — saved into the contact's Notes. */
  bio?: string | null;
}

// Last-resort picture: the owner's initials, white on SwiftCard blue — the
// same tile the server vCard draws with Satori (lib/contact-initials-photo),
// from the same colours in lib/vcard. Drawn locally, so it needs no network
// and can't fail the way a remote image can. Null only if the browser has no
// canvas, in which case the contact saves without a picture.
function drawInitialsPhoto(name: string): VCardPhoto | null {
  const initials = contactInitials(name);
  if (!initials) return null;
  try {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = CONTACT_INITIALS_BG;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = CONTACT_INITIALS_FG;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const px = Math.round(size * (initials.length > 1 ? 0.38 : 0.46));
    ctx.font = `600 ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(initials, size / 2, size / 2 + px * 0.04);
    const m = canvas.toDataURL("image/jpeg", 0.9).match(/^data:([^;,]+);base64,(.+)$/);
    return m ? { base64: m[2], mime: m[1] } : null;
  } catch {
    return null;
  }
}

// Fetch the card owner's headshot and base64-encode it for embedding. Routed
// through the SSRF-guarded same-origin image proxy so cross-origin Supabase /
// avatar URLs read cleanly (and CORS-taint can't block the read). Best-effort:
// any failure (offline, non-image, timeout) resolves to null so the contact
// still saves — just without the photo. Capped so a slow image never hangs the
// save.
async function fetchHeadshotPhoto(url: string): Promise<VCardPhoto | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`/api/img-proxy?url=${encodeURIComponent(url)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    // ~700KB embedded ceiling — keeps the .vcf importable on iOS/Android.
    if (blob.size > 700_000) return null;
    const dataUrl: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("read failed"));
      fr.readAsDataURL(blob);
    });
    const m = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/i);
    if (!m || !m[2]) return null;
    return { base64: m[2], mime: m[1] || blob.type };
  } catch {
    return null;
  }
}

function trackEvent(username: string, eventType: string, source: string) {
  const visitorId = getVisitorId();
  fetch("/api/card-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // surface is always "card": this button renders on the card page only (the
    // Swift Links page uses ConnectButton). Sent explicitly rather than left to
    // the route's default so the row says where it happened instead of relying
    // on one — which is what the whole surface column exists to stop.
    body: JSON.stringify({ card_owner_username: username, visitor_id: visitorId, event_type: eventType, surface: "card", source }),
  }).catch(() => {});
}

/** iPhone, iPad (which reports itself as a Mac with touch) or Android. */
function phoneLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
}

export default function SaveContactButton({
  person,
  username,
  source = "direct_link",
  cardOwner,
  ownerFirstName,
  suppressTracking = false,
  vcardHref,
}: {
  person: Person;
  username?: string;
  source?: string;
  cardOwner?: string;
  ownerFirstName?: string;
  /** True when the OWNER is viewing their own card — the download still works,
      but no activity event or analytics are recorded (self-noise). */
  suppressTracking?: boolean;
  /** The server vCard for this card (/api/card/<slug>/vcard), when the page
      knows the route will serve it. On the web the button then delivers THAT
      file through a hidden iframe — exactly how a QR scan already delivers
      the contact — so iPhone Safari opens its own "Add to Contacts" sheet
      instead of dropping a .vcf into Files, and there is no headshot fetch
      to wait through first. Absent → the file is built in the browser. */
  vcardHref?: string;
}) {
  const [saved, setSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Why the save failed, in a sentence. The path had no catch at all: a
  // thrown error escaped to the error reporter and the visitor saw nothing.
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [showSheet, setShowSheet] = useState(false);
  // Desktop-only QR popup: on a computer you can't tap the card into your
  // phone, so the QR is the bridge — scan it and the card opens there.
  const [showQr, setShowQr] = useState(false);
  const [alreadyShared, setAlreadyShared] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  // SMS opt-in. MUST default to false and MUST NOT gate submission — Twilio
  // A2P review requires the box be unchecked by default and optional.
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  // What went wrong with the share-back, in a sentence. Both failure paths used
  // to end in a bare `setStatus("idle")`: pressing the button with an empty
  // phone did NOTHING, forever, with no message and no outline, and a failed
  // POST simply un-pressed it. This is a stranger, mid-handshake, on someone
  // else's card — they get one impression of whether this works
  // (audit 2026-09-29).
  const [shareErr, setShareErr] = useState<string | null>(null);
  // Which required field the error is about — the outline and
  // aria-describedby key off this, not off the sentence's first words.
  const [shareMissing, setShareMissing] = useState<"name" | "phone" | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardOwner) return;
    // Assigned, not just raised: these describe THIS card, so when cardOwner
    // changes they must fall back to false for the new one. Only ever setting
    // them true meant a component reused across two cards carried the first
    // card's "Saved to Contacts!" state onto the second.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration read from localStorage
    setAlreadyShared(hasSharedWith(cardOwner));
    setSaved(hasSavedContact(cardOwner));
    // Pre-fill from an earlier share anywhere on SwiftCard — never ask twice.
    const v = getVisitorInfo();
    if (v) setForm({ name: v.name, phone: v.phone, email: v.email });
  }, [cardOwner]);

  // A QR scan on a phone finishes at the OS "Add to Contacts" sheet, outside
  // this component entirely — ScanSaveContact (on the card page) announces when
  // that's done so the share-back ask lands there too, matching the button flow.
  // Listening rather than lifting state keeps the sheet's markup in one place.
  useEffect(() => {
    if (!cardOwner) return;
    function onScanSaved() {
      // Visibility-aware: this fires as the visitor comes back from the OS
      // "Add to Contacts" sheet, where the page can still be backgrounded.
      if (hasSharedWith(cardOwner!)) { triggerSignupNudgeWhenVisible("vcard"); return; }
      setSaved(true);
      setShowSheet(true);
    }
    window.addEventListener(SCAN_SAVED_EVENT, onScanSaved);
    return () => window.removeEventListener(SCAN_SAVED_EVENT, onScanSaved);
  }, [cardOwner]);

  // Every dismissal path (X, backdrop, "No thanks") still earns the visitor a
  // friendly "create your free card" invite — the moment is already theirs.
  function closeSheet() {
    setShowSheet(false);
    triggerSignupNudge("vcard");
  }

  // Closing the QR popup hands off to the SAME share-back sheet the Save
  // Contact button raises — the ask doesn't belong inside the QR popup (they're
  // looking at their phone, not the screen), it belongs after it, exactly where
  // it lands in the save flow. If they've already shared, skip straight to the
  // signup nudge like every other dismissal path.
  function closeQr() {
    setShowQr(false);
    if (cardOwner && !alreadyShared && !hasSharedWith(cardOwner)) {
      setTimeout(() => setShowSheet(true), 250);
    } else {
      triggerSignupNudge("vcard");
    }
  }

  // Both overlays: Escape closes, focus moves in (the sheet lands on the name
  // box), and returns to the opener afterwards. Neither did any of that.
  useDialogA11y(showSheet && status !== "done", closeSheet, sheetRef, nameRef);
  useDialogA11y(showQr, closeQr, qrRef);

  async function downloadVCard() {
    // Guard against a double-tap while the headshot is still fetching — one save
    // per click, no duplicate downloads or duplicate activity entries.
    if (downloading) return;
    // NOTE: the "create your free card" popup is DELIBERATELY not fired here.
    // The order is: Save Contact → the owner's "share your info back" sheet →
    // and only once that sheet is submitted or dismissed does the signup nudge
    // appear (closeSheet / shareBack own that trigger). Firing it up front made
    // it collide with the share sheet.
    setDownloading(true);
    setSaveErr(null);
    try {
    // Native shell: a Blob/anchor download no-ops in WKWebView. Hand the user
    // to the server vCard over the system browser sheet, where iOS shows the
    // real "Add to Contacts" preview. Only fires in the app (username known);
    // the web path below is unchanged. Record the save first so the owner
    // still gets the activity/notification even though we navigate away.
    if (username && (await openFileViaSystemBrowser(`/api/card/${encodeURIComponent(username)}/vcard`))) {
      setSaved(true);
      markSavedContact(cardOwner);
      if (!suppressTracking) {
        trackEvent(username, "downloaded_vcard", source);
      }
      if (cardOwner && !alreadyShared && !hasSharedWith(cardOwner)) {
        setTimeout(() => setShowSheet(true), 900);
      }
      return;
    }
    // A PHONE, with the server vCard available: hand it the same file a QR
    // scan delivers, over a hidden iframe so this page keeps the viewport
    // (navigating the top frame to a text/vcard URL strands Android Chrome on
    // a blank tab — see ScanSaveContact). iOS shows its native "Add to
    // Contacts" sheet on top, Android its download. Nothing to wait for
    // first: the server embeds the photo itself. Phones only: a desktop
    // browser may render an inline vCard as text inside the hidden frame and
    // do nothing visible, whereas the download below is exactly what a
    // computer expects.
    if (vcardHref && phoneLike()) {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.setAttribute("aria-hidden", "true");
      iframe.src = vcardHref;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 20_000);
      setSaved(true);
      markSavedContact(cardOwner);
      if (username && !suppressTracking) trackEvent(username, "downloaded_vcard", source);
      if (cardOwner && !alreadyShared && !hasSharedWith(cardOwner)) {
        setTimeout(() => setShowSheet(true), 900);
      } else {
        triggerSignupNudgeWhenVisible("vcard", 900);
      }
      return;
    }
    // ONE ACTION = ONE RECORD. The save is recorded once, as "downloaded_vcard"
    // through /api/card-events — the canonical pipeline. Two other writes for the
    // same tap have now been removed: "clicked_save_contact" (which put a
    // duplicate line in each contact's conversation timeline) and a
    // "contact_save" row in analytics_events, a table with no reader anywhere in
    // the codebase — only inserts, deletes and an index. A second recording of
    // one real action is a second recording even when nothing counts it.
    // Escaping + field ordering live in the shared buildVCard (src/lib/vcard.ts),
    // used by the server lead export too so contacts save identically everywhere.

    // Embed THIS card owner's headshot, or the card's logo when they have no
    // headshot (owner order 2026-09-24), or their initials when there is
    // neither — or when the picture they have fails to load (2026-09-25).
    const image = pickContactImage(person.photoUrl, person.logoUrl);
    const photo = (image ? await fetchHeadshotPhoto(image.url) : null) ?? drawInitialsPhoto(person.name);

    const vcard = buildVCard(
      {
        name: person.name,
        title: person.title,
        company: person.company,
        email: person.email,
        phone: person.phone,
        phones: person.phones,
        fax: person.fax,
        website: person.website,
        // Same SwiftCard link the QR/server vCard embeds — a contact saved from
        // the phone button and one saved by scanning must be identical.
        cardUrl: username || cardOwner ? `${window.location.origin}/${username ?? cardOwner}` : undefined,
        address: person.address,
        linkedin: person.linkedin,
        instagram: person.instagram,
        twitter: person.twitter,
        tiktok: person.tiktok,
        // Swift Links bio → the contact's Notes, same as the server vCard.
        note: person.bio,
      },
      photo,
    );

    const blob = new Blob([vcard], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${person.name.replace(/ /g, "_")}.vcf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Not synchronously: some browsers have not started the transfer when
    // click() returns, and revoking then aborts it.
    setTimeout(() => URL.revokeObjectURL(url), 1500);

    setSaved(true);
    markSavedContact(cardOwner);

    // Owners testing their own card still get the download, but nothing is
    // recorded — no "saved your contact" event/notification to themselves.
    if (username && !suppressTracking) {
      trackEvent(username, "downloaded_vcard", source);
    }

    // Show the "share your info back" lead-capture sheet (card owner's). If it
    // won't show, invite the visitor to make their OWN card instead (signup nudge).
    // Live check too — they may have shared via another form since mount.
    if (cardOwner && !alreadyShared && !hasSharedWith(cardOwner)) {
      setTimeout(() => setShowSheet(true), 900);
    } else {
      // Visibility-aware: the OS "Add to Contacts" sheet backgrounds the page
      // and iOS throttles its timers — a bare setTimeout fired the popup into
      // a hidden page, invisibly. This waits for the visitor to return.
      triggerSignupNudgeWhenVisible("vcard", 900);
    }
    } catch {
      setSaveErr("Couldn't prepare the contact — please try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function shareBack(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setShareMissing("name");
      setShareErr("Add your name so they know who shared.");
      nameRef.current?.focus();
      return;
    }
    if (!form.phone.trim()) {
      setShareMissing("phone");
      setShareErr("Add a phone number so they can reach you.");
      phoneRef.current?.focus();
      return;
    }
    if (!cardOwner) {
      setShareErr("Couldn't send just now — please try again.");
      return;
    }
    setShareMissing(null);
    setShareErr(null);
    setStatus("loading");

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email || null,
          card_owner: cardOwner,
          // The browser id that every card_event for this person also carries.
          // Without it the contact stores null and its conversation can never
          // show a single view or save — the events are recorded, they just
          // have nothing to join to.
          visitor_id: getVisitorId(),
          source: "save_contact_conversion",
        }),
      });
      if (!res.ok) throw new Error("lead capture failed");
    } catch {
      // Don't mark as shared or advance the UI on a failed capture — the
      // visitor's info would otherwise be silently lost. AND SAY SO: resetting
      // to "idle" on its own just un-pressed the button, which reads as the app
      // ignoring them rather than as something to try again.
      setStatus("idle");
      setShareErr("Couldn't send that — check your connection and try again.");
      return;
    }

    markSharedWith(cardOwner, form);
    setAlreadyShared(true);
    setStatus("done");
    // After they share back, close whichever surface hosted the form (the
    // bottom sheet or the desktop QR popup) and invite them to make their own
    // card. The invite fires INSIDE the close callback, not on a second timer
    // of the same length: two 1500ms timers race, and on a slow device the
    // popup could paint in the same frame the sheet was still covering.
    setTimeout(() => {
      setShowSheet(false);
      setShowQr(false);
      triggerSignupNudgeWhenVisible("vcard", 60);
    }, 1500);
  }

  return (
    <>
      {/* On a phone the blue button owns the full row, exactly as before. On a
          computer (md+) it slims down, stays on the left, and "Scan QR code"
          joins it on the right — scanning is the desktop bridge to the phone. */}
      <div className="flex items-stretch gap-2">
        {/* whitespace-nowrap on both: the saved label ("Saved to Contacts!") is
            longer than "Save Contact", and without this it wraps to two lines in
            the narrowed flex-1 — the row's two buttons then have different
            heights and visibly stop lining up the moment the contact saves. */}
        <button
          onClick={downloadVCard}
          disabled={downloading}
          aria-busy={downloading || undefined}
          className={`flex-1 min-w-0 text-white font-semibold py-3 px-4 rounded-full transition-colors text-sm flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-70 ${saved ? "" : "active:bg-blue-800"}`}
          style={{ background: saved ? "#16a34a" : "var(--sc-accent, #1D4ED8)" }}
        >
          {downloading ? (
            // The browser-built file can wait up to 4s on the headshot; the
            // button used to say nothing at all for that whole time.
            <>
              <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />
              Preparing…
            </>
          ) : saved ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Saved to Contacts!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              Save Contact
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => setShowQr(true)}
          // IDENTICAL typography to Save Contact — text-sm, font-semibold,
          // py-3, gap-2, w-4 icon — so the pair reads as one control, not two
          // different-sized ones. It stays the narrower of the two purely
          // through tighter horizontal padding (px-3 vs px-4) plus Save Contact
          // taking flex-1; shrinking the LABEL to do that made them visibly
          // mismatched, which is what this restores.
          className="hidden md:flex shrink-0 items-center justify-center gap-2 font-semibold py-3 px-3 rounded-full text-sm whitespace-nowrap border transition-colors hover:bg-blue-50"
          style={{ borderColor: "var(--sc-accent, #1D4ED8)", color: "var(--sc-accent, #1D4ED8)", background: "#fff" }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
          </svg>
          Scan QR code
        </button>
      </div>
      {saveErr && (
        <p role="alert" className="text-red-500 text-xs text-center mt-2">{saveErr}</p>
      )}
      {/* Once saved: the phone-confirm pointer, plus the "Made with SwiftCard —
          Get yours free" blurb right under the button. It used to be a blue
          "Create your free card" button here and the blurb lived at the very
          bottom of the page (owner request 2026-08-13: move the blurb up into
          this slot). This is the stronger placement — the visitor has just
          experienced the product working, and the invite is the same one tap
          away after they dismiss the popup.
          `onWhite` because this sits inside the white section card, where the
          blurb's original white pill would have vanished. */}
      {saved && (
        <div className="mt-1.5 flex flex-col items-center gap-2.5">
          {/* 12px slate-500 (was 11px #94a3b8 — 2.8:1 on white, the least
              legible text on the page, carrying the one instruction a
              first-time recipient needs). */}
          <p className="text-center text-xs" style={{ color: "#64748b" }}>
            Save — then tap &ldquo;Create New Contact&rdquo;
          </p>
          <MadeWithSwiftCard
            src="save_contact_cta"
            tone="onWhite"
            // Straight into the builder, exactly where the button it replaced
            // went — this slot is a conversion moment, not a footer.
            href="/cards/new?src=save_contact_cta"
            // No wipe on click: same as "Get started free" in the site header.
            // The builder asks "Continue your card / Start a new card" itself
            // when an unfinished card exists (owner rule 2026-09-16).
          />
        </div>
      )}

      {/* Conversion sheet. PORTALED to <body>: the card page's scroll-reveal
          wrappers carry transforms, which turn position:fixed into
          "fixed inside that ancestor" — on desktop the sheet rendered at the
          BOTTOM OF THE DOCUMENT, off-screen until the visitor scrolled (owner
          bug report, 2026-08-25). Same fix QRCodeModal has carried all along.
          Bottom sheet on phones; centered dialog on md+. */}
      {showSheet && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={(e) => e.target === e.currentTarget && closeSheet()}
        >
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sc-shareback-title"
            className="w-full max-w-sm rounded-t-3xl md:rounded-3xl p-6 animate-slide-up md:animate-pop"
            style={{ background: "#FAF7F2", border: "1px solid #E4DDD4" }}
          >
            {status === "done" ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-slate-900 font-bold text-base">Info shared!</p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p id="sc-shareback-title" className="text-slate-900 font-bold text-base leading-snug">
                      Let {ownerFirstName ?? "them"} have yours too
                    </p>
                    <p className="text-slate-500 text-sm mt-1">
                      Share your information!
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeSheet}
                    // 44px target on the one way out that isn't a form button
                    // (it was the bare 24px glyph); the negative margins keep
                    // the glyph exactly where it sat.
                    className="w-11 h-11 -mr-3 -mt-3 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-black/5 transition-colors text-2xl leading-none shrink-0 ml-3"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>

                {/* method="post" for the same reason the sign-in form carries
                    one: before hydration there is no submit handler, and the
                    HTML default without a method is GET — which would put this
                    visitor's name, phone and email in the URL and the history. */}
                <form onSubmit={shareBack} method="post" className="space-y-3">
                  <label htmlFor="sc-shareback-name" className="sr-only">Your name (required)</label>
                  <input
                    ref={nameRef}
                    id="sc-shareback-name"
                    type="text"
                    required
                    autoComplete="name"
                    aria-invalid={shareMissing === "name" || undefined}
                    aria-describedby={shareErr ? "sc-shareback-err" : undefined}
                    placeholder="Your name *"
                    value={form.name}
                    onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); if (shareErr) { setShareErr(null); setShareMissing(null); } }}
                    className={`w-full bg-white text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 transition-colors border ${shareMissing === "name" ? "border-red-400" : "border-gray-200"}`}
                  />
                  <label htmlFor="sc-shareback-phone" className="sr-only">Your phone number (required)</label>
                  <input
                    ref={phoneRef}
                    id="sc-shareback-phone"
                    type="tel"
                    required
                    autoComplete="tel"
                    aria-invalid={shareMissing === "phone" || undefined}
                    aria-describedby={shareErr ? "sc-shareback-err" : undefined}
                    placeholder="Your phone *"
                    value={form.phone}
                    onChange={(e) => { setForm((f) => ({ ...f, phone: e.target.value })); if (shareErr) { setShareErr(null); setShareMissing(null); } }}
                    className={`w-full bg-white text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 transition-colors border ${shareMissing === "phone" ? "border-red-400" : "border-gray-200"}`}
                  />
                  <label htmlFor="sc-shareback-email" className="sr-only">Your email (optional)</label>
                  <input
                    id="sc-shareback-email"
                    type="email"
                    autoComplete="email"
                    placeholder="Your email (optional)"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full bg-white text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 transition-colors border border-gray-200"
                  />
                  {shareErr && (
                    <p id="sc-shareback-err" role="alert" className="text-red-500 text-xs px-1">{shareErr}</p>
                  )}
                  <button
                    type="submit"
                    disabled={status === "loading"}
                    className="w-full font-bold py-3 rounded-full text-white text-sm transition-all disabled:opacity-50"
                    style={{ background: "var(--sc-accent, #1D4ED8)" }}
                  >
                    {status === "loading" ? "Sending…" : `Share my info with ${ownerFirstName ?? "them"} →`}
                  </button>
                  <button
                    type="button"
                    onClick={closeSheet}
                    className="w-full text-slate-400 text-sm py-3 hover:text-slate-600 transition-colors"
                  >
                    No thanks
                  </button>
                </form>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* Desktop QR popup — JUST the code. The "Let <name> have yours too" ask
          deliberately does NOT live in here: while this is open the visitor is
          looking at their phone, not the screen, so a form behind the code is
          asking at the one moment nobody is reading. It fires on close instead
          (see closeQr), landing in exactly the same place it does in the Save
          Contact flow. Only reachable from the md+ button, so phones never see it. */}
      {showQr && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={(e) => e.target === e.currentTarget && closeQr()}
        >
          <div
            ref={qrRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sc-scanqr-title"
            className="w-full max-w-sm rounded-3xl p-6 max-h-[90vh] overflow-y-auto"
            style={{ background: "#FAF7F2", border: "1px solid #E4DDD4" }}
          >
            {/* No X — Done at the bottom is the single, obvious way out (owner
                preference). The backdrop still closes it, and Done carries the
                same closeQr handler, so nothing about the exit flow changes. */}
            <div className="mb-4">
              <p id="sc-scanqr-title" className="text-slate-900 font-bold text-base leading-snug">Scan to save {ownerFirstName ?? "this"} contact</p>
              <p className="text-slate-500 text-sm mt-1">
                Point your phone camera at the code — the contact opens already filled in.
                Tap <span className="text-slate-700 font-medium">Create New Contact</span> to save it,
                and the card stays open behind it.
              </p>
            </div>

            {/* The QR lands on the CARD PAGE with ?save=1 — not the raw .vcf.
                The card loads, then ScanSaveContact hands the phone the
                contact on top of it, so iOS/Android show their native "Add
                to Contacts" screen with every field filled AND dismissing it
                leaves the visitor on the full SwiftCard, free to keep
                scrolling. Pointing straight at the .vcf gave them the
                contact and then a blank page. */}
            <div className="flex justify-center">
              <MiniQR
                size={196}
                url={`${typeof window !== "undefined" ? window.location.origin : "https://swiftcard.me"}/${encodeURIComponent(username ?? cardOwner ?? "")}?save=1&source=qr_code`}
              />
            </div>

            <button
              type="button"
              onClick={closeQr}
              className="mt-5 w-full text-slate-500 hover:text-slate-700 text-sm py-2 transition-colors"
            >
              Done
            </button>
          </div>
        </div>,
        document.body,
      )}

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up { animation: slide-up 0.25s ease-out; }
        @keyframes sc-sheet-pop {
          from { transform: scale(0.96); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @media (min-width: 768px) {
          .md\\:animate-pop { animation: sc-sheet-pop 0.2s cubic-bezier(0.25,1,0.5,1); }
        }
      `}</style>
    </>
  );
}
