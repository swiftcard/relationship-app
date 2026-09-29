import { AASA_PATHS, aasaComponents } from "@/lib/universal-links";

// Apple App Site Association (AASA) — served at the exact path
// /.well-known/apple-app-site-association with a JSON content-type and no
// redirect, which is what Apple's Universal Links CDN fetches. A Route Handler
// is used (rather than a static file in /public) so the content-type is
// application/json and the path can be served without a file extension.
//
// This is the web-servable half of Universal Links (Part 0). The matching
// native entitlement (applinks:swiftcard.me) and the real Apple Team ID are
// owner/Xcode actions tracked separately.
//
// The Team ID is read from APPLE_TEAM_ID — the SAME variable Wallet already
// passes as teamIdentifier (lib/wallet.ts) and Sign-in-with-Apple revocation
// uses (lib/apple-revoke.ts). One Team ID, one variable, already listed in
// .env.example. Nothing in this file needs editing to go live.
//
// ⚠️ Until APPLE_TEAM_ID is set, this serves the original
// "TEAMID_PLACEHOLDER.me.swiftcard.app" — byte-identical to before — so
// Universal Links stay dormant rather than half-working. To activate: set
// APPLE_TEAM_ID (Production) in Vercel, then REDEPLOY; env changes only take
// effect on a new deployment. Apple ALSO requires the matching Associated
// Domains entitlement (applinks:swiftcard.me) on the Xcode target — without
// that half the links stay dead no matter what is served here. Runbook §2–3.

/** Apple Team IDs are exactly 10 alphanumeric characters, e.g. "ABCDE12345". */
const TEAM_ID_RE = /^[A-Z0-9]{10}$/i;

function appleTeamId(): string {
  const raw = (process.env.APPLE_TEAM_ID ?? "").trim();
  // A malformed value — a stray quote, a whole appID pasted in, trailing
  // whitespace — would produce an AASA that Apple silently rejects, which is
  // far harder to diagnose than simply not having Universal Links yet. Anything
  // that isn't a well-formed Team ID falls back to the visible placeholder, so
  // the served file still reads as "not configured" at a glance.
  return TEAM_ID_RE.test(raw) ? raw : "TEAMID_PLACEHOLDER";
}

// Built per request rather than frozen at module load, so the env var is read
// at serve time instead of being pinned for the life of the server process.
function buildAasa() {
  return {
  applinks: {
    apps: [],
    details: [
      {
        appIDs: [`${appleTeamId()}.me.swiftcard.app`],
        appID: `${appleTeamId()}.me.swiftcard.app`,
        // No link opens the app — every path is excluded (lib/universal-links).
        // Sign-in returns use the swiftcard:// scheme, not a universal link.
        paths: [...AASA_PATHS],
        components: aasaComponents(),
      },
    ],
  },
  };
}

export async function GET() {
  return new Response(JSON.stringify(buildAasa()), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Apple's CDN caches this too (and phones cache the CDN's copy), so a
      // change here reaches iPhones over hours to days — NativeAppBridge sends
      // any card link that still arrives from an old copy on to the browser.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
