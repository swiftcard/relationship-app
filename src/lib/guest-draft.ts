"use client";

// ── Guest draft store (localStorage) + editor hook ───────────────────────────
// A guest can build a full Card (which also carries its SwiftLink + Email
// Signature — all one `cards` row) WITHOUT an account. Their work lives here in
// localStorage; nothing hits the DB until they authenticate and the draft is
// "claimed" (see src/app/api/drafts/claim + GuestDraftClaim).
//
// This module is browser-only but MUST stay importable in the node test env, so
// every entry point guards on `typeof localStorage`. It deliberately avoids
// next/navigation (uses window.location) so tests can import the store logic.
import { useCallback, useEffect, useState } from "react";

export const GUEST_DRAFT_KEY = "swiftcard_guest_draft";

// Event the editor fires (via requireAuth) to pop the auth gate. GuestGateModal
// listens for it — keeps the modal fully self-contained.
export const GUEST_GATE_EVENT = "swiftcard:guest-gate";

export type GuestDraft = {
  id: string;
  kind: "card";
  payload: Record<string, unknown>;
  images: Record<string, string>; // e.g. { logo: "data:…", photo: "data:…" }
  step: number;
  updatedAt: number;
  // Set the moment the guest explicitly chooses "Create account / Log in" at
  // the gate FOR THIS DRAFT. A draft is only ever claimed into an account when
  // this consent is present and fresh — an abandoned draft sitting in
  // localStorage must never silently attach to whichever account signs in next
  // on this browser (that was a real cross-account leak).
  claimRequestedAt?: number;
};

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `d_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function readStorage(key: string = GUEST_DRAFT_KEY): GuestDraft | null {
  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuestDraft;
    if (!parsed || parsed.kind !== "card" || typeof parsed.id !== "string") return null;
    return parsed;
  } catch {
    // Corrupt / unparseable draft → treat as none rather than crash the editor.
    return null;
  }
}

// In-memory copy so rapid saves merge without a storage round-trip; the debounced
// flush persists it. requireAuth flushes synchronously before it navigates.
// Kept PER KEY: the guest draft and a signed-in account's own draft (see
// accountDraftKey) never share a copy.
const mems = new Map<string, GuestDraft | null>();
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function writeNow(draft: GuestDraft, key: string = GUEST_DRAFT_KEY): boolean {
  if (!storageAvailable()) return false;
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    /* quota / private mode — the in-memory copy still carries the session */
    return false;
  }
}

/**
 * The draft store for one key. The guest builder uses GUEST_DRAFT_KEY (the
 * functions below are exactly this for that key). A SIGNED-IN builder uses its
 * own account's key, so a refresh no longer throws away a card being built by
 * someone who already has an account (2026-09-22 signup review) — and because
 * the key carries the account id, one account's unfinished card can never be
 * offered to another account on the same browser, and it is never "claimed".
 */
export function draftStore(key: string) {
  const load = (): GuestDraft | null => {
    if (mems.has(key)) return mems.get(key) ?? null;
    const d = readStorage(key);
    mems.set(key, d);
    return d;
  };
  /** Write the pending draft now. false = it did NOT reach storage, so a page
   *  load would lose it (the LinkedIn photo hop checks this before leaving). */
  const flush = (): boolean => {
    const t = flushTimers.get(key);
    if (t) { clearTimeout(t); flushTimers.delete(key); }
    const m = mems.get(key);
    return m ? writeNow(m, key) : true;
  };
  const save = (partial: Partial<GuestDraft>): void => {
    const base: GuestDraft =
      mems.get(key) ??
      readStorage(key) ?? {
        id: newId(),
        kind: "card",
        payload: {},
        images: {},
        step: 1,
        updatedAt: Date.now(),
      };
    const next: GuestDraft = {
      ...base,
      ...partial,
      // payload/images are full snapshots from the editor — replace, don't merge.
      payload: partial.payload ?? base.payload,
      images: partial.images ?? base.images,
      id: base.id || newId(),
      kind: "card",
      updatedAt: Date.now(),
    };
    mems.set(key, next);
    // Debounce the actual localStorage write — the editor calls this on every
    // keystroke.
    const t = flushTimers.get(key);
    if (t) clearTimeout(t);
    if (typeof setTimeout !== "undefined") {
      flushTimers.set(key, setTimeout(() => {
        flushTimers.delete(key);
        const m = mems.get(key);
        if (m) writeNow(m, key);
      }, 400));
    } else {
      writeNow(next, key);
    }
  };
  const clear = (): void => {
    mems.set(key, null);
    const t = flushTimers.get(key);
    if (t) { clearTimeout(t); flushTimers.delete(key); }
    if (!storageAvailable()) return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };
  return { load, save, clear, flush };
}

/** A signed-in account's own unfinished-card key. */
export function accountDraftKey(userId: string): string {
  return `swiftcard_card_draft:${userId}`;
}

const guestStore = draftStore(GUEST_DRAFT_KEY);

export function loadDraft(): GuestDraft | null {
  return guestStore.load();
}

export function flushDraft(): void {
  guestStore.flush();
}

export function saveDraft(partial: Partial<GuestDraft>): void {
  guestStore.save(partial);
}

export function clearDraft(): void {
  guestStore.clear();
}

export function hasPendingDraft(): boolean {
  return loadDraft() !== null;
}

// ── Claim consent ─────────────────────────────────────────────────────────────
// How long the "yes, save this draft into the account I'm about to sign into"
// choice stays valid. Long enough to cover login + email confirmation on the
// same device; short enough that a forgotten draft can't ambush a different
// account signing in days later.
export const CLAIM_CONSENT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// Called when the guest clicks "Create account" / "Log in" at the gate — the
// explicit moment they choose to save THIS draft into the account they're
// about to authenticate as.
export function markClaimConsent(): void {
  const draft = loadDraft();
  if (!draft) return;
  const consented = { ...draft, claimRequestedAt: Date.now() };
  mems.set(GUEST_DRAFT_KEY, consented);
  writeNow(consented);
}

// True when the pending draft carries fresh, explicit save-consent.
export function hasClaimConsent(): boolean {
  const draft = loadDraft();
  if (!draft?.claimRequestedAt) return false;
  const age = Date.now() - draft.claimRequestedAt;
  return age >= 0 && age <= CLAIM_CONSENT_MAX_AGE_MS;
}

// Client-side auth heuristic: the @supabase/ssr session is stored in a cookie
// named `sb-<project-ref>-auth-token` (possibly chunked with .0/.1). Its presence
// means "logged in". The claim route re-verifies server-side regardless — this
// only decides whether the editor runs the action or pops the auth gate.
export function isAuthenticated(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return /(?:^|;\s*)sb-[^=;]*-auth-token(?:\.\d+)?=/.test(document.cookie);
  } catch {
    return false;
  }
}

function openGate(action: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(GUEST_GATE_EVENT, { detail: { action } }));
  } catch {
    // Very old browsers without CustomEvent constructor — fall back to a direct
    // route so the flow never dead-ends.
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}&draft=1`;
  }
}

export function useGuestDraft(): {
  draft: GuestDraft | null;
  save: (p: Partial<GuestDraft>) => void;
  clear: () => void;
  requireAuth: (action: string, run: () => void, opts?: { forceGate?: boolean }) => void;
} {
  const [draft, setDraft] = useState<GuestDraft | null>(null);

  // Hydrate after mount (loadDraft touches localStorage → client-only, avoids an
  // SSR mismatch).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage after mount, avoids an SSR mismatch
    setDraft(loadDraft());
  }, []);

  const save = useCallback((p: Partial<GuestDraft>) => {
    saveDraft(p);
    setDraft(loadDraft());
  }, []);

  const clear = useCallback(() => {
    clearDraft();
    setDraft(null);
  }, []);

  const requireAuth = useCallback((action: string, run: () => void, opts?: { forceGate?: boolean }) => {
    // Logged in → just do it. Guest → persist and pop the gate; the action is
    // retried after they come back and the draft is claimed.
    //
    // forceGate: ALWAYS pop the account gate, even when a session cookie is
    // present. The marketing "new card" flow uses this so a card is never
    // silently saved into whatever account happens to be logged in — the visitor
    // must explicitly log in or sign up (with a different email → a new account).
    if (!opts?.forceGate && isAuthenticated()) {
      run();
      return;
    }
    flushDraft();
    openGate(action);
  }, []);

  return { draft, save, clear, requireAuth };
}

// ── Is there real work in this draft? ────────────────────────────────────────
// The wizard autosaves the moment it opens, so a visitor who merely looked at
// the builder leaves a draft of empty strings behind. Only a draft with
// something the visitor actually entered (or that got past step 1) is worth
// the "Continue your card / Start a new card" question.
export function draftHasWork(draft: GuestDraft | null): boolean {
  if (!draft) return false;
  if (typeof draft.step === "number" && draft.step > 1) return true;
  if (draft.images && Object.values(draft.images).some(Boolean)) return true;
  const p = draft.payload ?? {};
  const c = (p.customization ?? {}) as Record<string, unknown>;
  const filled = (v: unknown) => typeof v === "string" && v.trim() !== "";
  if (["name", "company", "title", "phone", "email", "website", "linkedin", "instagram", "tiktok", "twitter"].some((k) => filled(p[k]))) return true;
  if (["bio", "facebook", "snapchat", "youtube", "fax"].some((k) => filled(c[k]))) return true;
  if (Array.isArray(c.links) && c.links.some((l) => filled((l as { url?: unknown })?.url) || filled((l as { label?: unknown })?.label))) return true;
  if (Array.isArray(c.phones) && c.phones.some((ph) => filled((ph as { number?: unknown })?.number))) return true;
  if (c.address && typeof c.address === "object" && Object.values(c.address as Record<string, unknown>).some(filled)) return true;
  return false;
}
