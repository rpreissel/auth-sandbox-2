FROM docker.io/library/node:22-alpine

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/tanmock-api/package.json apps/tanmock-api/tsconfig.json apps/tanmock-api/Dockerfile ./apps/tanmock-api/
COPY packages/backend-core/package.json packages/backend-core/tsconfig.json ./packages/backend-core/
COPY packages/backend-core/src ./packages/backend-core/src
COPY packages/backend-core/migrations ./packages/backend-core/migrations
COPY packages/shared-types/package.json packages/shared-types/tsconfig.json ./packages/shared-types/
COPY packages/shared-types/src ./packages/shared-types/src
COPY apps/tanmock-api/src ./apps/tanmock-api/src
COPY apps/tanmock-api/migrations ./apps/tanmock-api/migrations

RUN pnpm install --frozen-lockfile && pnpm --filter @auth-sandbox-2/tanmock-api build

CMD ["node", "apps/tanmock-api/dist/apps/tanmock-api/src/server.js"]
