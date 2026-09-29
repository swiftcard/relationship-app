// node scripts/asc-whats-new.mjs [--apply]
//
// Sets the "What's New in This Version" text on the version that is currently
// in Prepare for Submission. Metadata only — this does NOT submit anything.
//
// The notes describe what the BUILD changes, which for a remote-URL shell is a
// narrower list than "what changed in SwiftCard": every web improvement is
// already live for users without an app update. Claiming those here would be
// padding, and a reviewer comparing notes to a diff would be right to wonder.
import { asc, APP_ID } from "./lib/asc.mjs";
import { WHATS_NEW } from "./lib/whats-new.mjs";

const APPLY = process.argv.includes("--apply");

const vers = await asc("GET", `/apps/${APP_ID}/appStoreVersions?limit=5&fields[appStoreVersions]=versionString,appStoreState`);
const v = (vers.data ?? []).find((x) => x.attributes.appStoreState === "PREPARE_FOR_SUBMISSION");
if (!v) { console.log("no version in PREPARE_FOR_SUBMISSION — nothing to do"); process.exit(0); }
console.log(`version ${v.attributes.versionString} (${v.attributes.appStoreState})`);

const locs = await asc("GET", `/appStoreVersions/${v.id}/appStoreVersionLocalizations?fields[appStoreVersionLocalizations]=locale,whatsNew`);
for (const l of locs.data ?? []) {
  const cur = l.attributes.whatsNew;
  console.log(`\n${l.locale ?? l.attributes.locale}  current: ${cur ? JSON.stringify(cur.slice(0, 60)) : "EMPTY"}`);
  if (!APPLY) continue;
  const out = await asc("PATCH", `/appStoreVersionLocalizations/${l.id}`, {
    data: { type: "appStoreVersionLocalizations", id: l.id, attributes: { whatsNew: WHATS_NEW } },
  });
  console.log(`  written (${out.data.attributes.whatsNew.length} chars)`);
}

if (!APPLY) console.log("\n--- would write ---\n" + WHATS_NEW + "\n\n(dry run — pass --apply)");
