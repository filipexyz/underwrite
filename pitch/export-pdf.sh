#!/usr/bin/env bash
# Renders the deck to underwrite-pitch.pdf — the "short deck" the code freeze asks for.
# Video slides export their poster frame.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-4321}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

[ -x "$CHROME" ] || { echo "Chrome not found. Set CHROME=/path/to/chrome"; exit 1; }

python3 -m http.server "$PORT" >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
sleep 1

"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=underwrite-pitch.pdf \
  --virtual-time-budget=10000 \
  "http://localhost:${PORT}/index.html" 2>/dev/null

echo "wrote $(pwd)/underwrite-pitch.pdf"
