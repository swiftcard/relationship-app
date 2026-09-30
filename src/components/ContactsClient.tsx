"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSourceLabel } from "@/lib/source-labels";
import { locationLabel } from "@/lib/location-display";
import { hasMarkedPlace, splitLocationParts } from "@/lib/location-privacy";
import { BlurredPlace } from "@/components/NotificationBody";
import type { GeoAccuracy } from "@/lib/request-geo";
import { CRON_HOUR_UTC } from "@/lib/cron-schedule";
import AddContactModal from "@/components/AddContactModal";
import ContactQuickActions from "@/components/ContactQuickActions";
import ShareMyInfoButton, { type CardSigner } from "@/components/ShareMyInfoButton";
import { PlanGate } from "@/components/PlanGate";
import { AiDraftTag } from "@/components/AiConsentGate";
import { openFileViaSystemBrowser } from "@/lib/native-file";

const ACTIVE_CARD_KEY = "swiftcard_active_card";

type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  company_description: string | null;
  location: string | null;
  /** How much of `location` is real — it is IP-derived, unlike every other
   *  field on this panel, which the contact typed in themselves. Absent on
   *  leads captured before the column existed; those render unchanged. */
  geo_accuracy?: string | null;
  notes: string | null;
  source: string | null;
  visitor_id: string | null;
  created_at: string;
  status: string | null;
  tags: string[] | null;
  follow_up_date: string | null;
  card_owner: string | null;
  where_met: string | null;
  convo_details: string | null;
  message: string | null;
  follow_up_sequence?: { day: number; time?: string; message: string; subject?: string; channel?: string; sent_at?: string | null; anchor?: string; not_sent?: string }[] | null;
};

type CardEvent = {
  id: string;
  event_type: string;
  /** "card" | "links" — absent on events written before the column existed. */
  surface?: string | null;
  /** For clicked_link: the destination host the visitor tapped. */
  target?: string | null;
  /** How the visitor was recognised (lib/known-contact.ts). "forwarded" is a
   *  browser that opened a link sent to this contact after another browser
   *  already had: shown as the link, never as the person. */
  lead_confidence?: string | null;
  /** For clicked_link: the link's own name ("Listings"), when recorded. */
  target_label?: string | null;
  source: string | null;
  visitor_name: string | null;
  visitor_email: string | null;
  created_at: string;
};

const EVENT_LABELS: Record<string, { label: string; icon: string }> = {
  viewed_card:           { label: "Viewed your card",           icon: "·" },
  clicked_save_contact:  { label: "Clicked Save Contact",       icon: "·" },
  downloaded_vcard:      { label: "Downloaded your contact card", icon: "·" },
  clicked_link:          { label: "Tapped one of your links",  icon: "·" },
  shared_info:           { label: "Shared their info",          icon: "✓" },
};

// Natural-language phrases for the read-only conversation/activity log,
// prefixed with the contact's first name ("Aaron downloaded your contact card").
//
// downloaded_vcard USED TO READ "saved your contact", which this very file
// contradicted one line above by calling the same event a download. A save
// finishes in the operating system's "Add to Contacts" sheet — a surface no web
// or native API reports back — so whether they tapped Add, edited it, or
// cancelled is genuinely unknown. The download is the part we performed and can
// therefore state.
const ACTIVITY_PHRASES: Record<string, string> = {
  viewed_card:           "viewed your card",
  clicked_save_contact:  "tapped Save Contact",
  downloaded_vcard:      "downloaded your contact card",
  clicked_link:          "tapped one of your links",
  shared_info:           "shared their info with you",
};

// A view carries WHICH PAGE was opened (card_events.surface). Without it every
// Swift Links view in this timeline read "Viewed your card" — the owner's
// notification already said "Swift Links viewed", so the bell and the
// conversation described the same event differently.
function eventLabel(e: { event_type: string; surface?: string | null }): { label: string; icon: string } {
  if (e.event_type === "viewed_card" && e.surface === "links") {
    return { label: "Viewed your Swift Links", icon: "·" };
  }
  return EVENT_LABELS[e.event_type] ?? { label: e.event_type, icon: "·" };
}

function activityPhrase(e: { event_type: string; surface?: string | null; target?: string | null; target_label?: string | null }): string | undefined {
  if (e.event_type === "viewed_card" && e.surface === "links") return "viewed your Swift Links";
  // Name the link when the row knows which one — "tapped your calendly.com
  // link" is the answer a Swift Links owner is actually looking for.
  // The owner's own name for the link beats its host: two zillow.com links
  // are "Listings" and "Open house", not the same thing twice.
  if (e.event_type === "clicked_link" && e.target_label) return `tapped your ${e.target_label} link`;
  if (e.event_type === "clicked_link" && e.target) return `tapped your ${e.target} link`;
  return ACTIVITY_PHRASES[e.event_type];
}


function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function formatShort(iso: string) {
  const d = new Date(iso);
  // A different year says so — "Sep 23, 2:15 PM" a year apart looked identical.
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
    hour: "numeric", minute: "2-digit",
  });
}

// Follow-up sequence presets — auto-send cadences (days + times).
const SEQ_PRESETS = {
  light:      { label: "Light",      desc: "2 touches · tomorrow 10:06 AM, then day 30 at 1:22 PM" },
  medium:     { label: "Medium",     desc: "3 touches · tomorrow 10:06 AM, 2 weeks 1:22 PM, 4 weeks 11:45 AM" },
  aggressive: { label: "Aggressive", desc: "4 touches · tomorrow 10:06 AM, 2 weeks 1:22 PM, 4 weeks 11:45 AM, 8 weeks 11:22 AM" },
} as const;

function to12h(time: string): string {
  const [h, m] = (time || "13:00").split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

function stepLabel(day: number, time: string): string {
  const when = day === 1 ? "Tomorrow" : day % 7 === 0 ? `${day / 7} week${day / 7 > 1 ? "s" : ""}` : `Day ${day}`;
  return `${when} · ${to12h(time)}`;
}

// The DAY a step goes out — no clock time.
//
// This used to render the step's `time` field in the viewer's local timezone
// ("Sends Aug 8, 10:06 AM"). The sender never reads that field: the cron runs
// once a day and the due check compares against end-of-UTC-day, so the message
// actually goes out on the daily run, up to ~11 hours from the time on screen.
// A precise wrong time is worse than an honest date — the owner plans around
// it, and it's the sort of thing they notice when a contact replies.
//
// The DATE has to be derived the same way, and wasn't. `anchor + N days` is an
// instant; the sender compares it against the end of the UTC day and then sends
// on the CRON_HOUR_UTC run of the UTC day it falls in. Formatting that raw
// instant in the viewer's zone therefore named the wrong day whenever the two
// calendars disagreed at that moment: a flow set up at 9pm Eastern anchors past
// UTC midnight, so every step read a day EARLIER on screen than it would send.
// Rendering the moment the cron will actually run is right in both directions —
// a day later for zones ahead of UTC, unchanged for the US afternoon.
//
// If per-step timing is wanted, the sender has to honour it first (that needs
// more than one cron run a day); the display can follow.
function sendWhen(createdAt: string, day: number): string {
  const due = new Date(new Date(createdAt).getTime() + day * 86400000);
  const run = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate(), CRON_HOUR_UTC);
  return new Date(run).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const PRESET_FROM_COUNT = (n: number): string => (n >= 4 ? "Aggressive" : n === 2 ? "Light" : "Medium");

function formatDateOnly(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source || source === "direct_link") return null;
  return (
    <span className="text-[0.625rem] font-semibold px-2 py-0.5 rounded-full bg-blue-950 text-blue-300 shrink-0">
      {getSourceLabel(source)}
    </span>
  );
}

// The automation status shown under the contact's name, derived from the ACTUAL
// follow-up sequence (email + text steps combined), not a tag:
//   • no sequence at all         → "no flow"   (grey)  — nothing set up yet
//   • some steps still unsent    → "mid-flow"  (yellow)— running / scheduled
//   • every step has a sent_at   → "flow done" (green) — the whole flow has run
// How an outbound message's delivery state reads in the thread. Our own send
// path writes "sent"/"failed"/"not_configured"; Twilio's status callback later
// overwrites it with the CARRIER's verdict (queued → sending → sent →
// delivered, or undelivered/failed). "sent" alone means accepted-not-yet-
// delivered, so it must not be shown as a definitive success.
function outDeliveryLabel(status: string | null | undefined): { text: string; tone: string } {
  switch ((status ?? "").toLowerCase()) {
    case "delivered":      return { text: "Delivered", tone: "text-emerald-500" };
    case "undelivered":    return { text: "Not delivered", tone: "text-red-400" };
    case "failed":         return { text: "Failed", tone: "text-red-400" };
    case "bounced":        return { text: "Not delivered", tone: "text-red-400" };
    case "not_configured":
    case "canceled":
    case "cancelled":      return { text: "Not sent", tone: "text-amber-400" };
    case "accepted":
    case "scheduled":
    case "queued":
    case "sending":        return { text: "Sending", tone: "text-gray-600" };
    // "sent" (Twilio accepted it / the mail service took it) and rows written
    // before statuses existed. Anything that did NOT go never lands here: a
    // step that was skipped writes no row at all.
    default:               return { text: "Sent", tone: "text-gray-600" };
  }
}

function FlowBadge({ sequence }: { sequence: Lead["follow_up_sequence"] }) {
  const seq = sequence ?? [];
  if (seq.length === 0) {
    return <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-gray-800 text-gray-600">no flow</span>;
  }
  const done = seq.every((s) => !!s.sent_at);
  if (done) {
    return (
      <span className="text-[0.625rem] font-semibold px-2 py-0.5 rounded-full bg-emerald-900/60 text-emerald-400 border border-emerald-800/40">
        flow done
      </span>
    );
  }
  return (
    <span className="text-[0.625rem] font-semibold px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-300 border border-amber-800/40">
      mid-flow
    </span>
  );
}

export default function ContactsClient({
  leads: initialLeads,
  primaryUsername,
  userCards = [],
  cardSigners = {},
  initialCardFilter = null,
  initialSelectedId = null,
  isPro = false,
}: {
  leads: Lead[];
  primaryUsername?: string;
  /** Paid account? Follow-up automations are Pro-only (see the channel cards). */
  isPro?: boolean;
  userCards?: { username: string; name: string }[];
  /** Per card slug: what a share from one of its contacts is signed with. */
  cardSigners?: Record<string, CardSigner>;
  initialCardFilter?: string | null;
  /** Deep link (?lead=) — open this contact's detail panel on load. */
  initialSelectedId?: string | null;
}) {
  const [search, setSearch] = useState("");
  // Default to the card currently selected on the dashboard so only its contacts show.
  // Priority: ?card= from the dashboard link → primary card (overridden by saved selection below).
  const [cardFilter, setCardFilter] = useState<string>(initialCardFilter || primaryUsername || "all");

  const router = useRouter();
  const pathname = usePathname();

  // The header's contact COUNT and its Export button are rendered by the
  // server page from `?card=`, while this list filters from client state. With
  // no `?card=` the server computed "all cards" and this component defaulted
  // to the primary card — so a user with two or more cards saw an all-cards
  // total sitting above a single-card list, and Export quietly downloaded a
  // different set from the one on screen.
  //
  // Rather than duplicate the filter in two places, the URL is the single
  // source of truth: every change to the filter is mirrored into `?card=`, so
  // the server re-renders the count and the export href for the same card the
  // list is showing. replace(), not push(), so switching cards doesn't stack
  // history entries; scroll:false so it doesn't jump to the top.
  const syncCardParam = useCallback(
    (next: string) => {
      const params = new URLSearchParams(window.location.search);
      if (next === "all") params.delete("card");
      else params.set("card", next);
      // `lead` is a deep link to an already-open contact; dropping it here
      // would reopen that panel on every filter change.
      params.delete("lead");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // One setter for both, so no future caller can change the filter without the
  // URL following it.
  const selectCard = useCallback(
    (next: string) => {
      setCardFilter(next);
      syncCardParam(next);
    },
    [syncCardParam],
  );

  useEffect(() => {
    if (initialCardFilter) return; // the URL param already set the card
    try {
      const saved = localStorage.getItem(ACTIVE_CARD_KEY);
      if (saved && userCards.some((c) => c.username === saved)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration read from localStorage
        setCardFilter(saved);
        syncCardParam(saved);
        return;
      }
    } catch {
      /* ignore */
    }
    // No saved card either: the state default above is primaryUsername, so the
    // URL has to say so too or the server keeps counting every card.
    if (primaryUsername && userCards.length > 1) syncCardParam(primaryUsername);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selected, setSelected] = useState<Lead | null>(
    initialSelectedId ? initialLeads.find((l) => l.id === initialSelectedId) ?? null : null,
  );
  // Guards against out-of-order responses: if the user clicks a second contact
  // before the first contact's message/events fetch resolves, the stale fetch
  // must not overwrite the panel with the wrong contact's data.
  // ONE place to say "that didn't work".
  //
  // deleteLead, toggleRead, toggleChannelPause and resetChannel
  // all discarded their failures: the confirm dialog closed and the contact
  // stayed, or the toggle simply didn't move, with nothing said. The user's
  // only signal was the UI not changing — indistinguishable from a slow tap,
  // so they tap again. A toast is used rather than an inline slot because
  // these fire from BOTH the list (delete) and the detail panel.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `ms` because the automation failures below are two sentences that tell the
  // reader to go and do something; five seconds is not long enough to read one,
  // let alone act on it.
  function fail(message: string, ms = 5000) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), ms);
  }

  const selectSeq = useRef(0);
  const [events, setEvents] = useState<CardEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesText, setNotesText] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [editingWhereMet, setEditingWhereMet] = useState(false);
  const [whereMetText, setWhereMetText] = useState("");
  const [fieldSaving, setFieldSaving] = useState<string | null>(null);
  const [aiUpgrade, setAiUpgrade] = useState<string | null>(null);
  // Per-channel follow-up automations. Email and text are INDEPENDENT — each has
  // its own toggle, preset, format and on/off, and both can be active at once —
  // but you set them up one at a time. The active flow for each channel lives in
  // the lead's follow_up_sequence; `draft*` is the channel currently being set up.
  const [draftCh, setDraftCh] = useState<"email" | "sms" | null>(null);
  const [draftPreset, setDraftPreset] = useState<"light" | "medium" | "aggressive" | null>(null);
  const [draftItems, setDraftItems] = useState<{ day: number; time: string; channel: "email" | "sms"; message: string; subject?: string }[] | null>(null);
  // Did AI write this draft? Pro accounts get their steps composed from the
  // contact's notes; a Free email flow gets editable starter copy instead, and
  // the panel must not claim otherwise — no "AI draft" tag, and no Regenerate
  // button, which would redraw the identical text and read as broken.
  const [draftIsAi, setDraftIsAi] = useState(true);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [seqSaving, setSeqSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [sortBy, setSortBy] = useState<"alpha" | "recent" | "activity">("alpha");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [detailTab, setDetailTab] = useState<"conversation" | "info">("conversation");
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState({ name: "", company: "", email: "", phone: "" });
  // Dedicated state machine for the "Contact Info / Presets" Save button so it
  // can show clear Default/Saving/Success/Error feedback and never fire twice.
  const [contactSaveStatus, setContactSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [convoMessages, setConvoMessages] = useState<{ id: string; direction: string; channel: string | null; body: string; status: string | null; created_at: string }[]>([]);


  // Guided tour: when the tour reaches the Contacts page, auto-open the sample
  // (demo) contact on its info tab so the tour can walk through the contact's
  // details and the follow-up automations. No-op outside the tour.
  useEffect(() => {
    let touring = false;
    try { touring = sessionStorage.getItem("sc_tour_running") === "1"; } catch { /* ignore */ }
    if (!touring) return;

    const open = (c: Lead) => {
      // Through selectLead, so its Activity & Messages load like any contact
      // opened by hand — then onto the info tab the tour walks through.
      void selectLead(c);
      setDetailTab("info");
    };

    const demo = leads.find((l) => (l.tags ?? []).includes("demo")) ?? leads[0];
    if (demo) {
      open(demo);
      return;
    }

    // No contact to demonstrate (older account, or the demo contact was deleted
    // before replaying the tour). Seed the sample on the fly so the Contacts
    // steps always have something to point at. Idempotent server-side.
    const owner = cardFilter !== "all" ? cardFilter : (primaryUsername || userCards[0]?.username);
    if (!owner) return;
    let cancelled = false;
    fetch("/api/contacts/seed-demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardOwner: owner }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.contact) return;
        const c = data.contact as Lead;
        setLeads((prev) => [c, ...prev]);
        open(c);
      })
      .catch(() => { /* tour still works, the step just won't spotlight a contact */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveContact() {
    // In-flight guard: a second tap while saving must not fire a duplicate PATCH.
    if (!selected || contactSaveStatus === "saving") return;
    if (!contactDraft.name.trim()) return;
    setContactSaveStatus("saving");
    setFieldSaving("contact");
    let ok = false;
    try {
      const res = await fetch(`/api/leads/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactDraft),
      });
      ok = res.ok;
    } catch { /* network error — leave the editor open with the draft intact */ }
    setFieldSaving(null);
    if (ok) {
      const patch = { ...contactDraft };
      setSelected((prev) => (prev ? { ...prev, ...patch } : prev));
      setLeads((prev) => prev.map((l) => (l.id === selected.id ? { ...l, ...patch } : l)));
      // Flash a success confirmation, then close the editor.
      setContactSaveStatus("saved");
      setTimeout(() => { setEditingContact(false); setContactSaveStatus("idle"); }, 900);
    } else {
      // Keep the editor open with the draft intact so nothing is lost.
      setContactSaveStatus("error");
      setTimeout(() => setContactSaveStatus("idle"), 2500);
    }
  }

  // Download this contact as a vCard so the user can save it to their phone.
  async function saveContactToPhone() {
    if (!selected) return;
    // Native shell: a Blob/anchor download no-ops in WKWebView. Route to the
    // server vCard over the system browser sheet, where iOS shows the real
    // "Add to Contacts" preview. Web keeps the client Blob path below.
    const href = `/api/leads/vcard?id=${encodeURIComponent(selected.id)}`;
    if (await openFileViaSystemBrowser(href)) return;

    // Web uses the SAME server route as native now, instead of hand-rolling a
    // second vCard here. Three reasons, in order of severity:
    //
    //  1. The local escaper was applied to name, company and note but NOT to
    //     email or phone — which are VISITOR-supplied at public capture. A
    //     stored phone or email containing a line break injected arbitrary
    //     properties into the .vcf the owner saved to their address book.
    //  2. The server route enforces the Free-plan lead lock; this path did not,
    //     so a downgraded account could still pull a locked contact's details.
    //  3. The two builders disagreed — this one carried the note, the server's
    //     didn't — so the same button produced different contacts on different
    //     platforms. The note now lives in the shared builder.
    //
    // A plain anchor to the route: Content-Disposition: attachment makes the
    // browser download it rather than navigate.
    const a = document.createElement("a");
    a.href = href;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Per-channel pause (email-paused / sms-paused tags — the cron skips a paused
  // channel's steps and they resume, unsent, when switched back on). The two
  // channel switches are THE automation controls: text off stops texts, email
  // off stops emails. (The old master flow-paused toggle is gone — any channel
  // interaction also clears a legacy flow-paused tag so old contacts unblock.)
  function channelPausedFor(ch: "email" | "sms") {
    const tags = selected?.tags ?? [];
    if (ch === "email") return tags.includes("email-paused");
    // SMS is opt-IN: it's only "active" when the contact has affirmative
    // consent (sms-ok) and isn't paused. No consent → shown as off, because the
    // cron won't text them until the owner turns it on (asserting consent).
    return !tags.includes("sms-ok") || tags.includes("sms-paused");
  }
  async function toggleChannelPause(ch: "email" | "sms") {
    if (!selected) return;
    const tags = (selected.tags ?? []).filter((t) => t !== "flow-paused");
    if (ch === "email") {
      const next = tags.includes("email-paused") ? tags.filter((t) => t !== "email-paused") : [...tags, "email-paused"];
      if (!(await updateTags(selected.id, next))) fail("Couldn't change the email setting — please try again.");
      return;
    }
    // Turning SMS ON asserts consent to text this contact (grants sms-ok);
    // turning it OFF pauses and revokes it. The server owns sms-ok — the
    // sms_consent flag drives it.
    const turningOn = channelPausedFor("sms"); // currently off → this turns it on
    if (!(await updateTags(selected.id, tags, turningOn))) fail("Couldn't change the text setting — please try again.");
  }

  // Reset a channel: wipe its automation entirely (the other channel keeps
  // running) and open setup so a fresh one can be submitted. The new flow is
  // anchored at submit time, so it restarts with its next message from then.
  async function resetChannel(ch: "email" | "sms") {
    if (!selected) return;
    const remaining = ((selected.follow_up_sequence ?? []) as { channel?: string }[]).filter(
      (o) => (o.channel ?? "email") !== ch
    );
    try {
      const res = await fetch(`/api/leads/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ follow_up_sequence: remaining }),
      });
      // "Reset ↺" was a pure no-op on failure: the sequence stayed, the panel
      // did not change, and nothing was said.
      if (!res.ok) { fail("Couldn't reset that automation — please try again."); return; }
    } catch {
      fail("Couldn't reset that automation — please check your connection.");
      return;
    }
    setLeads((prev) => prev.map((l) => (l.id === selected.id ? { ...l, follow_up_sequence: remaining as Lead["follow_up_sequence"] } : l)));
    setSelected((prev) => (prev && prev.id === selected.id ? { ...prev, follow_up_sequence: remaining as Lead["follow_up_sequence"] } : prev));
    // Reset clears the SEQUENCE. It must not flip the SWITCH.
    //
    // This used to strip the channel's own pause tag unconditionally, and for
    // SMS it passed smsConsent:true — which makes the server grant sms-ok AND
    // drop sms-paused. So turning a channel off and then pressing Reset turned
    // it straight back on, silently re-arming a channel the user had just
    // switched off. Resetting is "throw this cadence away", not "switch this
    // channel on"; only submitting a new automation means the latter, and
    // submitDraft still does exactly that.
    //
    // The legacy master flow-paused tag is still cleared either way — it is a
    // migration leftover with no toggle of its own, so nothing the user can see
    // depends on it.
    const channelOff = channelPausedFor(ch);
    const pauseTag = ch === "email" ? "email-paused" : "sms-paused";
    const tags = (selected.tags ?? []).filter(
      (t) => t !== "flow-paused" && !(t === pauseTag && !channelOff),
    );
    // smsConsent is left UNDEFINED when the channel is off, so consent is not
    // touched at all. Sending `false` would also work but would rewrite
    // sms-ok/sms-paused server-side; a reset has no business editing a consent
    // record it was not asked to change. When the channel is ON this is still
    // the request that (re-)asserts sms-ok, which the cron requires.
    const smsConsent = ch === "sms" && !channelOff ? true : undefined;
    if (!(await updateTags(selected.id, tags, smsConsent))) {
      fail(channelOff
        ? "Reset, but we couldn't save that change — please try again."
        : ch === "sms"
          ? "Reset, but we couldn't re-enable texting for this contact — submit again before relying on it."
          : "Reset, but we couldn't un-pause email for this contact — submit again before relying on it.");
    }
    startDraft(ch);
  }


  // ── Keeping Activity & Messages current ────────────────────────────────────
  //
  // The panel used to load exactly ONCE, in selectLead, when a contact was
  // opened. Anything that happened afterwards — sharing your card by email or
  // text — was written server-side and never read back, so the log stayed
  // silent until you left the contact and came back. That made a successful
  // send look like it had done nothing.
  //
  // This re-reads BOTH feeds behind the panel (the message thread and the
  // contact's card events), so it is the one call any action can make after
  // changing anything the panel shows, rather than each action hand-patching
  // its own row into state and drifting from what the server recorded.
  async function refreshActivity() {
    const lead = selected;
    if (!lead) return;
    // Same guard selectLead uses: a refresh still in flight for a contact the
    // user has already navigated away from must not overwrite the one now on
    // screen. Read at call time and re-checked before every setState below.
    const seq = selectSeq.current;
    try {
      const r = await fetch(`/api/leads/${lead.id}/message`);
      const d = await r.json();
      if (selectSeq.current === seq && Array.isArray(d.messages)) setConvoMessages(d.messages);
    } catch {
      // Deliberately KEEP what is on screen. selectLead clears to [] because it
      // is switching contacts and the old thread is simply wrong; here the
      // displayed log is still accurate and a dropped request is no reason to
      // blank out a correct history.
    }
    try {
      const res = await fetch(`/api/card-events?lead_id=${encodeURIComponent(lead.id)}`);
      const data = await res.json();
      if (selectSeq.current === seq && Array.isArray(data)) setEvents(data);
    } catch {
      /* keep what is on screen — see above */
    }
  }

  // The other direction of the same staleness. Actions taken HERE now refresh
  // the panel, but plenty lands in it that nobody in this tab did: a reply from
  // the contact, a follow-up the scheduler sent, a delivery status Twilio
  // revised. Those are written while the app is in the background, so re-read
  // when it comes back to the foreground — the moment the user is looking again.
  //
  // Not a poll. A timer would fetch for every open contact forever to catch
  // something that arrives rarely; this costs one request at the only point
  // where the answer could have changed AND is about to be read.
  const refreshRef = useRef(refreshActivity);
  useEffect(() => { refreshRef.current = refreshActivity; });
  // Opened straight onto a contact (?lead= — a push, a notification row): it
  // was selected without selectLead, so its messages and activity were never
  // fetched and the panel showed nothing but the arrival line.
  useEffect(() => {
    if (initialSelectedId && selected?.id === initialSelectedId) void refreshRef.current();
    // Mount only: this is the one contact selected without a click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!selected?.id) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [selected?.id]);

  /** Returns whether the save landed, so the caller can keep the editor open. */
  async function saveField(field: string, value: string): Promise<boolean> {
    if (!selected) return false;
    setFieldSaving(field);
    const ok = await updateField(selected.id, field, value);
    if (ok) setSelected((prev) => prev ? { ...prev, [field]: value } : prev);
    setFieldSaving(null);
    return ok;
  }

  // Turn a channel ON to configure it — one channel at a time.
  function startDraft(ch: "email" | "sms") {
    setDraftCh(ch);
    setDraftPreset(null);
    setDraftItems(null);
    setAiUpgrade(null);
    setDraftError(null);
  }
  function cancelDraft() {
    setDraftCh(null);
    setDraftPreset(null);
    setDraftItems(null);
    setAiUpgrade(null);
    setDraftError(null);
  }

  // Pick a preset → AI-generate the draft for the ONE channel being set up.
  // Nothing schedules until Submit.
  async function selectPreset(preset: "light" | "medium" | "aggressive") {
    if (!selected || !draftCh) return;
    setDraftPreset(preset);
    setDraftLoading(true);
    setDraftItems(null);
    setAiUpgrade(null);
    setDraftError(null);
    try {
      const res = await fetch(`/api/leads/${selected.id}/generate-sequence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetKey: preset, whereMet: selected.where_met ?? "", notes: selected.notes ?? "", channel: draftCh }),
      });
      const data = await res.json();
      if (res.status === 402 || data.error === "upgrade") {
        setAiUpgrade(data.message || "Text follow-ups are a Pro feature. Email follow-ups are included on every plan.");
        setDraftItems(null);
        setDraftPreset(null);
        return;
      }
      const items = (Array.isArray(data.sequence) ? data.sequence : []).map((s: { day: number; time: string; message: string; subject?: string }) => ({
        day: s.day, time: s.time, channel: draftCh, message: s.message, subject: s.subject,
      }));
      // A failure must never look like a dead button — surface it so the user
      // can tap the preset again instead of assuming the feature is broken.
      if (!res.ok || items.length === 0) {
        setDraftError("Couldn't write the messages just now — tap a cadence to try again.");
        setDraftItems(null);
        setDraftPreset(null);
        return;
      }
      setDraftError(null);
      setDraftIsAi(data.aiWritten !== false);
      setDraftItems(items);
    } catch {
      setDraftError("Couldn't write the messages just now — check your connection and tap a cadence to try again.");
      setDraftItems(null);
      setDraftPreset(null);
    } finally {
      setDraftLoading(false);
    }
  }

  function updateDraftItem(i: number, message: string) {
    setDraftItems((prev) => (prev ? prev.map((it, idx) => (idx === i ? { ...it, message } : it)) : prev));
  }
  function updateDraftSubject(i: number, subject: string) {
    setDraftItems((prev) => (prev ? prev.map((it, idx) => (idx === i ? { ...it, subject } : it)) : prev));
  }

  // Submit the draft → activate THIS channel. Merge into follow_up_sequence,
  // keeping the OTHER channel's items (so both can run). Steps are anchored to
  // NOW (not the contact's created date) so flows set up later still send.
  async function submitDraft() {
    if (!selected || !draftCh || !draftItems?.length) return;
    setSeqSaving("saving");
    const nowIso = new Date().toISOString();
    const old = (selected.follow_up_sequence ?? []) as { day: number; time?: string; message: string; subject?: string; channel?: string; sent_at?: string | null; anchor?: string }[];
    const otherChannel = old.filter((o) => (o.channel ?? "email") !== draftCh);
    const oldMine = old.filter((o) => (o.channel ?? "email") === draftCh);
    // A finished flow being set up again starts FRESH — carrying old sent_at
    // stamps would silently mark the new steps as already sent. Mid-flight
    // re-drafts keep sent steps (and their schedule) so nothing double-sends.
    const freshStart = oldMine.length === 0 || oldMine.every((o) => o.sent_at);
    const mine = draftItems.map((it) => {
      const prior = freshStart ? undefined : oldMine.find((o) => o.day === it.day);
      return {
        day: it.day, time: it.time, message: it.message, subject: it.subject, channel: draftCh,
        sent_at: prior?.sent_at ?? null,
        anchor: prior ? prior.anchor : nowIso,
      };
    });
    const payload = [...otherChannel, ...mine];
    let ok = false;
    try {
      const res = await fetch(`/api/leads/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ follow_up_sequence: payload }),
      });
      ok = res.ok;
    } catch { /* network error */ }
    if (!ok) {
      // Keep the draft on screen so nothing is lost — the user can retry.
      setSeqSaving("idle");
      fail("Couldn't save the automation — please try again.");
      return;
    }
    setLeads((prev) => prev.map((l) => (l.id === selected.id ? { ...l, follow_up_sequence: payload } : l)));
    setSelected((prev) => (prev && prev.id === selected.id ? { ...prev, follow_up_sequence: payload } : prev));
    // Submitting turns this channel ON: clear any stale pause (and the legacy
    // master pause) so the new automation runs immediately. Building a TEXT
    // automation asserts consent to text this contact (grants sms-ok, which the
    // cron requires) — always send it for SMS, even if it wasn't paused, so a
    // never-consented contact's new text automation actually sends.
    const pauseTag = draftCh === "email" ? "email-paused" : "sms-paused";
    const curTags = selected.tags ?? [];
    // This second request is what actually makes the automation SENDABLE — for
    // SMS it grants sms-ok, which the cron hard-requires. Its result used to be
    // discarded, so if it failed the sequence saved, the UI said "Saved ✓" and
    // rendered the toggle on with scheduled dates, and not one text would ever
    // go out. A dead automation the owner believes is running is worse than a
    // visible failure: they stop following up manually because they think it is
    // handled.
    let tagsOk = true;
    if (draftCh === "sms") {
      tagsOk = await updateTags(selected.id, curTags.filter((t) => t !== "sms-paused" && t !== "flow-paused"), true);
    } else if (curTags.includes(pauseTag) || curTags.includes("flow-paused")) {
      tagsOk = await updateTags(selected.id, curTags.filter((t) => t !== pauseTag && t !== "flow-paused"));
    }
    if (!tagsOk) {
      // Was an alert(), on the reasoning that this component had no inline
      // error slot for the automation panel. It does — `fail()` above, whose
      // toast is position:fixed at z-50, so it clears the detail overlay and
      // the bottom tab bar and is visible from this panel like any other. A
      // native alert() blocks the whole page, is unstyled, truncates on some
      // phones, and can be suppressed entirely by iOS "block dialogs" — which
      // would have hidden exactly this warning (audit 2026-09-29; same
      // reasoning ManageCards records for dropping confirm()).
      fail(
        draftCh === "sms"
          ? "Your automation was saved, but we couldn't turn texting on for this contact. Open it and submit again — until then no texts will send."
          : "Your automation was saved, but we couldn't un-pause email for this contact. Open it and submit again.",
        9000,
      );
      setSeqSaving("idle");
      return;
    }
    cancelDraft();
    setSeqSaving("saved");
    setTimeout(() => setSeqSaving("idle"), 2000);
  }


  // Filtering, sorting and the A–Z grouping used to run on EVERY render of this
  // component — and it re-renders constantly: every keystroke in a notes field,
  // every tab switch, every 10s notification poll, every optimistic tag edit.
  // None of that changes the list, so the whole derivation is memoised on the
  // four inputs that actually do. Same output, same order, same objects.
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return leads
      .filter((l) => {
        if (cardFilter !== "all" && l.card_owner !== cardFilter) return false;
        return (
          l.name.toLowerCase().includes(q) ||
          (l.email ?? "").toLowerCase().includes(q) ||
          (l.phone ?? "").includes(q) ||
          (l.company ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortBy === "recent") {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
        if (sortBy === "activity") {
          const aDate = a.follow_up_date ?? a.created_at;
          const bDate = b.follow_up_date ?? b.created_at;
          return new Date(bDate).getTime() - new Date(aDate).getTime();
        }
        return a.name.localeCompare(b.name);
      });
  }, [leads, cardFilter, search, sortBy]);

  // Group alphabetically
  const { grouped, letters } = useMemo(() => {
    const g: Record<string, Lead[]> = {};
    for (const lead of filtered) {
      const letter = lead.name[0]?.toUpperCase() ?? "#";
      if (!g[letter]) g[letter] = [];
      g[letter].push(lead);
    }
    return { grouped: g, letters: Object.keys(g).sort() };
  }, [filtered]);

  async function selectLead(lead: Lead) {
    const seq = ++selectSeq.current;
    setSelected(lead);
    setEvents([]);
    setDetailTab("conversation");
    setEditingContact(false);
    setEditingNotes(false);
    setEditingWhereMet(false);
    setWhereMetText(lead.where_met ?? "");
    setAiUpgrade(null);
    // The active automations render directly from the lead's follow_up_sequence;
    // just clear any in-progress draft when switching contacts.
    setDraftCh(null);
    setDraftPreset(null);
    setDraftItems(null);
    setDraftLoading(false);
    setSeqSaving("idle");
    setConvoMessages([]);
    // Load the message thread (degrades to empty if not yet migrated). Guarded
    // by `seq` so a slow response for a contact the user already navigated
    // away from can't overwrite the currently-selected contact's messages.
    fetch(`/api/leads/${lead.id}/message`)
      .then((r) => r.json())
      .then((d) => { if (selectSeq.current === seq) setConvoMessages(Array.isArray(d.messages) ? d.messages : []); })
      .catch(() => { if (selectSeq.current === seq) setConvoMessages([]); });
    setLoadingEvents(true);
    try {
      const res = await fetch(`/api/card-events?lead_id=${encodeURIComponent(lead.id)}`);
      const data = await res.json();
      if (selectSeq.current === seq) setEvents(Array.isArray(data) ? data : []);
    } catch {
      if (selectSeq.current === seq) setEvents([]);
    } finally {
      if (selectSeq.current === seq) setLoadingEvents(false);
    }
  }

  const today = new Date().toISOString().split("T")[0];

  // Every mutator below only applies its local state change when the server
  // ACCEPTED the write — a failed PATCH (expired session, deleted lead, 500)
  // must never leave the UI pretending the save happened.
  async function updateField(leadId: string, field: string, value: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // tags is a Postgres text[] — send the real array, not a stringified one.
  // `smsConsent` (optional) is the owner asserting they DO / DON'T have consent
  // to text this contact — the server sets the server-owned sms-ok tag from it
  // (the one tag the cron requires to send an automated text). Reflected in the
  // optimistic local tags so the toggle shows the right state immediately.
  async function updateTags(leadId: string, tags: string[], smsConsent?: boolean): Promise<boolean> {
    let nextTags = tags;
    if (smsConsent === true) nextTags = Array.from(new Set([...tags.filter((t) => t !== "sms-paused"), "sms-ok"]));
    else if (smsConsent === false) nextTags = Array.from(new Set([...tags.filter((t) => t !== "sms-ok"), "sms-paused"]));
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags, ...(typeof smsConsent === "boolean" ? { sms_consent: smsConsent } : {}) }),
      });
      if (!res.ok) return false;
    } catch {
      return false;
    }
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, tags: nextTags } : l)));
    setSelected((prev) => (prev && prev.id === leadId ? { ...prev, tags: nextTags } : prev));
    return true;
  }

  function isUnread(lead: Lead) {
    return (lead.tags ?? []).includes("unread");
  }

  async function toggleRead(lead: Lead) {
    const tags = lead.tags ?? [];
    const newTags = tags.includes("unread")
      ? tags.filter((t) => t !== "unread")
      : [...tags, "unread"];
    if (!(await updateTags(lead.id, newTags))) fail("Couldn't update that contact — please try again.");
  }

  async function deleteLead(id: string) {
    let ok = false;
    try {
      const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
      ok = res.ok;
    } catch { /* network error — keep the contact in the list */ }
    setConfirmDeleteId(null);
    if (!ok) { fail("Couldn't delete that contact — please try again."); return; }
    setLeads((prev) => prev.filter((l) => l.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  async function saveNotes() {
    if (!selected) return;
    setNotesSaving(true);
    const ok = await updateField(selected.id, "notes", notesText);
    if (ok) setSelected((prev) => prev ? { ...prev, notes: notesText } : prev);
    setNotesSaving(false);
    if (ok) setEditingNotes(false);
  }

  const renderLeadItem = (lead: Lead) => {
    const isOverdue = lead.follow_up_date && lead.follow_up_date.slice(0, 10) <= today;
    const unread = isUnread(lead);
    return (
      // The row is a plain container: it holds controls of its own (Call /
      // Text / Email, the read toggle), and a button wrapping other controls
      // is one a screen reader flattens. The avatar + text ARE the button —
      // the keyboard and screen-reader way in — and a click anywhere else on
      // the row still opens the contact (the controls stop their own clicks).
      <div
        key={lead.id}
        data-contact-row=""
        onClick={() => selectLead(lead)}
        className={`group w-full text-left px-4 py-3.5 border-b border-gray-800/50 transition-colors hover:bg-gray-900 cursor-pointer ${selected?.id === lead.id ? "bg-gray-900 border-l-2 border-l-blue-500" : ""}`}
      >
        <div className="flex items-start gap-3">
          {/* No onClick of its own: the click bubbles to the row, so opening
              the contact happens once, from one place. */}
          <button type="button" className="flex items-start gap-3 flex-1 min-w-0 text-left rounded-lg">
          <div className="relative shrink-0 mt-0.5">
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
              {lead.name[0]?.toUpperCase() ?? "?"}
            </div>
            {unread && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-gray-950" title="Unread" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-sm truncate ${unread ? "text-white font-bold" : "text-gray-100 font-semibold"}`}>{lead.name}</p>
              <SourceBadge source={lead.source} />
            </div>
            {lead.company && <p className="text-gray-400 text-xs truncate">{lead.company}</p>}
            <p className="text-gray-500 text-xs truncate">{lead.email || lead.phone}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <p suppressHydrationWarning className="text-gray-700 text-[0.625rem]">{formatShort(lead.created_at)}</p>
              {lead.card_owner && userCards.length > 1 && (
                <span className="text-[0.625rem] text-gray-600">/{lead.card_owner}</span>
              )}
              {isOverdue && (
                <span className="text-[0.625rem] font-semibold text-amber-400">follow-up due</span>
              )}
            </div>
          </div>
          </button>
          {/* Call · Text · Email in one tap (owner, 2026-09-29 — they came
              from the dashboard's Quick Contacts). Hidden per button when
              there is no number / no email. */}
          <div className="self-center">
            <ContactQuickActions name={lead.name} phone={lead.phone} email={lead.email} />
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleRead(lead); }}
            title={unread ? "Mark as read" : "Mark as unread"}
            aria-label={unread ? "Mark as read" : "Mark as unread"}
            // gray-500, not gray-600: at rest this icon measured 2.35:1 on the
            // gray-900 row and 2.66:1 on the page — under the 3:1 WCAG asks of a
            // control you have to SEE to use, and it is the only way to mark a
            // contact read from the list. gray-500 clears it (3.67 / 4.16) while
            // staying clearly subordinate to the blue unread state, which is the
            // distinction the two colours exist to make.
            className={`shrink-0 self-center p-1.5 rounded-lg transition-colors ${unread ? "text-blue-400 hover:bg-blue-500/10" : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"}`}
          >
            {/* A dot, not an envelope: the Email button beside it is an
                envelope, and two envelopes side by side read as the same
                thing. Filled = unread, ring = read — the same dot the avatar
                wears while unread. */}
            <span aria-hidden="true" className="flex w-4 h-4 items-center justify-center">
              <span className={`block w-2.5 h-2.5 rounded-full ${unread ? "bg-current" : "border-[1.5px] border-current"}`} />
            </span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex gap-0 lg:h-[calc(100vh-56px)]">
      {/* Left: contact list — full width on mobile, hidden once a contact is opened */}
      <div className={`${selected ? "hidden lg:flex" : "flex"} w-full lg:w-96 shrink-0 lg:border-r border-gray-800 flex-col lg:overflow-hidden`}>
        {/* Search */}
        <div className="p-4 border-b border-gray-800 space-y-3">
          {/* Add contact — attaches to the currently-selected card */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-gray-500 text-xs">
              {cardFilter !== "all" && userCards.length > 1
                ? `Showing /${cardFilter}`
                : "All contacts"}
            </p>
            <div className="flex items-center gap-2 shrink-0">
            {/* The scanner's only door used to be inside the Add contact modal.
                This is the same modal — it just says so from the outside. */}
            <AddContactModal
              variant="scan"
              cardOwner={cardFilter !== "all" ? cardFilter : (primaryUsername || userCards[0]?.username)}
              onAdded={(lead) => {
                const l = lead as Lead;
                setLeads((prev) => [l, ...prev]);
                if (cardFilter !== "all" && l.card_owner && l.card_owner !== cardFilter) selectCard(l.card_owner);
              }}
            />
            <AddContactModal
              cardOwner={cardFilter !== "all" ? cardFilter : (primaryUsername || userCards[0]?.username)}
              onAdded={(lead) => {
                const l = lead as Lead;
                setLeads((prev) => [l, ...prev]);
                // Make sure it's visible under the active filter.
                if (cardFilter !== "all" && l.card_owner && l.card_owner !== cardFilter) {
                  // selectCard, not setCardFilter — the header count and Export
                  // read the card from the URL, so a filter change that skips
                  // the sync puts them back out of step with this list.
                  selectCard(l.card_owner);
                }
              }}
            />
            </div>
          </div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search contacts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 text-gray-200 placeholder-gray-500 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <select
            aria-label="Sort contacts"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="bg-gray-900 border border-gray-700 text-gray-300 rounded-xl px-3 py-2 text-xs focus:outline-none w-full"
          >
            <option value="alpha">Alphabetical</option>
            <option value="recent">Recently Added</option>
            {/* It has always sorted by follow-up date, whatever its old label said. */}
            <option value="activity">Follow-up Date</option>
          </select>
          <p className="text-gray-600 text-xs pl-1">{filtered.length} contact{filtered.length !== 1 ? "s" : ""}</p>
        </div>

        {/* List */}
        <div className="flex-1 lg:overflow-y-auto pb-20 lg:pb-0">
          {filtered.length === 0 ? (
            search ? (
              <div className="p-8 text-center text-gray-600 text-sm">No contacts match your search.</div>
            ) : (
              /* "No contacts yet." — four words of grey in the middle of an
                 otherwise empty screen — was the whole of this state, on the
                 page a new account opens expecting to find out how any of this
                 works. It said nothing about where contacts come from and
                 offered nothing to do. The dashboard has carried the right
                 pattern for this all along (audit 2026-09-29). */
              <div className="px-6 py-10 text-center">
                <div className="w-10 h-10 bg-gray-800/60 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 text-gray-600" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                  </svg>
                </div>
                <p className="font-semibold text-gray-300 text-sm mb-1">No contacts yet</p>
                <p className="text-gray-600 text-xs leading-relaxed max-w-xs mx-auto">
                  They arrive on their own — anyone who taps &ldquo;Share your info&rdquo; on your card lands
                  here straight away. You can also add someone yourself, or scan their business card.
                </p>
                <Link
                  href={`/dashboard${cardFilter !== "all" ? `?card=${encodeURIComponent(cardFilter)}` : ""}`}
                  className="sc-tap mt-5 inline-flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 px-5 py-2.5 text-xs font-semibold text-white transition-colors"
                >
                  Share your card
                </Link>
              </div>
            )
          ) : (
            sortBy === "alpha" ? (
              letters.map((letter) => (
                <div key={letter}>
                  {/* z-10: the letter headers are sticky inside the scrolling
                      list, but had no stacking context, so contact rows scrolled
                      OVER them instead of under — the header appeared to sit
                      behind the list. Scoped to this scroll container; it does
                      not interact with the page nav (z-30) above it. */}
                  <div className="px-4 py-1.5 text-[0.6875rem] font-bold text-gray-600 uppercase tracking-widest bg-gray-950 sticky top-0 z-10">
                    {letter}
                  </div>
                  {grouped[letter].map((lead) => renderLeadItem(lead))}
                </div>
              ))
            ) : (
              filtered.map((lead) => renderLeadItem(lead))
            )
          )}
        </div>
      </div>

      {/* Right: detail panel — full-screen overlay on mobile, side pane on desktop */}
      <div className={`${selected ? "fixed inset-0 z-50 bg-gray-950 overflow-y-auto" : "hidden"} lg:static lg:z-auto lg:block lg:flex-1 lg:overflow-y-auto`}>
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-600 gap-3">
            <svg className="w-10 h-10 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            <p className="text-sm">Select a contact to view details</p>
          </div>
        ) : (
          <>
            {/* Mobile back bar.
                sc-overlay-topbar: the panel above is `fixed inset-0`, and the
                app ships viewport-fit=cover, so in the native shell it starts
                at the true top of the screen — under the clock. `body`'s
                safe-area padding does not move a fixed element (see the note on
                html.native-app body in globals.css), and this bar carries
                neither .sc-app nor .sc-tabbar, the two classes that get the
                inset. So the status bar sat squarely on top of this 48px bar
                and the back button could not be tapped at all. */}
            <div className="sc-overlay-topbar lg:hidden sticky top-0 z-10 flex items-center gap-2 px-4 h-12 bg-gray-950/95 backdrop-blur border-b border-gray-800">
              <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                Contacts
              </button>
            </div>
          <div className="max-w-xl mx-auto p-4 sm:p-8 pb-24 lg:pb-8">
            {/* Header */}
            {/* Tighter on a phone, unchanged from `sm` up. Measured at 390px:
                the avatar (64) + this button (137) + gaps left the name and the
                status pill about 130px between them, so an ordinary two-word
                name broke across two lines and "New Contact" was clipped. The
                phone sizes below give that column back roughly 90px. */}
            <div data-tour="contact-detail" className="flex items-start gap-3 sm:gap-5 mb-6 sm:mb-8">
              <div className="w-10 h-10 sm:w-16 sm:h-16 rounded-full bg-blue-600 flex items-center justify-center text-sm sm:text-xl font-bold text-white shrink-0">
                {selected.name[0]?.toUpperCase() ?? "?"}
              </div>
              {/* min-w-0: this is the only flexible child in the row — the 64px
                  avatar and the right-hand actions are both shrink-0. Without it
                  a flex item cannot shrink below its min-content width, so a long
                  contact name (or an email used as one) pushed the whole header
                  past the right edge of a phone screen instead of wrapping. */}
              <div className="min-w-0">
                {/* break-words, not just min-w-0 on the parent: min-w-0 lets a
                    flex ITEM shrink below its min-content width, but nothing
                    makes an unbreakable STRING wrap. Lead capture accepts an
                    email address in the name field, and a 48-character token at
                    20px bold overran a 375px screen by 400px — which, inside a
                    panel that is its own horizontal scroller, showed up as "the
                    page doesn't fit and I can't reach the back button". */}
                <h2 className="text-base sm:text-xl font-bold text-gray-100 break-words">{selected.name}</h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {/* This pill used to be inflated to 16px with taller padding
                      to match the status <select> beside it — a form control the
                      iOS zoom floor forces to 16px and which needed a thumb-
                      sized target. That select is gone, so this is a plain,
                      non-interactive <span> at its natural 10px, matching the
                      flow badge next to it. Nothing here is tappable, so no
                      touch target is lost. */}
                  {selected.source && selected.source !== "direct_link" && (
                    <span className="text-[0.625rem] font-semibold px-2 py-0.5 rounded-full bg-blue-950 text-blue-300">
                      {getSourceLabel(selected.source)}
                    </span>
                  )}
                  <FlowBadge sequence={selected.follow_up_sequence} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleRead(selected)}
                /* The label is hidden on phones, and `hidden` is display:none —
                   which removes it from the ACCESSIBILITY tree, not just the
                   layout. Without this the control would be an unlabelled icon
                   to a screen reader, so the name has to live here too. */
                aria-label={isUnread(selected) ? "Mark as read" : "Mark as unread"}
                title={isUnread(selected) ? "Mark as read" : "Mark as unread"}
                className={`ml-auto shrink-0 flex items-center gap-1.5 text-xs font-semibold p-2 sm:px-3 sm:py-1.5 rounded-full border transition-colors ${isUnread(selected) ? "border-blue-700 bg-blue-600/15 text-blue-300 hover:bg-blue-600/25" : "border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"}`}
              >
                {isUnread(selected) ? (
                  <>
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M1.5 8.67v8.58a3 3 0 003 3h15a3 3 0 003-3V8.67l-8.928 5.493a3 3 0 01-3.144 0L1.5 8.67z" /><path d="M22.5 6.908V6.75a3 3 0 00-3-3h-15a3 3 0 00-3 3v.158l9.714 5.978a1.5 1.5 0 001.572 0L22.5 6.908z" /></svg>
                    <span className="hidden sm:inline">Mark as read</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0l-9.75 6.75L2.25 6.75" /></svg>
                    <span className="hidden sm:inline">Mark as unread</span>
                  </>
                )}
              </button>
            </div>

            {/* Quick actions — call the contact, share YOUR info with them, and
                save them to your phone */}
            <div className="flex items-center gap-2 mb-6">
              {selected.phone ? (
                <a
                  href={`tel:${selected.phone}`}
                  className="flex items-center justify-center gap-1.5 flex-1 text-sm font-semibold py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                  </svg>
                  Call
                </a>
              ) : (
                <span className="flex-1 text-center text-xs text-gray-600 py-2.5 rounded-xl border border-dashed border-gray-800">No phone to call</span>
              )}
              {/* Text / email / share sheet hand off to the owner's own phone,
                  pre-addressed to this contact — nothing is sent or logged.
                  "Share by both" is the exception: it sends from SwiftCard's
                  own senders and writes two rows into the thread, so it needs
                  the lead id and a refresh when it lands. */}
              <ShareMyInfoButton
                firstName={(selected.name || "them").split(" ")[0]}
                phone={selected.phone}
                email={selected.email || null}
                cardOwner={selected.card_owner}
                signer={selected.card_owner ? cardSigners[selected.card_owner] ?? null : null}
                leadId={selected.id}
                onSent={refreshActivity}
              />
              <button
                onClick={saveContactToPhone}
                title="Save this contact to your phone"
                className="flex items-center justify-center gap-1.5 flex-1 min-w-0 whitespace-nowrap text-sm font-semibold py-2.5 px-2 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4 shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
                </svg>
                {/* "Save" on a phone (three buttons across is tight); the full
                    label where there's room. */}
                <span className="sm:hidden">Save</span>
                <span className="hidden sm:inline">Save to phone</span>
              </button>
            </div>

            {/* Tab switcher */}
            <div className="flex bg-gray-900 rounded-xl p-1 gap-1 mb-6">
              {([
                { id: "conversation", label: "Conversation" },
                { id: "info", label: "Contact info / Presets" },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setDetailTab(t.id)}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
                  style={{ background: detailTab === t.id ? "#1D4ED8" : "transparent", color: detailTab === t.id ? "#fff" : "#6b7280" }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── CONTACT INFO / PRESETS TAB ── */}
            <div className={detailTab === "info" ? "" : "hidden"}>

            {/* Contact info */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6 space-y-3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[0.6875rem] font-bold text-gray-600 uppercase tracking-widest">Contact Info</p>
                {!editingContact && (
                  <button
                    onClick={() => { setContactDraft({ name: selected.name ?? "", company: selected.company ?? "", email: selected.email ?? "", phone: selected.phone ?? "" }); setContactSaveStatus("idle"); setEditingContact(true); }}
                    className="text-[0.6875rem] text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Edit
                  </button>
                )}
              </div>
              {editingContact && (
                <div className="space-y-2 mb-2">
                  <input type="text" value={contactDraft.name} onChange={(e) => setContactDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" className="w-full bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  <input type="text" value={contactDraft.company} onChange={(e) => setContactDraft((d) => ({ ...d, company: e.target.value }))} placeholder="Company" className="w-full bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  <input type="email" value={contactDraft.email} onChange={(e) => setContactDraft((d) => ({ ...d, email: e.target.value }))} placeholder="Email" className="w-full bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  <input type="tel" value={contactDraft.phone} onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))} placeholder="Phone" className="w-full bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => { setEditingContact(false); setContactSaveStatus("idle"); }}
                      disabled={contactSaveStatus === "saving"}
                      className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200 transition-colors disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveContact}
                      disabled={contactSaveStatus === "saving" || contactSaveStatus === "saved" || !contactDraft.name.trim()}
                      aria-busy={contactSaveStatus === "saving"}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm transition-all active:scale-[0.98] disabled:cursor-not-allowed"
                      style={{
                        background:
                          contactSaveStatus === "saved" ? "#16a34a"
                          : contactSaveStatus === "error" ? "#dc2626"
                          : "#2563eb",
                        opacity: contactSaveStatus === "idle" && !contactDraft.name.trim() ? 0.5 : 1,
                      }}
                    >
                      {contactSaveStatus === "saving" ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Saving…
                        </>
                      ) : contactSaveStatus === "saved" ? (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Saved!
                        </>
                      ) : contactSaveStatus === "error" ? (
                        "Error — try again"
                      ) : (
                        "Save changes"
                      )}
                    </button>
                  </div>
                </div>
              )}
              {selected.company && (
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                    </svg>
                    <span className="min-w-0 break-words text-gray-300 text-sm font-medium">{selected.company}</span>
                  </div>
                  {selected.company_description ? (
                    <p className="text-gray-500 text-xs pl-7 break-words">{selected.company_description}</p>
                  ) : null}
                </div>
              )}
              {selected.email && (
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0l-9.75 6.75L2.25 6.75" />
                  </svg>
                  {/* break-all + min-w-0: an email is one unbreakable token and
                      the icon beside it is shrink-0, so neither the row nor the
                      string could give. break-all rather than break-words
                      because an address has no break opportunity to find. */}
                  <a href={`mailto:${selected.email}`} className="min-w-0 break-all text-blue-400 text-sm hover:underline">{selected.email}</a>
                </div>
              )}
              {selected.phone && (
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                  </svg>
                  <a href={`tel:${selected.phone}`} className="text-gray-300 text-sm hover:text-white flex-1">{selected.phone}</a>
                </div>
              )}
              {selected.location && (
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  <span className="min-w-0 break-words text-gray-400 text-sm">
                    {hasMarkedPlace(selected.location)
                      ? <BlurredPlace text={splitLocationParts(selected.location).map((p) => p.text).join("")} />
                      : locationLabel(selected.location, selected.geo_accuracy as GeoAccuracy | null)}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3 pt-1 border-t border-gray-800">
                <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
                </svg>
                {/* Viewer-TZ text: server SSRs in UTC — suppress the cosmetic mismatch */}
                <span suppressHydrationWarning className="text-gray-500 text-sm">Added {formatDate(selected.created_at)}</span>
              </div>
              {selected.follow_up_date && (
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className={`text-sm font-medium ${selected.follow_up_date.slice(0,10) <= today ? "text-amber-400" : "text-gray-400"}`}>
                    Follow up: <span suppressHydrationWarning>{formatDateOnly(selected.follow_up_date)}</span>
                    {selected.follow_up_date.slice(0,10) <= today && " · overdue"}
                  </span>
                </div>
              )}
            </div>

            {/* Notes & Context */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
              <p className="text-[0.6875rem] font-bold text-gray-600 uppercase tracking-widest">Notes &amp; Context</p>

              {/* Notes */}
              <div className="flex gap-3">
                <svg className="w-4 h-4 text-gray-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
                <div className="flex-1">
                  <p className="text-[0.6875rem] font-semibold text-gray-500 mb-1">Notes</p>
                  {editingNotes ? (
                    <div className="space-y-2">
                      <textarea
                        value={notesText}
                        onChange={(e) => setNotesText(e.target.value)}
                        rows={3}
                        className="w-full bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-500"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setEditingNotes(false)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
                        <button onClick={saveNotes} disabled={notesSaving}
                          className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors disabled:opacity-40">
                          {notesSaving ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <p className="text-gray-400 text-sm whitespace-pre-wrap flex-1">
                        {selected.notes || <span className="text-gray-600 italic">No notes</span>}
                      </p>
                      <button
                        onClick={() => { setNotesText(selected.notes ?? ""); setEditingNotes(true); }}
                        className="text-[0.6875rem] text-gray-600 hover:text-gray-400 transition-colors shrink-0"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Where met */}
              <div className="flex gap-3 pt-3 border-t border-gray-800">
                <svg className="w-4 h-4 text-gray-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-[0.6875rem] font-semibold text-gray-500 mb-1">Where did you meet?</p>
                  {editingWhereMet ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={whereMetText}
                        onChange={(e) => setWhereMetText(e.target.value)}
                        placeholder="e.g. Networking event, LinkedIn, Conference…"
                        className="w-full bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setEditingWhereMet(false)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
                        <button
                          // Close ONLY on success. It used to close regardless,
                          // so a failed save silently discarded what the user
                          // had just typed and reverted to the old value with
                          // no error. saveNotes below always got this right.
                          onClick={async () => { if (await saveField("where_met", whereMetText)) setEditingWhereMet(false); }}
                          disabled={fieldSaving === "where_met"}
                          className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors disabled:opacity-40"
                        >
                          {fieldSaving === "where_met" ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <p className="text-gray-400 text-sm flex-1">
                        {selected.where_met || <span className="text-gray-600 italic">Not set</span>}
                      </p>
                      <button
                        onClick={() => { setWhereMetText(selected.where_met ?? ""); setEditingWhereMet(true); }}
                        className="text-[0.6875rem] text-gray-600 hover:text-gray-400 transition-colors shrink-0"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Follow-up automations — Email and Text are independent, and the two
                channel switches are the ONLY controls: text off stops texts, email
                off stops emails (email-paused / sms-paused — the cron skips a
                paused channel and it resumes when switched back on). Reset clears
                a channel's automation so a fresh one can be submitted, restarting
                from submit time. */}
            <div data-tour="contact-automations" className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-[0.6875rem] font-bold text-gray-600 uppercase tracking-widest">Follow-up Automations</p>
              <p className="text-gray-600 text-xs mt-0.5 mb-3">Set up Email and Text separately — run one or both.</p>

              {/* Deliberately louder than a footnote (owner request): people
                  skipped it and got generic AI messages. Amber + icon reads as
                  "do this before flipping automations on". Pro only: AI never
                  writes a Free account's messages, so on Free this would be
                  a promise the draft below does not keep. */}
              {isPro && <div className="flex items-start gap-2.5 text-xs text-amber-100/90 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3.5 py-3 mb-4 leading-relaxed">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0 mt-0.5 text-amber-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                </svg>
                <span>
                  The AI writes each message from this contact&apos;s <strong className="font-semibold text-amber-200">where you met</strong> and <strong className="font-semibold text-amber-200">notes</strong> — for a great, human response <strong className="font-semibold text-amber-200">make those descriptive</strong>.
                </span>
              </div>}

              <div className="space-y-3">
                {([
                  { ch: "email" as const, label: "Email", can: !!selected.email, word: "email", noun: "emails" },
                  { ch: "sms" as const,   label: "Text",  can: !!selected.phone, word: "text",  noun: "texts" },
                ]).map(({ ch, label, can, word, noun }) => {
                  const activeItems = ((selected.follow_up_sequence ?? []) as { day: number; time?: string; message: string; subject?: string; channel?: string; sent_at?: string | null; anchor?: string; not_sent?: string }[])
                    .filter((i) => (i.channel ?? "email") === ch)
                    .sort((a, b) => a.day - b.day);
                  const isDrafting = draftCh === ch;
                  const hasActive = activeItems.length > 0;
                  const allSent = hasActive && activeItems.every((i) => i.sent_at);
                  const running = hasActive && !allSent;
                  const chPaused = channelPausedFor(ch);
                  const presetName = PRESET_FROM_COUNT(activeItems.length);
                  const switchOn = isDrafting || (running && !chPaused);
                  // TEXT is Pro; EMAIL is every plan (owner, 2026-09-11).
                  //
                  // Pro-only to SET UP — never to stop. A downgraded account
                  // still has to be able to switch a live text flow off (the
                  // cron holds those anyway), and this card is where that
                  // switch lives, so an existing flow is never tagged.
                  const needsPro = !isPro && ch === "sms" && !hasActive;

                  return (
                    <div key={ch} className={`border rounded-xl p-4 ${switchOn ? (ch === "sms" ? "border-emerald-800/50 bg-emerald-950/10" : "border-blue-800/50 bg-blue-950/10") : "border-gray-800 bg-gray-800/20"}`}>
                      {/* Header + on/off toggle */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-100 flex items-center gap-1.5">
                            {label} automation
                            {/* SMALL (owner: "a very small pro badge… I don't
                                want it to be shoved in their face"). Same 8px
                                tag the card finishes use. Only where the thing
                                is actually Pro, and only until they are. */}
                            {needsPro && <span className="text-[0.5rem] font-bold text-blue-400 shrink-0">PRO</span>}
                          </p>
                          <p className="text-gray-600 text-[0.6875rem] mt-0.5">
                            {!can ? `No ${ch === "email" ? "email" : "phone"} on file for this contact`
                              : running && chPaused ? `Off — remaining ${noun} won't send. Switch on to resume.`
                              : running ? `On · ${presetName} · auto-sending ${noun}`
                              : allSent ? `Completed · all ${activeItems.length} ${noun} sent`
                              : isDrafting ? "Choose a cadence, then submit to activate"
                              : needsPro ? `Automatic ${noun} to this contact, on a cadence you pick`
                              : !isPro && ch === "email" && !hasActive ? "Automatic emails to this contact, on a cadence you pick"
                              : `Off — set up a ${word} follow-up`}
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={switchOn}
                          disabled={!can}
                          title={!can ? "No contact info"
                            : running ? (chPaused ? `Resume ${word} automation` : `Turn ${word} automation off`)
                            : `Set up a ${word} follow-up`}
                          onClick={() => {
                            if (!can) return;
                            // A live flow toggles ITS OWN channel off/on; otherwise the
                            // switch opens (or closes) the setup flow.
                            if (running) { toggleChannelPause(ch); return; }
                            // Free account, nothing set up yet: say what it is
                            // once, where they tapped. Nothing pops up
                            // uninvited — the PRO tag is the only standing
                            // mention (owner: don't shove it in their face).
                            if (needsPro) {
                              setAiUpgrade("Text follow-ups are part of Pro. Email follow-ups are included on your plan — set one up on the Email automation above.");
                              return;
                            }
                            if (isDrafting) cancelDraft(); else startDraft(ch);
                          }}
                          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${!can ? "opacity-60 cursor-not-allowed" : ""}`}
                          style={{ background: switchOn ? (ch === "sms" ? "#059669" : "#2563eb") : "#374151" }}
                        >
                          <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: switchOn ? "22px" : "2px" }} />
                        </button>
                      </div>

                      {/* DRAFTING — pick a preset, edit, submit */}
                      {isDrafting && (
                        <div className="mt-3 pt-3 border-t border-gray-800">
                          <div className="space-y-2 mb-3">
                            {(["light", "medium", "aggressive"] as const).map((p) => (
                              <button
                                key={p}
                                onClick={() => selectPreset(p)}
                                disabled={draftLoading}
                                className={`w-full text-left rounded-xl px-3.5 py-2.5 border transition-colors disabled:opacity-60 ${draftPreset === p ? (ch === "sms" ? "border-emerald-500 bg-emerald-950/30" : "border-blue-500 bg-blue-950/30") : "border-gray-700 bg-gray-800/40 hover:border-gray-600"}`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold text-gray-100">{SEQ_PRESETS[p].label}</span>
                                  {draftPreset === p && <span className="text-[0.625rem] text-gray-400 font-semibold">Selected</span>}
                                </div>
                                <p className="text-gray-500 text-[0.6875rem] mt-0.5 leading-relaxed">{SEQ_PRESETS[p].desc}</p>
                              </button>
                            ))}
                          </div>

                          {draftError && !draftLoading && (
                            <p className="text-[0.75rem] text-amber-400 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2 mb-3">⚠ {draftError}</p>
                          )}

                          {draftLoading && (
                            <div className="flex items-center justify-center gap-2 py-3 text-gray-500 text-sm">
                              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                              </svg>
                              Writing your {noun}…
                            </div>
                          )}

                          {!draftLoading && draftItems && draftItems.length > 0 && (
                            <div className="space-y-3">
                              <p className="text-[0.6875rem] text-amber-400">● Draft — edit any message, then Submit to activate.</p>
                              {draftItems.map((it, i) => (
                                <div key={i} className="bg-gray-800 border border-gray-700 rounded-xl p-3">
                                  {/* Native-only "AI draft" tag; renders null (no DOM) on web.
                                      Never shown over starter copy nobody's AI wrote. */}
                                  {draftIsAi && <AiDraftTag />}
                                  <p className="text-[0.6875rem] font-semibold text-gray-400 mb-1.5">{stepLabel(it.day, it.time)}</p>
                                  {ch === "email" && (
                                    <input
                                      type="text"
                                      value={it.subject ?? ""}
                                      onChange={(e) => updateDraftSubject(i, e.target.value)}
                                      placeholder="Email subject"
                                      className="w-full bg-gray-900 border border-gray-700 text-gray-100 rounded-lg px-3 py-1.5 text-xs mb-1.5 focus:outline-none focus:border-blue-500"
                                    />
                                  )}
                                  <textarea
                                    value={it.message}
                                    onChange={(e) => updateDraftItem(i, e.target.value)}
                                    rows={2}
                                    className="w-full bg-gray-900 border border-gray-700 text-gray-100 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-500"
                                  />
                                </div>
                              ))}
                              {/* WHERE TEXT CONSENT LIVES NOW (owner, 2026-09-20).
                                  The share form no longer asks the visitor to
                                  tick a box — sharing details is not
                                  subscribing to texts — so the record is this:
                                  switching a text automation on is the owner
                                  stating they have this person's permission,
                                  and it is the only thing that grants sms-ok.
                                  Said plainly, where the decision is made,
                                  because /sms-consent describes exactly this. */}
                              {ch === "sms" && (
                                <p className="text-[0.6875rem] text-gray-500 leading-snug mb-2.5">
                                  Only switch this on if {(selected?.name || "this contact").trim()} agreed you could text them. They can reply STOP at any time, which stops texts from SwiftCard for good.
                                </p>
                              )}
                              <div className="flex items-center justify-between">
                                {draftIsAi
                                  ? <button onClick={() => draftPreset && selectPreset(draftPreset)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Regenerate ↺</button>
                                  : <span className="text-[0.6875rem] text-gray-500">Edit each message to make it yours</span>}
                                <div className="flex items-center gap-2">
                                  <button onClick={cancelDraft} className="text-xs font-semibold text-gray-400 hover:text-gray-200 px-3 py-2 transition-colors">Cancel</button>
                                  <button
                                    onClick={submitDraft}
                                    disabled={seqSaving === "saving"}
                                    className={`text-xs font-semibold text-white px-5 py-2 rounded-full disabled:opacity-40 transition-colors ${ch === "sms" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-blue-600 hover:bg-blue-500"}`}
                                  >
                                    {seqSaving === "saving" ? "Submitting…" : "Submit & activate"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ACTIVE / PAUSED — submitted summary: preset + messages + when they send */}
                      {!isDrafting && running && (
                        <div className="mt-3 pt-3 border-t border-gray-800">
                          <p className={`text-[0.6875rem] font-semibold mb-2 ${!chPaused ? (ch === "sms" ? "text-emerald-400" : "text-blue-400") : "text-amber-400"}`}>
                            {!chPaused ? `● On — ${presetName}` : `⏸ Off — ${presetName}`} · {activeItems.length} {noun}
                          </p>
                          <div className="space-y-2">
                            {activeItems.map((it, i) => (
                              <div key={i} className="bg-gray-800/60 border border-gray-700/60 rounded-lg px-3 py-2">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span suppressHydrationWarning className="text-[0.625rem] font-semibold text-gray-500">
                                    {it.not_sent
                                      ? `Not sent — ${it.not_sent === "opted_out" ? "they unsubscribed" : ch === "sms" ? "no phone number" : "no email address"}`
                                      : it.sent_at ? `Sent ${formatShort(it.sent_at)}` : `Sends ${sendWhen(it.anchor ?? selected.created_at, it.day)}`}
                                  </span>
                                  {it.not_sent
                                    ? <span className="text-[0.625rem] text-amber-500/90 shrink-0">not sent</span>
                                    : it.sent_at
                                    ? <span className="text-[0.625rem] text-emerald-400 shrink-0">✓</span>
                                    : chPaused
                                    ? <span className="text-[0.625rem] text-amber-500/90 shrink-0">paused</span>
                                    : <span className="text-[0.625rem] text-gray-600 shrink-0">scheduled</span>}
                                </div>
                                {ch === "email" && it.subject && <p className="text-[0.6875rem] text-gray-400 font-medium truncate">Subject: {it.subject}</p>}
                                <p className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">{it.message}</p>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-2">
                            <p className="text-gray-600 text-[0.625rem]">
                              {chPaused
                                ? "Off — nothing sends. Switch on to resume, or reset to start over."
                                : `Switch off above to pause ${ch === "sms" ? "texts" : "emails"} anytime.`}
                            </p>
                            {/* Reset appears ONLY while the channel is switched off/paused —
                                a running automation must be paused before it can be wiped. */}
                            {chPaused && (
                              <button
                                onClick={() => resetChannel(ch)}
                                className="text-[0.6875rem] font-semibold text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 px-2.5 py-1 rounded-full transition-colors shrink-0"
                                title={`Clear this ${word} automation and set up a new one`}
                              >
                                Reset ↺
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* COMPLETED — all sent; reset to run a fresh one */}
                      {!isDrafting && allSent && (
                        <div className="mt-3 pt-3 border-t border-gray-800 flex items-center justify-between gap-3">
                          {(() => {
                            // "All sent" only when all of them WENT.
                            const notSent = activeItems.filter((i) => i.not_sent).length;
                            return notSent
                              ? <p className="text-amber-400 text-xs">Finished — {activeItems.length - notSent} sent, {notSent} not sent.</p>
                              : <p className="text-emerald-400 text-xs">✓ All {activeItems.length} {noun} sent.</p>;
                          })()}
                          <button onClick={() => resetChannel(ch)} disabled={!can} className="text-xs font-semibold text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-full transition-colors disabled:opacity-40">Reset ↺</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {aiUpgrade && (
                <PlanGate
                  feature="ai-sequences"
                  nativeCopy="Pro feature — Text follow-ups are only available on the Pro plan"
                >
                  <div className="border border-blue-800/40 bg-blue-950/40 rounded-xl py-4 px-4 text-center mt-3">
                    <p className="text-blue-200 text-sm">{aiUpgrade}</p>
                    <Link href="/upgrade" className="inline-block mt-2 text-xs font-semibold text-blue-400 hover:text-blue-300">Upgrade to Pro →</Link>
                  </div>
                </PlanGate>
              )}
            </div>

            </div>{/* end Contact info / Presets tab */}

            {/* ── CONVERSATION TAB ── */}
            <div className={detailTab === "conversation" ? "" : "hidden"}>

            {/* Activity & messages — read-only log of what this contact did and what was auto-sent */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[0.6875rem] font-bold text-gray-600 uppercase tracking-widest">Activity &amp; Messages</p>
                <span className="text-[0.625rem] text-gray-600">Auto-tracked · read-only</span>
              </div>

              {loadingEvents ? (
                <p className="text-gray-600 text-sm">Loading activity…</p>
              ) : (() => {
                const fname = selected.name.split(" ")[0] || "They";
                const items: { at: string; key: string; kind: "event" | "in" | "out"; icon?: string; text?: string; source?: string | null; body?: string; channel?: string | null; status?: string | null }[] = [];
                for (const ev of events) {
                  // "clicked_save_contact" always fired alongside "downloaded_vcard"
                  // (same tap) — we stopped emitting it, and we hide the historical
                  // ones so old conversations show one "saved your contact" line too.
                  if (ev.event_type === "clicked_save_contact") continue;
                  // A link the owner sent to this contact, opened on a device
                  // that isn't theirs (forwarded): it says WHO did WHAT — a view,
                  // a tap, a download are different things, not three copies of
                  // "was opened".
                  const phrase = activityPhrase(ev) ?? ev.event_type.replace(/_/g, " ");
                  const text = ev.lead_confidence === "forwarded"
                    ? (ev.event_type === "viewed_card" ? `Your link to ${fname} was opened on another device` : `Someone with your link to ${fname} ${phrase}`)
                    : `${fname} ${phrase}`;
                  items.push({ at: ev.created_at, key: `ev-${ev.id}`, kind: "event", icon: eventLabel(ev).icon, text, source: ev.source });
                }
                // How this contact ARRIVED — only what really happened. It used
                // to say "{name} shared their info with you" on EVERY contact,
                // including ones the owner typed in or scanned, and the sample.
                const isSample = (selected.tags ?? []).includes("demo");
                const addedByOwner = selected.source === "manual";
                items.push(isSample
                  ? { at: selected.created_at, key: "shared", kind: "event", icon: "✦", text: `Sample contact — ${fname} isn't a real person. It's here to show how a shared contact looks.`, source: null }
                  : addedByOwner
                    ? { at: selected.created_at, key: "shared", kind: "event", icon: "+", text: `You added ${fname} to your contacts`, source: null }
                    : { at: selected.created_at, key: "shared", kind: "event", icon: "✓", text: `${fname} shared their info with you`, source: selected.source });
                // The note they typed when they shared — theirs, so it is only
                // shown as coming from them when they did share.
                if (selected.message && !addedByOwner) items.push({ at: selected.created_at, key: "note", kind: "in", body: selected.message });
                for (const m of convoMessages) {
                  items.push(m.direction === "in"
                    ? { at: m.created_at, key: `m-${m.id}`, kind: "in", body: m.body }
                    : { at: m.created_at, key: `m-${m.id}`, kind: "out", body: m.body, channel: m.channel, status: m.status });
                }
                items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
                return (
                  <div className="space-y-3">
                    {items.map((it) => {
                      if (it.kind === "out") {
                        const isSms = it.channel === "sms";
                        return (
                          <div key={it.key} className="flex flex-col items-end">
                            {/* text-[0.8125rem], same as the event lines — the feed
                                used to mix 14px bubbles with 13px events and
                                the whole card read oversized on a phone
                                (owner call 2026-08-11: uniform sizes). */}
                            <div className={`max-w-[85%] text-white rounded-2xl rounded-br-md px-3.5 py-2.5 text-[0.8125rem] whitespace-pre-wrap break-words leading-relaxed ${isSms ? "bg-emerald-600" : "bg-blue-600"}`}>
                              {it.body}
                            </div>
                            <span className="text-gray-600 text-[0.625rem] mt-1 pr-1 flex items-center gap-1.5">
                              <span className={`px-1.5 py-px rounded font-semibold ${isSms ? "bg-emerald-900/50 text-emerald-300" : "bg-blue-900/50 text-blue-300"}`}>
                                {isSms ? "Text" : "Email"}
                              </span>
                              {/* Twilio's own delivery status wins over our
                                  optimistic "sent". Accepting a text is not
                                  delivering it: a carrier can drop it later
                                  (e.g. unregistered A2P 10DLC), and the status
                                  callback rewrites this row. Never tell someone
                                  a message arrived when the carrier said it
                                  didn't. */}
                              <span suppressHydrationWarning className={outDeliveryLabel(it.status).tone}>
                                {outDeliveryLabel(it.status).text} · {formatShort(it.at)}
                              </span>
                            </span>
                          </div>
                        );
                      }
                      if (it.kind === "in") {
                        return (
                          <div key={it.key} className="flex flex-col items-start">
                            {/* whitespace-pre-wrap wraps at spaces only, so a
                                long URL — which auto-sent follow-ups and inbound
                                replies both routinely contain — blows past
                                max-w-[85%]. break-words is what actually holds
                                the bubble to its width. */}
                            <div className="max-w-[85%] bg-gray-800 text-gray-200 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[0.8125rem] whitespace-pre-wrap break-words leading-relaxed">
                              {it.body}
                            </div>
                            <span suppressHydrationWarning className="text-gray-600 text-[0.625rem] mt-1 pl-1">{formatShort(it.at)}</span>
                          </div>
                        );
                      }
                      return (
                        // Two lines, not one: this row used to hold the icon,
                        // the sentence, the "via …" tag AND the timestamp on a
                        // single line, so on a 375px phone the sentence was
                        // squeezed into a skinny column and wrapped word by
                        // word — the owner read it as "words on top of each
                        // other". The sentence now owns the full width beside
                        // the icon (the "via" tag riding inline where it can
                        // wrap naturally), and the timestamp sits underneath
                        // at the same 10px every bubble's timestamp uses.
                        <div key={it.key} className="flex items-start gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs shrink-0">{it.icon}</div>
                          <div className="min-w-0 flex-1">
                            {/* break-words stays: an email-shaped contact name
                                is one unbreakable token, and nothing else
                                makes a spaceless string wrap. */}
                            <p className="text-gray-300 text-[0.8125rem] leading-snug break-words">
                              {it.text}
                              {it.source && it.source !== "direct_link" && (
                                <span className="text-[0.625rem] text-blue-400 whitespace-nowrap"> · via {getSourceLabel(it.source)}</span>
                              )}
                            </p>
                            <p suppressHydrationWarning className="text-gray-600 text-[0.625rem] mt-0.5">{formatShort(it.at)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

            </div>

            </div>{/* end Conversation tab */}

            {/* Delete contact */}
            <div className="mt-6 pt-4 border-t border-gray-800">
              {confirmDeleteId === selected.id ? (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-gray-400 flex-1">Delete this contact permanently?</p>
                  <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
                  <button
                    onClick={() => deleteLead(selected.id)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-900/60 text-red-300 hover:bg-red-900 border border-red-800/60 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(selected.id)}
                  className="text-xs text-red-500/70 hover:text-red-400 transition-colors"
                >
                  Delete contact
                </button>
              )}
            </div>
          </div>
          </>
        )}
      </div>

      {/* Sits above the bottom tab bar (z-40) and the detail overlay (z-40). */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+7rem)] md:bottom-6 z-50 mx-auto max-w-sm rounded-xl border border-red-900/60 bg-gray-900 px-4 py-3 shadow-xl flex items-start gap-3"
        >
          <span className="text-sm text-red-300 flex-1 min-w-0 break-words">{notice}</span>
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="text-gray-500 hover:text-gray-300 shrink-0"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
