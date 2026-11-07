# syntax=docker/dockerfile:1.7
# Malina — the game server image: node runs server/main.ts (TypeScript directly) and serves the built game from dist/.
#   docker buildx build -t malina .            — production image (target "runtime")
#   docker buildx build --target dev -t malina:dev .  — dependencies only, for docker-compose.dev.yml
#
# Cross-building without emulation: every RUN happens in stages on the BUILD machine's platform ($BUILDPLATFORM —
# arm64 on a Mac), the target-platform "runtime" stage only copies files. So `--platform linux/amd64` on a Mac
# needs no QEMU ("exec format error" otherwise). This is safe while production dependencies are pure JS
# (three, ws): a dependency with native code would need `npm ci --omit=dev` on the target platform.
ARG NODE_VERSION=26.7.0

# ---- all dependencies (dev included): tsc and vite for the build, also the dev image
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS deps
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
# files with mode 600 in the working copy would be unreadable for user node in the runtime image;
# /out/data — an empty directory for the database, copied with the right owner (no RUN in the runtime stage)
RUN chmod -R a+rX server src assets && npm run build && mkdir -p /out/data

# ---- production dependencies only (three, ws — pure JS, so the build platform is fine)
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

# ---- runtime (target platform): only COPY, nothing is executed here
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DB_PATH=/data/malina.db STATIC=dist
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/assets ./assets
COPY --from=build /app/dist ./dist
COPY --from=build --chown=node:node /out/data /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server/main.ts"]
