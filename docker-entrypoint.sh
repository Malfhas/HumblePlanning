#!/bin/sh
# Humble Planning container entrypoint.
#
#   web                    apply database migrations, then start Next.js (port $PORT)
#   socket                 start the Socket.io server (port $SOCKET_PORT)
#   provision <command>    run src/scripts/provision.ts (check-db, migrate, create-admin…)
#   healthcheck [web|socket]
#   anything else          executed as is (e.g. `sh`)
set -eu

cmd="${1:-web}"
[ "$#" -gt 0 ] && shift

case "$cmd" in
  web)
    if [ "${HP_SKIP_MIGRATIONS:-0}" != "1" ]; then
      echo "[entrypoint] Applying database migrations…"
      bun src/scripts/provision.ts migrate
    fi
    echo "[entrypoint] Starting the web server on port ${PORT:-3000}…"
    exec bun node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "${PORT:-3000}"
    ;;
  socket)
    echo "[entrypoint] Starting the Socket.io server on port ${SOCKET_PORT:-3001}…"
    exec bun server.ts
    ;;
  provision)
    exec bun src/scripts/provision.ts "$@"
    ;;
  healthcheck)
    if [ "${1:-web}" = "socket" ]; then
      url="http://127.0.0.1:${SOCKET_PORT:-3001}/health"
    else
      url="http://127.0.0.1:${PORT:-3000}/login"
    fi
    exec bun -e "fetch('$url', { redirect: 'manual', signal: AbortSignal.timeout(4000) })
      .then((r) => process.exit(r.status === 200 ? 0 : 1), () => process.exit(1))"
    ;;
  *)
    exec "$cmd" "$@"
    ;;
esac
