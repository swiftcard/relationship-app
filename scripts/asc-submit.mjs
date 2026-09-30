// Submit the release in flight — the version and build the Xcode project is
// set to — with as few hands as possible. Run AFTER
// `npm run ios:release -- --no-watch` has uploaded the build and App Store
// Connect shows it VALID (processing takes ~10 minutes).
//
//   node scripts/asc-submit.mjs        # dry run: shows every state, changes nothing
//   node scripts/asc-submit.mjs --go   # create the version if needed, attach the
//                                      # build, write What's New, submit for review
//   node scripts/asc-submit.mjs --prepare  # everything --go does EXCEPT the
//                                      # submission — stage the version so
//                                      # screenshots etc. can be added first
//
// One script for every release. The version and build come from
// ios/App/App.xcodeproj/project.pbxproj (MARKETING_VERSION /
// CURRENT_PROJECT_VERSION, which must agree across every target), and the
// What's New text from scripts/lib/whats-new.mjs — so a release is cut by
// bumping the project and editing that one line, never by copying this file.
// (It replaced per-release copies, asc-submit-104.mjs and asc-submit-105.mjs.)
//
// Idempotent: every step checks before it acts, so it can be re-run after a
// partial failure. Refuses on any mismatch (wrong build, another submission
// open). Release type is AFTER_APPROVAL — live the moment Apple approves.
import { readFileSync } from "node:fs";
import { asc, APP_ID } from "./lib/asc.mjs";
import { WHATS_NEW } from "./lib/whats-new.mjs";

const pbx = readFileSync(new URL("../ios/App/App.xcodeproj/project.pbxproj", import.meta.url), "utf8");
/** The one value every target is set to — refuses if two targets disagree. */
function projectSetting(key) {
  const values = [...new Set([...pbx.matchAll(new RegExp(`${key} = ([^;]+);`, "g"))].map((m) => m[1].trim()))];
  if (values.length !== 1) throw new Error(`${key} is not the same on every target (${values.join(", ") || "none"}) — fix the Xcode project first`);
  return values[0];
}
const WANT_VERSION = projectSetting("MARKETING_VERSION");
const WANT_BUILD = projectSetting("CURRENT_PROJECT_VERSION");
const PREPARE = process.argv.includes("--prepare");
const GO = process.argv.includes("--go") || PREPARE;
console.log(`release in flight: ${WANT_VERSION} (build ${WANT_BUILD})`);

const act = (msg) => console.log(GO ? `→ ${msg}` : `(dry) would ${msg}`);

// ── 1. The version ───────────────────────────────────────────────────────────
const vers = await asc("GET", `/apps/${APP_ID}/appStoreVersions?limit=5&fields[appStoreVersions]=versionString,appStoreState,releaseType`);
let v = (vers.data ?? []).find((x) => x.attributes.versionString === WANT_VERSION);
if (v) {
  console.log(`version ${WANT_VERSION}: ${v.attributes.appStoreState} release=${v.attributes.releaseType} (id ${v.id})`);
} else {
  const editable = (vers.data ?? []).find((x) => x.attributes.appStoreState === "PREPARE_FOR_SUBMISSION");
  if (editable) throw new Error(`a different version (${editable.attributes.versionString}) is in PREPARE_FOR_SUBMISSION — rename or delete it in App Store Connect first`);
  act(`create version ${WANT_VERSION} (release AFTER_APPROVAL)`);
  if (GO) {
    const created = await asc("POST", "/appStoreVersions", {
      data: {
        type: "appStoreVersions",
        attributes: { versionString: WANT_VERSION, platform: "IOS", releaseType: "AFTER_APPROVAL" },
        relationships: { app: { data: { type: "apps", id: APP_ID } } },
      },
    });
    v = created.data;
    console.log(`created ${WANT_VERSION} (id ${v.id})`);
  }
}
if (v && v.attributes.appStoreState !== "PREPARE_FOR_SUBMISSION" && !["WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE", "READY_FOR_SALE"].includes(v.attributes.appStoreState)) {
  throw new Error(`version ${WANT_VERSION} is ${v.attributes.appStoreState} — not a state this script handles`);
}
if (v && v.attributes.appStoreState !== "PREPARE_FOR_SUBMISSION") {
  console.log(`\n${WANT_VERSION} is already ${v.attributes.appStoreState} — nothing left to do here.`);
  process.exit(0);
}

// ── 2. The build ─────────────────────────────────────────────────────────────
const builds = await asc("GET", `/builds?filter[app]=${APP_ID}&limit=5&sort=-uploadedDate&fields[builds]=version,processingState,expired`);
const b = (builds.data ?? []).find((x) => x.attributes.version === WANT_BUILD);
if (!b) throw new Error(`build ${WANT_BUILD} has not reached App Store Connect — run: npm run ios:release`);
console.log(`build ${WANT_BUILD}: ${b.attributes.processingState}${b.attributes.expired ? " (EXPIRED)" : ""}`);
if (b.attributes.processingState !== "VALID") throw new Error(`build ${WANT_BUILD} is still ${b.attributes.processingState} — wait for VALID (about 10 minutes after upload) and re-run`);
if (b.attributes.expired) throw new Error(`build ${WANT_BUILD} is expired`);

if (v) {
  let attached = null;
  try {
    const cur = await asc("GET", `/appStoreVersions/${v.id}/build?fields[builds]=version`);
    attached = cur.data?.attributes?.version ?? null;
  } catch { /* none attached */ }
  if (attached === WANT_BUILD) {
    console.log(`build ${WANT_BUILD} already attached`);
  } else {
    act(`attach build ${WANT_BUILD} (currently ${attached ?? "none"})`);
    if (GO) await asc("PATCH", `/appStoreVersions/${v.id}/relationships/build`, { data: { type: "builds", id: b.id } });
  }

  // ── 3. What's New + screenshots (carried over from the previous version) ──
  const loc = await asc("GET", `/appStoreVersions/${v.id}/appStoreVersionLocalizations?fields[appStoreVersionLocalizations]=locale,whatsNew`);
  if (!loc.data?.length) throw new Error("the version has no localization — open it once in App Store Connect");
  for (const l of loc.data) {
    if (l.attributes.whatsNew === WHATS_NEW) {
      console.log(`${l.attributes.locale} whatsNew already set`);
    } else {
      act(`write What's New for ${l.attributes.locale}`);
      if (GO) await asc("PATCH", `/appStoreVersionLocalizations/${l.id}`, {
        data: { type: "appStoreVersionLocalizations", id: l.id, attributes: { whatsNew: WHATS_NEW } },
      });
    }
    const sets = await asc("GET", `/appStoreVersionLocalizations/${l.id}/appScreenshotSets`);
    for (const s of sets.data ?? []) {
      const shots = await asc("GET", `/appScreenshotSets/${s.id}/appScreenshots?limit=10&fields[appScreenshots]=assetDeliveryState`);
      const ok = shots.data.filter((x) => x.attributes.assetDeliveryState?.state === "COMPLETE").length;
      console.log(`  ${s.attributes.screenshotDisplayType}: ${ok}/${shots.data.length} screenshots complete`);
      if (ok === 0) throw new Error("no screenshots on the version — run: node scripts/asc-upload-screenshots.mjs app-store/screenshots/6.9-inch-v7");
    }
  }
}

// ── 4. Submit ────────────────────────────────────────────────────────────────
const subs = await asc("GET", `/reviewSubmissions?filter[app]=${APP_ID}&limit=5`);
for (const s of subs.data ?? []) console.log(`submission ${s.id} ${s.attributes.state}`);
const open = (subs.data ?? []).filter((s) => !["COMPLETE", "CANCELING", "CANCELED"].includes(s.attributes.state));
if (open.some((s) => s.attributes.state !== "READY_FOR_REVIEW")) throw new Error("another submission is open — resolve it in App Store Connect first");

if (!GO) { console.log("\ndry run — pass --go to do all of the above and submit"); process.exit(0); }
if (PREPARE) { console.log("\n--prepare: version staged (build attached, What's New written) — NOT submitted. Re-run with --go to submit."); process.exit(0); }

let subId = open.find((s) => s.attributes.state === "READY_FOR_REVIEW")?.id;
if (!subId) {
  const created = await asc("POST", "/reviewSubmissions", {
    data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: APP_ID } } } },
  });
  subId = created.data.id;
  console.log("created submission", subId);
}
await asc("POST", "/reviewSubmissionItems", {
  data: { type: "reviewSubmissionItems", relationships: {
    reviewSubmission: { data: { type: "reviewSubmissions", id: subId } },
    appStoreVersion: { data: { type: "appStoreVersions", id: v.id } },
  } },
});
console.log("version added to submission");
const out = await asc("PATCH", `/reviewSubmissions/${subId}`, { data: { type: "reviewSubmissions", id: subId, attributes: { submitted: true } } });
console.log("SUBMITTED:", out.data.attributes.state);
const after = await asc("GET", `/appStoreVersions/${v.id}?fields[appStoreVersions]=appStoreState`);
console.log("version state now:", after.data.attributes.appStoreState);
console.log("\nNext: if this release fixes something users are hitting, ask Apple for an expedited review (see the runbook §8).");
