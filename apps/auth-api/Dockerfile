FROM docker.io/library/node:22-alpine

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/auth-api/package.json apps/auth-api/tsconfig.json apps/auth-api/Dockerfile ./apps/auth-api/
COPY packages/shared-types/package.json packages/shared-types/tsconfig.json ./packages/shared-types/
COPY apps/auth-api/src ./apps/auth-api/src
COPY apps/auth-api/migrations ./apps/auth-api/migrations
COPY packages/shared-types/src ./packages/shared-types/src

RUN pnpm install --frozen-lockfile && pnpm --filter @auth-sandbox-2/auth-api build

CMD ["node", "apps/auth-api/dist/apps/auth-api/src/server.js"]
