#!/bin/bash
# Auto-extract YouTube cookies from Chrome and upload to the VPS's cookies.txt.
#
# This file is the SOURCE OF TRUTH, but launchd does NOT run it from here:
# ~/Desktop is a macOS TCC-protected folder, so the launchd-spawned bash has no
# permission to read/execute files under it (fails with exit 126 "Operation not
# permitted"). The agent runs an installed COPY from a non-protected location.
#
#   After editing this file, run:  npm run cookies:install
#   (copies this script + my.pem to the install dir and reloads the agent.)
#
# Paths below are relative to the script's own dir, so the same file works
# whether run from the repo (manual) or from the installed copy (launchd).
# Schedule: com.mafuzhen.clip-cookie-sync runs daily at 09:00 and 21:00.
# Details: COOKIE-SYNC-SETUP.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COOKIE_FILE="/tmp/yt-cookies.txt"
PEM="$SCRIPT_DIR/my.pem"  # my.pem sits next to this script in both locations
VPS="ubuntu@43.134.87.27"
VPS_PATH="/home/ubuntu/clip-learner/cookies.txt"
LOG="/tmp/sync-cookies.log"

echo "$(date): Starting cookie sync" >> "$LOG"

# Extract cookies from Chrome (yt-dlp reads Chrome's cookie store directly)
# --flat-playlist prevents yt-dlp from crawling recommended videos
yt-dlp --cookies-from-browser chrome \
  --cookies "$COOKIE_FILE" \
  --skip-download \
  --no-download \
  --flat-playlist \
  --playlist-items 0 \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>> "$LOG" || true

# Verify cookies file was created and has YouTube entries
if [ ! -s "$COOKIE_FILE" ]; then
  echo "$(date): ERROR - Cookie file empty or missing" >> "$LOG"
  exit 1
fi

if ! grep -q '.youtube.com' "$COOKIE_FILE"; then
  echo "$(date): ERROR - No YouTube cookies found" >> "$LOG"
  exit 1
fi

# Upload to VPS
scp -i "$PEM" -o StrictHostKeyChecking=no "$COOKIE_FILE" "${VPS}:${VPS_PATH}" >> "$LOG" 2>&1

echo "$(date): Cookie sync complete" >> "$LOG"
rm -f "$COOKIE_FILE"
