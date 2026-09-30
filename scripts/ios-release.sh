#!/usr/bin/env bash
# Archive, sign, export and upload SwiftCard to App Store Connect — in one go.
#
#   npm run ios:release            # archive + export + upload
#   npm run ios:release -- --dry   # archive + export + validate, no upload
#
# WHY THIS EXISTS: signing normally means an Apple ID typed into Xcode →
# Settings → Accounts, with 2FA. You do not need that. An App Store Connect API
# key authenticates BOTH halves headlessly: xcodebuild uses it to mint the
# distribution certificate and provisioning profiles (-allowProvisioningUpdates
# + -authenticationKey*), and the same key authorises the upload. One credential,
# no password, no 2FA prompt, repeatable in CI later.
#
# ONE-TIME SETUP — create the key, then drop three values here:
#   1. appstoreconnect.apple.com → Users and Access → Integrations →
#      App Store Connect API → Team Keys → (+). Role: App Manager (Admin also
#      works). Download the .p8 — it downloads ONCE.
#   2. Note the Key ID (next to the key) and the Issuer ID (above the table).
#   3. Put them in ~/.swiftcard/asc/ :
#        mkdir -p ~/.swiftcard/asc && chmod 700 ~/.swiftcard/asc
#        mv ~/Downloads/AuthKey_<KEYID>.p8 ~/.swiftcard/asc/
#        echo '<KEYID>'   > ~/.swiftcard/asc/key-id
#        echo '<ISSUERID>'> ~/.swiftcard/asc/issuer-id
#        chmod 600 ~/.swiftcard/asc/*
#
# This is a DIFFERENT key from ~/.swiftcard/keys/AuthKey_C8TWRXCNKA.p8, which is
# the Sign in with Apple / APNs key. Do not mix them up: an APNs key has no App
# Store Connect authority and fails here with a confusing 401.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASC="$HOME/.swiftcard/asc"
BUILD="$ROOT/ios/build"
ARCHIVE="$BUILD/SwiftCard.xcarchive"
EXPORT_DIR="$BUILD/export"
DRY=0
NO_WATCH=0
for arg in "$@"; do
  case "$arg" in
    --dry) DRY=1 ;;
    # Ship the iPhone app WITHOUT the Apple Watch app. The watch targets stay in
    # the project; this only says "not in this build", which the entitlements
    # guard below would otherwise (correctly) treat as a silently-dropped embed
    # phase. Use it deliberately — a release that should contain the watch app
    # and doesn't is exactly the failure that guard exists to catch.
    --no-watch) NO_WATCH=1 ;;
    # die() is defined further down, so this cannot call it.
    *) printf '\nerror: unknown flag: %s (expected --dry and/or --no-watch)\n' "$arg" >&2; exit 1 ;;
  esac
done

die() { printf '\nerror: %s\n' "$1" >&2; exit 1; }

# ── credentials ──────────────────────────────────────────────────────────────
KEY_FILE="$(ls "$ASC"/AuthKey_*.p8 2>/dev/null | head -1 || true)"
[[ -n "$KEY_FILE" ]] || die "no App Store Connect API key at $ASC/AuthKey_*.p8 — see the setup notes at the top of this script."
[[ -f "$ASC/key-id" ]]    || die "missing $ASC/key-id"
[[ -f "$ASC/issuer-id" ]] || die "missing $ASC/issuer-id"
KEY_ID="$(tr -d '[:space:]' < "$ASC/key-id")"
ISSUER_ID="$(tr -d '[:space:]' < "$ASC/issuer-id")"

# xcodebuild only looks for keys in a few fixed locations unless given a path;
# -authenticationKeyPath wants an absolute one.
AUTH=(-allowProvisioningUpdates
      -authenticationKeyPath "$KEY_FILE"
      -authenticationKeyID "$KEY_ID"
      -authenticationKeyIssuerID "$ISSUER_ID")

# altool is different: --apiKey does NOT take a path. It searches ./private_keys,
# ~/private_keys, ~/.private_keys and ~/.appstoreconnect/private_keys — or the
# directory named by API_PRIVATE_KEYS_DIR. Without this line, validate/upload
# fails with "could not find the private key" even though xcodebuild just used
# the very same key successfully.
export API_PRIVATE_KEYS_DIR="$ASC"

echo "Using ASC key $KEY_ID (issuer ${ISSUER_ID:0:8}…)"

# ── signing assets (created by scripts/asc-provision.mjs) ────────────────────
# The Apple Distribution identity lives in a dedicated keychain with its own
# password, so no login-keychain password and no GUI prompt is ever needed.
DIST="$HOME/.swiftcard/dist"
KC="$HOME/Library/Keychains/swiftcard-release.keychain-db"
if [[ ! -f "$DIST/keychain-pass" || ! -f "$KC" ]]; then
  die "signing assets missing — run: node scripts/asc-provision.mjs (see that script's header)"
fi
security unlock-keychain -p "$(cat "$DIST/keychain-pass")" "$KC"
security list-keychains -d user | grep -q swiftcard-release || \
  security list-keychains -d user -s "$KC" "$HOME/Library/Keychains/login.keychain-db"
security find-identity -v -p codesigning "$KC" | grep -q "Apple Distribution" || \
  die "no Apple Distribution identity in $KC — re-run scripts/asc-provision.mjs and the keychain setup"
echo "Signing identity ready."

# ── keep the web assets in step ──────────────────────────────────────────────
cd "$ROOT"
npx cap sync ios

# ── archive ──────────────────────────────────────────────────────────────────
# The archive is SIGNED, with MANUAL style pinned per target in project.pbxproj
# (App → "SwiftCard App Store", widget → "SwiftCard Widget App Store", watch app
# → "SwiftCard Watch App Store", complication → "SwiftCard Watch Complication
# App Store"). Run scripts/asc-provision.mjs first; it creates all four.
#
# It used to archive with CODE_SIGNING_ALLOWED=NO on the reasoning that
# automatic signing wants an "Apple Development" profile and this team has no
# registered devices. The reasoning was right; the fix was not. Disabling
# signing also skips ProcessProductPackaging, the step that compiles
# CODE_SIGN_ENTITLEMENTS into the .xcent that gets embedded at signing time.
# -exportArchive cannot recover entitlements that were never compiled, so it
# signed the app with only what it could infer — application-identifier and
# team-identifier. Builds 1-10 all shipped with NO aps-environment, NO app
# group and NO associated-domains, even though the profile granted all three.
# That is why push registration failed on every device, Universal Links opened
# Safari, and the widget never saw its shared container.
#
# Manual signing keeps the device-less property that made unsigned archives
# attractive — App Store distribution profiles require no registered devices —
# while actually producing the entitlements. The verification gate after export
# is what makes the failure impossible to ship again.
rm -rf "$ARCHIVE" "$EXPORT_DIR"
mkdir -p "$BUILD"
cd "$ROOT/ios/App"

# ── --no-watch: archive from a project copy that does not build the watch ────
# The watch targets are signed MANUALLY against "SwiftCard Watch App Store" and
# "SwiftCard Watch Complication App Store". Both exist since 2026-09-30 (the
# complication bundle id had to become …watchkitapp.widget — Apple refuses
# ".complication" — and the App Group must be assigned in the portal; see
# docs/ios-review/SHELL-RUNBOOK.md §6c). The flag remains for a release that
# deliberately ships without the watch: building the App scheme pulls both watch
# targets in through the App target's dependency + "Embed Watch Content" phase.
#
# Rather than editing project.pbxproj in the shared working tree (several
# sessions commit from it), archive from a SIBLING COPY of the .xcodeproj with
# those two references stripped. Relative paths inside a project resolve from
# its parent directory, so a copy next to the original builds the same sources.
# The copy is removed on exit, success or failure.
PROJECT="App.xcodeproj"
if (( NO_WATCH )); then
  PROJECT="App-NoWatch.xcodeproj"
  rm -rf "$PROJECT"
  cp -R App.xcodeproj "$PROJECT"
  trap 'rm -rf "$ROOT/ios/App/App-NoWatch.xcodeproj"' EXIT
  # The App target references the watch exactly twice: the embed phase and the
  # target dependency. Both lines carry their comment, which is what we match.
  sed -i '' -e '/DD0000000000000000000001 \/\* Embed Watch Content \*\/,/d' \
            -e '/DD0000000000000000000003 \/\* PBXTargetDependency \*\/,/d' \
            "$PROJECT/project.pbxproj"
  # (The copy-files phase itself and its file entry stay; only the App target's
  # two references go, which is enough for the phase never to run.)
  if grep -q 'DD0000000000000000000001 /\* Embed Watch Content \*/,' "$PROJECT/project.pbxproj" || grep -q 'DD0000000000000000000003 /\* PBXTargetDependency \*/,' "$PROJECT/project.pbxproj"; then
    die "--no-watch: could not strip the watch references from the project copy — the pbxproj ids changed; update this script."
  fi
  echo "Archiving WITHOUT the Apple Watch app (--no-watch), from $PROJECT."
fi

echo "Archiving (signed with the App Store distribution profile)…"
xcodebuild -project "$PROJECT" -scheme App -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  OTHER_CODE_SIGN_FLAGS="--keychain $KC" \
  "${AUTH[@]}" \
  archive

# ── export (and upload, unless --dry) ────────────────────────────────────────
# `destination: upload` in ExportOptions would upload during export; we export
# to disk first so a failed upload doesn't cost a fresh 3-minute archive, and so
# --dry can validate the very same .ipa that would ship.
echo "Exporting…"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$ROOT/ios/App/ExportOptions.plist" \
  -exportPath "$EXPORT_DIR" \
  "${AUTH[@]}"

IPA="$(ls "$EXPORT_DIR"/*.ipa 2>/dev/null | head -1 || true)"
[[ -n "$IPA" ]] || die "export produced no .ipa (look in $EXPORT_DIR)"
echo "Built $(basename "$IPA") ($(du -h "$IPA" | cut -f1))"

# ── entitlement gate ─────────────────────────────────────────────────────────
# Read the entitlements out of the SIGNED BINARY — not the .entitlements source
# and not the provisioning profile. The profile only says what the app is
# ALLOWED to claim; the code signature is what iOS actually enforces at runtime,
# and for ten builds those two disagreed silently. Apple accepts such a build,
# review passes, and the capability is simply dead on every device.
#
# There is no warning for this anywhere in the toolchain. This gate is it.
echo "Verifying embedded entitlements…"
VERIFY_DIR="$BUILD/verify"
rm -rf "$VERIFY_DIR"; mkdir -p "$VERIFY_DIR"
unzip -q -o "$IPA" -d "$VERIFY_DIR"
APP_BIN="$VERIFY_DIR/Payload/App.app"
[[ -d "$APP_BIN" ]] || die "no Payload/App.app inside the .ipa"
ENTS="$(codesign -d --entitlements :- "$APP_BIN" 2>/dev/null || true)"

missing=()
grep -q 'aps-environment' <<<"$ENTS" || missing+=("aps-environment (push notifications)")
grep -q 'production'      <<<"$ENTS" || missing+=("aps-environment=production (would register against SANDBOX APNs)")
# INVERTED (owner, 2026-09-29): the app must claim NO links. With associated
# domains a phone routes any swiftcard.me link it has cached rules for into the
# app instead of the browser. A build that carries them does not ship.
if grep -q 'associated-domains' <<<"$ENTS"; then missing+=("NO com.apple.developer.associated-domains — links must open in the browser, never the app (remove applinks: from the entitlements)"); fi
grep -q 'group.me.swiftcard.app' <<<"$ENTS" || missing+=("application-groups (home-screen widget)")

WIDGET="$(find "$APP_BIN/PlugIns" -maxdepth 1 -name '*.appex' 2>/dev/null | head -1 || true)"
if [[ -n "$WIDGET" ]]; then
  WENTS="$(codesign -d --entitlements :- "$WIDGET" 2>/dev/null || true)"
  grep -q 'group.me.swiftcard.app' <<<"$WENTS" || missing+=("widget application-groups (widget cannot read the shared container)")
fi

# ── the Apple Watch app ──────────────────────────────────────────────────────
# Checked for PRESENCE first, not just entitlements. A watch app is embedded by
# a copy-files phase, and a phase that silently stops running produces a
# perfectly valid iPhone .ipa with no watch app in it — Apple accepts it, review
# passes, and the feature simply does not exist for anyone. Same failure shape
# as the entitlements above, one level up.
WATCH_APP="$APP_BIN/Watch/SwiftCardWatch.app"
if (( NO_WATCH )); then
  if [[ -d "$WATCH_APP" ]]; then
    die "--no-watch was passed but the watch app IS embedded — the build does not match the intent."
  fi
  echo "Apple Watch app: deliberately excluded from this build (--no-watch)."
elif [[ ! -d "$WATCH_APP" ]]; then
  missing+=("Watch/SwiftCardWatch.app (the Apple Watch app is not in the build at all)")
else
  WAENTS="$(codesign -d --entitlements :- "$WATCH_APP" 2>/dev/null || true)"
  grep -q 'group.me.swiftcard.app' <<<"$WAENTS" || missing+=("watch app application-groups (its complication cannot read the card)")

  COMPLICATION="$(find "$WATCH_APP/PlugIns" -maxdepth 1 -name '*.appex' 2>/dev/null | head -1 || true)"
  if [[ -z "$COMPLICATION" ]]; then
    missing+=("watch complication .appex (no watch-face complication would install)")
  else
    CENTS="$(codesign -d --entitlements :- "$COMPLICATION" 2>/dev/null || true)"
    grep -q 'group.me.swiftcard.app' <<<"$CENTS" || missing+=("watch complication application-groups (it would render the empty state forever)")
  fi
fi

if (( ${#missing[@]} )); then
  printf '\nerror: the signed binary is missing entitlements the app depends on:\n' >&2
  printf '  - %s\n' "${missing[@]}" >&2
  printf '\nApp entitlements actually embedded:\n%s\n' "$ENTS" >&2
  die "refusing to ship a build whose capabilities are dead on device."
fi
if (( NO_WATCH )); then
  echo "Entitlements OK: push (production), Universal Links, app group — app and widget."
else
  echo "Entitlements OK: push (production), Universal Links, app group — app, widget, watch app and complication."
fi

# Validation catches the things App Store Connect would reject hours later:
# missing privacy manifest reasons, bad icon, entitlement/profile mismatch,
# app-vs-extension version skew.
echo "Validating with Apple…"
xcrun altool --validate-app -f "$IPA" -t ios \
  --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"

if [[ "$DRY" == "1" ]]; then
  echo
  echo "--dry: validated but NOT uploaded. IPA: $IPA"
  exit 0
fi

echo "Uploading to App Store Connect…"
xcrun altool --upload-app -f "$IPA" -t ios \
  --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"

echo
echo "Uploaded. It takes ~5-15 min to finish processing, then it appears under"
echo "the 1.0.0 version in App Store Connect → TestFlight / App Store."
