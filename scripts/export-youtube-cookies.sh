#!/usr/bin/env bash
# Export YouTube cookies from a local browser and print a Railway-ready value.
# Usage:
#   ./scripts/export-youtube-cookies.sh brave
#   ./scripts/export-youtube-cookies.sh chrome
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BROWSER="${1:-brave}"
YTDLP="$ROOT/.tools/bin/yt-dlp-python"
[[ -x "$YTDLP" ]] || YTDLP="$(command -v yt-dlp)"

TMP="$(mktemp)"
FILTERED="$(mktemp)"
trap 'rm -f "$TMP" "$FILTERED"' EXIT

echo "# Exporting cookies from ${BROWSER}..." >&2
# Close Brave/Chrome lock issues: still write cookies even if extract fails.
"$YTDLP" \
  --cookies-from-browser "$BROWSER" \
  --cookies "$TMP" \
  --skip-download \
  --ignore-no-formats-error \
  --no-warnings \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" >/dev/null 2>&1 || true

if [[ ! -s "$TMP" ]] || [[ "$(wc -c < "$TMP")" -lt 200 ]]; then
  echo "# ERROR: cookies file empty. Close $BROWSER completely and retry." >&2
  exit 1
fi

python3 - "$TMP" "$FILTERED" <<'PY'
import gzip, base64, sys
from pathlib import Path
src, dst = Path(sys.argv[1]), Path(sys.argv[2])
lines = src.read_text(errors="ignore").splitlines()
keep = []
for line in lines:
    if line.startswith("#") or not line.strip():
        if not keep or line.startswith("#"):
            keep.append(line)
        continue
    parts = line.split("\t")
    if len(parts) < 7:
        continue
    domain = parts[0].lower()
    if any(x in domain for x in ("youtube.com", "google.com", "youtu.be", "google.co")):
        keep.append(line)
text = ("\n".join(keep) + "\n").encode()
if len(text) < 500 or b"youtube.com" not in text:
    print("# ERROR: no YouTube cookies found. Sign in to YouTube in the browser, then retry.", file=sys.stderr)
    sys.exit(1)
dst.write_bytes(text)
gz_b64 = base64.b64encode(gzip.compress(text, 9)).decode()
print(gz_b64)
print(f"# bytes={len(text)} gzip_b64={len(gz_b64)}", file=sys.stderr)
print("# Railway → Variables → New Variable:", file=sys.stderr)
print("#   Name:  YT_DLP_COOKIES_BASE64", file=sys.stderr)
print("#   Value: (paste the long line printed above)", file=sys.stderr)
print("# Then redeploy. Without this, cookies are lost after each deploy.", file=sys.stderr)
PY
