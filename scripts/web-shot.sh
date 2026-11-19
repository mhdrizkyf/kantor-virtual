#!/bin/bash
# Screenshot of a public web page, for agents' reports (competitor pages, pricing, sign-up flows).
#   scripts/web-shot.sh <url> <out.png> [width] [height]
# Default 1440x1000 (desktop). Use 390 844 for a phone view, or a larger height (e.g. 3000) for a long page.
# Uses its own browser profile, so it never touches the member's Chrome or logins.
set -euo pipefail
URL="${1:?url}"; OUT="${2:?out.png}"; W="${3:-1440}"; H="${4:-1000}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || CHROME="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
PROFILE="$(cd "$(dirname "$0")/.." && pwd)/data/shot-profile"
mkdir -p "$PROFILE" "$(dirname "$OUT")"
UA=""; [ "$W" -lt 600 ] && UA="--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
"$CHROME" --headless=new --user-data-dir="$PROFILE" --disable-gpu --hide-scrollbars --lang=id-ID,en \
  --window-size="$W,$H" --virtual-time-budget=10000 ${UA:+"$UA"} --screenshot="$OUT" "$URL" >/dev/null 2>&1 || true
if [ -s "$OUT" ]; then echo "saved $OUT"; else echo "failed: no screenshot for $URL" >&2; exit 1; fi
