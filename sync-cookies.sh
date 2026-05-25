#!/bin/bash
# Auto-extract YouTube cookies from Chrome and upload to VPS
# Runs via launchd every 12 hours

set -euo pipefail

COOKIE_FILE="/tmp/yt-cookies.txt"
PEM="/Users/mafuzhen/Desktop/MyProject/clip-learner/my.pem"
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
