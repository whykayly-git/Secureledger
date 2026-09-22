FROM node:20-alpine
WORKDIR /repo

COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/package.json
RUN npm install --workspace=packages/db --include-workspace-root

COPY packages/db packages/db

CMD ["npx", "prisma", "migrate", "deploy", "--schema", "packages/db/prisma/schema.prisma"]
