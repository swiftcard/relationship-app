import { isHexColor, qrSvgMarkup } from "@/lib/qr-svg";

// ── GET /api/qr?u=<text>&fg=<#hex> → the SwiftCard QR as an SVG file ────────
//
// The marketing pages' cards (homepage showcase and gallery, /for, /templates)
// put their codes on the page as <img src="/api/qr?…"> instead of inline SVG
// path data — see card-templates/qr-render-mode.tsx for why. The drawing is
// lib/qr-svg's, the same one MiniQR renders inline, so the picture is the
// real code and still scans.
//
// Immutable for a year: the response is a pure function of the query string,
// and the CDN may keep it (s-maxage) so a code is drawn once, not per visit.
// `u` is only ever encoded into the module bits, never written into the
// markup; `fg` must be a hex colour, so nothing a caller sends reaches the
// SVG as text.

const MAX_TEXT = 512;

export function GET(req: Request): Response {
  const { searchParams } = new URL(req.url);
  const u = searchParams.get("u") ?? "";
  const fg = searchParams.get("fg") ?? "#111827";
  if (!u || u.length > MAX_TEXT || !isHexColor(fg)) {
    return new Response("Bad request", { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const svg = qrSvgMarkup(u, fg);
  if (!svg) return new Response("Cannot encode", { status: 400, headers: { "Cache-Control": "no-store" } });
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      // Belt and braces for a direct visit: the file is plain shapes and must
      // never be a vehicle for script.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
