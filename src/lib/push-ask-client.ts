import { useEffect, useSyncExternalStore } from "react";

// ── One "turn on notifications" ask on screen at a time ──────────────────────
//
// Two things on the dashboard can ask: the box at the top (PushNudge) and the
// reminder under a row inside the bell's dropdown. They can both be on screen
// at once — the bell opens over the page — and two copies of one question is
// exactly the spam the owner ruled out. So each surface says whether it WANTS
// to ask, and the one with the highest rank gets to:
//
//   nudge (the box) > bell
//
// The box outranks the reminder because it is already there, already asking;
// a reminder appearing beside it would be the second ask, not the first. (The
// dashboard's notifications list was a third surface until it went with Quick
// Contacts, 2026-09-29.)
//
// It also remembers, for this app session, what the server decided per
// notification and whether the person just said "Don't ask again" or turned
// push on — so a decision taken once is honoured a second later without
// another round trip. The server (/api/push/ask) stays the authority across
// devices and sessions.
//
// A module, not React context: the bell lives in the page header and the box
// in the page body.

export type AskSurface = "nudge" | "bell";
const RANK: Record<AskSurface, number> = { nudge: 3, bell: 1 };

const wanting = new Set<AskSurface>();
const decisions = new Map<string, boolean>();
const inflight = new Set<string>();
let stopped = false;
let pushOn = false;
/** "Not now" on the dashboard box this session — no reminder follows it. */
let snoozed = false;
/** The notification whose reminder just turned push on — kept briefly for its "You're set". */
let enabledFor: string | null = null;

let version = 0;
const listeners = new Set<() => void>();
function emit() {
  version++;
  for (const l of [...listeners]) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
const getVersion = () => version;

/** Re-render the caller whenever anything here changes. */
export function useAskStore(): void {
  useSyncExternalStore(subscribe, getVersion, () => 0);
}

export function askHolder(): AskSurface | null {
  let best: AskSurface | null = null;
  for (const w of wanting) if (!best || RANK[w] > RANK[best]) best = w;
  return best;
}

function setWanting(who: AskSurface, wants: boolean) {
  if (wanting.has(who) === wants) return;
  if (wants) wanting.add(who); else wanting.delete(who);
  emit();
}

/** Declare whether `who` wants to ask; true when it is the one that may. */
export function useAskSlot(who: AskSurface, wants: boolean): boolean {
  useAskStore();
  useEffect(() => {
    setWanting(who, wants);
    return () => setWanting(who, false);
  }, [who, wants]);
  return wants && askHolder() === who;
}

export const askStopped = () => stopped;
export const askSnoozed = () => snoozed;
export const askPushOn = () => pushOn;
export const askEnabledFor = () => enabledFor;
/** undefined = not asked yet this session. */
export const askDecision = (id: string): boolean | undefined => decisions.get(id);

/** Ask the server whether the reminder may show on `id` (once per id per session). */
export async function claimAsk(id: string): Promise<void> {
  if (decisions.has(id) || inflight.has(id)) return;
  inflight.add(id);
  let show = false;
  try {
    const res = await fetch("/api/push/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) show = ((await res.json()) as { show?: unknown }).show === true;
  } catch { /* offline: no ask, and nothing counted */ }
  inflight.delete(id);
  decisions.set(id, show);
  emit();
}

function post(body: Record<string, unknown>) {
  fetch("/api/push/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => { /* the server keeps its limit regardless */ });
}

/** "Not now" — this reminder is done. */
export function laterAsk(id: string): void {
  decisions.set(id, false);
  emit();
  post({ action: "later", id });
}

/** "Not now" on the dashboard box: the same question, so the reminders rest too. */
export function snoozeAsk(): void {
  snoozed = true;
  emit();
  post({ action: "snooze" });
}

/**
 * Never again: "Don't ask again", or switching push off on purpose (a "Don't
 * Allow" at the phone's prompt is not this — see lib/push-ask.ts). Everything
 * on screen retires at once from
 * the flag here; every later session, on every device, retires from the
 * server's record (GET /api/push/ask). Deliberately NOT written to the box's
 * device-wide localStorage key: that key outlives an account switch, and one
 * person's "no" must not silence the next person on a shared phone.
 */
export function stopAsk(): void {
  stopped = true;
  emit();
  post({ action: "stop" });
}

/**
 * Push was just turned on, from ANY switch (EnablePushButton reports every
 * success here): every ask on screen goes away.
 */
export function notePushOn(): void {
  if (pushOn) return;
  pushOn = true;
  emit();
}

/** The reminder on `id` turned push on — it stays a few seconds to say so. */
export function confirmEnabledFromAsk(id: string): void {
  enabledFor = id;
  pushOn = true;
  emit();
  setTimeout(() => {
    if (enabledFor === id) { enabledFor = null; emit(); }
  }, 5000);
}

/** What the server said about the account as a whole (GET /api/push/ask). */
export function noteAskAccount(state: { pushOn?: boolean; stopped?: boolean }): void {
  let changed = false;
  if (state.pushOn && !pushOn) { pushOn = true; changed = true; }
  if (state.stopped && !stopped) { stopped = true; changed = true; }
  if (changed) emit();
}
