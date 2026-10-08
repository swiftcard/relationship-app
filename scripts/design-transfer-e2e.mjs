#!/usr/bin/env node
// End-to-end proof that "Copy a card or template you like" works in PROD:
// signs in as the Apple-review demo account (Pro), sends a real template
// image through /api/design-transfer, and reports what came back.
//
//   node scripts/design-transfer-e2e.mjs [path/to/template.png]
//
// Auth is the same mechanism the browser uses: a Supabase password-grant
// session, folded into the @supabase/ssr cookie (base64-<base64url(JSON)>,
// chunked at ~3180 chars exactly like the library does) so the route's
// createClient() sees a normal signed-in user. No test backdoors in prod.
import { readFileSync } from "node:fs";

const APP = "https://swiftcard.me";
const EMAIL = "applereview@swiftcard.me";
const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD) { console.error("Set DEMO_PASSWORD (the App Review demo password) — it is never kept in the repo."); process.exit(1); }

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^"|"$/g, "");
const SUPA = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!SUPA || !ANON) throw new Error("missing supabase env");
const REF = new URL(SUPA).hostname.split(".")[0];

// ── sign in ──────────────────────────────────────────────────────────────────
const auth = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const session = await auth.json();
if (!auth.ok) throw new Error(`sign-in failed: ${auth.status} ${JSON.stringify(session).slice(0, 200)}`);
console.log(`signed in as ${EMAIL} (user ${session.user?.id?.slice(0, 8)}…)`);

// ── the ssr cookie, chunked like @supabase/ssr does ──────────────────────────
const b64url = (s) => Buffer.from(s).toString("base64url");
const value = "base64-" + b64url(JSON.stringify(session));
const CHUNK = 3180;
const cookies = [];
if (value.length <= CHUNK) {
  cookies.push(`sb-${REF}-auth-token=${value}`);
} else {
  for (let i = 0; i * CHUNK < value.length; i++) {
    cookies.push(`sb-${REF}-auth-token.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }
}
const cookieHeader = cookies.join("; ");

// ── a template image: passed in, or the demo card's own OG image ─────────────
let imgBuf, mediaType;
const file = process.argv[2];
if (file) {
  imgBuf = readFileSync(file);
  mediaType = file.endsWith(".png") ? "image/png" : "image/jpeg";
} else {
  const r = await fetch(`${APP}/card/jordanreed/opengraph-image`);
  imgBuf = Buffer.from(await r.arrayBuffer());
  mediaType = "image/png";
}
console.log(`template: ${file ?? "demo OG image"} (${(imgBuf.length / 1024).toFixed(0)}KB)`);

// ── the call the designer makes ──────────────────────────────────────────────
const t0 = Date.now();
const res = await fetch(`${APP}/api/design-transfer`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader },
  body: JSON.stringify({
    imageBase64: imgBuf.toString("base64"),
    mediaType,
    identity: {
      name: "Alex Rivera",
      title: "Sales Director",
      company: "Rivera Group",
      phone: "(212) 555-0148",
      email: "alex@riveragroup.com",
      website: "riveragroup.com",
    },
  }),
});
const body = await res.json().catch(() => ({}));
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n/api/design-transfer → ${res.status} in ${secs}s`);
if (!res.ok) {
  console.log("body:", JSON.stringify(body).slice(0, 300));
  process.exit(1);
}
console.log("checklist:", (body.checklist ?? []).join(" · "));
// Since 2026-10-08 the answer is an EDITABLE layout: the artwork as bgImage,
// the owner's details as elements.
const L = body.layout ?? {};
console.log(`artwork: ${body.artwork}  bgImage: ${L.bgImage ?? "—"}`);
for (const e of L.elements ?? []) console.log(`  ${e.id.padEnd(9)} ${e.type.padEnd(6)} x${e.x} y${e.y}`);
if (!L.elements?.length) { console.log("✗ no elements"); process.exit(1); }
if (!L.bgImage) { console.log("✗ no artwork came back (layout-only fallback)"); process.exit(1); }

// Fetch the artwork so a broken storage URL can't masquerade as success.
const img = await fetch(L.bgImage);
const bytes = Buffer.from(await img.arrayBuffer());
console.log(`artwork fetch: ${img.status}, ${(bytes.length / 1024).toFixed(0)}KB, ${img.headers.get("content-type")}`);
if (!img.ok || bytes.length < 10_000) process.exit(1);
console.log("\n✅ E2E PASS — the pipeline measures, redraws, stores and serves an editable copy.");
