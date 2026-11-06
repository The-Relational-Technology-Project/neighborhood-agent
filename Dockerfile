FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
RUN npm install --no-save typescript@5 --no-audit --no-fund && npx tsc -p tsconfig.json && npm prune --omit=dev
ENV NODE_ENV=production PORT=3000 CACHE_DIR=/data/cache
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "dist/server.js"]
