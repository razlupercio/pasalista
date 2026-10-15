# SPDX-License-Identifier: AGPL-3.0-or-later
FROM node:25-alpine AS build

RUN corepack enable
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/i18n/package.json packages/i18n/
RUN pnpm install --frozen-lockfile --filter "@pasalista/web..."

COPY packages/api-client packages/api-client
COPY packages/config packages/config
COPY packages/core packages/core
COPY packages/i18n packages/i18n
COPY apps/web apps/web

# Rewrites are resolved at build time, so the internal API address is a build argument.
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN pnpm --filter @pasalista/web build

FROM node:25-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
# Static files, including the QR decoder WASM copied by the prebuild step.
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
