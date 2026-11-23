# syntax=docker/dockerfile:1
# Authoritative Runtime Contract: docs/runtime-contract.md
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS base
WORKDIR /app

# Install OpenSSL and tini once for Prisma TLS, PID 1 signal forwarding, and zombie reaping
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get upgrade -y --no-install-recommends && \
    apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    tini && \
    mkdir -p /usr/local/etc && \
    printf 'update-notifier=false\n' | tee /usr/local/etc/npmrc > /etc/npmrc

# Isolated Prisma CLI stage (excludes Studio, @prisma/dev, and builder devDependencies; pinned to package-lock.json)
FROM base AS prisma-cli
WORKDIR /opt/prisma-cli
COPY package-lock.json /tmp/package-lock.json
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    node -e ' \
      const fs = require("fs"); \
      const path = require("path"); \
      const lock = JSON.parse(fs.readFileSync("/tmp/package-lock.json", "utf8")); \
      const srcPackages = lock.packages || {}; \
      const prismaVersion = srcPackages["node_modules/prisma"]?.version; \
      const configVersion = srcPackages["node_modules/@prisma/config"]?.version; \
      const effectVersion = srcPackages["node_modules/effect"]?.version; \
      if (!prismaVersion || !configVersion || !effectVersion) { \
        throw new Error("Missing required Prisma CLI package entries in package-lock.json"); \
      } \
      const stubs = { \
        "@prisma/studio-core": { \
          dir: "stubs/studio-core", \
          pkg: { \
            name: "@prisma/studio-core", \
            version: "0.0.0-disabled", \
            private: true, \
            exports: { \
              "./data/bff": "./index.cjs", \
              "./data/mysql2": "./index.cjs", \
              "./data/node-sqlite": "./index.cjs", \
              "./data/postgresjs": "./index.cjs" \
            } \
          }, \
          code: "module.exports = {};\n" \
        }, \
        "@prisma/dev": { \
          dir: "stubs/prisma-dev", \
          pkg: { \
            name: "@prisma/dev", \
            version: "0.0.0-disabled", \
            private: true, \
            exports: { ".": "./index.cjs", "./internal/state": "./index.cjs" } \
          }, \
          code: "module.exports = { ServerState: { scan: async () => [] } };\n" \
        }, \
        "mysql2": { \
          dir: "stubs/mysql2", \
          pkg: { name: "mysql2", version: "0.0.0-disabled", private: true, main: "index.cjs" }, \
          code: "module.exports = {};\n" \
        }, \
        "postgres": { \
          dir: "stubs/postgres", \
          pkg: { name: "postgres", version: "0.0.0-disabled", private: true, main: "index.cjs" }, \
          code: "module.exports = {};\n" \
        } \
      }; \
      for (const stub of Object.values(stubs)) { \
        const fullDir = path.join("/opt/prisma-cli", stub.dir); \
        fs.mkdirSync(fullDir, { recursive: true }); \
        fs.writeFileSync(path.join(fullDir, "package.json"), JSON.stringify(stub.pkg, null, 2) + "\n"); \
        fs.writeFileSync(path.join(fullDir, "index.cjs"), stub.code); \
      } \
      const rootPkg = { \
        name: "prisma-cli-isolated", \
        private: true, \
        dependencies: { \
          "@prisma/config": configVersion, \
          "prisma": prismaVersion \
        }, \
        overrides: { \
          "effect": effectVersion, \
          "@prisma/studio-core": "file:stubs/studio-core", \
          "@prisma/dev": "file:stubs/prisma-dev", \
          "mysql2": "file:stubs/mysql2", \
          "postgres": "file:stubs/postgres" \
        } \
      }; \
      fs.writeFileSync("/opt/prisma-cli/package.json", JSON.stringify(rootPkg, null, 2) + "\n"); \
      const outPackages = { "": { name: rootPkg.name, dependencies: rootPkg.dependencies } }; \
      for (const [pkgName, stub] of Object.entries(stubs)) { \
        outPackages[stub.dir] = { name: stub.pkg.name, version: stub.pkg.version }; \
        outPackages["node_modules/" + pkgName] = { resolved: stub.dir, link: true }; \
      } \
      function resolveKey(parentKey, depName) { \
        let prefix = parentKey; \
        while (true) { \
          const candidate = prefix ? prefix + "/node_modules/" + depName : "node_modules/" + depName; \
          if (srcPackages[candidate]) return candidate; \
          const prevIdx = prefix.lastIndexOf("/node_modules/"); \
          if (prevIdx === -1) break; \
          prefix = prefix.slice(0, prevIdx); \
        } \
        return "node_modules/" + depName; \
      } \
      const queue = ["node_modules/@prisma/config", "node_modules/prisma", "node_modules/effect"]; \
      const visited = new Set(); \
      while (queue.length > 0) { \
        const key = queue.shift(); \
        if (visited.has(key)) continue; \
        visited.add(key); \
        const pkgName = key.replace(/^(?:.*\/)?node_modules\//, ""); \
        if (stubs[pkgName]) continue; \
        const entry = srcPackages[key]; \
        if (!entry) throw new Error("Lockfile missing reachable package: " + key); \
        const cloned = { ...entry }; \
        delete cloned.dev; \
        delete cloned.devOptional; \
        if (cloned.dependencies) { \
          cloned.dependencies = { ...cloned.dependencies }; \
          for (const dep of Object.keys(cloned.dependencies)) { \
            if (stubs[dep]) cloned.dependencies[dep] = "file:" + stubs[dep].dir; \
            else queue.push(resolveKey(key, dep)); \
          } \
        } \
        if (cloned.optionalDependencies) { \
          for (const dep of Object.keys(cloned.optionalDependencies)) { \
            if (!stubs[dep]) { \
              const optKey = resolveKey(key, dep); \
              if (srcPackages[optKey]) queue.push(optKey); \
            } \
          } \
        } \
        outPackages[key] = cloned; \
      } \
      fs.writeFileSync("/opt/prisma-cli/package-lock.json", JSON.stringify({ \
        name: rootPkg.name, \
        lockfileVersion: lock.lockfileVersion || 3, \
        requires: true, \
        packages: outPackages \
      }, null, 2) + "\n"); \
      fs.unlinkSync("/tmp/package-lock.json"); \
    ' && \
    npm ci --omit=dev --no-audit --no-fund && \
    /opt/prisma-cli/node_modules/.bin/prisma --version | grep -q "schema-engine-cli" && \
    rm -rf \
      /opt/prisma-cli/package-lock.json \
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
