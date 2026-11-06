"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import LinkPreviewThumb from "@/components/LinkPreviewThumb";
import { LINK_FORM_TONE } from "@/components/AddLinkForm";
import { dropIndex, moveAmongUnlocked, nextUnlocked, shiftFor, withHttps } from "@/lib/link-list";

// ── "Additional links": the list you have built, in page order ─────────────
//
// Owner, 2026-11-06: "when the users add section headers and those additional
// links, it's shown on top… they can hold on to a section header and put it
// above a link or they can move one link under another link just by dragging
// it around", and "they should be able to click on it if they want to edit
// it". Before this the list could only grow and shrink: order was the order
// things were added, and a typo in a link meant × and type it all again.
//
//   • Every row the person owns has a grip (⠿) on its left. Press it and drag:
//     the row lifts, the others step aside to show where it lands, the page
//     scrolls near the top/bottom edge. Only the GRIP drags, so a thumb
//     scrolling the page can never move a link by accident; the arrow keys move
//     a focused grip one step for keyboard users.
//   • A link is a button: tap it and it opens in place with "Button text" and
//     "Web address" (the same two boxes as the add form), Cancel and Save link.
//     It keeps its spot. One open at a time, so there is never a second
//     half-finished edit.
//   • A section header's title is typed straight into its row, as it always
//     was. One word needs no confirm step, and a step there would let a header
//     be lost by pressing Save Changes before confirming it.
//   • "+ Add a section header" sits under the list and ABOVE the add form
//     (owner: it was under "Button text" and "Web address"). It adds the header
//     at the end and puts the cursor in its title, ready to drag into place.
//
// LOCKED rows are a company's links on a member's card: the server re-pins
// them first on every save, so here they have no grip, no edit and no ×, and
// nothing can be dragged above them (lib/link-list keeps their indices).
//
// One component for Edit card, the create-card wizard, Office Branding →
// Links, the homepage builder and the Teams demo, so they cannot drift.

type Row = { label: string; url: string; kind?: string };
type Variant = "app" | "panel" | "site";

// A row's identity across moves and edits. Keyed by index, a reorder would
// remount every row (and re-fetch every preview thumbnail); keyed by URL, two
// headers (which have none) would collide. The object is the identity, and an
// edit made here carries the id onto the new object.
const ROW_IDS = new WeakMap<object, string>();
let seq = 0;
function idOf(row: object): string {
  let id = ROW_IDS.get(row);
  if (!id) {
    seq += 1;
    id = `row${seq}`;
    ROW_IDS.set(row, id);
  }
  return id;
}

const TONES: Record<Variant, {
  link: string; header: string; office: string; label: string; url: string; tag: string;
  grip: string; remove: string; headerInput: string; hint: string; addHeader: string;
  rule: string; cancel: string; saveIdle: string; lifted: string; pencil: string;
}> = {
  app: {
    link: "bg-gray-900 border-gray-700",
    header: "bg-gray-900 border-gray-700 border-dashed",
    office: "bg-purple-500/[0.06] border-purple-500/25",
    label: "text-gray-200 text-xs",
    url: "text-gray-500 text-[0.625rem]",
    tag: "text-gray-500",
    grip: "text-gray-500 hover:text-gray-300",
    remove: "text-gray-500 hover:text-red-400 hover:bg-red-500/10",
    headerInput: "text-gray-200 placeholder-gray-600",
    hint: "text-gray-500",
    addHeader: "text-gray-400 hover:text-gray-200 hover:bg-gray-800/60",
    rule: "border-gray-800",
    cancel: "bg-gray-800/60 border border-transparent text-gray-200 hover:bg-gray-700",
    saveIdle: "border border-dashed border-gray-700 text-gray-400",
    lifted: "shadow-xl shadow-black/40 ring-1 ring-blue-500/60",
    pencil: "text-gray-600 group-hover:text-gray-300",
  },
  panel: {
    link: "bg-gray-950 border-gray-800",
    header: "bg-gray-950 border-gray-700 border-dashed",
    office: "bg-purple-500/[0.06] border-purple-500/25",
    label: "text-gray-200 text-xs",
    url: "text-gray-600 text-[0.625rem]",
    tag: "text-gray-500",
    grip: "text-gray-500 hover:text-gray-300",
    remove: "text-gray-500 hover:text-red-400 hover:bg-red-500/10",
    headerInput: "text-gray-200 placeholder-gray-600",
    hint: "text-gray-600",
    addHeader: "text-gray-400 hover:text-gray-200 hover:bg-gray-800/60",
    rule: "border-gray-800",
    cancel: "bg-gray-800/60 border border-transparent text-gray-200 hover:bg-gray-700",
    saveIdle: "border border-dashed border-gray-700 text-gray-400",
    lifted: "shadow-xl shadow-black/40 ring-1 ring-blue-500/60",
    pencil: "text-gray-600 group-hover:text-gray-300",
  },
  site: {
    link: "bg-[#15171F] border-white/10",
    header: "bg-[#15171F] border-white/15 border-dashed",
    office: "bg-[#15171F] border-white/10",
    label: "text-white text-sm",
    url: "text-white/40 text-[0.6875rem]",
    tag: "text-white/40",
    grip: "text-white/40 hover:text-white/80",
    remove: "text-white/40 hover:text-red-400 hover:bg-red-500/10",
    headerInput: "text-white placeholder:text-white/30",
    hint: "text-white/50",
    addHeader: "text-white/55 hover:text-white hover:bg-white/5",
    rule: "border-white/10",
    cancel: "border border-white/15 text-white/80 hover:border-white/30 hover:text-white",
    saveIdle: "border border-dashed border-white/15 text-white/40",
    lifted: "shadow-xl shadow-black/50 ring-1 ring-blue-400/60",
    pencil: "text-white/30 group-hover:text-white/70",
  },
};

function GripIcon({ className = "w-2.5 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 16" className={className} fill="currentColor" aria-hidden="true">
      {[3, 8, 13].map((y) => (
        <g key={y}>
          <circle cx="2.5" cy={y} r="1.4" />
          <circle cx="7.5" cy={y} r="1.4" />
        </g>
      ))}
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 shrink-0 transition-colors ${className}`} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" strokeLinejoin="round" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

/** No text gets selected while a finger or mouse sweeps across the page mid-drag. */
function lockSelection() {
  document.body.style.userSelect = "none";
  document.body.style.setProperty("-webkit-user-select", "none");
}
function unlockSelection() {
  document.body.style.userSelect = "";
  document.body.style.removeProperty("-webkit-user-select");
}

/** The element that actually scrolls the editor: the nearest scrolling ancestor, else the page. */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

type DragInfo = {
  id: string;
  from: number;
  pointerId: number;
  startY: number;
  lastY: number;
  startScroll: number;
  scroller: HTMLElement;
  isPage: boolean;
  rects: { top: number; height: number }[];
  locked: boolean[];
  minDy: number;
  maxDy: number;
  raf: number;
};

export default function LinkListEditor<T extends Row>({
  links,
  onChange,
  isLocked,
  variant = "app",
  thumbs = false,
  canAddHeader = false,
  headerPlaceholder = "Section title (e.g. Watch)",
  headerMaxLength,
  listLabel = "Your links, in page order",
}: {
  links: T[];
  onChange: (next: T[]) => void;
  /** A company row on a member's card: fixed in place, no edit, no remove. */
  isLocked?: (row: T) => boolean;
  variant?: Variant;
  /** The link's preview picture beside it (the card editor). Off elsewhere so
   *  the wizard, the homepage and the Teams demo never fetch previews. */
  thumbs?: boolean;
  /** Show "+ Add a section header" under the list (Pro, where the plan decides). */
  canAddHeader?: boolean;
  headerPlaceholder?: string;
  headerMaxLength?: number;
  listLabel?: string;
}) {
  const t = TONES[variant];
  const form = LINK_FORM_TONE[variant === "site" ? "site" : "app"];
  const uid = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const gripEls = useRef(new Map<string, HTMLButtonElement>());
  const dragRef = useRef<DragInfo | null>(null);
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number; step: number } | null>(null);
  const [editing, setEditing] = useState<{ id: string; label: string; url: string } | null>(null);
  const [said, setSaid] = useState("");

  const locked = links.map((l) => !!isLocked?.(l));
  const movable = locked.filter((x) => !x).length;
  const ownLinks = links.some((l, i) => !locked[i] && l.kind !== "header");

  /** Replace row i, keeping its identity (so its row, and any focus in it, stays put). */
  function patchRow(i: number, patch: Partial<Row>) {
    const id = idOf(links[i]);
    const next = { ...links[i], ...patch } as T;
    ROW_IDS.set(next, id);
    onChange(links.map((x, xi) => (xi === i ? next : x)));
  }

  function nameOf(l: Row) {
    return l.kind === "header" ? (l.label.trim() ? `section ${l.label.trim()}` : "section") : l.label;
  }

  // ── Dragging by the grip ─────────────────────────────────────────────────
  function measure(d: DragInfo) {
    const raw = d.lastY - d.startY + (d.scroller.scrollTop - d.startScroll);
    const dy = Math.max(d.minDy, Math.min(d.maxDy, raw));
    return { dy, to: dropIndex(d.rects, d.from, dy, d.locked) };
  }

  function update() {
    const d = dragRef.current;
    if (!d) return;
    const { dy, to } = measure(d);
    setDrag((cur) => (cur && (cur.dy !== dy || cur.to !== to) ? { ...cur, dy, to } : cur));
  }

  // Near the top or bottom of what is visible, scroll, faster the closer the
  // finger is to the edge, so a row can travel further than one screen.
  function tick() {
    const d = dragRef.current;
    if (!d) return;
    // The list went away mid-drag (the tab changed, the step moved on): stop.
    if (!listRef.current) {
      dragRef.current = null;
      unlockSelection();
      return;
    }
    const box = d.isPage ? { top: 0, bottom: window.innerHeight } : d.scroller.getBoundingClientRect();
    const EDGE = 56;
    let v = 0;
    if (d.lastY < box.top + EDGE) v = -((box.top + EDGE - d.lastY) / EDGE) * 14;
    else if (d.lastY > box.bottom - EDGE) v = ((d.lastY - (box.bottom - EDGE)) / EDGE) * 14;
    if (v) {
      d.scroller.scrollTop += Math.max(-16, Math.min(16, v));
      update();
    }
    d.raf = requestAnimationFrame(tick);
  }

  function startDrag(e: ReactPointerEvent<HTMLButtonElement>, i: number) {
    if (e.button !== 0 || editing || dragRef.current || locked[i] || movable < 2) return;
    const ul = listRef.current;
    if (!ul) return;
    e.preventDefault();
    const rows = Array.from(ul.children) as HTMLElement[];
    const rects = rows.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
    if (rects.length !== links.length) return;
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].top - rects[0].height) : 8;
    const first = locked.indexOf(false);
    const last = locked.lastIndexOf(false);
    const scroller = scrollParent(ul);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* an old WebView without capture still gets the moves */ }
    dragRef.current = {
      id: idOf(links[i]),
      from: i,
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      startScroll: scroller.scrollTop,
      scroller,
      isPage: scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body,
      rects,
      locked,
      // The row travels from the first movable slot to the last, a little past.
      minDy: rects[first].top - rects[i].top - 12,
      maxDy: rects[last].top + rects[last].height - (rects[i].top + rects[i].height) + 12,
      raf: 0,
    };
    lockSelection();
    setDrag({ id: idOf(links[i]), from: i, to: i, dy: 0, step: rects[i].height + gap });
    dragRef.current.raf = requestAnimationFrame(tick);
  }

  function moveDrag(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastY = e.clientY;
    update();
  }

  function endDrag(commit: boolean) {
    const d = dragRef.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    dragRef.current = null;
    unlockSelection();
    const { to } = measure(d);
    setDrag(null);
    if (commit && to !== d.from) {
      const moved = links[d.from];
      onChange(moveAmongUnlocked(links, d.from, to, (r) => !!isLocked?.(r)));
      setSaid(`Moved ${nameOf(moved)} to position ${to + 1} of ${links.length}.`);
    }
  }

  // Escape puts a lifted row back where it came from.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") endDrag(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── The keyboard: a focused grip moves one step per arrow ─────────────────
  function gripKey(e: ReactKeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    if (editing || locked[i]) return;
    const j = nextUnlocked(locked, i, e.key === "ArrowUp" ? -1 : 1);
    if (j === i) return;
    const id = idOf(links[i]);
    const moved = links[i];
    flushSync(() => onChange(moveAmongUnlocked(links, i, j, (r) => !!isLocked?.(r))));
    // React may have moved this very node; put the focus back on it.
    gripEls.current.get(id)?.focus();
    setSaid(`Moved ${nameOf(moved)} to position ${j + 1} of ${links.length}.`);
  }

  // ── Editing a link in place ───────────────────────────────────────────────
  function openEdit(i: number) {
    const row = links[i];
    const id = idOf(row);
    if (editing?.id === id) { setEditing(null); return; }
    // Rendered synchronously, then focused inside the same tap: iOS raises the
    // keyboard only for a focus() that happens within the user's gesture.
    flushSync(() => setEditing({ id, label: row.label, url: row.url }));
    const box = document.getElementById(`${uid}-edit-label`) as HTMLInputElement | null;
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  }

  const canSave = !!editing && !!editing.label.trim() && !!editing.url.trim();
  function saveEdit() {
    if (!editing || !canSave) return;
    const i = links.findIndex((r) => idOf(r) === editing.id);
    setEditing(null);
    if (i < 0) return;
    const label = editing.label.trim();
    patchRow(i, { label, url: withHttps(editing.url) });
    setSaid(`Saved ${label}.`);
  }
  function editKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
    else if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
  }

  function remove(i: number) {
    if (editing?.id === idOf(links[i])) setEditing(null);
    onChange(links.filter((_, xi) => xi !== i));
  }

  function addHeader() {
    const row = { label: "", url: "", kind: "header" } as unknown as T;
    flushSync(() => onChange([...links, row]));
    // The new title box, focused inside the tap (iOS keyboard, as above).
    const box = listRef.current?.lastElementChild?.querySelector("input") as HTMLInputElement | null;
    box?.focus();
  }

  const hint = [movable >= 2 ? "drag" : "", ownLinks ? "edit" : ""].filter(Boolean);

  return (
    <div data-link-list className="space-y-2">
      {links.length > 0 && (
        <ul ref={listRef} role="list" aria-label={listLabel} className="flex flex-col gap-2">
          {links.map((l, i) => {
            const id = idOf(l);
            const isHeader = l.kind === "header";
            const lockedRow = locked[i];
            const isEditing = editing?.id === id;
            const lifted = drag?.id === id;
            const shift = drag && !lifted ? shiftFor(i, drag.from, drag.to, locked) : 0;
            const style: CSSProperties | undefined = drag
              ? { transform: lifted ? `translateY(${drag.dy}px)` : shift ? `translateY(${shift * drag.step}px)` : undefined }
              : undefined;
            const gripDisabled = lockedRow || !!editing || movable < 2;

            const gripCell = lockedRow ? (
              <span className={`shrink-0 w-10 self-stretch flex items-center justify-center ${t.tag}`} title="Set by your company">
                <LockIcon />
              </span>
            ) : (
              <button
                type="button"
                ref={(el) => { if (el) gripEls.current.set(id, el); else gripEls.current.delete(id); }}
                aria-label={`Move ${nameOf(l)}`}
                aria-describedby={hint.length ? `${uid}-hint` : undefined}
                aria-disabled={gripDisabled || undefined}
                onPointerDown={(e) => startDrag(e, i)}
                onPointerMove={moveDrag}
                onPointerUp={() => endDrag(true)}
                onPointerCancel={() => endDrag(false)}
                onLostPointerCapture={() => endDrag(true)}
                onKeyDown={(e) => gripKey(e, i)}
                onContextMenu={(e) => e.preventDefault()}
                // touch-action INLINE, not the touch-none class: globals.css
                // gives every button `touch-action: manipulation` outside any
                // layer, which beats a Tailwind utility, and a phone then
                // scrolls the page and cancels the drag one move in (caught by
                // tests/render/link-list-editor). No callout or text loupe on
                // a long press in the iPhone app either.
                style={{ touchAction: "none", WebkitTouchCallout: "none" }}
                className={`shrink-0 w-10 self-stretch min-h-11 flex items-center justify-center rounded-l-xl select-none transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 ${t.grip} ${
                  gripDisabled ? "opacity-40 cursor-default" : lifted ? "cursor-grabbing" : "cursor-grab"
                }`}
              >
                <GripIcon />
              </button>
            );

            const removeCell = lockedRow ? (
              <span className="text-[0.5625rem] font-semibold uppercase tracking-wide text-purple-300 shrink-0 pr-3 self-center">Company</span>
            ) : (
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={isHeader ? `Remove section${l.label.trim() ? ` ${l.label.trim()}` : ""}` : `Remove ${l.label}`}
                className={`shrink-0 self-center grid place-items-center w-9 h-9 mr-1 rounded-lg transition-colors text-lg leading-none ${t.remove}`}
              >
                ×
              </button>
            );

            return (
              <li
                key={id}
                data-link-row={isHeader ? "header" : "link"}
                data-locked={lockedRow || undefined}
                style={style}
                className={`relative ${lifted ? "z-20" : ""} ${drag && !lifted ? "motion-safe:transition-transform motion-safe:duration-150" : ""}`}
              >
                <div className={`rounded-xl border ${lockedRow ? t.office : isHeader ? t.header : t.link} ${lifted ? `${t.lifted} scale-[1.02]` : ""} transition-[scale,box-shadow] duration-150`}>
                  {isHeader ? (
                    <div className="flex items-center">
                      {gripCell}
                      <span className={`text-[0.5625rem] font-bold uppercase tracking-wide shrink-0 mr-2 ${t.tag}`}>Section</span>
                      <input
                        type="text"
                        value={l.label}
                        onChange={(e) => patchRow(i, { label: headerMaxLength ? e.target.value.slice(0, headerMaxLength) : e.target.value })}
                        maxLength={headerMaxLength}
                        placeholder={headerPlaceholder}
                        readOnly={lockedRow}
                        aria-label="Section title"
                        className={`flex-1 min-w-0 bg-transparent py-2.5 text-xs font-bold uppercase tracking-wide focus:outline-none ${t.headerInput} ${lockedRow ? "cursor-default opacity-80" : ""}`}
                      />
                      {removeCell}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-stretch">
                        {gripCell}
                        {lockedRow ? (
                          <div className="flex-1 min-w-0 flex items-center gap-2.5 py-2.5 pr-2">
                            {thumbs && <LinkPreviewThumb url={l.url} />}
                            <span className="flex-1 min-w-0">
                              <span className={`block font-semibold truncate ${t.label}`}>{l.label}</span>
                              <span className={`block truncate ${t.url}`}>{l.url}</span>
                            </span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openEdit(i)}
                            disabled={!!editing && !isEditing}
                            aria-expanded={isEditing}
                            aria-label={`Edit ${l.label}`}
                            className="group flex-1 min-w-0 flex items-center gap-2.5 py-2.5 pr-2 text-left rounded-lg focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 disabled:cursor-default"
                          >
                            {thumbs && <LinkPreviewThumb url={l.url} />}
                            <span className="flex-1 min-w-0">
                              <span className={`block font-semibold truncate ${t.label}`}>{l.label}</span>
                              <span className={`block truncate ${t.url}`}>{l.url}</span>
                            </span>
                            <PencilIcon className={isEditing ? "text-blue-400" : t.pencil} />
                          </button>
                        )}
                        {removeCell}
                      </div>
                      {isEditing && editing && (
                        <div className={`mx-3 mb-3 pt-3 border-t space-y-2.5 ${t.rule}`}>
                          <div>
                            <label htmlFor={`${uid}-edit-label`} className={`block text-[0.6875rem] font-medium mb-1 ${form.label}`}>Button text</label>
                            <input
                              id={`${uid}-edit-label`}
                              type="text"
                              value={editing.label}
                              onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                              onKeyDown={editKey}
                              placeholder="e.g. Leave a review"
                              className={form.input}
                            />
                          </div>
                          <div>
                            <label htmlFor={`${uid}-edit-url`} className={`block text-[0.6875rem] font-medium mb-1 ${form.label}`}>Web address</label>
                            <input
                              id={`${uid}-edit-url`}
                              type="text"
                              inputMode="url"
                              autoCapitalize="none"
                              autoCorrect="off"
                              spellCheck={false}
                              value={editing.url}
                              onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                              onKeyDown={editKey}
                              placeholder="e.g. calendly.com/alex"
                              className={form.input}
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className={`flex-1 h-10 rounded-xl text-xs font-semibold transition-colors ${t.cancel}`}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={saveEdit}
                              disabled={!canSave}
                              className={`flex-1 h-10 rounded-xl text-xs font-semibold transition-colors ${canSave ? "bg-blue-600 hover:bg-blue-500 text-white border border-blue-500" : t.saveIdle}`}
                            >
                              Save link
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hint.length > 0 && (
        <p id={`${uid}-hint`} className={`text-[0.625rem] leading-snug ${t.hint}`}>
          {hint.includes("drag") && (
            <>
              Drag <GripIcon className="inline-block w-2 h-3 align-[-1px] mx-0.5" /> to reorder.{" "}
            </>
          )}
          {hint.includes("edit") && "Tap a link to edit it."}
        </p>
      )}
      <p className="sr-only" aria-live="polite">{said}</p>

      {canAddHeader && (
        <button
          type="button"
          onClick={addHeader}
          className={`block -ml-1.5 px-1.5 py-2 rounded-lg text-[0.6875rem] font-semibold transition-colors ${t.addHeader}`}
        >
          + Add a section header
        </button>
      )}
    </div>
  );
}
