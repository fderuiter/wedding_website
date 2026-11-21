# syntax=docker/dockerfile:1
# Authoritative Runtime Contract: docs/runtime-contract.md
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS base
WORKDIR /app

# Install OpenSSL once for Prisma engine detection and runtime TLS across stages
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates

# Isolated Prisma CLI stage (excludes Studio, @prisma/dev, and builder devDependencies)
FROM base AS prisma-cli
WORKDIR /opt/prisma-cli
COPY package-lock.json /tmp/package-lock.json
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    node -e ' \
      const fs = require("fs"); \
      const lock = JSON.parse(fs.readFileSync("/tmp/package-lock.json", "utf8")); \
      const prismaVersion = lock.packages?.["node_modules/prisma"]?.version || "7.10.1"; \
      const configVersion = lock.packages?.["node_modules/@prisma/config"]?.version || prismaVersion; \
      const effectVersion = lock.packages?.["node_modules/effect"]?.version || "3.22.5"; \
      fs.mkdirSync("/opt/prisma-cli/stubs/studio-core", { recursive: true }); \
      fs.writeFileSync("/opt/prisma-cli/stubs/studio-core/package.json", JSON.stringify({ \
        name: "@prisma/studio-core", \
        version: "0.0.0-disabled", \
        private: true, \
        exports: { \
          "./data/bff": "./index.cjs", \
          "./data/mysql2": "./index.cjs", \
          "./data/node-sqlite": "./index.cjs", \
          "./data/postgresjs": "./index.cjs" \
        } \
      }, null, 2)); \
      fs.writeFileSync("/opt/prisma-cli/stubs/studio-core/index.cjs", "module.exports = {};\n"); \
      fs.mkdirSync("/opt/prisma-cli/stubs/prisma-dev", { recursive: true }); \
      fs.writeFileSync("/opt/prisma-cli/stubs/prisma-dev/package.json", JSON.stringify({ \
        name: "@prisma/dev", \
        version: "0.0.0-disabled", \
        private: true, \
        exports: { ".": "./index.cjs", "./internal/state": "./index.cjs" } \
      }, null, 2)); \
      fs.writeFileSync("/opt/prisma-cli/stubs/prisma-dev/index.cjs", "module.exports = { ServerState: { scan: async () => [] } };\n"); \
      fs.mkdirSync("/opt/prisma-cli/stubs/empty", { recursive: true }); \
      fs.writeFileSync("/opt/prisma-cli/stubs/empty/package.json", JSON.stringify({ \
        name: "empty-stub", \
        version: "0.0.0-disabled", \
        private: true, \
        main: "index.cjs" \
      }, null, 2)); \
      fs.writeFileSync("/opt/prisma-cli/stubs/empty/index.cjs", "module.exports = {};\n"); \
      fs.writeFileSync("/opt/prisma-cli/package.json", JSON.stringify({ \
        name: "prisma-cli-isolated", \
        private: true, \
        dependencies: { \
          "@prisma/config": configVersion, \
          "prisma": prismaVersion \
        }, \
        overrides: { \
          "effect": effectVersion, \
          "@prisma/studio-core": "file:/opt/prisma-cli/stubs/studio-core", \
          "@prisma/dev": "file:/opt/prisma-cli/stubs/prisma-dev", \
          "mysql2": "file:/opt/prisma-cli/stubs/empty", \
          "postgres": "file:/opt/prisma-cli/stubs/empty" \
        } \
      }, null, 2)); \
      fs.unlinkSync("/tmp/package-lock.json"); \
    ' && \
    npm install --install-links --omit=dev --no-audit --no-fund && \
    /opt/prisma-cli/node_modules/.bin/prisma --version | grep -q "schema-engine-cli" && \
    rm -rf \
      /opt/prisma-cli/package-lock.json \
      /opt/prisma-cli/stubs \
      /opt/prisma-cli/node_modules/prisma/build/studio.js \
      /opt/prisma-cli/node_modules/prisma/build/studio.css \
      /opt/prisma-cli/node_modules/prisma/build/xdg-open \
      /opt/prisma-cli/node_modules/prisma/build/*.cockroachdb.* \
      /opt/prisma-cli/node_modules/prisma/build/*.mysql.* \
      /opt/prisma-cli/node_modules/prisma/build/*.sqlite.* \
      /opt/prisma-cli/node_modules/prisma/build/*.sqlserver.* \
      /opt/prisma-cli/node_modules/effect/src \
      /opt/prisma-cli/node_modules/effect/dist/esm \
      /opt/prisma-cli/node_modules/effect/dist/dts \
      /opt/prisma-cli/node_modules/.cache && \
    find /opt/prisma-cli/node_modules -type f \( -name "*.d.ts" -o -name "*.map" \) -delete && \
    /opt/prisma-cli/node_modules/.bin/prisma --version | grep -q "schema-engine-cli"

# Builder stage
FROM base AS builder
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts

COPY . .

# Generate Prisma Client once and build standalone Next.js output without linters or doc generators
RUN --mount=type=cache,target=/app/.next/cache,sharing=locked \
    npm run build:docker && \
    rm -rf \
      /app/public/mockServiceWorker.js \
      /app/.next/standalone/public/mockServiceWorker.js \
      /app/.next/standalone/node_modules/@img/sharp-libvips-linuxmusl-* \
      /app/.next/standalone/node_modules/@img/sharp-linuxmusl-* \
      /app/.next/standalone/node_modules/@img/sharp-wasm32 \
      /app/.next/standalone/node_modules/pdfkit/js/pdfkit.standalone.js && \
    find /app/.next/standalone/node_modules -type f \( -name "*.d.ts" -o -name "*.map" \) -delete && \
    node -e ' \
      const fs = require("fs"); \
      const pkgPath = "/app/.next/standalone/package.json"; \
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); \
      delete pkg.devDependencies; \
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n"); \
    '

# Runner stage
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# Copy entrypoint script and install isolated Prisma CLI wrapper on system PATH
COPY docker-entrypoint.sh /usr/local/bin/
COPY --from=prisma-cli --chown=nextjs:nodejs /opt/prisma-cli /opt/prisma-cli
RUN printf '%s\n' \
      '#!/bin/sh' \
      'export CHECKPOINT_DISABLE=1' \
      'export NODE_PATH="/opt/prisma-cli/node_modules${NODE_PATH:+:$NODE_PATH}"' \
      'exec node /opt/prisma-cli/node_modules/prisma/build/index.js "$@"' \
      > /usr/local/bin/prisma && \
    chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/prisma

# Leverage traced standalone output and flat static/public asset hierarchy
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Set correct permissions and pre-create writable directories
RUN mkdir -p .next public/uploads && \
    chown nextjs:nodejs .next public public/uploads

# Copy Prisma schema, config, and standalone password hash utility
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts/generate-password-hash.mjs ./scripts/generate-password-hash.mjs

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
