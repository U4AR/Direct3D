FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN if [ ! -f public/cad/asset-manifest.json ] || [ ! -f public/sculpt/sculpt.js ]; then apt-get update && apt-get install -y --no-install-recommends git ca-certificates && corepack enable && corepack prepare pnpm@10.8.0 --activate && node scripts/setup-browser-editors.mjs && rm -rf /var/lib/apt/lists/*; fi
RUN npm run build
FROM node:22-bookworm-slim
ENV NODE_ENV=production BRIDGE_HOST=0.0.0.0 PORT=8788 DRAW3D_STATIC_DIR=/app/dist SESSION_DIR=/data ALLOW_NATIVE_GUI=0
WORKDIR /app
RUN groupadd -g 10001 draw3d && useradd -u 10001 -g draw3d -d /tmp draw3d && mkdir /data && chown draw3d:draw3d /data
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY scripts ./scripts
COPY src ./src
COPY agent-skills ./agent-skills
COPY deploy/OPEN-SOURCE.md ./OPEN-SOURCE.md
USER 10001:10001
EXPOSE 8788
CMD ["node","scripts/model-bridge.mjs"]
