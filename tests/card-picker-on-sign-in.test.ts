import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SESSION_CARD_COOKIE,
  SESSION_CARD_FLAG,
  SESSION_CARD_GUARD_SCRIPT,
  readSessionCard,
  sessionCardValue,
  signInTag,
} from "@/lib/active-card";

// Owner, 2026-10-27: "When I log in to my account through the website … it
// shows the dashboard for a second and then goes back to the Select a Card
// page." and "The first thing that pops up when a user logs in should ask them
// which card they want to open."
//
// Two bugs, one cookie. The session card (sc_session_card) outlived a sign-in
// that ended without Sign out, so the next sign-in reopened the old card:
//   • in the tab that had chosen it, straight into the dashboard — no picker;
//   • in any other tab, the server rendered that dashboard and a mount effect
//     only THEN noticed the tab had never chosen it and swapped to the picker.
// Now the card is stamped with its sign-in (the server renders the picker for
// a new one), and the new-tab check runs as an inline script ahead of the
// dashboard markup, before any of it can paint.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the session card belongs to one sign-in", () => {
  const sid = "6f1c2a9e-3b7d-4c0a-9e21-5d8f7a6b4c3d";

  it("the tag is stable for a session and differs between sign-ins", () => {
    expect(signInTag(sid)).toBe(signInTag(sid));
    expect(signInTag(sid)).toMatch(/^[a-z0-9]{12}$/i);
    expect(signInTag(sid)).not.toBe(signInTag("0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9"));
    expect(signInTag(undefined)).toBe("");
    expect(signInTag(42)).toBe("");
  });

  it("the card chosen in this sign-in is honoured", () => {
    const tag = signInTag(sid);
    expect(readSessionCard(sessionCardValue("dana-ellis", tag), tag)).toBe("dana-ellis");
    expect(readSessionCard(sessionCardValue("dana-ellis-2", tag), tag)).toBe("dana-ellis-2");
  });

  it("a card left over from an earlier sign-in is not — the picker comes first", () => {
    const old = signInTag("0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9");
    expect(readSessionCard(sessionCardValue("dana-ellis", old), signInTag(sid))).toBeNull();
  });

  it("an unstamped value (written before this fix) and junk are not honoured", () => {
    const tag = signInTag(sid);
    expect(readSessionCard("dana-ellis", tag)).toBeNull();
    expect(readSessionCard("", tag)).toBeNull();
    expect(readSessionCard(undefined, tag)).toBeNull();
    expect(readSessionCard(`.${tag}`, tag)).toBeNull();
  });

  it("the dashboard reads it through the sign-in, and writes it stamped", () => {
    const page = read("src/app/dashboard/page.tsx");
    expect(page).toMatch(/const signIn = signInTag\(claimsData\.claims\.session_id\);/);
    expect(page).toMatch(/readSessionCard\(cookieStore\.get\(SESSION_CARD_COOKIE\)\?\.value, signIn\)/);
    // Decided after the claims are known, never from the raw cookie.
    expect(page.indexOf("const sessionCard =")).toBeGreaterThan(page.indexOf("auth.getClaims()"));
    expect(page).not.toMatch(/cookieStore\.get\(SESSION_CARD_COOKIE\)\?\.value \?\? null/);
    expect(page).toMatch(/signIn=\{signIn\}/);

    const persist = read("src/components/CardSelectionPersist.tsx");
    expect(persist).toMatch(/\$\{SESSION_CARD_COOKIE\}=\$\{encodeURIComponent\(sessionCardValue\(selectedCard, signIn\)\)\}/);
  });
});

describe("a tab that never chose the card never paints its dashboard", () => {
  function runGuard(opts: { flag?: boolean; storageThrows?: boolean; splashArmed?: boolean }) {
    const calls: string[] = [];
    const timers: Array<() => void> = [];
    const classes = new Set<string>(opts.splashArmed ? ["sc-splash-armed"] : []);
    const doc = {
      cookie: "",
      documentElement: { classList: { contains: (c: string) => classes.has(c) } },
    };
    const storage = {
      getItem: (k: string) => {
        if (opts.storageThrows) throw new Error("SecurityError");
        return k === SESSION_CARD_FLAG && opts.flag ? "1" : null;
      },
    };
    const win = { stop: () => calls.push("stop") };
    const loc = { replace: (u: string) => calls.push(`replace ${u}`) };
    const later = (fn: () => void) => { timers.push(fn); return 0; };
    new Function("sessionStorage", "document", "window", "location", "setTimeout", SESSION_CARD_GUARD_SCRIPT)(
      storage, doc, win, loc, later,
    );
    return { calls, doc, timers, classes };
  }

  it("a tab that chose it: nothing happens", () => {
    const r = runGuard({ flag: true });
    expect(r.calls).toEqual([]);
    expect(r.doc.cookie).toBe("");
  });

  it("a fresh tab: drops the session card, stops the page, opens the picker", () => {
    const r = runGuard({});
    expect(r.doc.cookie).toBe(`${SESSION_CARD_COOKIE}=; path=/; max-age=0; samesite=lax`);
    // stop() FIRST: the rest of the dashboard is never parsed or swapped in.
    expect(r.calls).toEqual(["stop", "replace /dashboard?pick=1"]);
  });

  it("an app launch lets the splash finish before opening the picker", () => {
    const r = runGuard({ splashArmed: true });
    expect(r.calls).toEqual(["stop"]);
    r.timers.shift()!();
    expect(r.calls).toEqual(["stop"]);
    r.classes.delete("sc-splash-armed");
    r.timers.shift()!();
    expect(r.calls).toEqual(["stop", "replace /dashboard?pick=1"]);
  });

  it("storage blocked: trusts the cookie, like the effect", () => {
    const r = runGuard({ storageThrows: true });
    expect(r.calls).toEqual([]);
  });

  it("the guard is the FIRST thing the dashboard renders, outside any Suspense", () => {
    const page = read("src/app/dashboard/page.tsx");
    const main = page.slice(page.lastIndexOf("\n  return (\n    <>"));
    const persist = main.indexOf("<CardSelectionPersist");
    expect(persist).toBeGreaterThan(-1);
    // Ahead of every other element of the main dashboard.
    const firstOther = main.slice(main.indexOf("<>") + 2).search(/<[A-Za-z]/);
    expect(main.indexOf("<>") + 2 + firstOther).toBe(persist);
    expect(persist).toBeLessThan(main.indexOf('data-tour="share"') === -1 ? Infinity : main.indexOf('data-tour="share"'));
    expect(persist).toBeLessThan(main.indexOf("<AppTopNav"));
    expect(main.slice(0, persist)).not.toMatch(/<Suspense>/);
    // Only for a restored card on a multi-card account.
    expect(main).toMatch(/restored=\{!params\.card && !!sessionCard && allCards\.length > 1\}/);
  });

  it("the component emits the script only from the server, and keeps the effect for in-app navigations", () => {
    const persist = read("src/components/CardSelectionPersist.tsx");
    expect(persist).toMatch(/dangerouslySetInnerHTML=\{\{ __html: SESSION_CARD_GUARD_SCRIPT \}\}/);
    expect(persist).toMatch(/type=\{typeof window === "undefined" \? "text\/javascript" : "text\/plain"\}/);
    expect(persist).toMatch(/if \(!restored \|\| !selectedCard\) return null;/);
    expect(persist).toMatch(/location\.replace\("\/dashboard\?pick=1"\)/);
  });

  it("the knowledge base says every sign-in opens on Select a card", () => {
    expect(read("src/lib/knowledge/docs/dashboard.ts")).toMatch(/every time you sign in/);
  });
});
