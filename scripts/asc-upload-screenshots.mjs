#!/usr/bin/env node
// Upload the 6.9-inch screenshot set to App Store Connect.
//
//   node scripts/asc-upload-screenshots.mjs [dir]
//
// Default dir: app-store/screenshots/6.9-inch (files uploaded in filename
// order, which is why they are numbered).
//
// ASC asset upload is a three-step reservation dance, not a plain POST:
//   1. POST /appScreenshots  → Apple reserves a slot and hands back
//      `uploadOperations`, each a pre-signed request for one byte range.
//   2. PUT each range to the given URL with the given headers.
//   3. PATCH the screenshot with uploaded:true and the file's MD5, which is
//      how Apple verifies it got exactly what we sent.
// Skipping step 3 leaves the asset stuck in UPLOAD_COMPLETE forever and it
// never appears on the listing.
//
// Idempotent: deletes and recreates the set so re-running always matches the
// directory rather than appending duplicates.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import crypto from "node:crypto";
import { APP_ID, asc, token } from "./lib/asc.mjs";

// 1320 x 2868 is the 6.9-inch canonical size, and APP_IPHONE_67 is the display
// type that now covers it — Apple folded 6.9" into the 6.7" slot rather than
// adding a new one. Smaller iPhones auto-scale from this set.
// `--type APP_WATCH_ULTRA` (or any screenshotDisplayType) targets another slot;
// the default remains the 6.9-inch iPhone set.
const typeArg = process.argv.indexOf("--type");
const DISPLAY_TYPE = typeArg > -1 ? process.argv[typeArg + 1] : "APP_IPHONE_67";
// The en-US localization of the version in PREPARE_FOR_SUBMISSION. Apple
// refuses screenshot edits on a released version, so this has to be the
// unreleased one: 1.0.3 as of 2026-09-22 (1.0.2 was efacc7ef… — released with
// the v4 set; 1.0.1 077d36d9…; 1.0.0 38667b78…). When a new version is
// created, find its localization id and update this default.
// Without ASC_LOCALIZATION_ID, use the en-US localization of whichever
// version is in PREPARE_FOR_SUBMISSION — the only one Apple lets us edit.
async function inFlightLocalization() {
  const vers = await asc("GET", `/apps/${APP_ID}/appStoreVersions?limit=5&fields[appStoreVersions]=versionString,appStoreState`);
  const v = (vers.data ?? []).find((x) => x.attributes.appStoreState === "PREPARE_FOR_SUBMISSION");
  if (!v) throw new Error("no version in PREPARE_FOR_SUBMISSION — create one first (node scripts/asc-submit.mjs --prepare)");
  const loc = await asc("GET", `/appStoreVersions/${v.id}/appStoreVersionLocalizations?fields[appStoreVersionLocalizations]=locale`);
  const en = (loc.data ?? []).find((l) => l.attributes.locale === "en-US") ?? loc.data?.[0];
  if (!en) throw new Error(`version ${v.attributes.versionString} has no localization`);
  console.log(`target: version ${v.attributes.versionString} (${v.attributes.appStoreState}), ${en.attributes.locale} localization ${en.id}`);
  return en.id;
}
const LOCALIZATION = process.env.ASC_LOCALIZATION_ID || await inFlightLocalization();
const positional = process.argv.slice(2).filter((a, i, arr) => !a.startsWith("--") && arr[i - 1] !== "--type");
const dir = positional[0] || "app-store/screenshots/6.9-inch";

const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".png")).sort();
if (!files.length) {
  console.error(`no .png files in ${dir}`);
  process.exit(1);
}
console.log(`uploading ${files.length} screenshot(s) from ${dir}`);

// Fresh set each run, so the listing mirrors the directory exactly.
const existing = await asc("GET", `/appStoreVersionLocalizations/${LOCALIZATION}/appScreenshotSets`);
for (const s of existing.data) {
  if (s.attributes.screenshotDisplayType === DISPLAY_TYPE) {
    await asc("DELETE", `/appScreenshotSets/${s.id}`);
    console.log(`  removed previous ${DISPLAY_TYPE} set`);
  }
}

const set = await asc("POST", "/appScreenshotSets", {
  data: {
    type: "appScreenshotSets",
    attributes: { screenshotDisplayType: DISPLAY_TYPE },
    relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: LOCALIZATION } } },
  },
});
const setId = set.data.id;

for (const file of files) {
  const path = join(dir, file);
  const bytes = readFileSync(path);
  const name = basename(file);

  const reserved = await asc("POST", "/appScreenshots", {
    data: {
      type: "appScreenshots",
      attributes: { fileName: name, fileSize: bytes.length },
      relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } },
    },
  });
  const id = reserved.data.id;

  for (const op of reserved.data.attributes.uploadOperations) {
    const chunk = bytes.subarray(op.offset, op.offset + op.length);
    const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]));
    const res = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (!res.ok) throw new Error(`chunk upload failed for ${name}: ${res.status} ${await res.text()}`);
  }

  // Apple compares this to what it received; a mismatch fails the commit
  // rather than silently publishing a corrupt asset.
  const md5 = crypto.createHash("md5").update(bytes).digest("hex");
  const done = await asc("PATCH", `/appScreenshots/${id}`, {
    data: { type: "appScreenshots", id, attributes: { uploaded: true, sourceFileChecksum: md5 } },
  });
  console.log(`  ${name} → ${done.data.attributes.assetDeliveryState?.state ?? "uploaded"}`);
}

// Apple processes asynchronously; surface the final verdict rather than
// assuming success, since a rejected asset just never shows up otherwise.
await new Promise((r) => setTimeout(r, 5000));
const check = await asc("GET", `/appScreenshotSets/${setId}/appScreenshots`);
for (const s of check.data) {
  const st = s.attributes.assetDeliveryState;
  console.log(`  ${s.attributes.fileName}: ${st?.state}${st?.errors?.length ? " — " + JSON.stringify(st.errors) : ""}`);
}
console.log(`\n${check.data.length} screenshot(s) in the ${DISPLAY_TYPE} set.`);
void token;
