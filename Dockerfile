# syntax=docker/dockerfile:1

# ---- install production dependencies (tsx is a runtime dependency: no build step yet) ----
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev

# ---- shared base ----
FROM node:24-slim AS base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared ./packages/shared

# ---- api ----
FROM base AS api
COPY apps/api ./apps/api
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/server.ts"]

# ---- worker ----
FROM base AS worker
COPY apps/worker ./apps/worker
WORKDIR /app/apps/worker
USER node
CMD ["node", "--import", "tsx", "src/worker.ts"]
