// This module holds the service-role key, which bypasses every row-level
// security policy in the database — the most dangerous value in the product.
// "Only use server-side" was a comment, and a comment is a hope.
//
// WHAT ENFORCES IT: tests/server-only-boundary.test.ts, which walks the import
// graph out of every "use client" entry and fails CI with the offending chain
// if any of them can reach this file. Verified to fire by injecting a
// violation and watching it fail, then pass again once removed.
//
// WHAT DOES NOT: `import "server-only"`, the React-official marker, was tried
// here first and does nothing under Turbopack — a client component that
// imports AND CALLS getAdminSupabase built with exit code 0 and loaded in a
// real browser with no build error and no console error. It also broke the
// test runner, which resolves the package to its throwing path. A guard that
// looks like protection and isn't is worse than none, so it is gone.
//
// Nothing has ever leaked: Next does not inline a non-NEXT_PUBLIC_ env var
// into client code, so the key itself cannot travel even along a bad import.
// The two modules that had drifted onto a client path (office-leads,
// office-team, each via a display constant) now keep those constants in
// lib/lead-status and lib/member-status.
import { createClient } from "@supabase/supabase-js";

// Hard cap on every call, like the session client in supabase-server.ts. With
// no cap, a slow database makes every hot route (card views, vCards, leads)
// hang until the function's max duration, so instances pile up instead of
// failing fast — the way a traffic spike turns into an outage. 10s is ~20× a
// normal round-trip. Storage gets 60s: uploads up to 25 MB go through here.
const ADMIN_TIMEOUT_MS = 10_000;
const ADMIN_STORAGE_TIMEOUT_MS = 60_000;

function cappedFetch(url: RequestInfo | URL, init?: RequestInit) {
  const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  const cap = AbortSignal.timeout(href.includes("/storage/v1/") ? ADMIN_STORAGE_TIMEOUT_MS : ADMIN_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, cap]) : cap;
  return fetch(url, { ...init, signal });
}

// Service-role client — bypasses RLS. Server-side only; see above.
export function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: cappedFetch } }
  );
}
