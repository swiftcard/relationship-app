// Ship 1.0.4 (build 14) — the iOS 27 launch-crash fix — with as few hands as
// possible. Run AFTER `npm run ios:release -- --no-watch` has uploaded build 14
// and App Store Connect shows it VALID (processing takes ~10 minutes).
//
//   node scripts/asc-submit-104.mjs        # dry run: shows every state, changes nothing
//   node scripts/asc-submit-104.mjs --go   # create 1.0.4 if needed, attach build 14,
//                                          # write What's New, submit for review
//
// Idempotent: every step checks before it acts, so it can be re-run after a
// partial failure. Refuses on any mismatch (wrong build, another submission
// open). Release type is AFTER_APPROVAL — the moment Apple approves, 1.0.4 is
// live and every iOS 27 phone can open the app again. Nobody has to be awake.
//
// Owner's go on 2026-09-28: "we need this to be fixed ASAP".
import { asc, APP_ID } from "./lib/asc.mjs";

const WANT_VERSION = "1.0.4";
const WANT_BUILD = "14";
const GO = process.argv.includes("--go");
// Must match scripts/asc-whats-new.mjs and APP-STORE-METADATA.md "## Version".
const WHATS_NEW = "Fixes the app closing right after opening on iOS 27.";

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
if (!b) throw new Error(`build ${WANT_BUILD} has not reached App Store Connect — run: npm run ios:release -- --no-watch`);
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

  // ── 3. What's New + screenshots (carried over from 1.0.3 automatically) ────
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
console.log("\nNext: ask Apple for an expedited review (see the runbook §8) — the app cannot open on iOS 27 until this is live.");
