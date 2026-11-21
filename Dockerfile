FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci
COPY . .
RUN npm run build \
 && ./node_modules/.bin/esbuild src/worker/platform-worker.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=.output/worker.mjs \
 && ./node_modules/.bin/esbuild src/worker/monitor-wallet-worker.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=.output/monitor-wallet-worker.mjs \
 && npm prune --omit=dev \
 && test ! -e node_modules/@vitejs/plugin-react \
 && test ! -e node_modules/typescript \
 && test ! -e node_modules/tsx

FROM node:22-bookworm-slim AS production
ARG BUILD_COMMIT=unknown
ARG BUILD_DATE=unknown
ENV NODE_ENV=production PORT=8083 HOST=0.0.0.0 PLATFORM_PROCESS_MODE=all APP_BUILD_COMMIT=$BUILD_COMMIT APP_BUILD_DATE=$BUILD_DATE
ENV NPM_CONFIG_PRODUCTION=true
LABEL org.opencontainers.image.revision=$BUILD_COMMIT org.opencontainers.image.created=$BUILD_DATE
WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node /app/node_modules ./node_modules
# npm file: dependencies are links to these package directories.
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/legacy ./legacy
COPY --from=build --chown=node:node /app/scripts/migrate-production.mjs ./scripts/migrate-production.mjs
COPY --from=build --chown=node:node /app/scripts/migration-readiness.mjs ./scripts/migration-readiness.mjs
COPY --from=build --chown=node:node /app/scripts/legacy-db-initializer.mjs ./scripts/legacy-db-initializer.mjs
COPY --chown=node:node scripts/start.mjs scripts/process-supervisor.mjs scripts/webhook-proxy.mjs ./scripts/
USER node
EXPOSE 8083 8084
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8083/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "scripts/start.mjs"]

