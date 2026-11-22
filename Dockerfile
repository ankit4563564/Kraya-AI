# Multi-stage production Dockerfile for Kraya (API + Web PWA)
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/finance-engine/package.json packages/finance-engine/
COPY packages/agent-core/package.json packages/agent-core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps ./apps

RUN pnpm build

# ---- Runtime Stage 1: Kraya API Server ----
FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/finance-engine/package.json ./packages/finance-engine/
COPY --from=builder /app/packages/finance-engine/dist ./packages/finance-engine/dist
COPY --from=builder /app/packages/agent-core/package.json ./packages/agent-core/
COPY --from=builder /app/packages/agent-core/dist ./packages/agent-core/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/migrations ./apps/api/migrations
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
EXPOSE 8787
CMD ["node", "apps/api/dist/node-server.js"]

# ---- Runtime Stage 2: Kraya Web PWA (Nginx + /api reverse proxy) ----
FROM nginx:1.27-alpine AS web
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
