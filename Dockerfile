FROM node:20-slim AS builder

WORKDIR /app

# Build-time deps (nothing native beyond what npm needs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM node:20-slim AS runtime

WORKDIR /app

# Runtime deps:
# - poppler-utils provides `pdftotext` (used via spawnSync in server/routes.ts)
# - ca-certificates for outbound HTTPS (OpenAI, SMTP)
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=5000

# Install prod deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built bundle + static assets + seed data
COPY --from=builder /app/dist ./dist

# Persistent volume mount point (Railway mounts here)
RUN mkdir -p /app/uploads

EXPOSE 5000

CMD ["node", "dist/index.cjs"]
