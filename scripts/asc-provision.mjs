#!/usr/bin/env node
// Provision App Store signing assets through the App Store Connect API —
// distribution certificate + App Store profiles for all four targets: the app,
// the home-screen widget, the Apple Watch app and its complication.
//
//   node scripts/asc-provision.mjs              # create what is missing
//   node scripts/asc-provision.mjs --recreate   # also delete+recreate existing profiles
//
// WHY: `xcodebuild -exportArchive -allowProvisioningUpdates` wants to CLOUD-sign
// (Apple holds the private key), and that needs permissions our App Manager API
// key does not have ("Cloud signing permission error"). But the same key CAN
// create classic certificates and profiles through the public API — where WE
// hold the private key (~/.swiftcard/dist/dist-key.pem). So this script does
// what Xcode's magic would have, deterministically:
//   1. POST /v1/certificates (DISTRIBUTION) with our CSR    → Apple Distribution cert
//   2. GET  /v1/bundleIds  (creating any watch id that is missing, with the
//      App Groups capability)                                → four bundle ids
//   3. POST /v1/profiles (IOS_APP_STORE) for each bundle id  → App Store profiles
//      (App Store profiles need NO registered devices — that requirement is
//      development-profile-only, and is why the naive archive failed.)
//   4. Write everything to ~/.swiftcard/dist/ for ios-release.sh to consume.
//
// Idempotent: reuses an existing usable DISTRIBUTION cert if its serial file is
// present locally, makes sure EVERY bundle id carries the App Groups capability
// (a watch id registered by an earlier, interrupted run had none — and a
// profile minted without it signs fine, then fails the entitlement gate), and
// creates only the profiles that are missing. `--recreate` deletes and remints
// all four by name — the documented fix after a capability change, but not
// something to do to the live app's profile by accident.
//
// Profiles are written to ~/.swiftcard/dist/ AND installed into
// ~/Library/MobileDevice/Provisioning Profiles/<uuid>.mobileprovision, which is
// where xcodebuild looks for a PROVISIONING_PROFILE_SPECIFIER name.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

const ASC = join(homedir(), ".swiftcard", "asc");
const DIST = join(homedir(), ".swiftcard", "dist");
const API = "https://api.appstoreconnect.apple.com/v1";

const APP_BUNDLE = "me.swiftcard.app";
const WIDGET_BUNDLE = "me.swiftcard.app.SwiftCardWidgetExtension";
// The Apple Watch app and its complication. watchOS bundle ids live in the same
// App ID list as iOS ones and take the SAME profile type — the App Store
// provisioning profile covers iOS, iPadOS, visionOS and watchOS. There is no
// WATCHOS_APP_STORE to look for.
const WATCH_BUNDLE = "me.swiftcard.app.watchkitapp";
const WATCH_COMPLICATION_BUNDLE = "me.swiftcard.app.watchkitapp.widget";

// Every bundle id that ends up inside the uploaded .ipa. Miss one and the
// export fails at the last step with "no profile for <id>", after the archive.
const BUNDLES = [APP_BUNDLE, WIDGET_BUNDLE, WATCH_BUNDLE, WATCH_COMPLICATION_BUNDLE];

const PROFILE_NAMES = {
  [APP_BUNDLE]: "SwiftCard App Store",
  [WIDGET_BUNDLE]: "SwiftCard Widget App Store",
  [WATCH_BUNDLE]: "SwiftCard Watch App Store",
  [WATCH_COMPLICATION_BUNDLE]: "SwiftCard Watch Complication App Store",
};

// Names as they appear in the developer portal's App ID list, used only when a
// bundle id has to be created.
const BUNDLE_NAMES = {
  [WATCH_BUNDLE]: "SwiftCard Watch App",
  [WATCH_COMPLICATION_BUNDLE]: "SwiftCard Watch Complication",
};

// All four share the App Group (group.me.swiftcard.app) so the widget and the
// complication can read the active card. A profile minted without this
// capability signs fine and then fails at runtime with an unreadable shared
// container — the exact failure WidgetBridge.swift documents. The group itself
// is assigned in the developer portal; the capability row carries no settings.
const APP_GROUP = "group.me.swiftcard.app";

const RECREATE = process.argv.includes("--recreate");
const PROFILES_DIR = join(homedir(), "Library", "MobileDevice", "Provisioning Profiles");

function token() {
  const key = readFileSync(join(ASC, "AuthKey_" + readFileSync(join(ASC, "key-id"), "utf8").trim() + ".p8"), "utf8");
  const kid = readFileSync(join(ASC, "key-id"), "utf8").trim();
  const iss = readFileSync(join(ASC, "issuer-id"), "utf8").trim();
  const b64 = (b) => Buffer.from(b).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }));
  const p = b64(JSON.stringify({ iss, iat: now, exp: now + 900, aud: "appstoreconnect-v1" }));
  const sig = b64(crypto.sign("sha256", Buffer.from(h + "." + p), { key, dsaEncoding: "ieee-p1363" }));
  return `${h}.${p}.${sig}`;
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = json.errors?.[0];
    throw new Error(`${method} ${path} → ${res.status}: ${err?.title ?? ""} ${err?.detail ?? text.slice(0, 300)}`);
  }
  return json;
}

// ── 1. Apple Distribution certificate ────────────────────────────────────────
let certId, certContent;
try {
  const saved = JSON.parse(readFileSync(join(DIST, "cert.json"), "utf8"));
  // confirm it still exists server-side
  const check = await api("GET", `/certificates/${saved.id}`);
  certId = saved.id;
  certContent = check.data.attributes.certificateContent;
  console.log(`cert: reusing ${certId} (${check.data.attributes.serialNumber})`);
} catch {
  const csr = readFileSync(join(DIST, "dist.csr"), "utf8");
  const created = await api("POST", "/certificates", {
    data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent: csr } },
  });
  certId = created.data.id;
  certContent = created.data.attributes.certificateContent;
  writeFileSync(join(DIST, "cert.json"), JSON.stringify({ id: certId }));
  console.log(`cert: created ${certId} (${created.data.attributes.serialNumber}, expires ${created.data.attributes.expirationDate?.slice(0, 10)})`);
}
writeFileSync(join(DIST, "dist-cert.cer"), Buffer.from(certContent, "base64"));

// ── 2. bundle ids ────────────────────────────────────────────────────────────
const bundles = await api(
  "GET",
  "/bundleIds?filter[identifier]=" + BUNDLES.map(encodeURIComponent).join(",") + "&limit=200"
);
const byIdentifier = Object.fromEntries(bundles.data.map((b) => [b.attributes.identifier, b.id]));

for (const b of BUNDLES) {
  if (byIdentifier[b]) {
    console.log(`bundleId: ${b} → ${byIdentifier[b]}`);
    continue;
  }

  // The two shipping ids predate this script and are never created here — if
  // one of them is missing something is wrong with the account, not with the
  // build, and creating a replacement would be the wrong repair.
  if (b === APP_BUNDLE || b === WIDGET_BUNDLE) {
    throw new Error(`bundle id ${b} is not registered in the developer portal`);
  }

  // platform IOS is correct for a watchOS bundle id: watch apps are part of
  // the iOS app's platform family in the portal, not a platform of their own.
  const made = await api("POST", "/bundleIds", {
    data: {
      type: "bundleIds",
      attributes: { identifier: b, name: BUNDLE_NAMES[b] ?? b, platform: "IOS" },
    },
  });
  byIdentifier[b] = made.data.id;
  console.log(`bundleId: created ${b} → ${made.data.id}`);
  // App Groups is attached in the loop below. (An earlier version posted a
  // `settings` block here; the API rejects "APP_GROUPS" as a settings key, and
  // that 409 is what left the watch id registered WITHOUT the capability.)
}

// Every bundle id must carry App Groups — including ones that already existed.
// Sent WITHOUT `settings`: that is the shape the live app id has, and the
// profile it yields carries group.me.swiftcard.app (the group is attached at
// the team level, not per capability row).
for (const b of BUNDLES) {
  const caps = await api("GET", `/bundleIds/${byIdentifier[b]}/bundleIdCapabilities`);
  const has = (caps.data ?? []).some((c) => c.attributes.capabilityType === "APP_GROUPS");
  if (has) continue;
  await api("POST", "/bundleIdCapabilities", {
    data: {
      type: "bundleIdCapabilities",
      attributes: { capabilityType: "APP_GROUPS" },
      relationships: { bundleId: { data: { type: "bundleIds", id: byIdentifier[b] } } },
    },
  });
  console.log(`bundleId: enabled App Groups on existing ${b}`);
}

// ── 3. App Store profiles (create what is missing; --recreate deletes and
//        remints by name, the documented remedy after a capability change) ────
//
// THE ONE THING THIS SCRIPT CANNOT DO: put group.me.swiftcard.app INTO the App
// Groups capability. The public API only switches the capability on; which
// groups it contains is set in the developer portal (Identifiers → the App ID
// → App Groups → Configure). Xcode's own path needs an Apple ID session, not
// this API key. A profile minted before that step carries an EMPTY groups
// array, and signing an app whose entitlements claim the group then fails.
// So: a profile whose groups array is empty is treated as stale and re-minted
// on every run, and the run ends with a loud instruction if it is still empty.
const groupsIn = (profileContent) => {
  // The profile is CMS-wrapped XML; the entitlements block is plain text
  // inside it, so a substring test is enough here.
  const raw = Buffer.from(profileContent, "base64").toString("latin1");
  const m = raw.match(/<key>com\.apple\.security\.application-groups<\/key>\s*<array>([\s\S]*?)<\/array>/);
  return m ? [...m[1].matchAll(/<string>([^<]+)<\/string>/g)].map((x) => x[1]) : [];
};

mkdirSync(PROFILES_DIR, { recursive: true });
const existing = await api("GET", "/profiles?filter[profileType]=IOS_APP_STORE&limit=200");
const stillEmpty = [];
for (const bundle of BUNDLES) {
  const name = PROFILE_NAMES[bundle];
  const old = existing.data.find((p) => p.attributes.name === name);
  const oldHasGroup = old ? groupsIn(old.attributes.profileContent ?? "").includes(APP_GROUP) : false;
  if (old && old.attributes.profileState === "ACTIVE" && oldHasGroup && !RECREATE) {
    console.log(`profile: keeping existing "${name}" (${old.attributes.uuid}, expires ${old.attributes.expirationDate?.slice(0, 10)})`);
    continue;
  }
  if (old) {
    await api("DELETE", `/profiles/${old.id}`);
    console.log(`profile: deleted ${oldHasGroup ? "existing" : "stale (no app group)"} "${name}"`);
  }
  const created = await api("POST", "/profiles", {
    data: {
      type: "profiles",
      attributes: { name, profileType: "IOS_APP_STORE" },
      relationships: {
        bundleId: { data: { type: "bundleIds", id: byIdentifier[bundle] } },
        certificates: { data: [{ type: "certificates", id: certId }] },
      },
    },
  });
  const file = join(DIST, name.replace(/ /g, "-") + ".mobileprovision");
  writeFileSync(file, Buffer.from(created.data.attributes.profileContent, "base64"));
  // Xcode resolves PROVISIONING_PROFILE_SPECIFIER by NAME and a stale copy of
  // the same name (an earlier mint, now invalidated) can win — remove any
  // installed profile carrying this name before installing the new one.
  for (const f of readdirSync(PROFILES_DIR)) {
    if (!f.endsWith(".mobileprovision")) continue;
    try {
      const xml = execFileSync("security", ["cms", "-D", "-i", join(PROFILES_DIR, f)], { stdio: ["ignore", "pipe", "ignore"] }).toString("latin1");
      if (xml.includes(`<key>Name</key>\n\t<string>${name}</string>`)) {
        unlinkSync(join(PROFILES_DIR, f));
        console.log(`profile: removed stale local copy ${f}`);
      }
    } catch { /* unreadable file — leave it */ }
  }
  const installed = join(PROFILES_DIR, created.data.attributes.uuid + ".mobileprovision");
  copyFileSync(file, installed);
  const groups = groupsIn(created.data.attributes.profileContent);
  console.log(`profile: created "${name}" (${created.data.attributes.uuid}) groups=[${groups.join(", ")}] → ${file}\n         installed → ${installed}`);
  if (!groups.includes(APP_GROUP)) stillEmpty.push(bundle);
}

if (stillEmpty.length) {
  console.log(`
⚠️  These App IDs have App Groups switched on but NO group assigned, so their
    profiles carry an empty groups array and a signed archive will fail:
${stillEmpty.map((b) => `      • ${b}`).join("\n")}
    Fix (portal only, ~1 minute, account holder or admin):
      developer.apple.com/account/resources/identifiers → open each App ID →
      App Groups → Configure → tick "${APP_GROUP}" → Save → Save again.
    Then re-run: node scripts/asc-provision.mjs   (it re-mints those profiles)`);
  process.exitCode = 2;
} else {
  console.log("\nDone. ios-release.sh signs with these by name.");
}
