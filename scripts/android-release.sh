#!/usr/bin/env bash
# Build the signed Android release for Google Play.
#
#   npm run android:release          # signed .aab for Play Console
#   npm run android:release -- --apk # also a signed .apk to sideload on a phone
#
# Nothing is uploaded: the .aab goes to Play Console by hand (Internal testing
# → Create release → upload), because the first upload of an app cannot be
# done through the API and every later one is a review decision.
#
# SIGNING: this is the UPLOAD key, not the app signing key. Play App Signing
# holds the real signing key; the upload key only proves a bundle came from
# us, and Google can reset it if it is lost. It lives outside the repo:
#   ~/.swiftcard/android/upload.jks          the keystore (PKCS12, alias "upload")
#   ~/.swiftcard/android/keystore.properties storeFile / storePassword / keyAlias / keyPassword
#   ~/.swiftcard/android/upload_certificate.pem  the public cert, if Play ever asks
#
# The signing values are passed as android.injected.signing.* properties rather
# than a signingConfigs block, so no path or password ever enters build.gradle.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROPS="$HOME/.swiftcard/android/keystore.properties"
OUT="$ROOT/android/build/release"
APK=0
for arg in "$@"; do
  case "$arg" in
    --apk) APK=1 ;;
    *) printf 'error: unknown flag: %s (expected --apk)\n' "$arg" >&2; exit 1 ;;
  esac
done
die() { printf '\nerror: %s\n' "$1" >&2; exit 1; }

[[ -f "$PROPS" ]] || die "no $PROPS — the upload keystore is missing (see the header of this script)"
prop() { grep -E "^$1=" "$PROPS" | head -1 | cut -d= -f2-; }
STORE="$(prop storeFile)"; STOREPASS="$(prop storePassword)"; ALIAS="$(prop keyAlias)"; KEYPASS="$(prop keyPassword)"
[[ -f "$STORE" ]] || die "keystore $STORE does not exist"

# Gradle 8 / AGP need JDK 17-21; the /usr/bin/java stub is not one.
if [[ -z "${JAVA_HOME:-}" ]]; then
  for j in /opt/homebrew/opt/openjdk@21 /opt/homebrew/opt/openjdk@17; do
    [[ -x "$j/bin/java" ]] && export JAVA_HOME="$j" && break
  done
fi
[[ -n "${JAVA_HOME:-}" ]] || die "no JDK 17/21 found — brew install openjdk@21"

cd "$ROOT"
echo "Syncing Capacitor config and plugins into android/…"
npx cap sync android >/dev/null

VERSION_NAME="$(grep -E '^\s*versionName ' android/app/build.gradle | head -1 | sed -E 's/.*"(.*)".*/\1/')"
VERSION_CODE="$(grep -E '^\s*versionCode ' android/app/build.gradle | head -1 | awk '{print $2}')"
echo "Building SwiftCard for Android $VERSION_NAME ($VERSION_CODE)…"

SIGN=(
  "-Pandroid.injected.signing.store.file=$STORE"
  "-Pandroid.injected.signing.store.password=$STOREPASS"
  "-Pandroid.injected.signing.key.alias=$ALIAS"
  "-Pandroid.injected.signing.key.password=$KEYPASS"
)
TASKS=(:app:bundleRelease)
(( APK )) && TASKS+=(:app:assembleRelease)
(cd android && ./gradlew --quiet "${TASKS[@]}" "${SIGN[@]}")

mkdir -p "$OUT"
AAB_SRC="android/app/build/outputs/bundle/release/app-release.aab"
[[ -f "$AAB_SRC" ]] || die "bundleRelease produced no .aab"
AAB="$OUT/SwiftCard-$VERSION_NAME-$VERSION_CODE.aab"
cp "$AAB_SRC" "$AAB"

# ── gate: the bundle is signed by OUR upload key ─────────────────────────────
# An unsigned or debug-signed bundle is rejected by Play only at upload time,
# with an error that does not say which key it expected.
WANT="$("$JAVA_HOME/bin/keytool" -list -keystore "$STORE" -storepass "$STOREPASS" -alias "$ALIAS" | grep -Eo 'SHA-256\): [0-9A-F:]+' | head -1 || true)"
[[ -n "$WANT" ]] || WANT="$("$JAVA_HOME/bin/keytool" -exportcert -alias "$ALIAS" -keystore "$STORE" -storepass "$STOREPASS" | shasum -a 256 | awk '{print toupper($1)}')"
GOT="$("$JAVA_HOME/bin/keytool" -printcert -jarfile "$AAB" 2>/dev/null | grep -Eo 'SHA256: [0-9A-F:]+' | head -1 | tr -d ':' | awk '{print $2}')"
WANT_HEX="$(echo "$WANT" | tr -d ':' | grep -Eo '[0-9A-F]{64}' | head -1)"
[[ -n "$GOT" && "$GOT" == "$WANT_HEX" ]] || die "the .aab is not signed with the upload key (got '${GOT:-none}', want '$WANT_HEX')"
echo "Signature: upload key ✓"

if (( APK )); then
  APK_SRC="android/app/build/outputs/apk/release/app-release.apk"
  [[ -f "$APK_SRC" ]] || die "assembleRelease produced no .apk"
  cp "$APK_SRC" "$OUT/SwiftCard-$VERSION_NAME-$VERSION_CODE.apk"
  echo "APK: $OUT/SwiftCard-$VERSION_NAME-$VERSION_CODE.apk  (adb install -r <it>)"
fi

echo
echo "Ready for Play Console: $AAB ($(du -h "$AAB" | cut -f1))"
echo "Not uploaded. Play Console → SwiftCard → Test and release → Internal testing → Create new release."
