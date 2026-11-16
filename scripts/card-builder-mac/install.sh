#!/bin/bash
# ── Install (or reinstall) Card Builder's Mac agent ──────────────────────────
# Runs scripts/card-builder-mac/agent.mjs in the background from now on, and
# again after every restart (launchd). Safe to run again: it replaces itself.
#
#   bash scripts/card-builder-mac/install.sh            install and start
#   bash scripts/card-builder-mac/install.sh uninstall  stop and remove
#
# Logs: ~/Library/Logs/swiftcard-card-builder.log
set -euo pipefail

LABEL="me.swiftcard.card-builder"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$HOME/Library/Logs/swiftcard-card-builder.log"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "uninstall" ]; then
  rm -f "$PLIST"
  echo "Removed. Nothing will be sent or built from this Mac."
  exit 0
fi

NODE="$(command -v node)"
CLAUDE="$(command -v claude || true)"
[ -n "$NODE" ] || { echo "Node isn't on the PATH."; exit 1; }
[ -n "$CLAUDE" ] || echo "Note: Claude Code ('claude') isn't on the PATH: batches won't run until it is. Sending still works."
[ -f "$ROOT/.env.local" ] || { echo "$ROOT/.env.local is missing: the agent needs the Supabase keys in it."; exit 1; }

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--no-warnings</string>
    <string>$ROOT/scripts/card-builder-mac/agent.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE"):$( [ -n "$CLAUDE" ] && dirname "$CLAUDE" ):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>CLAUDE_BIN</key><string>${CLAUDE:-claude}</string>
    <key>DEVELOPER_DIR</key><string>/Library/Developer/CommandLineTools</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PL

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed and running. Logs: $LOG"
echo "Node used: $NODE  (give THIS file Full Disk Access, and allow it to control Messages when macOS asks)"
