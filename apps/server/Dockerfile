# syntax=docker/dockerfile:1
# API and the built web app run in one process. Nginx on the entry host
# proxies https://recall.aimo.plus to this container.

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/dto/package.json packages/dto/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
RUN pnpm install --frozen-lockfile --filter=@agent-recall/server... --filter=@agent-recall/web...
COPY packages/dto packages/dto
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @agent-recall/dto build \
 && pnpm --filter @agent-recall/server build \
 && pnpm --filter @agent-recall/web build

FROM base AS prod-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/dto/package.json packages/dto/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
RUN pnpm install --frozen-lockfile --prod --filter=@agent-recall/server...

FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/dto ./packages/dto
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages/dto/dist ./packages/dto/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist
WORKDIR /app/apps/server
EXPOSE 8787
CMD ["node", "dist/index.js"]
