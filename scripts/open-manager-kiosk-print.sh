#!/usr/bin/env bash

set -euo pipefail

CHROME_APP="/Applications/Google Chrome.app"
CHROME_BIN="$CHROME_APP/Contents/MacOS/Google Chrome"

if [[ ! -x "$CHROME_BIN" ]]; then
  echo "Google Chrome not found at: $CHROME_BIN" >&2
  exit 1
fi

APP_URL="${1:-http://localhost:3002/sale}"
PROFILE_DIR="${HOME}/.superice-manager-kiosk-profile"

mkdir -p "$PROFILE_DIR"

exec "$CHROME_BIN" \
  --user-data-dir="$PROFILE_DIR" \
  --app="$APP_URL" \
  --kiosk-printing \
  --new-window \
  --disable-session-crashed-bubble \
  --no-first-run \
  --no-default-browser-check
