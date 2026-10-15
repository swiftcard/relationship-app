"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Undo for a design tab (Card design, Social design) ──────────────────────
// Every screen a card or a Swift Links page is designed on has one: Edit card,
// the new-card builder, Office admin → Branding (Card and Links), and the
// homepage "see how it would look" builders.
//
// Owner, 2026-09-23: "if a user … puts a new accent color … and realizes they
// don't like it, they just press Undo without having to lose all the other
// changes they made." Each press steps back one change, newest first; the
// history ends when the card is saved.
//
// It WATCHES the tab's design values rather than wrapping each control, so
// every control on the tab — colour, font, finish, template, layout, photos,
// link styles — is covered without threading anything through them, and a
// control added next year is covered without anyone remembering to.
//
// Three rules keep one press = one thing the person did:
//   • A burst is one step. Dragging a colour picker or a slider fires dozens of
//     changes; changes to the same thing within COALESCE_MS of each other merge,
//     so Undo returns to where the drag STARTED. Short enough that two
//     deliberate clicks (one swatch, then another) stay two steps.
//   • Only changes the person made. Nothing is recorded until their first tap
//     or keypress: a restored draft, a layout upgraded on mount, a brand overlay
//     applied on load are the starting point, not steps.
//   • `describe` may veto a change (return null) — e.g. a link added on another
//     tab moves the link list the Social design tab styles; that's not a design
//     step to undo here.

const COALESCE_MS = 450;
const LIMIT = 50;

export type DesignHistory = {
  canUndo: boolean;
  undo: () => void;
  /** Forget every step — after a successful save. */
  clear: () => void;
};

export function useDesignHistory<S>(
  slice: S,
  apply: (s: S) => void,
  opts: {
    /** A key for the change prev → next (same key within the window = one
     *  step), or null to not record it at all. Default: the changed fields. */
    describe?: (prev: S, next: S) => string | null;
  } = {},
): DesignHistory {
  const serial = JSON.stringify(slice);
  const baseline = useRef<{ value: S; serial: string }>({ value: slice, serial });
  const stack = useRef<{ value: S; serial: string }[]>([]);
  const last = useRef<{ key: string; at: number } | null>(null);
  const armed = useRef(false);
  const [depth, setDepth] = useState(0);

  // Armed by the person's own first touch or keypress, anywhere on the page.
  useEffect(() => {
    const arm = () => { armed.current = true; };
    window.addEventListener("pointerdown", arm, { capture: true });
    window.addEventListener("keydown", arm, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", arm, { capture: true });
      window.removeEventListener("keydown", arm, { capture: true });
    };
  }, []);

  useEffect(() => {
    const prev = baseline.current;
    if (prev.serial === serial) return;
    baseline.current = { value: slice, serial };
    if (!armed.current) return;
    const key = opts.describe ? opts.describe(prev.value, slice) : changedKeys(prev.value, slice);
    if (key === null) return;
    const now = Date.now();
    const l = last.current;
    last.current = { key, at: now };
    if (l && l.key === key && now - l.at < COALESCE_MS) return;
    stack.current.push(prev);
    if (stack.current.length > LIMIT) stack.current.shift();
    setDepth(stack.current.length);
    // `slice` is represented by `serial`; depending on the object would fire on
    // every render (a fresh object each time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial]);

  const undo = useCallback(() => {
    // Skip any step that would change nothing visible (a value restored by
    // another route since) — one press must always do something.
    let prev = stack.current.pop();
    while (prev && prev.serial === baseline.current.serial) prev = stack.current.pop();
    setDepth(stack.current.length);
    last.current = null;
    if (!prev) return;
    // Set the baseline FIRST, so the change this causes is not itself
    // recorded as a new step.
    baseline.current = prev;
    apply(prev.value);
  }, [apply]);

  const clear = useCallback(() => {
    stack.current = [];
    last.current = null;
    setDepth(0);
  }, []);

  return { canUndo: depth > 0, undo, clear };
}

/**
 * The default step key: WHICH fields changed, one level into nested objects —
 * "style.accentColor", not "style" — so the accent and then the font, changed
 * a moment apart, are two steps rather than one.
 */
export function changedKeys<S>(prev: S, next: S): string {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(prev) || !isObj(next)) return "value";
  const out: string[] = [];
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const a = prev[k], b = next[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (isObj(a) && isObj(b)) {
      for (const sub of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (JSON.stringify(a[sub]) !== JSON.stringify(b[sub])) out.push(`${k}.${sub}`);
      }
    } else out.push(k);
  }
  return out.sort().join(",") || "value";
}

// ── Social design's per-link look ──────────────────────────────────────────
// Each link button carries its own look (tile size, row style, blur, tile
// photo), but the links themselves are edited elsewhere (Socials, the company
// links list). So a history tracks only the look, matched back to its link by
// WHAT the link is — never by position — and a link added or removed is never
// a step (vetoed with sameLinkList).

type StyledLink = { kind?: string; label: string; url: string; size?: unknown; rowStyle?: unknown; glass?: unknown; media?: unknown };
type LinkLook = { k: string; size?: unknown; rowStyle?: unknown; glass?: unknown; media?: unknown };

const linkLookKey = (l: StyledLink) => `${l.kind ?? "link"}|${l.label}|${l.url}`;

export function linkLooksOf(links: StyledLink[]): LinkLook[] {
  return links.map((l) => ({ k: linkLookKey(l), size: l.size, rowStyle: l.rowStyle, glass: l.glass, media: l.media }));
}

/** Put each link's remembered look back on it, leaving every other link alone. */
export function restoreLinkLooks<L extends StyledLink>(links: L[], looks: LinkLook[]): L[] {
  return links.map((l) => {
    const was = looks.find((x) => x.k === linkLookKey(l));
    return was ? ({ ...l, size: was.size, rowStyle: was.rowStyle, glass: was.glass, media: was.media } as L) : l;
  });
}

/** The same links in the same order — only then is a change a design step. */
export function sameLinkList(a: LinkLook[], b: LinkLook[]): boolean {
  return a.map((x) => x.k).join("\n") === b.map((x) => x.k).join("\n");
}

/**
 * Ctrl/Cmd+Z on a computer, for the tab that is showing. Leaves the key alone
 * while typing in a field — there it is the field's own text undo.
 */
export function useUndoShortcut(enabled: boolean, history: DesignHistory): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!history.canUndo) return;
      e.preventDefault();
      history.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, history]);
}
