# syntax=docker/dockerfile:1.7
#
# Humble Planning — production image.
# One image, three roles (see docker-entrypoint.sh):
#   web         database migrations, then `next start` (port 3000)
#   socket      Socket.io real-time server (port 3001)
#   provision   provisioning commands used by install.sh
#
# Build:  docker build -t humble-planning --build-arg APP_VERSION=1.0.0 .

ARG BUN_VERSION=1.4.4
ARG NODE_VERSION=26

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS bun-binary

# ── 1. Build ─────────────────────────────────────────────────────────────────
# Runs on the build platform: the `.next` output is plain JavaScript, native
# modules (sharp, argon2…) are external and come from the runtime stage. This
# keeps multi-arch builds fast (no emulated `next build`).
# `next build` runs on Node.js, as on a classic server (`bun run` uses the
# `node` found in PATH): some dependencies (css-tree) fail to prerender under
# the Bun runtime. The application itself runs on Bun.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-trixie-slim AS build
COPY --from=bun-binary /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json bun.lock bunfig.toml ./
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile

COPY . .
# A syntactically valid DATABASE_URL is required at build time: the root layout
# imports @/db (through config-service), which instantiates drizzle when the
# module loads. postgres-js only connects on the first query, which never
# happens during `next build`.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build bun run build \
 && rm -rf .next/cache

# ── 2. Production dependencies (target platform) ────────────────────────────
FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile --production \
 # Bun installs the native packages for both libc flavours; the runtime is
 # Debian (glibc), so the musl builds (~140 MB) are dead weight.
 && rm -rf node_modules/@next/swc-linux-*-musl node_modules/@img/*-linuxmusl-*

# ── 3. Runtime ───────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-slim AS runtime

ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="Humble Planning" \
      org.opencontainers.image.description="Open-source planning application" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/Malfhas/HumblePlanning"

# PostgreSQL 18 client from the PGDG repository: the app runs pg_dump and
# pg_restore for its backups and imports (an 18 client also handles 16/17 servers).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    install -d -m 0755 /etc/apt/keyrings; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /etc/apt/keyrings/postgresql.asc; \
    . /etc/os-release; \
    echo "deb [signed-by=/etc/apt/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-18; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/*; \
    pg_dump --version

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    SOCKET_PORT=3001

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# src/ is needed at runtime: provisioning (src/scripts), seed and migrations
# (src/db), which the import feature also reads.
COPY --from=build /app/src ./src
COPY --from=build /app/package.json /app/next.config.ts /app/tsconfig.json /app/server.ts ./
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# The application code stays owned by root (read-only for the app user);
# only the data directories and the Next.js cache are writable.
RUN mkdir -p uploads data/backups data/imports .next/cache \
 && chown -R bun:bun uploads data .next/cache

USER bun
VOLUME ["/app/uploads", "/app/data"]
EXPOSE 3000 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD ["docker-entrypoint.sh", "healthcheck"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["web"]
