FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
FROM base AS build
COPY package.json pnpm-workspace.yaml .npmrc ./
COPY shared/package.json ./shared/package.json
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm build
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 10001 duet && useradd --system --uid 10001 --gid duet --home-dir /app duet
COPY --from=build --chown=duet:duet /app/server/dist ./server/dist
COPY --from=build --chown=duet:duet /app/server/src/db/schema.sql ./server/dist/db/schema.sql
COPY --from=build --chown=duet:duet /app/server/node_modules ./server/node_modules
COPY --from=build --chown=duet:duet /app/node_modules ./node_modules
COPY --from=build --chown=duet:duet /app/web/dist ./web/dist
USER duet
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
