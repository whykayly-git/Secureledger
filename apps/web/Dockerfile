FROM node:20-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/ledger/package.json packages/ledger/package.json
COPY packages/verification/package.json packages/verification/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --workspaces --include-workspace-root

FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY packages/db packages/db
COPY packages/crypto packages/crypto
COPY packages/ledger packages/ledger
COPY packages/verification packages/verification
COPY apps/web apps/web
COPY tsconfig.base.json ./
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run build --workspace=packages/db
RUN npm run build --workspace=packages/crypto
RUN npm run build --workspace=packages/ledger
RUN npm run build --workspace=packages/verification
ENV NEXT_TELEMETRY_DISABLED=1
# `next build` imports API route modules, and lib/auth.ts throws at import time
# without JWT_SECRET. This placeholder lives only in this build stage; the
# runner stage never inherits it and reads the real secret at runtime.
ENV JWT_SECRET=build-only-placeholder
RUN npm run build --workspace=apps/web

FROM node:20-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/packages/db ./packages/db
COPY --from=build /repo/packages/crypto ./packages/crypto
COPY --from=build /repo/packages/ledger ./packages/ledger
COPY --from=build /repo/packages/verification ./packages/verification
COPY --from=build /repo/apps/web ./apps/web

WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["npm", "run", "start"]
