# syntax=docker/dockerfile:1

# ---- Frontend ----
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- Backend ----
FROM node:22-bookworm-slim AS server
# The SQLite cipher driver compiles its native addon during install.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- Runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIST=/app/web \
    PORT=8080 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=server /server/package.json ./
COPY --from=server /server/node_modules ./node_modules
COPY --from=server /server/dist ./dist
COPY --from=web /web/dist ./web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
