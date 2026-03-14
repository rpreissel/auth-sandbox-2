FROM docker.io/library/node:22-alpine

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/mock-api/package.json apps/mock-api/tsconfig.json apps/mock-api/Dockerfile ./apps/mock-api/
COPY packages/backend-core/package.json packages/backend-core/tsconfig.json ./packages/backend-core/
COPY packages/backend-core/src ./packages/backend-core/src
COPY packages/backend-core/migrations ./packages/backend-core/migrations
COPY apps/mock-api/src ./apps/mock-api/src
COPY packages/shared-types/package.json packages/shared-types/tsconfig.json ./packages/shared-types/
COPY packages/shared-types/src ./packages/shared-types/src

RUN pnpm install --frozen-lockfile && pnpm --filter @auth-sandbox-2/mock-api build

CMD ["node", "apps/mock-api/dist/server.js"]
