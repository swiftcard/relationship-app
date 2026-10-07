// ── Asking again, at the one moment it is obviously worth it ─────────────────
//
// Owner, 2026-09-18: most people skip the notifications switch when they
// create their card. When something important then arrives — "Shantal shared
// her contact information with you" — the bell should say, right there, "turn
// on push notifications to get these on your phone". But "not on all their
// notifications, because it's going to be too spammy. After reminding them a
// few times, if they really don't want push notifications on, they don't want
// it on."
//
// So the rules, all of them here, pure, and applied by the server:
//
//   • ONLY the notifications worth a buzz: someone shared their details, a
//     contact replied, someone downloaded your contact card. Never a view —
//     the dashboard box already asks about views ("Your card is getting
//     opened"), and asking twice about the same thing is the spam.
//   • ONE ROW AT A TIME: the newest unread one of those, nothing else.
//   • THE APP IS THE POINT (owner, same day: "I'm talking about mainly for
//     the app. Most people will have the app downloaded."). The app and the
//     website each get their OWN reminders, so a "Not now" given on a laptop
//     never spends the ask that matters — the one on the phone:
//       app — asks until the PHONE receives pushes. Web push reaching a laptop
//             does not count: that is not the phone in their pocket.
//       web — asks only while NO device of theirs receives pushes; once the
//             app does, a computer has nothing to add and stays quiet. An
//             iPhone browser tab cannot get web push without "Add to Home
//             Screen", so there the reminder points to the app instead.
//   • EACH gets at most PUSH_ASK_MAX reminders, PUSH_ASK_GAP_MS apart.
//   • NEVER AGAIN, anywhere, once they chose "Don't ask again" or switched
//     push OFF themselves — "if they really don't want push notifications on,
//     they don't want it on." A "Don't Allow" at the phone's own prompt is
//     NOT that (owner, 2026-09-23): iOS asks once per install, often in the
//     middle of building a card, so the reminder still comes — with the
//     Settings button that is the only road back (PushAskCallout "settings").
//
// The ledger lives on profiles.customization._pushAsk, written through
// mutateCustomization (read-back verified), next to — not inside — _push, whose
// shape the send path parses. Which side a request is on is decided by the
// SERVER (lib/shell-request), never by what the page says about itself.

export const PUSH_ASK_KEY = "_pushAsk";

/** The notification types that may carry the ask. */
export const PUSH_ASK_TYPES = ["new_lead", "lead_reply", "contact_saved"] as const;

/** Reminders per side (app / website), ever. */
export const PUSH_ASK_MAX = 2;

/** Minimum time between two reminders on the same side. */
export const PUSH_ASK_GAP_MS = 3 * 24 * 60 * 60 * 1000;

/** An old unread notification is not "what just happened" — no ask on it. */
export const PUSH_ASK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Where the question is being asked. */
export type AskPlatform = "app" | "web";

export type AskTrack = {
  /** Reminders shown so far on this side. */
  n: number;
  /** When the latest one was first shown (ISO). */
  at: string | null;
  /** The notification it is attached to. */
  id: string | null;
  /** "Not now" was tapped on that one. */
  later: boolean;
};

export type PushAskLedger = {
  app: AskTrack;
  web: AskTrack;
  /** Never ask again — anywhere. */
  stop: boolean;
};

const EMPTY_TRACK: AskTrack = { n: 0, at: null, id: null, later: false };

function readTrack(raw: unknown): AskTrack {
  if (!raw || typeof raw !== "object") return { ...EMPTY_TRACK };
  const r = raw as Record<string, unknown>;
  return {
    n: typeof r.n === "number" && Number.isFinite(r.n) && r.n > 0 ? Math.floor(r.n) : 0,
    at: typeof r.at === "string" ? r.at : null,
    id: typeof r.id === "string" ? r.id : null,
    later: r.later === true,
  };
}

/** Normalise whatever is stored (or nothing) into a ledger. */
export function readPushAsk(raw: unknown): PushAskLedger {
  if (!raw || typeof raw !== "object") return { app: { ...EMPTY_TRACK }, web: { ...EMPTY_TRACK }, stop: false };
  const r = raw as Record<string, unknown>;
  // The first release (live for an hour) kept ONE flat track. Whatever it
  // recorded is kept as the website's, which is the conservative reading: it
  // can only make the website ask less, never make the app ask more.
  const flat = "n" in r || "id" in r || "at" in r;
  return {
    app: readTrack(r.app),
    web: flat ? readTrack(r) : readTrack(r.web),
    stop: r.stop === true,
  };
}

export function isAskableType(type: string | null | undefined): boolean {
  return (PUSH_ASK_TYPES as readonly string[]).includes(type ?? "");
}

export type AskCandidateRow = { id: string; type: string; read: boolean; created_at: string };

/**
 * Which row, if any, may carry the ask: the NEWEST unread notification of an
 * askable type that is still recent. Everything else carries nothing.
 */
export function pickAskCandidate(rows: AskCandidateRow[], now: number = Date.now()): string | null {
  let best: AskCandidateRow | null = null;
  for (const r of rows) {
    if (r.read || !isAskableType(r.type)) continue;
    const at = Date.parse(r.created_at);
    if (!Number.isFinite(at) || now - at > PUSH_ASK_MAX_AGE_MS) continue;
    if (!best || at > Date.parse(best.created_at)) best = r;
  }
  return best?.id ?? null;
}

const withTrack = (l: PushAskLedger, platform: AskPlatform, track: AskTrack): PushAskLedger =>
  ({ ...l, [platform]: track });

/**
 * May the ask be shown on notification `id` on this side right now — and what
 * does the ledger become?
 *
 * The same notification keeps its ask (it is one reminder however often the
 * bell is opened) until "Not now". A DIFFERENT notification is a new reminder,
 * and only if this side's budget and gap allow one. `next` is null when
 * nothing needs writing.
 */
export function decidePushAsk(
  ledger: PushAskLedger,
  platform: AskPlatform,
  id: string,
  now: number = Date.now(),
): { show: boolean; next: PushAskLedger | null } {
  if (ledger.stop) return { show: false, next: null };
  const t = ledger[platform];
  if (t.id === id) return { show: !t.later, next: null };
  if (t.n >= PUSH_ASK_MAX) return { show: false, next: null };
  if (t.at) {
    const last = Date.parse(t.at);
    if (Number.isFinite(last) && now - last < PUSH_ASK_GAP_MS) return { show: false, next: null };
  }
  return {
    show: true,
    next: withTrack(ledger, platform, { n: t.n + 1, at: new Date(now).toISOString(), id, later: false }),
  };
}

/** "Not now" on the reminder that is showing on this side. Only that one — never a stale id. */
export function laterPushAsk(ledger: PushAskLedger, platform: AskPlatform, id: string): PushAskLedger | null {
  const t = ledger[platform];
  if (t.id !== id || t.later) return null;
  return withTrack(ledger, platform, { ...t, later: true });
}

/**
 * "Not now" on the DASHBOARD BOX. It is the same question, so it starts the
 * same quiet period on this side — no reminder under a notification for
 * PUSH_ASK_GAP_MS — and retires any reminder still pending. Without this, "Not
 * now" on the box and opening the bell a second later was two asks in a row.
 */
export function snoozePushAsk(ledger: PushAskLedger, platform: AskPlatform, now: number = Date.now()): PushAskLedger | null {
  if (ledger.stop) return null;
  return withTrack(ledger, platform, { ...ledger[platform], at: new Date(now).toISOString(), later: true });
}

/** Until when nothing on this side may ask (box or reminder). */
export function pushAskQuietUntil(ledger: PushAskLedger, platform: AskPlatform): number | null {
  const at = ledger[platform].at;
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? t + PUSH_ASK_GAP_MS : null;
}

/** Never ask again, anywhere. */
export function stopPushAsk(ledger: PushAskLedger): PushAskLedger | null {
  return ledger.stop ? null : { ...ledger, stop: true };
}

/**
 * Does this account already get what this side would ask for?
 *   app — a phone registered through the app (an "apns:" endpoint on iOS,
 *         "fcm:" on Android);
 *   web — ANY device at all.
 */
export function pushAlreadyOn(endpoints: string[], platform: AskPlatform): boolean {
  return platform === "app"
    ? endpoints.some((e) => e.startsWith("apns:") || e.startsWith("fcm:"))
    : endpoints.length > 0;
}

/** Which device the reminder is on — it decides both the words and the button. */
export type AskDevice = "phone" | "computer" | "iphone-browser";

/**
 * The ask's words, for the device it is on.
 *
 * `denied`: the phone said "Don't Allow" once (iOS asks once per install and
 * never again), so the only road back is the Settings app. Owner, 2026-09-23:
 * still remind them — at the same moment, within the same budget — but with
 * the button that actually works there. Never a price, never "Pro".
 */
export function pushAskCopy(device: AskDevice, opts: { denied?: boolean; android?: boolean } = {}): { title: string; sub: string } {
  if (opts.denied) {
    return {
      title: "Notifications are off for SwiftCard",
      // Android is not an iPhone (2026-10-06 notification audit).
      sub: opts.android
        ? "Turn them on in Settings → Apps → SwiftCard so the next contact reaches your phone."
        : "Turn them on in iPhone Settings so the next contact reaches your phone.",
    };
  }
  if (device === "iphone-browser") {
    // An iPhone browser tab cannot receive web push without "Add to Home
    // Screen". The app is the real answer — and most people already have it,
    // so the words cover both: open it, or get it.
    return {
      title: "Get notifications like this on your phone",
      sub: "On iPhone they come through the SwiftCard app. Open it and allow notifications, or download it here.",
    };
  }
  return {
    title: device === "phone" ? "Get notifications like this on your phone" : "Get notifications like this on this computer",
    sub: "So you're alerted right away, even when SwiftCard is closed.",
  };
}
