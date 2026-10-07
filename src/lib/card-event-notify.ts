import { sourcePhrase } from "@/lib/source-labels";
import { locationPhrase } from "@/lib/location-display";
import type { GeoAccuracy } from "@/lib/request-geo";
import { ordinal } from "@/lib/contact-return-notify";
import { markName } from "@/lib/contact-privacy";

// What the owner is told when someone touches their card.
//
// Pure, and separate from the ingest route, because this is the part with
// actual rules in it — which events are worth a notification, what each one is
// called, and how it reads when we don't know who the person is. The route
// around it is plumbing.

export type CardEventNotice = { type: string; title: string; body: string };

/**
 * How far back "3rd visit this week" looks. A LOOKBACK for a headline — not a
 * dedupe window; visit dedupe is VIEW_VISIT_WINDOW_MS (lib/view-window.ts).
 */
export const REPEAT_VISIT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The notification for one card event, or null when the event isn't news.
 *
 * `viewed_card` and `downloaded_vcard` are the two an owner cares about. Views
 * used to be excluded entirely — "not every view" — which is defensible for
 * anonymous traffic and wrong for the case that actually matters: you send
 * your card to someone and want to know they opened it.
 */
export function cardEventNotice(input: {
  eventType: string;
  visitorName?: string | null;
  source?: string | null;
  // Which page was opened — the links page now forwards real ?source=
  // attribution (a QR scan is a QR scan on either surface), so the surface is
  // its own signal rather than being inferred from source === "swift_links".
  surface?: "card" | "links" | null;
  // The event's own stored location — never re-derived, never another
  // visitor's. Absent means absent: the copy simply omits it, no guessing.
  location?: string | null;
  /**
   * How much of that location is real (lib/request-geo.ts). Omitted for events
   * written before the column existed, where the wording stays exactly as it
   * was — no retro-claiming a confidence nobody recorded.
   */
  geoAccuracy?: GeoAccuracy | null;
  /**
   * This is the first view this card has EVER had.
   *
   * Changes the headline only. Every view now notifies (see the events route),
   * which is right — but it makes the first one indistinguishable from the
   * four-hundredth, and the first one is not just another view: it is the
   * moment the thing the person built starts working. Naming it costs nothing
   * and is the single most encouraging true sentence we can put on a screen.
   */
  firstEver?: boolean;
  /**
   * Is the NAME proof, or a memory?
   *
   * A signed-in viewer is proof. A name that came from the visitor's own
   * earlier share is an association: it lives in a device-global store, so on a
   * shared iPad, a kiosk or a demo phone the next person's view arrives under
   * the last person's name. The route already records that difference as
   * `identityLevel` and used to show it as certainty either way (owner report,
   * 2026-09-18) — an identification we cannot stand behind.
   */
  nameConfirmed?: boolean;
  /**
   * How many separate visits this same browser has made to this page in the
   * last 7 days, this one included. Someone who keeps coming back is the most
   * interesting person an owner does NOT yet know (owner, 2026-09-22: make the
   * notifications something people want to open). 2+ retitles the view as
   * "3rd visit this week 👀"; the body is unchanged, so the lock screen keeps
   * the where. Every plan — it is a fact about the visit, not a Pro detail.
   */
  repeatVisits?: number;
  /**
   * The name belongs to a contact LOCKED behind the Free cap. The Contacts
   * page does not list them, so this sentence must not name them either: the
   * name is wrapped in the NAME mark (lib/contact-privacy.ts) — blocks in a
   * Free bell, "A contact" on the lock screen, the name again after an
   * upgrade. Unhedged on purpose: "Looks like a contact" is not a sentence.
   * (2026-10-06 notification audit: this path printed the locked name.)
   */
  nameLocked?: boolean;
}): CardEventNotice | null {
  const { eventType } = input;
  const name = (input.visitorName ?? "").trim();
  // Hedged when the name is only an association, so the sentence claims exactly
  // what is known. "Someone" remains the wording when there is no name at all.
  const who = !name ? "Someone"
    : input.nameLocked ? markName(name)
    : input.nameConfirmed ? name : `Looks like ${name}`;
  const source = input.source ?? null;
  // Coarse context makes the notification concrete ("near the conference you're
  // at") — but only at the precision actually held. "near New York, US" was
  // being sent for a STATE-level answer, which reads as New York City; at that
  // confidence this now says "in the New York area" instead. See
  // lib/location-display.ts for the full ladder.
  // MARKED. The place a view came from is a Pro feature (the Locations tab is
  // gated, and a Free account's lead rows carry no location), and this sentence
  // was handing it over several times a day. The marks are invisible; they let
  // the row a Free account is sent have the place blocked out server-side, and
  // let the push — which cannot blur anything — drop the fragment whole.
  // lib/location-privacy.ts is the whole story.
  const near = locationPhrase(input.location, input.geoAccuracy, { mark: true });

  if (eventType === "viewed_card") {
    // Swift Links and the card are different surfaces and an owner shares them
    // for different reasons, so the notification says which one was opened.
    // source === "swift_links" kept for events from clients that predate the
    // explicit surface field.
    const isLinks = input.surface === "links" || source === "swift_links";
    const surfaceLabel = isLinks ? "your Swift Links" : "your card";
    // Both fit the 40-character lock-screen title budget (push-policy.ts), so
    // neither gets trimmed mid-word.
    const firstTitle = isLinks ? "Your Swift Links' first view!" : "Your card's first view!";
    return {
      type: "card_viewed",
      title: input.firstEver ? firstTitle
        : (input.repeatVisits ?? 0) >= 2
          ? `${ordinal(input.repeatVisits!)} visit this week 👀`
          : isLinks ? "Swift Links viewed" : "Card viewed",
      // "Someone" when we genuinely don't know. A visitor is only named once
      // they have shared their details, so this never guesses at an identity.
      body: `${who} viewed ${surfaceLabel}${near}.`,
    };
  }

  if (eventType === "downloaded_vcard") {
    // The source is worth naming on a save (it tells the owner which QR, link
    // or NFC tag is working) but not on a view, where it is just noise on the
    // most frequent notification they get.
    // "from a QR code", not "from QR code scan" (lib/source-labels sourcePhrase).
    const from = sourcePhrase(source);
    return {
      // The TYPE stays "contact_saved": it is the VISIT_RANK key, the push
      // category lookup and the CRM event name, and renaming it would be a
      // breaking change across five consumers for no gain.
      type: "contact_saved",
      // THE WORDING, THOUGH, WAS A CLAIM WE CANNOT MAKE. What actually happened
      // is that we built the .vcf and handed it to the device — the browser
      // download, or the OS "Add to Contacts" sheet. Whether the person then
      // tapped Add, edited it, or cancelled happens in an operating-system
      // surface no web or native API reports back. "Contact saved" told the
      // owner a stranger is now in that person's address book, which we do not
      // know. A download we DO know, so that is what it says.
      title: "Contact downloaded",
      body: `${who} downloaded your contact card${from}${near}.`,
    };
  }

  return null;
}
