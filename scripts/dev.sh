#!/usr/bin/env bash
# Coordinator for diagrams' dev servers: allocates ephemeral ports for the
# express backend (server.js) and vite frontend. See tech/dev/ports.d2 (layer 2).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

read -r BACKEND_PORT FRONTEND_PORT < <(python3 -c '
import socket
s1 = socket.socket(); s1.bind(("127.0.0.1", 0))
s2 = socket.socket(); s2.bind(("127.0.0.1", 0))
print(s1.getsockname()[1], s2.getsockname()[1])
s1.close(); s2.close()
')

# A fixed frontend port can be pinned with VITE_FRONTEND_PORT in .env.local
# (stable URL for bookmarks). The backend stays ephemeral.
pinned_frontend="$(sed -n 's/^VITE_FRONTEND_PORT=\([0-9]\+\)\s*$/\1/p' .env.local 2>/dev/null | tail -1)"
if [ -n "${pinned_frontend}" ]; then
  FRONTEND_PORT="${pinned_frontend}"
fi

echo "diagrams dev: backend -> http://localhost:${BACKEND_PORT}  frontend -> http://localhost:${FRONTEND_PORT}"

# Private mounts (scripts/private-mounts/README.md): kick off an immediate sync
# for each configured mount and make sure its 5-minute timer is running.
# Going through systemd (not sync.sh directly) means a start that lands while a
# timer-triggered sync is in flight joins that run instead of racing it, and
# restarts the timer's 5-minute countdown. Non-blocking: vite starts right away.
for conf in "$HOME"/.config/diagrams-private-mounts/*.env; do
  [ -e "$conf" ] || continue
  name="$(basename "$conf" .env)"
  if systemctl --user start "diagrams-sync@${name}.timer" 2>/dev/null; then
    systemctl --user start --no-block "diagrams-sync@${name}.service"
    echo "private mount ${name}: syncing now  (journalctl --user -u diagrams-sync@${name} -f)"
  else
    echo "private mount ${name}: no systemd user session; syncing once in background"
    scripts/private-mounts/sync.sh "$name" >/dev/null 2>&1 &
  fi
done

# Hand the backend's port to the frontend via a port file it reads at
# startup (vite.config.ts calls loadEnv, which picks up .env.local). Only the
# backend line is rewritten; anything else in the file (e.g. a pinned
# VITE_FRONTEND_PORT) is kept.
{
  grep -v '^VITE_BACKEND_PORT=' .env.local 2>/dev/null || true
  echo "VITE_BACKEND_PORT=${BACKEND_PORT}"
} > .env.local.tmp && mv .env.local.tmp .env.local

PORT="${BACKEND_PORT}" node server.js &
BACKEND_PID=$!

cleanup() {
  kill "${BACKEND_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npx vite --port "${FRONTEND_PORT}" --strictPort
