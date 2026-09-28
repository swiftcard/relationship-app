// ── Design transfer: an uploaded card design, re-issued to the owner ────────
//
// The owner uploads a picture of a card design they like (their old printed
// card, a template screenshot, someone else's card). The image model rebuilds
// THAT design carrying THIS owner's details. This file owns the instruction —
// pure string-building, no fetch — so tests can pin what the model is asked
// without touching a provider.
//
// The contract with the caller (and the UI): the output is a PROPOSAL. Image
// models fumble small text often enough that nothing here may auto-publish;
// the owner approves a side-by-side preview or regenerates. "It cannot make
// any mistakes" is delivered by that gate, not by trusting the model.

export type TransferIdentity = {
  name: string;
  title?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  /** Whether reference images ride along in the same request, in this order. */
  hasHeadshot?: boolean;
  hasLogo?: boolean;
};

/** One line per fact the model may print — and an explicit "omit" list, because
 *  the single worst failure is the TEMPLATE's details surviving onto the card. */
export function transferPrompt(id: TransferIdentity): string {
  const facts: string[] = [`- Name: ${id.name}`];
  if (id.title?.trim()) facts.push(`- Job title: ${id.title.trim()}`);
  if (id.company?.trim()) facts.push(`- Company: ${id.company.trim()}`);
  if (id.phone?.trim()) facts.push(`- Phone: ${id.phone.trim()}`);
  if (id.email?.trim()) facts.push(`- Email: ${id.email.trim()}`);
  if (id.website?.trim()) facts.push(`- Website: ${id.website.trim()}`);
  if (id.address?.trim()) facts.push(`- Address: ${id.address.trim()}`);

  const refs: string[] = [];
  if (id.hasHeadshot) refs.push("The FIRST extra image is this person's headshot — put it wherever the design shows a person's photo, cropped the same way.");
  if (id.hasLogo) refs.push(`The ${id.hasHeadshot ? "SECOND" : "FIRST"} extra image is their company logo — put it wherever the design shows a logo.`);

  return [
    "The first image shows a business card design. Recreate that DESIGN exactly —",
    "same layout, same fonts, same colours, same graphics, same alignment and",
    "spacing — but belonging to a different person, whose details are below:",
    "",
    ...facts,
    "",
    ...refs,
    "",
    "Rules, in order of importance:",
    "- Your output is the card's FACE alone: flat, straight-on, filling the",
    "  entire canvas edge to edge. If the image is a PHOTOGRAPH of a physical",
    "  card — held in a hand, lying on a table, at an angle, in a scene — extract",
    "  the card's printed design and flatten it. Never include hands, fingers,",
    "  backgrounds, tables, shadows, other cards, or any of the scene.",
    "- FIRST erase every trace of the original owner: their name, initials,",
    "  monogram, job title, company, phone, email, address, handles, and any",
    "  quote or tagline that is theirs. THEN print the details listed above in",
    "  the erased text's positions and style. The finished card must not contain",
    "  a single character of the original owner's information — if a detail",
    "  above has no counterpart on the original, place it harmoniously; if an",
    "  original text has no replacement listed, its space stays empty.",
    "- Do not add, move, resize or restyle the design's graphics. Do not add a",
    "  QR code, logo or decoration the original does not have.",
    "- Spell every detail exactly as written above, character for character.",
    "Return only the edited image.",
  ].join("\n");
}

/** Everything the approval UI asks the owner to eyeball, in checklist order.
 *  Kept next to the prompt so the two never drift apart. */
export function transferChecklist(id: TransferIdentity): string[] {
  const items = ["Your name is spelled exactly right"];
  if (id.phone?.trim()) items.push("The phone number is yours, digit for digit");
  if (id.email?.trim()) items.push("The email is yours, character for character");
  if (id.company?.trim() || id.title?.trim()) items.push("Title and company read correctly");
  items.push("Nothing from the original card's owner is still visible");
  return items;
}

// ── The FREE path: measure with vision, typeset ourselves ───────────────────
//
// Image GENERATION is a paid Google tier and the owner declined it, so the
// default pipeline is: a vision model (free tier) MEASURES the uploaded
// design — surfaces, positions, colors, sizes — and we render the owner's
// details at those measurements with Satori. The trade against generation:
// backgrounds are reconstructed (flat surfaces, panels, bars — not photo
// textures), but every letter is typeset by US, so a phone number can never
// come back misspelled. For "no mistakes", that is the better half to own.

import { ImageResponse } from "next/og";

export type FaceElementKind =
  | "name" | "title" | "company" | "phone" | "email" | "website" | "address"
  | "headshot" | "logo";

export type FaceElement = {
  kind: FaceElementKind;
  /** Percent of the card, 0–100; (x,y) is the element's top-left. */
  x: number; y: number; w: number; h: number;
  align: "left" | "center" | "right";
  color: string;
  weight: "normal" | "bold";
  size: "xs" | "sm" | "md" | "lg" | "xl";
  caps?: boolean;
  /** Circular crop (headshots). */
  round?: boolean;
};

export type FaceLayout = {
  background: string;
  panels: { x: number; y: number; w: number; h: number; color: string }[];
  serif?: boolean;
  elements: FaceElement[];
};

/** What the vision model is asked for. Measurements only — it never invents
 *  content, because the renderer only prints the owner's own values. */
export const PRECISE_SCAN_PROMPT = [
  "You are measuring a business card design so it can be rebuilt exactly.",
  "Report the design's GEOMETRY AND COLOURS. Do NOT transcribe any text values.",
  "",
  "Return ONLY valid JSON:",
  '{"background":"#rrggbb","serif":true|false,',
  ' "panels":[{"x":0,"y":0,"w":35,"h":100,"color":"#rrggbb"}],',
  ' "elements":[{"kind":"name","x":40,"y":18,"w":50,"h":10,"align":"left",',
  '   "color":"#rrggbb","weight":"bold","size":"xl","caps":false,"round":false}]}',
  "",
  "All x,y,w,h are PERCENT of the card (0-100), x,y = top-left corner.",
  "background = the card's base surface. panels = every OTHER solid surface:",
  "  colored bands, side panels, footer bars, accent stripes (thin bars are",
  "  panels with small h or w).",
  'elements: one entry per piece of content, kinds only from this list:',
  '  "name","title","company","phone","email","website","address" (text),',
  '  "headshot","logo" (images). Skip QR codes entirely. Skip icons.',
  'size = relative text prominence: "xl" the largest text, "xs" the smallest.',
  '"round": true when the photo/logo is displayed in a circle.',
  "Measure carefully — where things sit is the whole job. Omit what is not there.",
].join("\n");

const clamp = (v: unknown, lo: number, hi: number, fb: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fb;
  return Math.min(hi, Math.max(lo, n));
};
const hex = (v: unknown, fb: string): string =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : fb;

const KINDS = new Set<FaceElementKind>(["name", "title", "company", "phone", "email", "website", "address", "headshot", "logo"]);

// Design px on the 1400×800 canvas, by prominence tier. Measured against
// printed-card conventions (name ≈ 2-3× body size). Declared before
// faceLayoutFromScan because the bounds pass needs real glyph heights.
const FACE_PX: Record<FaceElement["size"], number> = { xs: 26, sm: 32, md: 42, lg: 58, xl: 84 };

/** Model output → renderable layout. Whitelist + clamp everything; a hostile
 *  or confused reading can only produce a plain card, never bad values. */
export function faceLayoutFromScan(raw: unknown): FaceLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const panels = (Array.isArray(r.panels) ? r.panels : []).slice(0, 8).flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const q = p as Record<string, unknown>;
    return [{
      x: clamp(q.x, 0, 100, 0), y: clamp(q.y, 0, 100, 0),
      w: clamp(q.w, 0.5, 100, 10), h: clamp(q.h, 0.5, 100, 10),
      color: hex(q.color, "#e5e7eb"),
    }];
  });
  const seen = new Set<string>();
  const elements = (Array.isArray(r.elements) ? r.elements : []).slice(0, 16).flatMap((e) => {
    if (!e || typeof e !== "object") return [];
    const q = e as Record<string, unknown>;
    const kind = typeof q.kind === "string" ? (q.kind.toLowerCase() as FaceElementKind) : null;
    if (!kind || !KINDS.has(kind) || seen.has(kind)) return [];
    seen.add(kind);
    return [{
      kind,
      x: clamp(q.x, 0, 96, 5), y: clamp(q.y, 0, 96, 5),
      w: clamp(q.w, 2, 100, 40), h: clamp(q.h, 2, 100, 10),
      align: (q.align === "center" || q.align === "right" ? q.align : "left") as FaceElement["align"],
      color: hex(q.color, "#111827"),
      weight: q.weight === "normal" ? "normal" as const : "bold" as const,
      size: (["xs", "sm", "md", "lg", "xl"] as const).includes(q.size as never) ? (q.size as FaceElement["size"]) : "md",
      caps: q.caps === true,
      round: q.round === true,
    }];
  });
  const background = hex(r.background, "#ffffff");

  // ── Rescue passes over the measured elements ──────────────────────────────
  // The model's measurements are kept wherever they're usable, but two classes
  // of reading produced visibly broken cards in production (2026-08-18 probe):
  // an element COLORED for one surface but POSITIONED on another (white name
  // on a white panel), and an element measured so low/right that its glyphs
  // rendered half off the canvas. Both are fixed here, in the pure validator,
  // so they're testable without a model.
  const yiqOf = (h: string): number | null => {
    const m = /^#([0-9a-f]{6})$/i.exec(h);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
  };
  // The surface actually under a point: the LAST matching panel wins, matching
  // paint order in the renderer (later panels draw on top).
  const surfaceAt = (x: number, y: number): string => {
    let c = background;
    for (const p of panels) {
      if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) c = p.color;
    }
    return c;
  };
  for (const e of elements) {
    if (e.kind === "headshot" || e.kind === "logo") {
      // Images: slide fully onto the canvas.
      if (e.x + e.w > 100) e.x = Math.max(0, 100 - e.w);
      if (e.y + e.h > 100) e.y = Math.max(0, 100 - e.h);
      continue;
    }
    // Text: the box must hold the GLYPHS, not just the measured h — an "xl"
    // line is ~11% of the card tall regardless of what the model said.
    const glyphH = ((FACE_PX[e.size] * 1.3) / 800) * 100;
    const needH = Math.max(e.h, glyphH);
    if (e.y + needH > 98) e.y = Math.max(0, 98 - needH);
    if (e.x + e.w > 100) e.x = Math.max(0, 100 - e.w);
    // Unreadable ink for the surface it actually sits on → flip to whichever
    // pole contrasts. A readable measured color (accents included) is kept.
    const sy = yiqOf(surfaceAt(e.x + e.w / 2, e.y + needH / 2));
    const ty = yiqOf(e.color);
    if (sy !== null && ty !== null && Math.abs(sy - ty) < 70) {
      e.color = sy < 140 ? "#ffffff" : "#141b26";
    }
  }

  // Thin accent bars (underlines, rules) measured at the original text's
  // position land mid-glyph once OUR value renders taller or lower than the
  // original — a line through the owner's name (seen in the 2026-08-18 sweep).
  // A bar that crosses a text element's glyph box slides to just below it,
  // which is where an underline was always meant to sit.
  for (const p of panels) {
    if (p.h > 3) continue; // only rules/underlines, never real surfaces
    for (const e of elements) {
      if (e.kind === "headshot" || e.kind === "logo") continue;
      const glyphH = ((FACE_PX[e.size] * 1.3) / 800) * 100;
      const top = e.y, bottom = e.y + Math.max(e.h, glyphH);
      const overlapsX = p.x < e.x + e.w && p.x + p.w > e.x;
      const crossesText = p.y + p.h > top + 1 && p.y < bottom - 1;
      if (overlapsX && crossesText) p.y = Math.min(100 - p.h, bottom + 0.5);
    }
  }

  if (!elements.some((e) => e.kind === "name")) {
    // A reading without a name slot was REJECTED at first — and that killed
    // real, otherwise-good readings in production (the model sometimes labels
    // the big text something else, or the elements list truncates). The name
    // is the one thing we can always place sensibly ourselves: right of the
    // widest full-height side panel, dark-on-light or light-on-dark.
    const side = panels
      .filter((p) => p.x <= 2 && p.h >= 80 && p.w < 60)
      .reduce((m, p) => Math.max(m, p.x + p.w), 0);
    const n = parseInt(background.slice(1), 16);
    const lum = (((n >> 16) & 255) * 299 + (((n >> 8) & 255) * 587) + ((n & 255) * 114)) / 1000;
    elements.unshift({
      kind: "name", x: Math.min(side + 5, 60), y: 14, w: Math.max(30, 90 - side), h: 12,
      align: "left", color: lum < 128 ? "#ffffff" : "#111827", weight: "bold", size: "xl",
      caps: false, round: false,
    });
  }
  return { background, panels, serif: r.serif === true, elements };
}

// ── Serif support ────────────────────────────────────────────────────────────
// The vision model measures whether the design is set in a serif face, and the
// renderer used to throw that reading away (Satori only draws fonts it has
// data for, and only the default sans ships). One cached fetch per lambda
// instance loads a real serif; a failed fetch falls back to sans rather than
// failing the render.
let serifFontsPromise: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700 }[] | null> | null = null;
function loadSerifFonts(): Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700 }[] | null> {
  serifFontsPromise ??= (async () => {
    try {
      const css = await (await fetch(
        "https://fonts.googleapis.com/css2?family=Noto+Serif:wght@400;700&display=swap",
        // A non-browser UA makes Google serve plain TTF urls, which Satori can read.
        { headers: { "User-Agent": "curl/8" } },
      )).text();
      const urls = [...css.matchAll(/src:\s*url\((https:\/\/fonts\.gstatic\.com[^)]+\.ttf)\)/g)].map((m) => m[1]);
      if (urls.length < 2) return null;
      const [reg, bold] = await Promise.all(urls.slice(0, 2).map(async (u) => (await fetch(u)).arrayBuffer()));
      return [
        { name: "face-serif", data: reg, weight: 400 as const },
        { name: "face-serif", data: bold, weight: 700 as const },
      ];
    } catch {
      return null;
    }
  })();
  return serifFontsPromise;
}

/** Typeset the owner's details onto the measured layout. 1400×800 (1.75:1). */
export async function renderFaceImage(
  layout: FaceLayout,
  id: TransferIdentity,
  images: { headshot?: string | null; logo?: string | null },
  /** Hybrid engine: render ONLY the text + headshot/logo on a transparent
   *  canvas, for compositing over the model's artwork copy. Default renders
   *  the full card (background + panels) exactly as before. */
  opts?: { overlayOnly?: boolean },
): Promise<Buffer> {
  const overlayOnly = opts?.overlayOnly === true;
  const W = 1400, H = 800;
  const value = (k: FaceElementKind): string | null => {
    switch (k) {
      case "name": return id.name || null;
      case "title": return id.title?.trim() || null;
      case "company": return id.company?.trim() || null;
      case "phone": return id.phone?.trim() || null;
      case "email": return id.email?.trim() || null;
      case "website": return id.website?.trim() || null;
      case "address": return id.address?.trim() || null;
      default: return null;
    }
  };
  const serifFonts = layout.serif ? await loadSerifFonts() : null;
  const res = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: overlayOnly ? "transparent" : layout.background, fontFamily: serifFonts ? "face-serif" : "sans-serif" }}>
        {(overlayOnly ? [] : layout.panels).map((p, i) => (
          <div key={`p${i}`} style={{ position: "absolute", left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h}%`, background: p.color, display: "flex" }} />
        ))}
        {layout.elements.map((e, i) => {
          if (e.kind === "headshot" || e.kind === "logo") {
            const src = e.kind === "headshot" ? images.headshot : images.logo;
            if (!src) return null;
            const px = (e.w / 100) * W, py = (e.h / 100) * H;
            return (
              // eslint-disable-next-line @next/next/no-img-element -- Satori element
              <img key={`e${i}`} alt="" src={src} width={Math.round(px)} height={Math.round(py)}
                style={{ position: "absolute", left: `${e.x}%`, top: `${e.y}%`, objectFit: e.kind === "logo" ? "contain" : "cover", borderRadius: e.round ? 9999 : 12 }} />
            );
          }
          const text = value(e.kind);
          if (!text) return null;
          // Fit the VALUE to the measured box, on ONE line: an email is
          // routinely longer than the token it replaces, and both a wrapped
          // stack and an overflowing line read as broken. Shrink toward a
          // legible floor first; if the floor still doesn't fit, widen the box
          // (re-anchored by its alignment) instead of letting the text wrap.
          const estW = (px: number) => text.length * px * (0.56 + (e.caps ? 0.06 : 0));
          let fontPx = FACE_PX[e.size];
          if (estW(fontPx) > (e.w / 100) * W) fontPx = Math.max(24, Math.floor(((e.w / 100) * W) / (text.length * 0.56)));
          let wPct = e.w, xPct = e.x;
          const needPct = Math.min(96, (estW(fontPx) / W) * 100 + 1);
          if (needPct > wPct) {
            if (e.align === "right") xPct = Math.max(2, xPct + wPct - needPct);
            else if (e.align === "center") xPct = Math.max(2, xPct + (wPct - needPct) / 2);
            else xPct = Math.min(xPct, 100 - needPct);
            wPct = needPct;
          }
          return (
            <div key={`e${i}`} style={{
              position: "absolute", left: `${xPct}%`, top: `${e.y}%`, width: `${wPct}%`, minHeight: `${e.h}%`,
              display: "flex", alignItems: "center",
              justifyContent: e.align === "center" ? "center" : e.align === "right" ? "flex-end" : "flex-start",
              fontSize: fontPx, fontWeight: e.weight === "bold" ? 700 : 400, color: e.color,
              textTransform: e.caps ? "uppercase" : "none", lineHeight: 1.15, whiteSpace: "nowrap",
              letterSpacing: e.caps ? 2 : 0,
            }}>
              {text}
            </div>
          );
        })}
      </div>
    ),
    {
      width: W, height: H,
      ...(serifFonts ? { fonts: serifFonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: "normal" as const })) } : {}),
    },
  );
  return Buffer.from(await res.arrayBuffer());
}

// ── The leak gate ─────────────────────────────────────────────────────────────
//
// The image model was ORDERED to erase the original owner's details, and in
// live tests (2026-08-19) it still occasionally kept an email beside the new
// one. Orders aren't guarantees, so the route verifies: a vision pass
// transcribes every email and phone on the GENERATED card, and anything that
// isn't the owner's is a leak. Emails and phones are the checkable, dangerous
// leaks — a stray first name can't misroute anyone's call.

// ── The hybrid engine's artwork pass ─────────────────────────────────────────
//
// Full rebuilds fail the leak gate whenever the model redraws TEXT — it copies
// artwork faithfully but misspells and leaks lettering. So the hybrid engine
// divides the labor: the model reproduces ONLY the artwork (this prompt), and
// renderFaceImage overlays the owner's details in real type. No letter is ever
// model-drawn, so the text can't be wrong; the background is the model's
// pixel-faithful copy, so the design isn't a flat reconstruction.
export const STRIP_ARTWORK_PROMPT = [
  "Reproduce this business card design EXACTLY — same canvas, same background,",
  "same colors, gradients, panels, shapes, borders, textures and decorative",
  "artwork, at the same positions.",
  "REMOVE COMPLETELY: all text and lettering of every kind, all logos and",
  "wordmarks, all QR codes and barcodes, and all photographs of people.",
  "Where something was removed, continue the underlying background seamlessly.",
  "Do NOT add anything new. Output only the cleaned design.",
].join(" ");

export const LEAK_SCAN_PROMPT = [
  "Transcribe every email address, every phone number, and every street/postal",
  "address printed on this business card image. Return ONLY valid JSON:",
  '{"emails":["..."],"phones":["..."],"addresses":["..."]}',
  "Empty arrays if none. Do not include anything else.",
].join("\n");

const digits = (s: string) => s.replace(/\D/g, "");

/** Emails/phones on the generated card that do NOT belong to the identity. */
export function findLeaks(
  scan: unknown,
  id: TransferIdentity,
): string[] {
  if (!scan || typeof scan !== "object") return [];
  const r = scan as { emails?: unknown; phones?: unknown };
  const leaks: string[] = [];
  const okEmail = (id.email ?? "").trim().toLowerCase();
  for (const e of Array.isArray(r.emails) ? r.emails : []) {
    if (typeof e !== "string") continue;
    const v = e.trim().toLowerCase();
    if (v && v !== okEmail) leaks.push(e.trim());
  }
  const okPhone = digits(id.phone ?? "");
  for (const p of Array.isArray(r.phones) ? r.phones : []) {
    if (typeof p !== "string") continue;
    const d = digits(p);
    // Same last-10 rule the SMS suppression uses; short fragments are noise.
    if (d.length >= 7 && d.slice(-10) !== okPhone.slice(-10)) leaks.push(p.trim());
  }
  // A street address that isn't the owner's is the same failure as a foreign
  // email — the original card's data on the rebuilt card (live case
  // 2026-08-26: identity had no address, and the source card's survived).
  // Compared on digits+first-word so OCR punctuation/casing noise can't make
  // the owner's own address read as a leak.
  const okAddr = (id.address ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const addrs = (r as { addresses?: unknown }).addresses;
  for (const a of Array.isArray(addrs) ? addrs : []) {
    if (typeof a !== "string") continue;
    const norm = a.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (norm.length < 6) continue; // fragments are noise
    if (!okAddr || !okAddr.includes(norm.split(" ").slice(0, 2).join(" "))) leaks.push(a.trim());
  }
  return leaks;
}

/** One corrective sentence for the retry attempt. */
export function leakRetrySuffix(leaks: string[]): string {
  return [
    "",
    `YOUR PREVIOUS ATTEMPT FAILED: it kept ${leaks.map((l) => `"${l}"`).join(" and ")}`,
    "from the original card. Remove every trace of it. That text must not",
    "appear anywhere on the output.",
  ].join("\n");
}
