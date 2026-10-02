import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getLogoProvider } from "@/lib/logo-provider";
import { logoForWebsite } from "@/lib/site-logo";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

// Provider calls need Node (safeFetch uses undici + node:dns) — never edge.
export const runtime = "nodejs";

// POST /api/logo-suggest  { input: "<company name | business email | domain>", website?: "<their site>" }
// → { status, candidates: [{ name, domain, logoUrl }] }
//
// The response NEVER auto-applies a logo — it only offers candidates the client
// must confirm.
//
// `website` is the third source: when given, the logo for THAT site (Logo.dev
// exact domain, else the logo the homepage declares) is offered FIRST — it is
// the user's own site, so it beats any name guess — and it still answers when
// the name/email search finds nothing.
//
// Open to signed-out visitors so the homepage builders can suggest a logo
// BEFORE an account exists (that's the point of "see how your card would
// look"). The input is just a company name/domain they typed — no identity is
// involved — so there's nothing user-specific to leak. Provider quota is the
// real asset here, so guests get a much tighter per-IP budget than signed-in
// users, who keep their existing per-user one.
const SIGNED_IN_LIMIT = 60;   // per user / 10 min
const GUEST_LIMIT = 10;       // per IP  / 10 min
const WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const key = user ? `logo-suggest:u:${user.id}` : `logo-suggest:ip:${clientIp(req)}`;
  if (await isRateLimited(key, user ? SIGNED_IN_LIMIT : GUEST_LIMIT, WINDOW_MS)) {
    return NextResponse.json(
      { status: "rate_limited", candidates: [], message: "Too many logo searches — please wait a moment." },
      { status: 429 },
    );
  }

  const provider = getLogoProvider();
  // Fail safe: if no credential is configured the feature is off. Return a
  // clean disabled state (200) rather than an error so the client just hides.
  if (!provider.isConfigured()) {
    return NextResponse.json({ status: "not_configured", candidates: [] });
  }

  let input = "";
  let website = "";
  try {
    const body = await req.json();
    if (typeof body?.input === "string") input = body.input;
    if (typeof body?.website === "string") website = body.website;
  } catch {
    return NextResponse.json({ status: "invalid_input", candidates: [] });
  }

  const [result, fromSite] = await Promise.all([
    input.trim() ? provider.suggest(input) : Promise.resolve(null),
    logoForWebsite(website),
  ]);

  if (fromSite) {
    const rest = (result?.candidates ?? []).filter((c) => c.domain !== fromSite.domain);
    return NextResponse.json({ status: "ok", candidates: [fromSite, ...rest].slice(0, 10) });
  }
  return NextResponse.json(result ?? { status: website.trim() ? "no_match" : "invalid_input", candidates: [] });
}
