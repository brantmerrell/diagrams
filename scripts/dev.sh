#!/usr/bin/env bash
# Coordinator for diagrams' dev servers: allocates ephemeral ports for the
# express backend (server.js) and vite frontend. See manual/dev/ports.d2 (layer 2).
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

echo "diagrams dev: backend -> http://localhost:${BACKEND_PORT}  frontend -> http://localhost:${FRONTEND_PORT}"

# Hand the backend's port to the frontend via a port file it reads at
# startup (vite.config.ts calls loadEnv, which picks up .env.local).
cat > .env.local <<EOF
VITE_BACKEND_PORT=${BACKEND_PORT}
EOF

PORT="${BACKEND_PORT}" node server.js &
BACKEND_PID=$!

cleanup() {
  kill "${BACKEND_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npx vite --port "${FRONTEND_PORT}" --strictPort
