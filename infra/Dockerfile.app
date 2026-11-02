FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 PATEX_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force && mkdir -p /data && chown node:node /data
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/node/server/index.js"]
