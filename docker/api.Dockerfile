# SPDX-License-Identifier: AGPL-3.0-or-later
# The API runs TypeScript directly with Node's built-in type stripping (ADR-0006): no build step.
FROM node:24-alpine

RUN corepack enable
WORKDIR /app

# Install production dependencies of the API and its workspace packages only.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
RUN pnpm install --frozen-lockfile --prod --filter "@pasalista/api..."

COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/i18n packages/i18n
COPY apps/api apps/api

ENV NODE_ENV=production PORT=3001
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3001/api/v1/health > /dev/null || exit 1

# Apply pending migrations, then start the API.
CMD ["sh", "-c", "node packages/db/src/migrate.ts && exec node apps/api/src/index.ts"]
