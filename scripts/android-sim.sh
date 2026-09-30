#!/usr/bin/env bash
set -euo pipefail

# Build the Android shell, put it on an emulator and stream its console.
#
#   npm run android:sim              # default AVD
#   npm run android:sim -- pixel-7   # a named AVD
#
# The mirror of scripts/ios-sim.sh, and self-contained for the same reason: it
# exports its own toolchain paths rather than trusting the shell it is invoked
# from. An agent session, a cron job and a fresh terminal all get different
# environments, and a script that depends on ~/.zshrc fails in exactly the ones
# nobody is watching.

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

AVD="${1:-swiftcard-36}"
APP_ID="me.swiftcard.app"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "→ syncing web config into the native project"
npx cap sync android

if ! adb devices | grep -q "emulator-"; then
  echo "→ booting $AVD"
  # -no-snapshot-load: a restored snapshot can come back with no network
  # interface at all, which presents as "the site is down" inside the app.
  nohup emulator -avd "$AVD" -dns-server 8.8.8.8 -netdelay none -netspeed full \
    -no-snapshot-load > /tmp/swiftcard-emulator.log 2>&1 &
fi

adb wait-for-device
echo "→ waiting for boot"
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done

echo "→ building"
(cd android && ./gradlew --console=plain :app:assembleDebug)

echo "→ installing"
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

adb shell am force-stop "$APP_ID" || true
adb logcat -c
adb shell am start -n "$APP_ID/.MainActivity"

echo "--- app console (ctrl-c to stop) ---"
# Capacitor/Console carries the web layer's console.log, which is the only
# window onto the remote site from here; chromium:E catches load failures.
exec adb logcat -s Capacitor:V Capacitor/Console:V chromium:E AndroidRuntime:E
