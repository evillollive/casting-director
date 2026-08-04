# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:20.19.5-bookworm-slim
ARG POSTGRES_IMAGE=postgres:16.4-bookworm

FROM ${POSTGRES_IMAGE} AS pgtools

FROM ${NODE_IMAGE} AS build
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build \
    && test -f .next/standalone/server.js

FROM ${NODE_IMAGE} AS runtime
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates liblz4-1 libpq5 libreadline8 libzstd1 python3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=pgtools /usr/lib/postgresql/16 /usr/lib/postgresql/16
RUN ln -s /usr/lib/postgresql/16/bin/pg_dump /usr/local/bin/pg_dump \
    && ln -s /usr/lib/postgresql/16/bin/pg_isready /usr/local/bin/pg_isready \
    && ln -s /usr/lib/postgresql/16/bin/pg_restore /usr/local/bin/pg_restore \
    && ln -s /usr/lib/postgresql/16/bin/psql /usr/local/bin/psql

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    CASTING_PYTHON_BIN=python3 \
    CASTING_ROLE=web
WORKDIR /app

RUN groupadd --system --gid 10001 casting \
    && useradd --system --uid 10001 --gid casting --home-dir /app casting

COPY --from=build --chown=casting:casting /workspace/.next/standalone ./
COPY --from=build --chown=casting:casting /workspace/.next/static ./.next/static
# The worker runs TypeScript through the locked tsx runtime. These files also
# provide Prisma CLI support for the one-shot migration role.
COPY --from=build --chown=casting:casting /workspace/node_modules ./node_modules
COPY --from=build --chown=casting:casting /workspace/runtime ./runtime
COPY --from=build --chown=casting:casting /workspace/package.json /workspace/tsconfig.json ./
COPY --from=build --chown=casting:casting /workspace/src ./src
COPY --from=build --chown=casting:casting /workspace/prisma ./prisma

COPY --chown=casting:casting tools ./tools
COPY --chown=casting:casting prompts ./prompts
COPY --chown=casting:casting rolodex ./rolodex
COPY --chown=casting:casting rubric.md sources.md ./
COPY --chown=casting:casting scripts/container-entrypoint.sh scripts/backup-postgres.sh scripts/restore-postgres.sh ./scripts/
RUN test -f ./tools/casting_eval.py \
    && test -f ./tools/tier2_scan_worker.py \
    && test -f ./prompts/tier0-weekly-scan.md \
    && test -f ./rubric.md \
    && test -f ./runtime/python-bridge/index.cjs
RUN chmod 0555 ./scripts/*.sh

USER casting
EXPOSE 3000
ENTRYPOINT ["/app/scripts/container-entrypoint.sh"]
CMD ["web"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/app/scripts/container-entrypoint.sh", "healthcheck"]
