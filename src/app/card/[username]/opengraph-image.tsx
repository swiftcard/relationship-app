import { ImageResponse } from "next/og";
import { resolveCardMeta } from "@/lib/resolve-card";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isCardActive } from "@/lib/card-active";
import { storedCaptureIsCurrent } from "@/lib/stored-capture";
import { BrandOg, loadBrandOgInputs } from "@/lib/brand-og";

// A pixel-perfect PNG of the real card, captured client-side on the dashboard
// and stored here. When present it IS the share preview, so the link unfurls
// with a picture identical to the card. Until it's captured (or on any error)
// we fall back to the rendered approximation below.
async function storedCardImage(username: string): Promise<ArrayBuffer | null> {
  try {
    const admin = getAdminSupabase();
    // Only a picture of the card that holds this address NOW
    // (lib/stored-capture) — never one left behind by a previous card.
    if (!(await storedCaptureIsCurrent(admin, "card-shares", username))) return null;
    const { data, error } = await admin.storage.from("card-shares").download(`${username}.png`);
    if (error || !data) return null;
    const buf = await data.arrayBuffer();
    return buf.byteLength > 1000 ? buf : null;
  } catch {
    return null;
  }
}

// Share preview = a picture of the ACTUAL card. When someone texts/DMs their
// SwiftCard link, the unfurl shows their card in their chosen template (colors,
// photo, logo, accent) — not a generic banner. Rendered with Satori, so each
// template is a faithful flexbox approximation of the real design.

// Match the card's real aspect ratio (1.75:1) so the preview IS the card,
// edge-to-edge, with NO blank backdrop around it. 1200 / 1.75 = 686.
// Messengers crop-to-fill their own slot from this, so no letterbox bars.
export const size = { width: 1200, height: 686 };
export const contentType = "image/png";
// Always reflect the live card (so edits show up in shares immediately).
export const dynamic = "force-dynamic";
// sharp (used to compress the stored capture) needs the Node runtime.
export const runtime = "nodejs";

type Meta = NonNullable<Awaited<ReturnType<typeof resolveCardMeta>>>;

function initialsOf(name: string | null | undefined) {
  return (name ?? "").split(" ").map((n) => n[0] ?? "").join("").toUpperCase().slice(0, 2) || "SC";
}

// Pre-fetch a remote image into a data: URI so the Satori render EMBEDS it and
// can never throw on a slow/failed image fetch (which would blow up the whole OG
// render and drop to the brand fallback — a card with no photo at all). On any
// problem we return null, so the Photo component just draws initials and the
// card still renders. Bounded by a short timeout so a stuck host can't hang the
// preview. (Only the Tier-2 rendered path uses this; Tier-1 is a stored PNG.)
async function embedImage(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  if (!/^https?:\/\//.test(url)) return null;
  // SSRF guard, same as wallet-strip.tsx: the URL is an owner-controlled DB
  // value and this fetch runs server-side — only touch the hosts our upload
  // flows write to (Supabase storage + our own domain), and never follow a
  // redirect off them. Anything else falls back to initials.
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    const ok = new Set<string>();
    for (const env of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me"]) {
      if (env) try { ok.add(new URL(env).hostname.toLowerCase()); } catch { /* ignore */ }
    }
    if (!ok.has(host)) return null;
  } catch {
    return null;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store", redirect: "error" }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/png";
    if (!/^image\//.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 100 || buf.byteLength > 6_000_000) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// Guaranteed-renderable branded fallback: the SAME picture the homepage and
// every marketing page unfurl with (lib/brand-og), at this route's 1200×686
// frame, so an offline/deleted card or a failed render never shows a
// generic placeholder. Every input it loads is optional and time-bounded,
// and its text is Latin-1 only, so it can't glyph-fail the way an arbitrary
// name/company could.
async function brandFallbackResponse(): Promise<Response> {
  const { fonts, ...inputs } = await loadBrandOgInputs(2500);
  const buf = await new ImageResponse(<BrandOg {...inputs} height={686} />, {
    ...size,
    fonts: fonts.length ? fonts : undefined,
  }).arrayBuffer();
  return new Response(buf, {
    headers: { "Content-Type": "image/png", "Cache-Control": CACHE_DEGRADED },
  });
}

// Absolute last resort: a static solid PNG (bytes are constant → cannot fail).
// Only reached if next/og itself is broken, which would be a deploy-wide issue.
const SOLID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAOCAIAAAC6mkspAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHElEQVR4nGPgFlSgCmIYNYh7NIy4R9OR4BDKIgAi4U7BLtU/7QAAAABJRU5ErkJggg==",
  "base64"
);

function Contact({ value, dot, color, fs = 27 }: { value: string; dot: string; color: string; fs?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 11, height: 11, borderRadius: 11, background: dot, flexShrink: 0 }} />
      <div style={{ fontSize: fs, color }}>{value}</div>
    </div>
  );
}

function Photo({ url, name, size: s, radius, border, bg = "#334155" }: { url: string | null; name: string; size: number; radius: number; border: string; bg?: string }) {
  if (url) {
    return <img src={url} alt="" width={s} height={s} style={{ borderRadius: radius, objectFit: "cover", border }} />;
  }
  return (
    <div style={{ width: s, height: s, borderRadius: radius, border, background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: s * 0.36, fontWeight: 800, color: "#fff" }}>
      {initialsOf(name)}
    </div>
  );
}

// ── Template renderers ──────────────────────────────────────────────────────

function ModernBoldOG(p: Meta) {
  const BLUE = p.accentColor || "#3b82f6";
  const website = (p.website ?? "").replace(/^https?:\/\//, "");
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#070d1c", padding: "48px 56px", position: "relative" }}>
      <div style={{ position: "absolute", top: -80, right: -60, width: 380, height: 380, borderRadius: 380, background: `radial-gradient(circle, ${BLUE}33 0%, transparent 70%)`, display: "flex" }} />
      {/* Company */}
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {p.logoUrl ? (
          <img src={p.logoUrl} alt="" width={56} height={56} style={{ borderRadius: 12, objectFit: "contain" }} />
        ) : null}
        {p.company ? <div style={{ fontSize: 26, letterSpacing: 5, color: "#cbd5e1", fontWeight: 700, textTransform: "uppercase" }}>{p.company}</div> : null}
      </div>
      {/* Name + title, photo right */}
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", gap: 40 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 76, fontWeight: 800, color: "#f1f5f9", lineHeight: 1.02 }}>{p.name}</div>
          {p.title ? <div style={{ fontSize: 34, color: BLUE, marginTop: 14, fontWeight: 600 }}>{p.title}</div> : null}
        </div>
        <Photo url={p.photoUrl} name={p.name ?? ""} size={210} radius={210} border={`6px solid ${BLUE}`} bg="#12203c" />
      </div>
      {/* Contacts */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {p.phone ? <Contact value={p.phone} dot={BLUE} color="#e2e8f0" fs={29} /> : null}
        {p.email ? <Contact value={p.email} dot={BLUE} color="#cbd5e1" /> : null}
        {website ? <Contact value={website} dot={BLUE} color="#cbd5e1" /> : null}
      </div>
    </div>
  );
}

function ClassicProOG(p: Meta) {
  const BLUE = p.accentColor || "#2563eb";
  const website = (p.website ?? "").replace(/^https?:\/\//, "");
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#fff", position: "relative" }}>
      {/* Left navy panel */}
      <div style={{ width: "37%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26, background: "linear-gradient(160deg, #0e1b35 0%, #162947 100%)" }}>
        <Photo url={p.photoUrl} name={p.name ?? ""} size={220} radius={220} border="7px solid rgba(255,255,255,0.18)" bg={BLUE} />
        {p.logoUrl ? (
          <img src={p.logoUrl} alt="" width={54} height={54} style={{ borderRadius: 12, objectFit: "contain" }} />
        ) : null}
      </div>
      {/* Right white panel */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, padding: "48px 56px" }}>
        <div style={{ fontSize: 66, fontWeight: 800, color: "#0f172a", lineHeight: 1.05 }}>{p.name}</div>
        <div style={{ width: 64, height: 6, borderRadius: 6, background: BLUE, marginTop: 16, display: "flex" }} />
        {p.title ? <div style={{ fontSize: 32, color: "#475569", marginTop: 18 }}>{p.title}</div> : null}
        {p.company ? <div style={{ fontSize: 30, fontWeight: 700, color: BLUE, marginTop: 4 }}>{p.company}</div> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 26 }}>
          {p.phone ? <Contact value={p.phone} dot={BLUE} color="#334155" fs={29} /> : null}
          {p.email ? <Contact value={p.email} dot={BLUE} color="#334155" /> : null}
          {website ? <Contact value={website} dot={BLUE} color="#334155" /> : null}
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 9, background: `linear-gradient(90deg, ${BLUE}, #7c3aed)`, display: "flex" }} />
    </div>
  );
}

function PhotoFirstOG(p: Meta) {
  const ACCENT = p.accentColor || "#6d28d9";
  const website = (p.website ?? "").replace(/^https?:\/\//, "");
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#fff" }}>
      {/* Left photo panel */}
      <div style={{ width: "40%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(145deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)" }}>
        <Photo url={p.photoUrl} name={p.name ?? ""} size={300} radius={40} border="8px solid rgba(255,255,255,0.25)" bg="rgba(255,255,255,0.15)" />
      </div>
      {/* Right details */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, padding: "48px 56px" }}>
        <div style={{ fontSize: 64, fontWeight: 800, color: "#1e1b4b", lineHeight: 1.05 }}>{p.name}</div>
        <div style={{ width: 80, height: 6, borderRadius: 6, background: `linear-gradient(90deg, ${ACCENT}, #a78bfa)`, marginTop: 16, display: "flex" }} />
        {p.title ? <div style={{ fontSize: 32, color: "#4b5563", marginTop: 18 }}>{p.title}</div> : null}
        {p.company ? <div style={{ fontSize: 30, fontWeight: 700, color: ACCENT, marginTop: 4 }}>{p.company}</div> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 26 }}>
          {p.phone ? <Contact value={p.phone} dot={ACCENT} color="#374151" fs={29} /> : null}
          {p.email ? <Contact value={p.email} dot={ACCENT} color="#374151" /> : null}
          {website ? <Contact value={website} dot={ACCENT} color="#374151" /> : null}
        </div>
      </div>
    </div>
  );
}

function LocalBusinessOG(p: Meta) {
  const AMBER = p.accentColor || "#b45309";
  const website = (p.website ?? "").replace(/^https?:\/\//, "");
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#fffbf0", position: "relative" }}>
      {/* Header band */}
      <div style={{ height: "33%", display: "flex", alignItems: "center", gap: 24, padding: "0 56px", background: `linear-gradient(100deg, ${AMBER} 0%, #92400e 60%, #f59e0b 100%)` }}>
        {p.logoUrl ? (
          <div style={{ width: 96, height: 96, borderRadius: 96, background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src={p.logoUrl} alt="" width={68} height={68} style={{ objectFit: "contain" }} />
          </div>
        ) : null}
        <div style={{ fontSize: 48, fontWeight: 800, color: "#fff" }}>{p.company || p.name}</div>
      </div>
      {/* Body */}
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", padding: "24px 56px 36px" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 58, fontWeight: 800, color: "#78350f", lineHeight: 1.05 }}>{p.name}</div>
          {p.title ? <div style={{ fontSize: 30, color: "#92400e", marginTop: 10 }}>{p.title}</div> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 22 }}>
            {p.phone ? <Contact value={p.phone} dot={AMBER} color="#78350f" fs={29} /> : null}
            {p.email ? <Contact value={p.email} dot={AMBER} color="#92400e" /> : null}
            {website ? <Contact value={website} dot={AMBER} color="#92400e" /> : null}
          </div>
        </div>
        <Photo url={p.photoUrl} name={p.name ?? ""} size={200} radius={200} border={`6px solid ${AMBER}`} bg="#92400e" />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 8, background: `linear-gradient(90deg, ${AMBER}, #f59e0b, #92400e)`, display: "flex" }} />
    </div>
  );
}

function LuxuryMinimalOG(p: Meta) {
  const GOLD = p.accentColor || "#b08d57";
  const website = (p.website ?? "").replace(/^https?:\/\//, "");
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#fafaf6" }}>
      {/* Gold spine */}
      <div style={{ width: 14, background: `linear-gradient(to bottom, #c9a96a, ${GOLD}, #8c6c34)`, display: "flex" }} />
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", padding: "48px 64px" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {p.company ? <div style={{ fontSize: 24, letterSpacing: 7, textTransform: "uppercase", color: "#8c7b60", fontWeight: 600 }}>{p.company}</div> : null}
          <div style={{ fontSize: 62, fontWeight: 700, color: "#1c1612", lineHeight: 1.08, marginTop: 14, letterSpacing: 1 }}>{p.name}</div>
          <div style={{ width: 90, height: 3, background: `linear-gradient(90deg, ${GOLD}, transparent)`, marginTop: 18, display: "flex" }} />
          {p.title ? <div style={{ fontSize: 29, color: "#8c7b60", marginTop: 16 }}>{p.title}</div> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 26 }}>
            {p.phone ? <Contact value={p.phone} dot={GOLD} color="#1c1612" fs={28} /> : null}
            {p.email ? <Contact value={p.email} dot={GOLD} color="#5f5142" /> : null}
            {website ? <Contact value={website} dot={GOLD} color="#5f5142" /> : null}
          </div>
        </div>
        <Photo url={p.photoUrl} name={p.name ?? ""} size={190} radius={190} border={`3px solid ${GOLD}`} bg="#8c7b60" />
      </div>
    </div>
  );
}

function LogoFirstOG(p: Meta) {
  const NAVY = "#2c3a52";
  // The title and icons have no ground of their own, so a dark accent on the
  // navy would simply vanish. The CARD answers that by brightening the owner's
  // colour until it reads (readableAccent in LogoFirst.tsx); this used to just
  // throw the colour away and use white, so a crimson card previewed with a
  // white title. Same idea, one step: lift it toward white until it clears.
  const raw = p.accentColor || "";
  const m = raw.match(/^#([0-9a-f]{6})$/i);
  const ACCENT = (() => {
    if (!m) return "#ffffff";
    const n = parseInt(m[1], 16);
    let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (let i = 0; i < 12; i++) {
      if ((r * 299 + g * 587 + b * 114) / 1000 > 110) break;
      r += (255 - r) * 0.16; g += (255 - g) * 0.16; b += (255 - b) * 0.16;
    }
    const hx = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    const out = `#${hx(r)}${hx(g)}${hx(b)}`;
    return (r * 299 + g * 587 + b * 114) / 1000 > 100 ? out : "#ffffff";
  })();
  const website = (p.website ?? "").replace(/^https?:\/\//, "");

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: NAVY }}>
      {/* Left: the mark on its tinted panel.
          There is no RING here any more, because there is no ring on the card:
          it was replaced by a clipped tile once it turned out that every logo
          real owners upload is an opaque rectangle, whose corners punched
          straight through a circle. A fixed-size tile rather than the card's
          shrink-to-fit one — shrink-to-fit is not worth betting a whole OG
          render on, since a throw here drops the card image entirely, and this
          path is the FALLBACK: the primary preview is a stored PNG capture of
          the real card. */}
      <div
        style={{
          width: "38%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(255,255,255,0.045)",
        }}
      >
        {p.logoUrl ? (
          <img src={p.logoUrl} alt="" width={230} height={170} style={{ objectFit: "contain", borderRadius: 18 }} />
        ) : (
          <div style={{ fontSize: 92, fontWeight: 700, color: ACCENT, letterSpacing: 4 }}>
            {initialsOf(p.company || p.name)}
          </div>
        )}
      </div>

      {/* Hairline rule — the card's own divider, at OG scale. */}
      <div style={{ width: 2, marginTop: 70, marginBottom: 70, background: "rgba(255,255,255,0.20)", display: "flex" }} />

      {/* Right: identity above, contact below */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, padding: "48px 60px" }}>
        {/* As typed, like the card: forced capitals made the name the loudest
            thing on it (owner, 2026-09-29). */}
        <div style={{ fontSize: 58, fontWeight: 600, color: "#ffffff", lineHeight: 1.1 }}>
          {p.name}
        </div>
        {/* Name, TITLE, then company — matching the card, which reordered these
            so the quietest line stopped sitting between the loudest two. */}
        {p.title ? (
          <div style={{ fontSize: 24, color: ACCENT, marginTop: 12, letterSpacing: 5, textTransform: "uppercase", fontWeight: 600 }}>
            {p.title}
          </div>
        ) : null}
        {p.company ? <div style={{ fontSize: 30, color: "#c2ccdc", marginTop: 14 }}>{p.company}</div> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 30 }}>
          {p.phone ? <Contact value={p.phone} dot={ACCENT} color="#ffffff" fs={29} /> : null}
          {p.email ? <Contact value={p.email} dot={ACCENT} color="#e6ebf3" /> : null}
          {website ? <Contact value={website} dot={ACCENT} color="#c2ccdc" /> : null}
        </div>
      </div>
    </div>
  );
}

// Generic fallback for "custom" layouts and anything unrecognized.
function GenericOG(p: Meta) {
  const accent = p.accentColor || "#2563eb";
  const website = (p.website ?? "").replace(/^https?:\/\//, "");
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#ffffff" }}>
      <div style={{ height: 16, background: accent, display: "flex" }} />
      <div style={{ display: "flex", flex: 1, padding: "44px 56px", alignItems: "center", gap: 48 }}>
        <Photo url={p.photoUrl} name={p.name ?? ""} size={230} radius={230} border={`8px solid ${accent}`} bg={accent} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 72, fontWeight: 800, color: "#0f172a", lineHeight: 1.0 }}>{p.name}</div>
          {p.title ? <div style={{ fontSize: 38, color: "#475569", marginTop: 12 }}>{p.title}</div> : null}
          {p.company ? <div style={{ fontSize: 36, fontWeight: 700, color: accent, marginTop: 2 }}>{p.company}</div> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 13, marginTop: 26 }}>
            {p.phone ? <Contact value={p.phone} dot={accent} color="#1e293b" fs={32} /> : null}
            {p.email ? <Contact value={p.email} dot={accent} color="#334155" fs={30} /> : null}
            {website ? <Contact value={website} dot={accent} color="#334155" fs={30} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// Render an element to a fully-materialized PNG Response. Forcing the buffer
// here (not returning the streaming ImageResponse) means a Satori failure —
// a missing glyph, an unexpected value — is caught by OUR try/catch instead of
// surfacing as a 500 / broken image on the messenger.
// ── How long a preview may be cached ────────────────────────────────────────
//
// The og:image URL carries ?v=<hash of every field that appears in the preview>
// (metaVersion, in page.tsx), so ANY edit that changes the picture also changes
// the URL. A preview is therefore immutable for its version and safe to cache
// hard — "reflect the live card immediately" is already guaranteed by the
// versioned URL, not by refusing to cache.
//
// stale-while-revalidate is the directive that fixes the reported bug. With it
// the edge serves the cached image INSTANTLY once it goes stale and refreshes
// behind the scenes, so a messenger unfurling a link never waits on a render.
//
// Measured before this change: s-maxage=60 and no SWR. The second scrape within
// a minute was a 0.1s HIT, and the first one after expiry was a ~2s MISS. A
// link shared more than a minute after the last unfurl paid a full cold render,
// and a scraper that times out shows NO preview and often caches that absence.
// That is precisely "sometimes it doesn't show the preview".
const CACHE_COMPLETE = "public, max-age=600, s-maxage=86400, stale-while-revalidate=604800";

// A DEGRADED preview must not be frozen at the edge for a day. If the headshot
// or logo failed to embed (embedImage gives up after 2.5s and the card falls
// back to initials), caching that for 24h is how "no headshot" becomes
// permanent — the other half of the report. Keep the old short TTL so the very
// next scrape retries the image.
const CACHE_DEGRADED = "public, max-age=60, s-maxage=60";

async function toResponse(
  el: React.ReactElement,
  contentType = "image/png",
  /** False when the render is missing something it wanted — see CACHE_DEGRADED. */
  complete = true,
): Promise<Response> {
  const buf = await new ImageResponse(el, { ...size }).arrayBuffer();
  return new Response(buf, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": complete ? CACHE_COMPLETE : CACHE_DEGRADED,
    },
  });
}

/**
 * Human-readable US phone formatting for the share preview.
 *
 * A local copy, matching lib/wallet.ts: the canonical formatPhone lives in
 * card-templates/shared.tsx, which also exports React components, and this
 * route already carries a heavy render. Anything not recognisably US is
 * returned untouched so international numbers are never mangled.
 */
function prettyPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
}

export default async function Image({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  // Kill-switch: a card that's offline, deleted, or plan-deactivated 404s on the
  // page and its metadata "goes dark", but the stored capture below would keep
  // serving the full card image (name/phone/email) forever. Honor the same
  // active check the wallet route uses, and fall through to the brand fallback
  // when inactive. (cards audit M2) Fails OPEN on error so a transient DB blip
  // doesn't blank a live card's share preview.
  let active = true;
  try { active = await isCardActive(username); } catch { active = true; }

  // ── Tier 1: the pixel-perfect capture of the real card ────────────────────
  // Cover-fit to the exact frame → full-bleed, no blank space. JPEG keeps it
  // small (~40-90KB, under WhatsApp's ~600KB ceiling). Any failure → next tier.
  if (active) try {
    const stored = await storedCardImage(username);
    if (stored) {
      const hdr = new DataView(stored);
      const ratio = hdr.getUint32(16) / Math.max(1, hdr.getUint32(20));
      if (ratio >= 1.25 && ratio <= 2.4) {
        const sharp = (await import("sharp")).default;
        const jpeg = await sharp(Buffer.from(stored))
          .resize(size.width, size.height, { fit: "cover", position: "centre" })
          .jpeg({ quality: 86 })
          .toBuffer();
        // The best possible preview — a picture of the real card, nothing
        // missing. Cache it hard; the versioned URL handles freshness.
        return new Response(new Uint8Array(jpeg), {
          headers: { "Content-Type": "image/jpeg", "Cache-Control": CACHE_COMPLETE },
        });
      }
    }
  } catch {
    /* fall through to the rendered card */
  }

  // ── Tier 2: faithfully render the card (full-bleed) ───────────────────────
  // Only for a card that exists and is live. An address with no card behind
  // it, or a card that's offline/deleted, is not anyone's card: it gets the
  // brand picture (Tier 3) — the same one the homepage unfurls with — never a
  // template rendered around a made-up "SwiftCard" name.
  let p: Meta | null = null;
  if (active) try { p = await resolveCardMeta(username); } catch { p = null; }
  if (p) try {
    const meta: Meta = p;
    // Never hand the renderers a null name (used for initials/hero text).
    if (!(typeof meta.name === "string" && meta.name.trim())) meta.name = "SwiftCard";

    // Embed the photo + logo as data URIs so Satori can't fail fetching them
    // (a failed fetch would throw the whole render → brand fallback with no
    // card). If embedding fails, the field is null and the card draws initials.
    //
    // Remember what the card WANTED before embedding, so a preview that lost
    // its headshot to a slow fetch can be told apart from one that never had a
    // headshot. Only the first is degraded, and only that one must expire fast.
    const wantedPhoto = !!meta.photoUrl;
    const wantedLogo = !!meta.logoUrl;
    [meta.photoUrl, meta.logoUrl] = await Promise.all([embedImage(meta.photoUrl), embedImage(meta.logoUrl)]);
    const complete = (!wantedPhoto || !!meta.photoUrl) && (!wantedLogo || !!meta.logoUrl);

    // Format the phone ONCE here rather than at each template's <Contact>, so
    // all seven stay consistent. The stored capture is a picture of the real
    // card, which already formats; this fallback rendered raw digits
    // ("4048550515"), so the preview someone saw depended on which tier served
    // it. Non-US numbers pass through untouched.
    if (meta.phone) meta.phone = prettyPhone(meta.phone);

    let card: React.ReactElement;
    switch (meta.template) {
      case "modern-bold":     card = ModernBoldOG(meta); break;
      case "classic-pro":     card = ClassicProOG(meta); break;
      case "photo-first":     card = PhotoFirstOG(meta); break;
      case "local-business":  card = LocalBusinessOG(meta); break;
      case "luxury-minimal":  card = LuxuryMinimalOG(meta); break;
      case "logo-first":      card = LogoFirstOG(meta); break;
      default:                card = meta.template ? GenericOG(meta) : ClassicProOG(meta); break;
    }
    // Full-bleed: the card fills the ENTIRE frame — no backdrop, no blank space.
    return await toResponse(<div style={{ width: "100%", height: "100%", display: "flex" }}>{card}</div>, "image/png", complete);
  } catch {
    /* fall through to the branded fallback */
  }

  // ── Tier 3: guaranteed branded image (ASCII only — can't glyph-fail) ──────
  try {
    return await brandFallbackResponse();
  } catch {
    /* fall through to the static bytes */
  }

  // ── Tier 4: static solid PNG — literally cannot fail ──────────────────────
  return new Response(SOLID_PNG, {
    headers: { "Content-Type": "image/png", "Cache-Control": CACHE_DEGRADED },
  });
}
