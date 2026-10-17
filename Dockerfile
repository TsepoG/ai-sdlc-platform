# syntax=docker/dockerfile:1

# TODO(owner): pin the base image by digest (node:24-slim@sha256:...) once a refresh policy exists.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Production dependencies only; --ignore-scripts because nothing here needs install scripts.
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-slim AS runtime
WORKDIR /app
ARG APP_VERSION=0.0.0-dev
ENV NODE_ENV=production \
    PORT=8080 \
    APP_VERSION=${APP_VERSION}
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
USER node
EXPOSE 8080
# The slim image has no curl, so probe with Node's built-in fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/server/main.js"]
