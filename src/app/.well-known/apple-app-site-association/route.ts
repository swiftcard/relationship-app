import { AASA_PATHS, aasaComponents } from "@/lib/universal-links";

// Apple App Site Association (AASA) — served at the exact path
// /.well-known/apple-app-site-association with a JSON content-type and no
// redirect, which is what Apple's Universal Links CDN fetches. A Route Handler
// is used (rather than a static file in /public) so the content-type is
// application/json and the path can be served without a file extension.
//
// NO LINK OPENS THE APP (owner, 2026-09-29). From 1.0.4 the app carries no
// Associated Domains entitlement at all, so iOS never consults this file for
// it. It is still served — excluding every path — for the builds already on
// phones that DO carry the entitlement: when such a phone refreshes its copy,
// this is what it gets. Never add an include here.
//
// The Team ID is read from APPLE_TEAM_ID — the SAME variable Wallet already
// passes as teamIdentifier (lib/wallet.ts) and Sign-in-with-Apple revocation
// uses (lib/apple-revoke.ts). One Team ID, one variable, already listed in
// .env.example. Nothing in this file needs editing to go live.
//
// Until APPLE_TEAM_ID is set, this serves "TEAMID_PLACEHOLDER.me.swiftcard.app",
// which matches no app — equally harmless.

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
