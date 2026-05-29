#!/bin/bash
# Install/refresh the cookie-sync LaunchAgent.
# Run after editing sync-cookies.sh:  npm run cookies:install
#
# Copies sync-cookies.sh + my.pem into a non-TCC-protected dir (launchd can't run
# them from ~/Desktop), then (re)loads the LaunchAgent. Idempotent.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="$HOME/Library/Application Support/clip-cookie-sync"
PLIST="$HOME/Library/LaunchAgents/com.mafuzhen.clip-cookie-sync.plist"
LABEL="com.mafuzhen.clip-cookie-sync"

if [ ! -f "$REPO_DIR/my.pem" ]; then
  echo "ERROR: $REPO_DIR/my.pem not found (the VPS SSH key)." >&2
  exit 1
fi

mkdir -p "$DST"
cp "$REPO_DIR/sync-cookies.sh" "$DST/sync-cookies.sh"
chmod +x "$DST/sync-cookies.sh"
cp "$REPO_DIR/my.pem" "$DST/my.pem"
chmod 600 "$DST/my.pem"
echo "Installed script + key -> $DST"

if [ ! -f "$PLIST" ]; then
  echo "WARNING: $PLIST not found — the LaunchAgent definition is missing." >&2
  echo "         See COOKIE-SYNC-SETUP.md to recreate it." >&2
  exit 1
fi

# Reload so launchd picks up the refreshed copy.
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Reloaded LaunchAgent: $LABEL (runs daily 09:00 / 21:00)"
echo "Test now with:  launchctl kickstart -k gui/\$(id -u)/$LABEL  &&  tail /tmp/sync-cookies.log"
