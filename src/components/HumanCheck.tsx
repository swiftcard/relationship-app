"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// ── "Verify you're human" (Cloudflare Turnstile) for the email/password forms ──
//
// Supabase Auth's CAPTCHA switch (Dashboard → Auth → Attack Protection) makes
// sign-up, password sign-in and the reset email require a Turnstile token.
// Without one a bot farm can mint free accounts by the thousand — each of which
// can text and email strangers (lib/outbound-cap).
//
// INERT UNTIL CONFIGURED, like the Apple and Wallet switches: with no
// NEXT_PUBLIC_TURNSTILE_SITE_KEY nothing loads, `slot` is null and `token()`
// resolves undefined, so the forms behave exactly as they did before.
//
// NEVER BLOCKS ON ITS OWN. If no token arrives (an ad-blocker ate the script, a
// slow phone), `token()` gives up after a few seconds and the form sends the
// request anyway: Supabase is the one that decides, and isHumanCheckError()
// turns its refusal into words. A widget that can hard-lock a sign-in button
// is a worse failure than the bot it stops.
//
// Invisible for almost everyone (appearance: interaction-only). When Cloudflare
// does want a click, the box appears just above the submit button.

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_WAIT_MS = 8000;

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window { turnstile?: Turnstile }
}

let scriptPromise: Promise<Turnstile | null> | null = null;
function loadTurnstile(): Promise<Turnstile | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => resolve(window.turnstile ?? null);
      // Retry-able: a failed load must not poison every later mount.
      s.onerror = () => { scriptPromise = null; resolve(null); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export const HUMAN_CHECK_FAILED =
  "We couldn't confirm you're a person. Wait a moment and try again. If it keeps happening, turn off content blockers for swiftcard.me.";

/** Supabase's refusal when the token is missing, used or rejected. */
export function isHumanCheckError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "captcha_failed" || /captcha/i.test(err.message ?? "");
}

export function useHumanCheck({ theme = "light" }: { theme?: "light" | "dark" | "auto" } = {}): {
  /** Where the box appears when Cloudflare wants a click. Null when off. */
  slot: ReactNode;
  /** A fresh token, or undefined when off / none arrived in time. */
  token: () => Promise<string | undefined>;
  /** Tokens are single-use: call after every request that spent one. */
  reset: () => void;
} {
  // A callback ref, not useRef: the box can mount long after the form does (the
  // delete-account dialog, the expired-link screen), and the widget must render
  // into it whenever it appears and go away with it.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const current = useRef<string | null>(null);
  const waiters = useRef<((t: string | undefined) => void)[]>([]);
  const [interactive, setInteractive] = useState(false);

  const settle = useCallback((t: string | undefined) => {
    const ws = waiters.current;
    waiters.current = [];
    ws.forEach((w) => w(t));
  }, []);

  useEffect(() => {
    if (!SITE_KEY || !box) return;
    let cancelled = false;
    loadTurnstile().then((ts) => {
      if (cancelled || !ts) return;
      widget.current = ts.render(box, {
        sitekey: SITE_KEY,
        theme,
        appearance: "interaction-only",
        size: "flexible",
        callback: (t: string) => { current.current = t; setInteractive(false); settle(t); },
        "expired-callback": () => { current.current = null; },
        "error-callback": () => { current.current = null; settle(undefined); },
        "before-interactive-callback": () => setInteractive(true),
        "after-interactive-callback": () => setInteractive(false),
      });
    });
    return () => {
      cancelled = true;
      current.current = null;
      if (widget.current) {
        try { window.turnstile?.remove(widget.current); } catch { /* already gone */ }
        widget.current = null;
      }
    };
  }, [box, theme, settle]);

  const token = useCallback(async () => {
    if (!SITE_KEY) return undefined;
    if (current.current) return current.current;
    return new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(() => {
        waiters.current = waiters.current.filter((w) => w !== done);
        resolve(undefined);
      }, TOKEN_WAIT_MS);
      const done = (t: string | undefined) => { clearTimeout(timer); resolve(t); };
      waiters.current.push(done);
    });
  }, []);

  const reset = useCallback(() => {
    current.current = null;
    if (widget.current) {
      try { window.turnstile?.reset(widget.current); } catch { /* reloads on next mount */ }
    }
  }, []);

  // Zero height and no margin until Cloudflare asks for a click, so the form
  // looks exactly as before for everyone it lets straight through.
  const slot = SITE_KEY ? (
    <div ref={setBox} data-human-check className={interactive ? "mb-3 flex justify-center" : undefined} />
  ) : null;

  return { slot, token, reset };
}
