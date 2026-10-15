import { createClient } from "@/lib/supabase-server";

// Admin access is gated by ADMIN_EMAILS (comma-separated env var) — the same
// gate used across every /admin page and /api/admin route.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email?: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

// ── Two-step sign-in for the site admin (audit SEC-06) ──────────────────────
// The admin can export every user, email all of them, change or cancel any
// plan and merge code to production. A password alone guarded all of it, so a
// single leaked password was the whole platform. The admin session must now be
// at Supabase's aal2: signed in AND confirmed with a code from an
// authenticator app (TOTP). /admin shows the setup or code screen until it is
// (app/admin/AdminTwoStep). Fails closed: if the level can't be read, no.

export type AdminAccess =
  | { state: "signed_out" }
  | { state: "not_admin" }
  | { state: "needs_second_step"; email: string }
  | { state: "ok"; user: { id: string; email?: string } };

export async function adminAccess(): Promise<AdminAccess> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { state: "signed_out" };
  if (!isAdminEmail(user.email)) return { state: "not_admin" };
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!error && data?.currentLevel === "aal2") return { state: "ok", user };
  } catch {
    /* fail closed */
  }
  return { state: "needs_second_step", email: user.email ?? "" };
}

// For API routes: returns the admin user, or null (caller responds 403). Null
// too for an admin who hasn't passed the second step in this session.
export async function requireAdmin() {
  const access = await adminAccess();
  return access.state === "ok" ? access.user : null;
}
