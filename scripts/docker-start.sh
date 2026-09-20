#!/bin/sh
set -eu

POT_JS="/opt/bgutil-ytdlp-pot-provider/server/build/main.js"
POT_NODE="${YT_DLP_POT_NODE:-/opt/bgutil-node/bin/node}"
POT_LOG="/tmp/nova-pot.log"

if [ "${YT_DLP_POT_DISABLE:-0}" != "1" ] && [ -f "$POT_JS" ]; then
  if [ -x "$POT_NODE" ]; then
    export LD_LIBRARY_PATH="/opt/bgutil-node/lib:${LD_LIBRARY_PATH:-}"
    echo "[pot] starting $POT_NODE $POT_JS" >>"$POT_LOG"
    "$POT_NODE" "$POT_JS" --host 127.0.0.1 --port 4416 >>"$POT_LOG" 2>&1 &
    # Wait briefly for /ping
    i=0
    while [ "$i" -lt 40 ]; do
      if curl -fsS "http://127.0.0.1:4416/ping" >/dev/null 2>&1; then
        echo "[pot] ready" >>"$POT_LOG"
        break
      fi
      i=$((i + 1))
      sleep 0.25
    done
  else
    echo "[pot] missing node binary: $POT_NODE" >>"$POT_LOG"
  fi
else
  echo "[pot] skipped (disabled or missing $POT_JS)" >>"$POT_LOG"
fi

cd /app
exec npm start
