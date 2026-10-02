import type { NextRequest } from "next/server";

// The Instagram bot's scheduled routes are called by GitHub Actions (Vercel
// Hobby has no spare cron — see .github/workflows/instagram-bot.yml). Same
// rule as /api/push/catchup: a Bearer secret, and an UNSET secret must never
// authorize ("Bearer undefined" would otherwise match).
export function botAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const accepted = [process.env.INSTAGRAM_BOT_SECRET, process.env.PUSH_CATCHUP_SECRET, process.env.CRON_SECRET]
    .filter((s): s is string => !!s && s.length >= 16);
  return accepted.some((s) => auth === `Bearer ${s}`);
}
