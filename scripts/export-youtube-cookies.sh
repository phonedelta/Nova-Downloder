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

"$YTDLP" \
  --cookies-from-browser "$BROWSER" \
  --cookies "$TMP" \
  --skip-download \
  --ignore-no-formats-error \
  --no-warnings \
  -q \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" >/dev/null 2>&1 || true

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
dst.write_bytes(text)
gz_b64 = base64.b64encode(gzip.compress(text, 9)).decode()
print(gz_b64)
print(f"# bytes={len(text)} gzip_b64={len(gz_b64)}", file=sys.stderr)
print("# Add Railway variable:", file=sys.stderr)
print("#   YT_DLP_COOKIES_BASE64=<paste the line above>", file=sys.stderr)
print("# Then redeploy / restart the service.", file=sys.stderr)
PY
