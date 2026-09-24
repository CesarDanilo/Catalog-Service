# syntax=docker/dockerfile:1

# ---------- base ----------
FROM node:22-bookworm-slim AS base
WORKDIR /app
# Local compartilhado dos browsers do Playwright (acessível pelo usuário node).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*

# ---------- deps (todas as dependências) ----------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate

# ---------- dev (API e worker com hot reload) ----------
FROM deps AS dev
# Chromium só é necessário para crawlers que dependem de JavaScript (busca da Renner).
RUN npx playwright install --with-deps chromium
COPY . .
ENV NODE_ENV=development
EXPOSE 3333
CMD ["npm", "run", "dev"]

# ---------- build ----------
FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- production ----------
FROM base AS production
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules ./node_modules
# Usa a mesma versão do Playwright declarada no package-lock.
RUN npx playwright install --with-deps chromium
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package.json ./
USER node
EXPOSE 3333
CMD ["node", "dist/server.js"]
