#!/usr/bin/env bash
set -Eeuo pipefail

role="${1:-${CASTING_ROLE:-web}}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$role" in
  web)
    exec node server.js "$@"
    ;;
  worker)
    exec node --import tsx src/worker/cli.ts "$@"
    ;;
  migrate)
    exec ./node_modules/.bin/prisma migrate deploy "$@"
    ;;
  healthcheck)
    case "${CASTING_ROLE:-web}" in
      worker)
        exec node --import tsx src/worker/cli.ts --healthcheck
        ;;
      web)
        exec node -e '
          const port = process.env.PORT || "3000";
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 4000);
          fetch(`http://127.0.0.1:${port}/api/health`, {signal: controller.signal})
            .then(async response => {
              const body = await response.json();
              if (!response.ok || body.ready !== true) process.exit(1);
            })
            .catch(() => process.exit(1))
            .finally(() => clearTimeout(timeout));
        '
        ;;
      *)
        echo "No healthcheck is defined for CASTING_ROLE=${CASTING_ROLE:-}" >&2
        exit 2
        ;;
    esac
    ;;
  *)
    # An explicit command makes the image usable by neutral schedulers and jobs.
    exec "$role" "$@"
    ;;
esac

