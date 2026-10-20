import { timingSafeEqual } from "node:crypto";
import { env } from "./env";

// Bearer CREW_TICK_SECRET, compared in constant time. Fails closed: with no
// secret configured, nothing is authorized.
export function tickAuthorized(header: string | null): boolean {
  const secret = env("CREW_TICK_SECRET");
  if (!secret) return false;
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
