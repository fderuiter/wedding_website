# syntax=docker/dockerfile:1
# Authoritative Runtime Contract: docs/runtime-contract.md
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS base
WORKDIR /app

# Install OpenSSL, CA certificates, and binutils for Prisma TLS, ELF stripping, and $PREFIX/etc/npmrc
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get upgrade -y --no-install-recommends && \
    apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    binutils && \
    mkdir -p /usr/local/etc && \
    printf 'update-notifier=false\n' > /usr/local/etc/npmrc && \
    strip --strip-unneeded /usr/local/bin/node

# Isolated Prisma CLI stage pinned via committed lockfile (excludes Studio, @prisma/dev, fast-check, and @prisma/fetch-engine)
FROM base AS prisma-cli
WORKDIR /opt/prisma-cli
COPY docker/prisma-cli/package.json docker/prisma-cli/package-lock.json ./
COPY docker/prisma-cli/stubs ./stubs
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --install-links --omit=dev --no-audit --no-fund && \
    /opt/prisma-cli/node_modules/.bin/prisma --version | grep -q "schema-engine-cli" && \
    printf '%s\n' \
      '"use strict";' \
      'Object.defineProperty(exports, "__esModule", { value: true });' \
      > /opt/prisma-cli/node_modules/effect/dist/cjs/FastCheck.js && \
    printf '%s\n' \
      '"use strict";' \
      'const fs = require("fs");' \
      'const path = require("path");' \
      'const { enginesVersion } = require("@prisma/engines-version");' \
      'const engineDir = path.join(__dirname, "../");' \
      'module.exports = {' \
      '  enginesVersion,' \
      '  getEnginesPath: () => engineDir,' \
      '  ensureNeededBinariesExist: async () => {' \
      '    if (!fs.readdirSync(engineDir).some((f) => f.startsWith("schema-engine-"))) {' \
      '      throw new Error("Offline runtime: schema-engine binary missing");' \
      '    }' \
      '  },' \
      '};' \
      > /opt/prisma-cli/node_modules/@prisma/engines/dist/index.js && \
    rm -rf \
      /opt/prisma-cli/package-lock.json \
      /opt/prisma-cli/stubs \
      /opt/prisma-cli/node_modules/fast-check \
      /opt/prisma-cli/node_modules/pure-rand \
      /opt/prisma-cli/node_modules/@prisma/fetch-engine \
      /opt/prisma-cli/node_modules/@prisma/engines/scripts \
      /opt/prisma-cli/node_modules/@prisma/engines/dist/scripts \
      /opt/prisma-cli/node_modules/@prisma/get-platform/dist/test-utils \
      /opt/prisma-cli/node_modules/prisma/build/studio.js \
      /opt/prisma-cli/node_modules/prisma/build/studio.css \
      /opt/prisma-cli/node_modules/prisma/build/xdg-open \
      /opt/prisma-cli/node_modules/prisma/build/*.cockroachdb.* \
      /opt/prisma-cli/node_modules/prisma/build/*.mysql.* \
      /opt/prisma-cli/node_modules/prisma/build/*.sqlite.* \
      /opt/prisma-cli/node_modules/prisma/build/*.sqlserver.* \
      /opt/prisma-cli/node_modules/prisma/build/schema_engine_bg.* \
      /opt/prisma-cli/node_modules/prisma/build/query_compiler_* \
      /opt/prisma-cli/node_modules/effect/src \
      /opt/prisma-cli/node_modules/effect/dist/esm \
      /opt/prisma-cli/node_modules/effect/dist/dts \
      /opt/prisma-cli/node_modules/.cache && \
    find /opt/prisma-cli/node_modules -type f \( -name "*.d.ts" -o -name "*.map" \) -delete && \
    find /opt/prisma-cli/node_modules -type f \( -name "schema-engine-*" -o -name "*.node" \) -exec strip --strip-unneeded {} + && \
    /opt/prisma-cli/node_modules/.bin/prisma --version | grep -q "schema-engine-cli"

# Builder stage
FROM base AS builder
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts

COPY prisma ./prisma
COPY prisma.config.ts next.config.ts postcss.config.mjs tsconfig.json tsconfig.build.json next-env.d.ts ./
COPY assets ./assets
COPY public ./public
COPY src ./src
COPY scripts/generate-password-hash.mjs ./scripts/generate-password-hash.mjs

# Generate Prisma Client once and build standalone Next.js output without linters or doc generators
RUN --mount=type=cache,target=/app/.next/cache,sharing=locked \
    npm run build:docker && \
    rm -rf \
      /app/public/mockServiceWorker.js \
      /app/.next/standalone/public/mockServiceWorker.js \
      /app/.next/standalone/src \
      /app/.next/standalone/node_modules/@img/sharp-libvips-linuxmusl-* \
      /app/.next/standalone/node_modules/@img/sharp-linuxmusl-* \
      /app/.next/standalone/node_modules/@img/sharp-wasm32 \
      /app/.next/standalone/node_modules/pdfkit/.yarn \
      /app/.next/standalone/node_modules/pdfkit/js/pdfkit.standalone.js \
      /app/.next/standalone/node_modules/pdfkit/js/pdfkit.browser.js \
      /app/.next/standalone/node_modules/pdfkit/js/pdfkit.browser.mjs \
      /app/.next/standalone/node_modules/pdfkit/js/pdfkit.browser.old.js \
      /app/.next/standalone/node_modules/pdfkit/js/pdfkit.browser.old.mjs \
      /app/.next/standalone/node_modules/pdfkit/js/pdfkit.old.js \
      /app/.next/standalone/node_modules/pdfkit/lib/fs/browser.js \
      /app/.next/standalone/node_modules/pdfkit/lib/zlib/browser.js \
      /app/.next/standalone/node_modules/pdfkit/lib/stream/browser.js \
      /app/.next/standalone/node_modules/fontkit/dist/browser.cjs \
      /app/.next/standalone/node_modules/fontkit/dist/browser-module.mjs \
      /app/.next/standalone/node_modules/fontkit/src && \
    find /app/.next/standalone/node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" \) -prune -exec rm -rf {} + && \
    find /app/.next/standalone -type f \( -name "*.nft.json" -o -name "*.d.ts" -o -name "*.map" -o -path "*/src/*.ts" -o -path "*/src/*.tsx" \) -delete && \
    find /app/.next/standalone/node_modules -type f -name "*.node" -exec strip --strip-unneeded {} + && \
    node -e ' \
      const fs = require("fs"); \
      const pkgPath = "/app/.next/standalone/package.json"; \
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); \
      delete pkg.devDependencies; \
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n"); \
    '

# Runner stage: minimal Debian Bookworm runtime with stripped Node.js v22 binary and zero npm/npx/corepack/yarn
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    tini \
    libstdc++6 && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=base /usr/local/bin/node /usr/local/bin/node

# Copy entrypoint script and install isolated Prisma CLI wrapper on system PATH (owned by root:root)
COPY docker-entrypoint.sh /usr/local/bin/
COPY --from=prisma-cli /opt/prisma-cli /opt/prisma-cli
RUN printf '%s\n' \
      '#!/bin/sh' \
      'export CHECKPOINT_DISABLE=1' \
      'export NPM_CONFIG_UPDATE_NOTIFIER=false' \
      'export NO_UPDATE_NOTIFIER=1' \
      'export NODE_PATH="/opt/prisma-cli/node_modules${NODE_PATH:+:$NODE_PATH}"' \
      'exec node /opt/prisma-cli/node_modules/prisma/build/index.js "$@"' \
      > /usr/local/bin/prisma && \
    chmod 0755 /usr/local/bin/docker-entrypoint.sh /usr/local/bin/prisma

# Leverage traced standalone output and flat static/public asset hierarchy owned by root:root
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy Prisma schema, config, shared PostgreSQL URI normalizer, and standalone password hash utility owned by root:root
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src/lib/postgres-url.js ./src/lib/postgres-url.js
COPY --from=builder /app/scripts/generate-password-hash.mjs ./scripts/generate-password-hash.mjs

# Link ./node_modules/.bin/prisma (root:root), pre-create runtime cache/upload mountpoints, and strip setuid/setgid bits
RUN mkdir -p /app/node_modules/.bin /app/.next/cache /app/public/uploads && \
    ln -sf /usr/local/bin/prisma /app/node_modules/.bin/prisma && \
    chown -R nextjs:nodejs /app/.next/cache /app/public/uploads && \
    find / -xdev -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null || true

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/live').then((res)=>process.exit(res.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "-s", "--", "docker-entrypoint.sh"]
CMD ["node", "server.js"]
