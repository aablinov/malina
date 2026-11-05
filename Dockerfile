# syntax=docker/dockerfile:1.7
# Malina — the game server image: node runs server/main.ts (TypeScript directly) and serves the built game from dist/.
#   docker buildx build -t malina .            — production image (target "runtime")
#   docker buildx build --target dev -t malina:dev .  — dependencies only, for docker-compose.dev.yml
ARG NODE_VERSION=26.7.0

# ---- all dependencies (dev included): tsc and vite for the build, also the dev image
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS dev
ENV PORT=8787 HOST=0.0.0.0 DB_PATH=/data/malina.db
RUN mkdir -p /data
EXPOSE 8787 5173

# ---- build: type check of client and server + vite → dist/index.html
FROM deps AS build
COPY . .
# files with mode 600 in the working copy would be unreadable for user node in the runtime image
RUN chmod -R a+rX server src assets && npm run build

# ---- production dependencies only (three, ws)
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

# ---- runtime: the server imports shared code from src/ and maps from assets/
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DB_PATH=/data/malina.db STATIC=dist
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/assets ./assets
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server/main.ts"]
