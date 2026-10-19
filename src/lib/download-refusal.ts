import { NextResponse } from "next/server";

/**
 * A refusal for a link that opens as a FILE (an export in a new tab, or the
 * system browser from the app): plain words, not JSON. Someone who pressed
 * Export a few times saw {"error":"Too many requests…"} as the whole page
 * (audit F-OFFICE-10).
 */
export function downloadRefusal(message: string, status: number): NextResponse {
  return new NextResponse(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
