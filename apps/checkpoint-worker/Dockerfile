FROM node:20-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY apps/checkpoint-worker/package.json apps/checkpoint-worker/package.json
RUN npm install --workspaces --include-workspace-root

FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY packages/db packages/db
COPY packages/crypto packages/crypto
COPY apps/checkpoint-worker apps/checkpoint-worker
COPY tsconfig.base.json ./
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run build --workspace=packages/db
RUN npm run build --workspace=packages/crypto
RUN npm run build --workspace=apps/checkpoint-worker

FROM node:20-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/packages/db ./packages/db
COPY --from=build /repo/packages/crypto/dist ./packages/crypto/dist
COPY --from=build /repo/packages/crypto/package.json ./packages/crypto/package.json
COPY --from=build /repo/apps/checkpoint-worker/dist ./apps/checkpoint-worker/dist
COPY --from=build /repo/apps/checkpoint-worker/package.json ./apps/checkpoint-worker/package.json

EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8081/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "apps/checkpoint-worker/dist/index.js"]
