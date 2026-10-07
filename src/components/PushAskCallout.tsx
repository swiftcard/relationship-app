"use client";

import { useEffect } from "react";
import EnablePushButton, { usePushState } from "@/components/EnablePushButton";
import AppStoreBadge from "@/components/AppStoreBadge";
import { APP_STORE_URL } from "@/lib/app-store";
import { detectNativeApp, detectNativePlatform } from "@/lib/platform";
import { pushAskCopy, type AskDevice } from "@/lib/push-ask";
import {
  askDecision, askEnabledFor, askPushOn, askSnoozed, askStopped, claimAsk, confirmEnabledFromAsk, laterAsk, stopAsk,
  useAskSlot, useAskStore, type AskSurface,
} from "@/lib/push-ask-client";

// ── "Get notifications like this on your phone" ─────────────────────────────
//
// The reminder under ONE important notification — a new contact, a reply, a
// contact download — for someone who could have it on their phone and hasn't.
// Every rule about when (a couple of times, days apart, the app's reminders
// kept apart from the website's, never once they said no) is in
// lib/push-ask.ts and applied by /api/push/ask; which surface may show it
// (never two at once) is lib/push-ask-client.ts.
//
// WHAT IT OFFERS depends on the device, because the right answer does:
//   • the iPhone app, an Android phone, a computer — the push switch itself,
//     one tap, right here ("switch");
//   • an iPhone browser tab — no switch can work there: web push on iPhone
//     needs "Add to Home Screen" first. The app is the real answer (and most
//     people already have it), so it points there ("app");
//   • the iPhone app after a "Don't Allow" — iOS asks once per install and
//     never again, so the switch cannot help; the one road back is the
//     Settings app, and the reminder carries that button ("settings"). Owner,
//     2026-09-23: a new contact is still the moment to ask, and this is the
//     ask that can actually work there. Same budget, same "Not now" and
//     "Don't ask again". A browser that blocked notifications has no such
//     button, so the web keeps to Settings' written guidance.

export type PushAsk = { show: boolean; confirming: boolean; id: string | null; mode: "switch" | "app" | "settings" };

/**
 * Whether the reminder shows on `candidateId` in `surface`.
 *
 * `visible` is whether the surface is actually on screen — the bell passes
 * whether its dropdown is open, because a reminder is counted when it is SHOWN
 * and a closed dropdown shows nothing.
 */
export function usePushAsk(surface: AskSurface, candidateId: string | null, visible: boolean): PushAsk {
  // Blocked by the OS, a browser with no push at all, an app build without the
  // plugin, or push already on: nothing here can help, and Settings carries the
  // right words for each.
  const [state] = usePushState();
  useAskStore();

  // "denied" is only reachable after usePushState's effect has run, so the
  // native check behind it never runs on the server or the hydrating paint.
  const deniedInApp = state === "denied" && detectNativeApp();
  const mode: PushAsk["mode"] = state === "ios-install" ? "app" : deniedInApp ? "settings" : "switch";
  const deviceCanAct = state === "idle" || (state === "ios-install" && !!APP_STORE_URL) || deniedInApp;
  const confirming = !!candidateId && askEnabledFor() === candidateId;
  const decision = candidateId ? askDecision(candidateId) : undefined;
  const askable = deviceCanAct && !askStopped() && !askPushOn() && !askSnoozed() && decision !== false;
  const mine = useAskSlot(surface, visible && !!candidateId && (confirming || askable));

  useEffect(() => {
    if (mine && candidateId && !confirming) void claimAsk(candidateId);
  }, [mine, candidateId, confirming]);

  return {
    show: mine && !!candidateId && (confirming || (askable && decision === true)),
    confirming,
    id: candidateId,
    mode,
  };
}

export default function PushAskCallout({ ask }: { ask: PushAsk }) {
  if (!ask.show || !ask.id) return null;
  const id = ask.id;
  // Only ever rendered on the client (it needs the device's push state), so
  // reading the device here cannot disagree with the server's HTML.
  const device: AskDevice = ask.mode === "app"
    ? "iphone-browser"
    : detectNativeApp() || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? "phone" : "computer";
  const copy = pushAskCopy(device, { denied: ask.mode === "settings", android: detectNativePlatform() === "android" });

  return (
    // Inset to the text column of the row above it (dot + gap), same colour as
    // an unread row, so it reads as part of that notification.
    <div role="group" aria-label="Turn on push notifications" data-push-ask={ask.mode} className="bg-blue-950 pl-9 pr-4 pt-1 pb-3.5">
      {ask.confirming ? (
        <p className="text-xs font-semibold text-emerald-400" role="status">
          You&apos;re set — notifications like this will reach your {device === "computer" ? "computer" : "phone"} now.
        </p>
      ) : (
        <>
          <p className="text-white text-xs font-semibold">{copy.title}</p>
          <p className="text-gray-400 text-[0.6875rem] mt-0.5 leading-relaxed">{copy.sub}</p>
          <div className="mt-2.5">
            {ask.mode === "app" ? (
              // Going to the App Store IS the answer — this reminder is done.
              <AppStoreBadge onClick={() => laterAsk(id)} />
            ) : (
              // The switch, or — after a "Don't Allow" — just the Open iPhone
              // Settings button (compact). Either way EnablePushButton reports
              // the moment push is on, and this reminder says "You're set".
              <EnablePushButton compact={ask.mode === "settings"} onDone={() => confirmEnabledFromAsk(id)} />
            )}
          </div>
          <div className="mt-2 flex items-center gap-4">
            <button type="button" onClick={() => laterAsk(id)} className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors">
              Not now
            </button>
            <button type="button" onClick={stopAsk} className="text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors">
              Don&apos;t ask again
            </button>
          </div>
        </>
      )}
    </div>
  );
}
