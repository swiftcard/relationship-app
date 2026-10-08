"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardData, CustomElement, CustomLayout, CustomField, CustomSocial } from "@/components/card-templates/types";
import { FreeCard } from "@/components/card-templates/CustomCard";
import CardScaler from "@/components/CardScaler";
import { AI_FONTS } from "@/lib/ai-card-design";

// ── Fine-tune a free design ─────────────────────────────────────────────────
//
// Owner, 2026-09-23: after AI design makes a card, "the user will have the
// option to fix up that card themselves so they can move things around on that
// card, make things bigger, change the font, change colors also — do all that."
//
// The card IS the control. Tap anything to select it; drag it to move it; drag
// the corner handle (or use − / +) to make it bigger or smaller. The panel
// beside it restyles whatever is selected — font, weight, capitals, alignment,
// colour, a photo's frame, a shape's transparency, what sits in front — or,
// with nothing selected, the whole card's background and font.
//
// WHAT YOU SEE IS WHAT PUBLISHES. The canvas is FreeCard, the renderer the
// public card page uses, inside CardScaler at the same 460 design width; every
// position is a % of the card and every size is design px, so the drag maths
// converts screen pixels by the card's on-screen width and nothing drifts.
//
// A drag is previewed locally and written ONCE, on release — the tab's Undo
// records one step per move, not one per pointer event.

type Props = {
  layout: CustomLayout;
  data: CardData;
  commit: (next: CustomLayout) => void;
  undo: { canUndo: boolean; run: () => void };
  /** Grid placement for the canvas and the panel (the designer's two tracks). */
  canvasClassName?: string;
  panelClassName?: string;
};

const FIELD_LABEL: Record<CustomField, string> = {
  name: "Name", title: "Job title", company: "Company", phone: "Phone", email: "Email",
  website: "Website", address: "Address", fax: "Fax",
};
const SOCIAL_LABEL: Record<CustomSocial, string> = {
  instagram: "Instagram", linkedin: "LinkedIn", twitter: "X", tiktok: "TikTok",
  snapchat: "Snapchat", youtube: "YouTube", facebook: "Facebook",
};

function labelOf(el: CustomElement): string {
  switch (el.type) {
    case "field": return FIELD_LABEL[el.field ?? "name"] ?? "Text";
    case "text": return "Your text";
    case "logo": return "Logo";
    case "headshot": return "Photo";
    case "qr": return "QR code";
    case "social": return SOCIAL_LABEL[el.social ?? "instagram"];
    case "socials": return "Social handles";
    case "divider": return "Line";
    case "shape": return el.shape === "circle" ? "Circle" : "Shape";
  }
}

const isText = (el: CustomElement) => el.type === "field" || el.type === "text" || el.type === "social" || el.type === "socials";
const FONT_CHOICES: { label: string; value: string }[] = [
  { label: "Sans", value: AI_FONTS.sans },
  { label: "Display", value: AI_FONTS.display },
  { label: "Serif", value: AI_FONTS.serif },
  { label: "Elegant", value: AI_FONTS.elegant },
  { label: "Mono", value: AI_FONTS.mono },
  { label: "Rounded", value: AI_FONTS.rounded },
];
const BASE_COLORS = ["#ffffff", "#f5f0e6", "#e2e8f0", "#94a3b8", "#475569", "#111827", "#000000", "#c9a96e", "#2563eb", "#0d9488", "#16a34a", "#dc2626", "#db2777", "#7c3aed", "#f59e0b"];
const BG_COLORS = ["#0f172a", "#111827", "#1e3a8a", "#1f3a2d", "#4c1d95", "#7f1d1d", "#0c0a09", "#ffffff", "#faf7f2", "#f1f5f9", "#fdf2f8", "#ecfdf5"];

const HEX = /#[0-9a-f]{6}/gi;
/** The colours a design is already made of, so re-colouring stays on palette. */
function paletteOf(layout: CustomLayout): string[] {
  const found = new Set<string>();
  const take = (v?: string) => { for (const m of (v ?? "").match(HEX) ?? []) found.add(m.toLowerCase()); };
  take(layout.background); take(layout.textColor); take(layout.accentColor);
  for (const el of layout.elements) { take(el.color); take(el.fill); take(el.stroke); }
  return [...found].slice(0, 8);
}

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The size a − / + / drag scales: font size for text, px for pictures, % for shapes. */
function scaleEl(el: CustomElement, factor: number): CustomElement {
  if (isText(el)) return { ...el, fontSize: round(clamp((el.fontSize ?? 12) * factor, 5, 72)) };
  if (el.type === "shape") {
    return {
      ...el,
      w: round(clamp((el.w ?? 20) * factor, 1, 200)),
      ...(el.shape === "circle" ? {} : { h: round(clamp((el.h ?? 20) * factor, 0.5, 200)) }),
    };
  }
  if (el.type === "divider") return { ...el, width: round(clamp((el.width ?? 80) * factor, 8, 440)) };
  const base = el.size ?? (el.type === "logo" ? 46 : el.type === "qr" ? 52 : 64);
  return { ...el, size: Math.round(clamp(base * factor, el.type === "qr" ? 34 : 16, 220)) };
}

function newId(els: CustomElement[], base: string): string {
  const taken = new Set(els.map((e) => e.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

type Drag =
  | { kind: "move"; id: string; x0: number; y0: number; ex: number; ey: number; cw: number; ch: number; moved: boolean }
  | { kind: "resize"; id: string; x0: number; y0: number; start: CustomElement; wPx: number; hPx: number; cw: number; ch: number };

export default function FreeCardEditor({ layout, data, commit, undo, canvasClassName = "", panelClassName = "" }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [live, setLive] = useState<CustomLayout | null>(null);
  const [box, setBox] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const shown = live ?? layout;
  const els = shown.elements;
  // A selection that no longer exists (Undo removed it) simply reads as none.
  const sel = els.find((e) => e.id === selected) ?? null;
  const palette = useMemo(() => paletteOf(layout), [layout]);


  // The selection outline follows the element's real box on the card.
  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const id = sel?.id;
    if (!wrap || !id) { setBox(null); return; }
    const node = wrap.querySelector(`[data-el="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!node) { setBox(null); return; }
    const w = wrap.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    setBox({ l: r.left - w.left, t: r.top - w.top, w: r.width, h: r.height });
  }, [sel?.id]);
  useEffect(() => {
    // Next frame: the card has painted this layout by then.
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [measure, shown]);

  const cardRect = () => (wrapRef.current?.querySelector(".sc-card") as HTMLElement | null)?.getBoundingClientRect() ?? null;

  function update(id: string, patch: Partial<CustomElement> | ((el: CustomElement) => CustomElement)) {
    commit({
      ...layout,
      elements: layout.elements.map((e) => (e.id === id ? (typeof patch === "function" ? patch(e) : { ...e, ...patch }) : e)),
    });
  }

  // ── Pointer: select, move, resize ─────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent) {
    const target = e.target as HTMLElement;
    const rect = cardRect();
    if (!rect) return;
    if (target.closest("[data-resize]") && sel) {
      const node = wrapRef.current?.querySelector(`[data-el="${CSS.escape(sel.id)}"]`) as HTMLElement | null;
      const r = node?.getBoundingClientRect();
      drag.current = { kind: "resize", id: sel.id, x0: e.clientX, y0: e.clientY, start: sel, wPx: r?.width ?? 40, hPx: r?.height ?? 20, cw: rect.width, ch: rect.height };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const hit = target.closest("[data-el]");
    const id = hit?.getAttribute("data-el") ?? null;
    if (!id) { setSelected(null); return; }
    const el = layout.elements.find((x) => x.id === id);
    if (!el) return;
    setSelected(id);
    drag.current = { kind: "move", id, x0: e.clientX, y0: e.clientY, ex: el.x, ey: el.y, cw: rect.width, ch: rect.height, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (d.kind === "move") {
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      let x = d.ex + (dx / d.cw) * 100;
      const y = d.ey + (dy / d.ch) * 100;
      const el = layout.elements.find((q) => q.id === d.id);
      // A centred element snaps to the card's centre line.
      if (el?.align === "center" && Math.abs(x - 50) < 1.2) x = 50;
      setLive({ ...layout, elements: layout.elements.map((q) => (q.id === d.id ? { ...q, x: round(clamp(x, -50, 150)), y: round(clamp(y, -50, 150)) } : q)) });
    } else {
      const factor = clamp(1 + Math.max(dx / Math.max(20, d.wPx), dy / Math.max(12, d.hPx)), 0.2, 6);
      const next = d.start.type === "shape" && d.start.shape !== "circle"
        ? { ...d.start, w: round(clamp((d.start.w ?? 20) * (1 + dx / Math.max(20, d.wPx)), 1, 200)), h: round(clamp((d.start.h ?? 20) * (1 + dy / Math.max(12, d.hPx)), 0.5, 200)) }
        : scaleEl(d.start, factor);
      setLive({ ...layout, elements: layout.elements.map((q) => (q.id === d.id ? next : q)) });
    }
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (live && d && (d.kind === "resize" || d.moved)) commit(live);
    setLive(null);
  }

  // ── Keyboard: nudge, remove, deselect ─────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    if (!sel) return;
    const step = e.shiftKey ? 2 : 0.5;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const [mx, my] = moves[e.key];
      update(sel.id, (el) => ({ ...el, x: round(el.x + mx), y: round(el.y + my) }));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(sel.id);
    } else if (e.key === "Escape") {
      setSelected(null);
    }
  }

  function remove(id: string) {
    commit({ ...layout, elements: layout.elements.filter((e) => e.id !== id) });
    setSelected(null);
  }

  function reorder(id: string, dir: 1 | -1) {
    const i = layout.elements.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= layout.elements.length) return;
    const next = [...layout.elements];
    [next[i], next[j]] = [next[j], next[i]];
    commit({ ...layout, elements: next });
  }

  /** Change what `x` means without the element moving on the card. */
  function setAlign(el: CustomElement, align: "left" | "center" | "right") {
    const rect = cardRect();
    const node = wrapRef.current?.querySelector(`[data-el="${CSS.escape(el.id)}"]`) as HTMLElement | null;
    if (!rect || !node) { update(el.id, { align }); return; }
    const r = node.getBoundingClientRect();
    const left = ((r.left - rect.left) / rect.width) * 100;
    const width = (r.width / rect.width) * 100;
    const x = align === "center" ? left + width / 2 : align === "right" ? left + width : left;
    update(el.id, { align, x: round(x) });
  }

  // ── Adding ────────────────────────────────────────────────────────────────
  // Only what this card actually has: an Instagram with no handle, or an
  // address never entered, would show a placeholder here and NOTHING on the
  // published card — which reads as the button not working.
  const cust = (data.customization ?? {}) as Record<string, unknown>;
  const has = (key: string): boolean => {
    const v = (data as unknown as Record<string, unknown>)[key] ?? cust[key];
    return typeof v === "string" && v.trim().length > 0;
  };
  const present = new Set(layout.elements.map((e) => (e.type === "field" ? `f:${e.field}` : e.type === "social" ? `s:${e.social}` : e.type)));
  const textInk = layout.textColor;
  const addables: { key: string; label: string; make: () => Omit<CustomElement, "id"> & { id?: string } }[] = [
    ...(["name", "title", "company", "phone", "email", "website", "address"] as CustomField[])
      .filter((f) => !present.has(`f:${f}`) && has(f))
      .map((f) => ({
        key: `f:${f}`, label: FIELD_LABEL[f],
        make: () => ({ type: "field" as const, field: f, x: 8, y: 44, fontSize: f === "name" ? 24 : 11, color: textInk, weight: f === "name" ? 700 : 400, icon: ["phone", "email", "website", "address"].includes(f) || undefined }),
      })),
    ...(!present.has("headshot") && data.photoUrl ? [{ key: "headshot", label: "Photo", make: () => ({ type: "headshot" as const, x: 70, y: 20, size: 72 }) }] : []),
    ...(!present.has("logo") && data.logoUrl ? [{ key: "logo", label: "Logo", make: () => ({ type: "logo" as const, x: 8, y: 10, size: 48 }) }] : []),
    ...(!present.has("qr") ? [{ key: "qr", label: "QR code", make: () => ({ type: "qr" as const, x: 95.65, y: 73.39, size: 50, align: "right" as const }) }] : []),
    ...(Object.keys(SOCIAL_LABEL) as CustomSocial[])
      .filter((s) => !present.has(`s:${s}`) && has(s))
      .map((s) => ({ key: `s:${s}`, label: SOCIAL_LABEL[s], make: () => ({ type: "social" as const, social: s, x: 8, y: 80, fontSize: 10, color: textInk }) })),
    { key: "text", label: "Text", make: () => ({ type: "text" as const, text: "Your text", x: 8, y: 50, fontSize: 12, color: textInk }) },
    { key: "line", label: "Line", make: () => ({ type: "shape" as const, shape: "rect" as const, x: 8, y: 50, w: 30, h: 0.9, fill: layout.accentColor ?? textInk }) },
    { key: "box", label: "Box", make: () => ({ type: "shape" as const, shape: "rect" as const, x: 60, y: 20, w: 30, h: 40, fill: layout.accentColor ?? textInk, radius: 10, opacity: 0.9 }) },
    { key: "circle", label: "Circle", make: () => ({ type: "shape" as const, shape: "circle" as const, x: 70, y: 10, w: 20, fill: layout.accentColor ?? textInk, opacity: 0.85 }) },
  ];

  function add(a: (typeof addables)[number]) {
    const made = a.make();
    const id = newId(layout.elements, a.key.replace(/^[fs]:/, ""));
    const el = { ...made, id } as CustomElement;
    // Shapes go BEHIND everything, so a new box never hides your name.
    const elements = el.type === "shape" ? [el, ...layout.elements] : [...layout.elements, el];
    commit({ ...layout, elements });
    setSelected(id);
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const panel = "bg-gray-900 border border-gray-800 rounded-xl";
  const head = "text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-gray-500";
  const rowLabel = "text-[0.6875rem] text-gray-500 w-[64px] shrink-0 pt-2";
  const chip = "sc-tap text-[0.8125rem] font-semibold px-3 py-1.5 rounded-lg border transition-colors";
  const chipOff = "bg-gray-800 border-gray-600 text-gray-100 hover:text-white hover:border-gray-400";
  const chipOn = "bg-blue-600 border-blue-600 text-white";
  const swatch = (color: string, active: boolean, onClick: () => void, label: string) => (
    <button
      key={label + color}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className="sc-tap-sq w-7 h-7 rounded-lg transition-transform hover:scale-110"
      style={{
        background: color,
        boxShadow: active ? "0 0 0 2px #0b0f16, 0 0 0 4px #3b82f6" : "inset 0 0 0 1px rgba(148,163,184,.35)",
      }}
    />
  );
  const colorRow = (current: string | undefined, onPick: (c: string) => void, choices: string[]) => (
    <div className="flex flex-wrap gap-1.5 min-w-0 items-center">
      {[...new Set([...palette, ...choices])].slice(0, 14).map((c) => swatch(c, (current ?? "").toLowerCase() === c, () => onPick(c), c))}
      <label className="flex items-center gap-1 text-[0.625rem] text-gray-500">
        <input
          type="color"
          aria-label="Any colour"
          value={/^#[0-9a-f]{6}$/i.test(current ?? "") ? (current as string) : "#2563eb"}
          onChange={(e) => onPick(e.target.value)}
          className="sc-tap-sq w-7 h-7 rounded bg-transparent border border-gray-700"
        />
        any
      </label>
    </div>
  );

  const i = sel ? layout.elements.findIndex((e) => e.id === sel.id) : -1;

  return (
    <>
      {/* ── The canvas ── */}
      <div className={canvasClassName}>
        <div className="rounded-2xl border border-gray-800 bg-[radial-gradient(120%_90%_at_50%_0%,#141a26_0%,#0b0f17_70%)] p-4 sm:p-6">
          <div
            ref={wrapRef}
            tabIndex={0}
            role="application"
            aria-label="Your card. Tap anything to select it, drag to move it; arrow keys nudge the selected item."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            className="sc-free-canvas relative select-none outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-2xl"
          >
            <style>{`.sc-free-canvas [data-el]{cursor:grab;touch-action:none}.sc-free-canvas [data-el]:active{cursor:grabbing}`}</style>
            <CardScaler>
              <FreeCard data={data} layout={shown} placeholder />
            </CardScaler>
            {box && sel && (
              <div
                aria-hidden
                className="absolute pointer-events-none rounded-[4px]"
                style={{ left: box.l - 3, top: box.t - 3, width: box.w + 6, height: box.h + 6, boxShadow: "0 0 0 1.5px #3b82f6, 0 0 0 3px rgba(59,130,246,0.25)" }}
              >
                <span
                  data-resize
                  className="absolute -right-2.5 -bottom-2.5 w-5 h-5 rounded-full bg-white border-2 border-blue-500 shadow pointer-events-auto cursor-nwse-resize"
                  style={{ touchAction: "none" }}
                  title="Drag to resize"
                />
              </div>
            )}
          </div>
        </div>
        <p className="text-[0.6875rem] text-gray-500 mt-2 min-w-0">
          {sel ? `${labelOf(sel)} — drag to move, drag the corner dot to resize.` : "Tap anything on the card to move it, resize it or restyle it."}
        </p>
      </div>

      {/* ── The panel ── */}
      <div className={`space-y-3 ${panelClassName}`}>
        <div className={`${panel} p-3 space-y-3`}>
          <div className="flex items-center justify-between gap-2">
            <p className={head}>{sel ? labelOf(sel) : "Fine-tune"}</p>
            <div className="flex items-center gap-1.5">
              {sel && (
                <button type="button" onClick={() => setSelected(null)} className="text-[0.6875rem] px-2.5 py-1 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500">
                  Done
                </button>
              )}
              <button
                type="button"
                onClick={undo.run}
                disabled={!undo.canUndo}
                className="text-[0.6875rem] px-2.5 py-1 rounded-lg border border-gray-700 text-gray-300 disabled:opacity-40 hover:border-gray-500 shrink-0"
              >
                ↶ Undo
              </button>
            </div>
          </div>

          {sel ? (
            <>
              <div className="flex gap-2 items-center">
                <span className={`${rowLabel} pt-0`}>Size</span>
                <div className="flex items-center gap-1.5">
                  <button type="button" aria-label="Smaller" onClick={() => update(sel.id, (el) => scaleEl(el, 1 / 1.1))} className={`${chip} ${chipOff} w-10`}>−</button>
                  <button type="button" aria-label="Bigger" onClick={() => update(sel.id, (el) => scaleEl(el, 1.1))} className={`${chip} ${chipOff} w-10`}>+</button>
                </div>
              </div>

              {isText(sel) && (
                <>
                  <div className="flex gap-2">
                    <span className={rowLabel}>Font</span>
                    <div className="flex flex-wrap gap-1.5 min-w-0">
                      {FONT_CHOICES.map((f) => {
                        const active = (sel.font ?? layout.fontFamily) === f.value;
                        return (
                          <button key={f.label} type="button" onClick={() => update(sel.id, { font: f.value })}
                            className={`${chip} ${active ? chipOn : chipOff}`} style={{ fontFamily: f.value }}>{f.label}</button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className={rowLabel}>Style</span>
                    <div className="flex flex-wrap gap-1.5 min-w-0">
                      <button type="button" aria-pressed={(sel.weight ?? (sel.bold ? 700 : 400)) >= 600}
                        onClick={() => update(sel.id, (el) => ({ ...el, bold: undefined, weight: (el.weight ?? (el.bold ? 700 : 400)) >= 600 ? 400 : 700 }))}
                        className={`${chip} ${(sel.weight ?? (sel.bold ? 700 : 400)) >= 600 ? chipOn : chipOff} font-bold`}>Bold</button>
                      <button type="button" aria-pressed={!!sel.italic} onClick={() => update(sel.id, { italic: !sel.italic || undefined })}
                        className={`${chip} ${sel.italic ? chipOn : chipOff} italic`}>Italic</button>
                      <button type="button" aria-pressed={!!sel.upper} onClick={() => update(sel.id, { upper: !sel.upper || undefined })}
                        className={`${chip} ${sel.upper ? chipOn : chipOff}`}>CAPS</button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className={rowLabel}>Align</span>
                    <div className="flex flex-wrap gap-1.5 min-w-0">
                      {(["left", "center", "right"] as const).map((a) => (
                        <button key={a} type="button" onClick={() => setAlign(sel, a)}
                          className={`${chip} ${(sel.align ?? "left") === a ? chipOn : chipOff}`}>{a === "left" ? "Left" : a === "center" ? "Centre" : "Right"}</button>
                      ))}
                    </div>
                  </div>
                  {sel.type === "text" && (
                    <div className="flex gap-2">
                      <span className={rowLabel}>Text</span>
                      <input
                        type="text"
                        value={sel.text ?? ""}
                        maxLength={120}
                        onChange={(e) => update(sel.id, { text: e.target.value })}
                        className="flex-1 min-w-0 bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <span className={rowLabel}>Colour</span>
                    {colorRow(sel.color ?? layout.textColor, (c) => update(sel.id, { color: c }), BASE_COLORS)}
                  </div>
                </>
              )}

              {(sel.type === "headshot" || sel.type === "logo") && (
                <div className="flex gap-2">
                  <span className={rowLabel}>Frame</span>
                  <div className="flex flex-wrap gap-1.5 min-w-0">
                    {(["circle", "rounded", "square"] as const).map((f) => {
                      const active = (sel.frame ?? (sel.type === "headshot" ? "circle" : "rounded")) === f;
                      return (
                        <button key={f} type="button" onClick={() => update(sel.id, { frame: f })}
                          className={`${chip} ${active ? chipOn : chipOff}`}>{f === "circle" ? "Circle" : f === "rounded" ? "Rounded" : "Square"}</button>
                      );
                    })}
                  </div>
                </div>
              )}

              {sel.type === "shape" && (
                <>
                  <div className="flex gap-2">
                    <span className={rowLabel}>Colour</span>
                    {colorRow(/^#[0-9a-f]{6}$/i.test(sel.fill ?? "") ? sel.fill : undefined, (c) => update(sel.id, { fill: c }), BASE_COLORS)}
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className={`${rowLabel} pt-0`}>See-through</span>
                    <input
                      type="range" min={10} max={100} step={5}
                      aria-label="Opacity"
                      value={Math.round((sel.opacity ?? 1) * 100)}
                      onChange={(e) => setLive({ ...layout, elements: layout.elements.map((q) => (q.id === sel.id ? { ...q, opacity: Number(e.target.value) / 100 } : q)) })}
                      onPointerUp={() => { if (live) { commit(live); setLive(null); } }}
                      onKeyUp={() => { if (live) { commit(live); setLive(null); } }}
                      className="flex-1 accent-blue-500"
                    />
                  </div>
                </>
              )}

              <div className="flex gap-2 items-center">
                <span className={`${rowLabel} pt-0`}>Move</span>
                <div className="flex flex-wrap gap-1.5">
                  {([["←", -1, 0, "Move left"], ["→", 1, 0, "Move right"], ["↑", 0, -1, "Move up"], ["↓", 0, 1, "Move down"]] as const).map(([g, mx, my, label]) => (
                    <button key={label} type="button" aria-label={label} onClick={() => update(sel.id, (el) => ({ ...el, x: round(el.x + mx), y: round(el.y + my) }))}
                      className={`${chip} ${chipOff} w-10`}>{g}</button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 items-center">
                <span className={`${rowLabel} pt-0`}>Layer</span>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" disabled={i >= layout.elements.length - 1} onClick={() => reorder(sel.id, 1)} className={`${chip} ${chipOff} disabled:opacity-40`}>Bring forward</button>
                  <button type="button" disabled={i <= 0} onClick={() => reorder(sel.id, -1)} className={`${chip} ${chipOff} disabled:opacity-40`}>Send back</button>
                </div>
              </div>

              <button type="button" onClick={() => remove(sel.id)} className="text-[0.75rem] text-red-400 hover:text-red-300 py-1.5 pr-2">
                Remove from card
              </button>
            </>
          ) : (
            <>
              {/* A copied card's artwork sits under everything (Copy a card).
                  Removing it leaves the background colour and every element. */}
              {layout.bgImage && (
                <div className="flex gap-2 items-center">
                  <span className={`${rowLabel} pt-0`}>Artwork</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[0.75rem] text-gray-300">Copied from your card</span>
                    <button type="button" onClick={() => commit({ ...layout, bgImage: undefined })} className={`${chip} ${chipOff}`}>
                      Remove artwork
                    </button>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <span className={rowLabel}>Background</span>
                {colorRow(
                  /^#[0-9a-f]{6}$/i.test(layout.background) ? layout.background : undefined,
                  (c) => commit({ ...layout, background: c }),
                  BG_COLORS,
                )}
              </div>
              <div className="flex gap-2">
                <span className={rowLabel}>Font</span>
                <div className="flex flex-wrap gap-1.5 min-w-0">
                  {FONT_CHOICES.map((f) => (
                    <button
                      key={f.label}
                      type="button"
                      // The whole card: every line takes this font.
                      onClick={() => commit({ ...layout, fontFamily: f.value, elements: layout.elements.map((e) => (isText(e) ? { ...e, font: undefined } : e)) })}
                      className={`${chip} ${layout.fontFamily === f.value && !layout.elements.some((e) => isText(e) && e.font) ? chipOn : chipOff}`}
                      style={{ fontFamily: f.value }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className={`${panel} p-3`}>
          <p className={`${head} mb-2`}>Add to card</p>
          <div className="flex flex-wrap gap-1.5">
            {addables.map((a) => (
              <button key={a.key} type="button" onClick={() => add(a)} className={`${chip} ${chipOff}`}>+ {a.label}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
