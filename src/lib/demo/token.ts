import { createHash, randomBytes } from "node:crypto";
import { decryptToken, encryptToken } from "@/lib/token-crypto";

// ── The reschedule / cancel link ────────────────────────────────────────────
// swiftcard.me/demo/manage#<token>. The token rides after the "#", which a
// browser never sends to any server, so it can't land in Vercel's logs, the
// site analytics or an error report, and a mail scanner that fetches the link
// gets only the empty page. The page reads it and POSTs it.
//
// Stored twice: the sha256 finds the booking; the encrypted copy lets the clock
// put the same link in reminders it builds days later, and lets the admin copy
// it. The plain token is never stored.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export function hashManageToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newManageToken(): { token: string; hash: string; enc: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashManageToken(token), enc: encryptToken(token) };
}

/** 32 random bytes in base64url is exactly 43 characters of [A-Za-z0-9_-]. */
export function isManageTokenShape(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}

export type ManageAction = "confirm" | "reschedule" | "cancel";

/** The link for a booking. `action` opens the page on that step. */
export function manageUrl(b: { manage_token_enc: string }, action?: ManageAction): string {
  const token = decryptToken(b.manage_token_enc);
  return `${APP_URL}/demo/manage${action ? `?a=${action}` : ""}#${token}`;
}
