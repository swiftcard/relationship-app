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

// The owner signs in with the account's own login and nothing more: the
// authenticator-app second step added in the Oct 2026 audit (SEC-06) was
// removed at the owner's request. Don't add a second step back unasked.

export type AdminAccess =
  | { state: "signed_out" }
  | { state: "not_admin" }
  | { state: "ok"; user: { id: string; email?: string } };

export async function adminAccess(): Promise<AdminAccess> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { state: "signed_out" };
  if (!isAdminEmail(user.email)) return { state: "not_admin" };
  return { state: "ok", user };
}

// For API routes: returns the admin user, or null (caller responds 403).
export async function requireAdmin() {
  const access = await adminAccess();
  return access.state === "ok" ? access.user : null;
}
