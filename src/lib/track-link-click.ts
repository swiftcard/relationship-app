import { getVisitorId } from "@/lib/visitor";
import { enqueue } from "@/lib/offline-outbox";

// ── Which link did they actually press? ──────────────────────────────────────
//
// Swift Links buttons, a card's external links and the social icon row had NO
// tracking of any kind. The only thing a tap did was raise the signup nudge. So
// an owner could see that their Swift Links page was opened eleven times and
// never learn which of eight buttons anyone pressed — which is the single
// question that page exists to answer.
//
// WHY NOT A REDIRECT. The obvious design is to rewrite every href to
// /l/<token> and count the hop. It was rejected, and the reasons are worth
// keeping:
//
//   • Every rendered public URL would change. A visitor long-pressing a link,
//     copying its address, or reading the status bar would see swiftcard.me
//     instead of where they are going — on a page whose entire job is trust.
//   • Every customer's links would then depend on OUR uptime. A link that
//     worked for a year should not be able to break because an analytics
//     service is down.
//   • It is a new open-redirect surface to get right forever.
//   • It buys nothing here. Every one of these anchors is target="_blank", so
//     the page is NOT unloading and an ordinary request completes normally. The
//     one path that does navigate in place (SocialIcons' app-scheme handoff) is
//     covered by sendBeacon, which exists precisely to survive unload.
//
// So: the anchors keep their real destinations, untouched, and the event goes to
// the SAME canonical ingest route as views and downloads — one pipeline, one
// bot gate, one dedup window, one visit key. There is no second analytics path.
//
// THIS CAN NEVER DELAY OR BLOCK THE NAVIGATION. It is called from an onClick
// that does not preventDefault, it awaits nothing, and it swallows everything.

/**
 * The destination HOST, which is what identifies a link to its owner
 * ("calendly.com", "instagram.com").
 *
 * Never the full URL: that is where tracking parameters, tokens and campaign
 * ids live, and none of that belongs in an analytics row. Returns null for
 * anything unparseable or non-http — a mailto: or tel: tap is a contact action,
 * not a link click, and inventing a host for it would be worse than no row.
 */
export function linkTarget(url: string): string | null {
  const raw = (url || "").trim();
  // ABSOLUTE ONLY, with no base URL. Resolving against window.location would
  // turn a malformed or relative value ("not a url", "#", "/about") into OUR
  // hostname — so a broken link would be recorded as a tap on swiftcard.me,
  // which is worse than recording nothing. Every tracked anchor already carries
  // an absolute href (fullHref in lib/link-brand normalises owner input to
  // https://), so nothing legitimate is lost.
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const u = new URL(raw);
    return u.hostname.replace(/^www\./, "").toLowerCase().slice(0, 120) || null;
  } catch {
    return null;
  }
}

/**
 * Record one outbound link tap. Fire-and-forget, never awaited, never throws.
 *
 * `username` is the CARD slug the link belongs to; `surface` says which page it
 * was pressed on, so a tap on the card and a tap on the Swift Links page are
 * two events rather than one swallowing the other.
 */
export function trackLinkClick(opts: {
  username: string | null | undefined;
  surface: "card" | "links";
  url: string;
  source: string;
  /** The link's own name as the owner wrote it ("Listings", "Book a call").
   *  The host alone can't tell two zillow.com links apart, and "tapped your
   *  Listings link" is what the owner actually wants to read. */
  label?: string | null;
  /** True when the OWNER is looking at their own page — record nothing. */
  suppress?: boolean;
}): void {
  if (opts.suppress) return;
  const username = (opts.username ?? "").trim();
  const target = linkTarget(opts.url);
  if (!username || !target) return;
  if (typeof window === "undefined") return;

  const payload = JSON.stringify({
    card_owner_username: username,
    visitor_id: getVisitorId(),
    event_type: "clicked_link",
    surface: opts.surface,
    target,
    ...(opts.label?.trim() ? { target_label: opts.label.trim().slice(0, 60) } : {}),
    source: opts.source,
  });

  // No signal: a beacon would be accepted and then silently lost. Keep it on
  // this phone and send it later (lib/offline-outbox.ts).
  if (navigator.onLine === false && enqueue("/api/card-events", payload)) return;

  try {
    // sendBeacon is the right tool: the browser takes ownership of the request,
    // so it completes even if this document goes away mid-flight (the
    // app-scheme handoff in SocialIcons replaces the page). keepalive fetch is
    // the fallback where sendBeacon is unavailable or refuses the payload.
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/card-events", blob)) return;
  } catch {
    /* fall through */
  }
  try {
    void fetch("/api/card-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* a link tap must never fail because of a statistic */
  }
}
