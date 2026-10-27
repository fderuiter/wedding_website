# syntax=docker/dockerfile:1
# Authoritative Runtime Contract: docs/runtime-contract.md
FROM node:22-bookworm-slim AS base
WORKDIR /app

# Builder stage
FROM base AS builder
# Install dependencies needed for prisma
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
    openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts

COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build Next.js application inside builder stage
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

# Runner stage
FROM base AS runner
ENV NODE_ENV=production

# Install runtime dependencies (OpenSSL required by Prisma)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Set correct permissions and pre-create uploads directory
RUN mkdir -p .next public/uploads
RUN chown -R nextjs:nodejs .next public/uploads

# Copy Prisma schema, administrative scripts, and full node_modules for migrations and standalone execution
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000
ENV PORT=3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
