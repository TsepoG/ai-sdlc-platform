# syntax=docker/dockerfile:1

# The base image is pinned to the multi-arch index digest of node:24-slim so builds are
# reproducible; the tag is kept for readability. To refresh (e.g. for Node or Debian fixes):
#   docker buildx imagetools inspect node:24-slim
# copy the top-level "Digest:" (the index, not a per-platform manifest), update BOTH FROM
# lines below, then rebuild and check GET /health.
FROM node:24-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Production dependencies only; --ignore-scripts because nothing here needs install scripts.
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS runtime
WORKDIR /app
ARG APP_VERSION=0.0.0-dev
# NODE_EXTRA_CA_CERTS adds the RDS CA bundle to Node's trusted CAs, so the database connection
# verifies the server certificate (rejectUnauthorized stays true). Refresh: see README.
ENV NODE_ENV=production \
    PORT=8080 \
    APP_VERSION=${APP_VERSION} \
    NODE_EXTRA_CA_CERTS=/app/certs/rds-global-bundle.pem
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
# Stage and routing configuration; the server validates it at startup and refuses to run without it.
COPY --chown=node:node config ./config
# Applied at startup, before the server listens.
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node certs ./certs
USER node
EXPOSE 8080
# The slim image has no curl, so probe with Node's built-in fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/server/main.js"]
