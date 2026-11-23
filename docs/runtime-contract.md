# Application Runtime Contract

This document defines the authoritative, provider-neutral runtime contract for the wedding website application. Any supported hosting infrastructure—including Docker containers, cloud container services (e.g., Google Cloud Run, AWS App Runner/ECS, Azure Container Apps), serverless hosting (e.g., Vercel), static showcase CDNs, or bare-metal/VM local production environments—must satisfy the specifications described here.

---

## 1. Node.js & Next.js Standalone Runtime

- **Target Architecture**: Dual-mode Next.js App Router configuration in `next.config.ts`:
  - **Standalone Server Mode (Default)**: Configured with `output: 'standalone'` when `STATIC_EXPORT` is unset or false, producing a self-contained Node.js server bundle at `.next/standalone/server.js` (packaged at `/app/server.js` in OCI containers).
  - **Static Showcase Export Mode (`STATIC_EXPORT`)**: Setting `STATIC_EXPORT=true` or `STATIC_EXPORT=1`—or running `npm run build:export` (`scripts/build-export.mjs`)—switches `next.config.ts` to `output: 'export'` with `images.unoptimized: true` and optional subpath routing via `NEXT_PUBLIC_BASE_PATH` (`basePath` and `assetPrefix`). `scripts/build-export.mjs` stages build inputs without `src/app/api` (and without `public/uploads` or `public/mockServiceWorker.js`) inside `.next/export-stage`, compiles with `turbopack.root` pinned to the repository root, moves the generated `out/` directory to the repository root, and cleans up `.next/export-stage` automatically on exit or `SIGINT`/`SIGTERM`/`SIGHUP` while `src/lib/config.ts` renders pages against `STATIC_MOCK_CONFIG` without requiring PostgreSQL connectivity.
- **Node.js Version Requirement**: Node.js **v22.x LTS** runtime (`^22.12.0` with `npm@10.9.x` `^10.9.0`, pinned via `.nvmrc`, `.npmrc`, and `package.json`).
- **OCI Container Support**:
  - The official `Dockerfile` produces a multi-platform OCI image based on `node:22-bookworm-slim` with `tini` installed as PID 1 (`ENTRYPOINT ["/usr/bin/tini", "-s", "--", "docker-entrypoint.sh"]`), setuid/setgid bits stripped across the root filesystem, npm update checks disabled, and a built-in `/api/live` `HEALTHCHECK`.
  - Application assets, `node_modules`, `/opt/prisma-cli`, `prisma`, `prisma.config.ts`, and `scripts` are packaged under `/app` owned by `root:root` so the non-root runtime user (`nextjs:nodejs`, UID/GID 1001) holds write access to zero static code paths (only runtime cache/upload mountpoints `/app/.next/cache` and `/app/public/uploads` are owned by `nextjs:nodejs`).

---

## 2. Network Interface, Listening Port & Host Binding

- **Listening Port & Host Interface**:
  - Listening port is configured via the `PORT` environment variable (defaults to `3000`).
  - Host interface binding is configured via the `HOSTNAME` environment variable (`ENV HOSTNAME="0.0.0.0"` in `Dockerfile` and `HOSTNAME: "0.0.0.0"` in `docker-compose.yml`), ensuring the standalone `server.js` binds to all available network interfaces (`0.0.0.0`) rather than a container-internal hostname.
- **Protocol**: HTTP/1.1 or HTTP/2 unencrypted traffic internally, expecting TLS termination at the ingress/reverse-proxy layer.

---

## 3. Database Specification & PostgreSQL Policy

- **Engine**: PostgreSQL version **15.0 or higher** (tested with PostgreSQL 15-alpine and Neon serverless Postgres).
- **Driver / ORM**: Prisma ORM with `@prisma/adapter-pg` or direct TCP connections (`pg` driver).
- **Connection Strings**:
  - `DATABASE_URL`: Primary connection string bound to `datasource.url` in `prisma.config.ts`. Used for both Next.js runtime operations (supporting PgBouncer, Neon Connection Pooling, Supabase Pooler, or direct TCP) and `npx prisma migrate deploy`. When `DATABASE_URL` routes through a transaction-mode connection pooler such as PgBouncer, `npx prisma migrate deploy` requires an explicit `DATABASE_URL` override pointing to a direct, non-pooled PostgreSQL endpoint so Prisma can acquire advisory locks.
  - `POSTGRES_URL_NON_POOLING` *(Optional)*: Direct, non-pooled connection URL bound to `datasource.shadowDatabaseUrl` in `prisma.config.ts` for local shadow database creation (`prisma migrate dev`). Operators on pooled serverless databases can also store their direct PostgreSQL URL in `POSTGRES_URL_NON_POOLING` and pass it via an explicit `DATABASE_URL` override (`DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING npx prisma migrate deploy`) during release migrations.
- **Provider Neutrality**: No database-vendor specific features or proprietary extensions are required. Standard relational PostgreSQL features (tables, foreign keys, indexes, JSONB) are used.

---

## 4. Environment Variable Matrix

All operator-facing configuration across application runtime (`src/env.ts`, `src/lib/config.ts`), Next.js and VitePress build pipelines (`next.config.ts`, `scripts/build-export.mjs`, `docs-portal/.vitepress/config.mts`), and container orchestration (`Dockerfile`, `docker-compose.yml`) is supplied via environment variables. Core runtime variables are validated at startup by `src/env.ts` (Zod schema). Internal framework and test-runner flags (`NEXT_RUNTIME`, `npm_lifecycle_event`, and `JEST_WORKER_ID`) are managed automatically by Next.js, npm, and Jest rather than configured by operators.

### Mandatory Runtime Variables
| Variable | Default Value | Description & Validation Requirements |
|---|---|---|
| `DATABASE_URL` | *None* | Primary PostgreSQL connection URL (`datasource.url` in `prisma.config.ts`). Must be a valid `postgresql://` or `postgres://` connection string. |
| `ADMIN_PASSWORD` | *None* | Scrypt hash for admin authentication. Must match format `scrypt:[16-byte saltBase64]:[64-byte keyBase64]` (generated via `scripts/generate-password-hash.mjs`); plaintext passwords, non-64-byte hashes, and placeholder hashes are rejected, and `src/core/auth/auth.server.ts` derives a domain-separated HMAC signing key from the decoded hash bytes. |

### Production-Required Variables
These variables provide convenience defaults for local `development` and `test` modes in `src/env.ts`, but startup validation strictly requires unique, non-default values when `NODE_ENV=production`:
| Variable | Dev / Test Default | Production Requirements & Description |
|---|---|---|
| `GUEST_PASSCODE` | `wedding2026` | Global passcode required for guest website access. Required in `production` (must not be empty or use `wedding2026`, template placeholders, or E2E fallback passcodes). |
| `GUEST_SESSION_SECRET` | `default-guest-session-secret` | Dedicated server secret for signing and verifying guest invitation session tokens (HMAC-SHA256). Required in `production`; must be at least 32 characters long, distinct from `GUEST_PASSCODE`, and must not use `default-guest-session-secret`, template placeholders, or E2E fallback secrets. |

### Optional Infrastructure & Feature Variables
| Variable | Default Value | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime mode (`production`, `development`, `test`). Automatically set to `production` in `Dockerfile` runner environments. |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1,*.localhost` | Comma-separated list of whitelisted host domains or wildcard patterns validated against `X-Forwarded-Host` / `Host` in `src/middleware.ts`. Defaults to loopback hosts; production deployments serving custom domains must explicitly include their public hostnames (e.g., `localhost,127.0.0.1,wedding.example,*.wedding.example`). |
| `POSTGRES_URL_NON_POOLING` | *None* | Direct non-pooled connection string bound to `datasource.shadowDatabaseUrl` in `prisma.config.ts` (`prisma migrate dev`); can also supply an explicit `DATABASE_URL` override for `prisma migrate deploy` when bypassing PgBouncer. |
| `MULTISITE_ENABLED` | `false` | Enable subdomain-based `AppConfig` branding/profile routing (`src/lib/config.ts` resolves `X-Forwarded-Host` before `Host`). Switches `AppConfig` rows only; the other 14 tables in `prisma/schema.prisma` are shared across subdomains without tenant row isolation. |
| `RUN_MIGRATIONS` | `false` | Automatically run database schema migrations (`prisma migrate deploy`) during container startup in `docker-entrypoint.sh`. |
| `TRUST_PROXY` | `false` | Opt-in boolean (`true`/`false`) or non-negative integer hop count enabling `X-Forwarded-For` and `X-Real-IP` parsing for rate limiting behind trusted reverse proxies. |
| `HISTORY_VERSION_LIMIT` | `50` | Maximum version history entries retained per content item (integer >= 1). |
| `CRON_SECRET` | *None* | Bearer authorization secret for triggering scheduled background endpoints (`/api/cron/*`). |

### Optional Object Storage Variables (S3-Compatible)
When storing uploaded media assets externally, all four core S3 credential variables must be supplied together as a coherent group:
| Variable | Requirement | Default Value | Description |
|---|---|---|---|
| `S3_BUCKET` | Required if using S3 | *None* | Target S3/R2 bucket name. |
| `S3_REGION` | Required if using S3 | *None* | S3 region (e.g., `us-east-1` or `auto` for Cloudflare R2). |
| `S3_ACCESS_KEY_ID` | Required if using S3 | *None* | AWS/S3 API access key ID. |
| `S3_SECRET_ACCESS_KEY` | Required if using S3 | *None* | AWS/S3 API secret access key. |
| `S3_ENDPOINT` | Optional | *None* | Custom S3 API endpoint URL (e.g., Cloudflare R2 endpoint or MinIO). |
| `S3_PUBLIC_URL` | Optional | *None* | Custom CDN or public asset delivery URL prefix. |

*Note: Supplying partial core S3 credentials will cause startup and build-time environment validation to fail.*

### Optional Stripe Card Checkout Variables
When enabling online credit card and digital wallet processing for cash and experience funds, `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` must be supplied together as a pair (or both omitted for direct-transfer-only registries):
| Variable | Requirement | Default Value | Description |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Required if using Stripe card checkout | *None* | Server-side Stripe API secret key (`sk_...` or `rk_...`). Placeholder mock keys are rejected in non-test environments. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Required if using Stripe card checkout | *None* | Client-side Stripe publishable key (`pk_...`) used by Stripe Elements. Placeholder mock keys are rejected in non-test environments. |
| `STRIPE_WEBHOOK_SECRET` | Optional (recommended if using Stripe webhooks) | *None* | Endpoint signing secret (`whsec_...`) used to verify incoming `/api/registry/webhook/stripe` events. |

*Note: Supplying only one of `STRIPE_SECRET_KEY` or `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` will cause startup environment validation to fail fast.*

### Optional Server, Build, Portal & Container Variables
These variables configure container port binding, static HTML export builds, VitePress documentation portal asset paths, Docker Compose PostgreSQL service interpolation, and E2E setup bypasses:
| Variable | Default Value | Scope | Description |
|---|---|---|---|
| `PORT` | `3000` | Container / Standalone Server | HTTP listening port (`ENV PORT=3000` in `Dockerfile`; `127.0.0.1:${PORT:-3000}:3000` in `docker-compose.yml`). |
| `HOSTNAME` | `0.0.0.0` | Container / Standalone Server | Network interface address bound by standalone `server.js` (`ENV HOSTNAME="0.0.0.0"` in `Dockerfile`; `HOSTNAME: "0.0.0.0"` in `docker-compose.yml`). |
| `NEXT_PHASE` | *None* | Build (`src/env.ts`) | Next.js build phase identifier (`phase-production-build`) set automatically during `next build` so build-time schema checks allow template placeholders before runtime secret enforcement. |
| `STATIC_EXPORT` | *None* | Build (`next.config.ts`, `scripts/build-export.mjs`, `src/`) | Switches Next.js to static HTML export (`output: 'export'`) and `STATIC_MOCK_CONFIG` data when set to `'true'` or `'1'`. |
| `NEXT_PUBLIC_BASE_PATH` | *None* | Static Export Build (`next.config.ts`) | Optional URL subpath prefix (`basePath` and `assetPrefix`) applied when `STATIC_EXPORT` is enabled and value is not `'/'`. |
| `VITEPRESS_BASE` | `/` | Docs Portal (`docs-portal/.vitepress/config.mts`) | Base URL path for building and serving the VitePress documentation portal. |
| `E2E_TEST` | `false` (`docker-compose.yml`) | Runtime / Compose (`src/lib/config.ts`, `docker-compose.yml`) | Defaults to `false` in `docker-compose.yml` so `<SetupWizard />` onboarding runs on fresh deployments; set to `'true'` only in `.env.ci`, `docker-compose.ci.yml`, and automated E2E harnesses to bypass initial setup. |
| `CONTAINER_DATABASE_URL` | *None* | Docker Compose (`docker-compose.yml`) | Explicit PostgreSQL connection URL override (`${CONTAINER_DATABASE_URL:-...}`) for `migration` and `app` containers (e.g., external managed PostgreSQL) so host `DATABASE_URL` (`@localhost:5432`) never leaks into container networking. |
| `DB_USER` | `wedding` | Docker Compose (`docker-compose.yml`) | PostgreSQL username interpolated into the `db` container (`POSTGRES_USER`) and fallback `migration`/`app` `CONTAINER_DATABASE_URL` default. |
| `DB_PASSWORD` | *None* | Docker Compose (`docker-compose.yml`) | Mandatory PostgreSQL password (`${DB_PASSWORD:?...}`) interpolated into the `db` container (`POSTGRES_PASSWORD`) and fallback `migration`/`app` `CONTAINER_DATABASE_URL` default (`.env.example` and `.env.ci` supply `wedding123` for local and CI runs). |
| `DB_NAME` | `wedding` | Docker Compose (`docker-compose.yml`) | PostgreSQL database name interpolated into the `db` container (`POSTGRES_DB`) and fallback `migration`/`app` `CONTAINER_DATABASE_URL` default. |
| `DB_PORT` | `5432` | Docker Compose (`docker-compose.yml`) | Loopback host TCP port published to container port `5432` for the `db` service (`127.0.0.1:${DB_PORT:-5432}:5432`). |

### Optional Site Configuration Overrides (`SITE_*`)
`src/lib/config.ts` (`getEnvConfigOverrides`) supports 32 optional Layer 1 environment variable overrides that take precedence over database `AppConfig` rows and `APP_DEFAULTS`:
| Variable | Default Value | Target `AppConfig` Field | Description |
|---|---|---|---|
| `SITE_PARTNER1_NAME` | *None* | `partner1Name` | Override Partner 1 display name (when non-empty). |
| `SITE_PARTNER2_NAME` | *None* | `partner2Name` | Override Partner 2 display name (when non-empty). |
| `SITE_BRIDE_NAME` | *None* | `brideName`, `partner1Name` | Legacy alias overriding both `brideName` and `partner1Name` (when non-empty). |
| `SITE_GROOM_NAME` | *None* | `groomName`, `partner2Name` | Legacy alias overriding both `groomName` and `partner2Name` (when non-empty). |
| `SITE_WEDDING_DATE` | *None* | `weddingDate` | ISO 8601 date/timestamp string parsed via `new Date(...)` for the wedding celebration date. |
| `SITE_BASE_URL` | *None* | `baseUrl` | Canonical public base URL of the wedding website. |
| `SITE_VENUE_NAME` | *None* | `venueName` | Primary wedding venue name (when non-empty). |
| `SITE_VENUE_ADDRESS` | *None* | `venueAddress` | Street address of the primary venue. |
| `SITE_VENUE_CITY` | *None* | `venueCity` | City of the primary venue. |
| `SITE_VENUE_STATE` | *None* | `venueState` | State/province of the primary venue. |
| `SITE_VENUE_ZIP` | *None* | `venueZip` | Postal/ZIP code of the primary venue. |
| `SITE_LATITUDE` | *None* | `latitude` | Venue latitude coordinate parsed as a floating-point number (`parseFloat`). |
| `SITE_LONGITUDE` | *None* | `longitude` | Venue longitude coordinate parsed as a floating-point number (`parseFloat`). |
| `SITE_TIMEZONE` | *None* | `timezone` | IANA timezone identifier for event schedules (e.g., `America/Chicago`). |
| `SITE_COLOR_PRIMARY` | *None* | `colorPrimary` | Primary brand hex color token (when non-empty). |
| `SITE_COLOR_SECONDARY` | *None* | `colorSecondary` | Secondary accent hex color token (when non-empty). |
| `SITE_THEME_PRESET` | *None* | `themePreset` | Active theme preset identifier (e.g., `classic`). |
| `SITE_THEME_TOKENS` | *None* | `themeTokens` | JSON-encoded map of custom CSS design token overrides (malformed JSON is ignored). |
| `SITE_SHOW_COUNTDOWN` | *None* | `showCountdown` | Boolean string (`'true'` / `'false'`, case-insensitive) toggling the homepage countdown widget. |
| `SITE_SHOW_ADD_TO_CALENDAR` | *None* | `showAddToCalendar` | Boolean string (`'true'` / `'false'`, case-insensitive) toggling the homepage Add-to-Calendar widget. |
| `SITE_SEO_TITLE` | *None* | `seoTitle` | Custom HTML `<title>` / Open Graph title override. |
| `SITE_SEO_DESCRIPTION` | *None* | `seoDescription` | Custom meta / Open Graph description override. |
| `SITE_BRAND_MONOGRAM` | *None* | `brandMonogram` | Couple monogram text displayed in branding elements. |
| `SITE_BRAND_LOGO_URL` | *None* | `brandLogoUrl` | URL or asset path for the custom brand logo image. |
| `SITE_BRAND_LOGO_ALT` | *None* | `brandLogoAlt` | Accessible alt text for the custom brand logo image. |
| `SITE_HERO_IMAGE_URL` | *None* | `heroImageUrl` | URL or asset path for the homepage hero image. |
| `SITE_HERO_IMAGE_ALT` | *None* | `heroImageAlt` | Accessible alt text for the homepage hero image. |
| `SITE_BRAND_WATERMARK_URL` | *None* | `brandWatermarkUrl` | URL or asset path for the decorative brand watermark graphic. |
| `SITE_BRAND_WATERMARK_ALT` | *None* | `brandWatermarkAlt` | Accessible alt text for the decorative brand watermark graphic. |
| `SITE_BADGE_GRAPHIC_URL` | *None* | `badgeGraphicUrl` | URL or asset path for the custom badge graphic. |
| `SITE_BADGE_GRAPHIC_ALT` | *None* | `badgeGraphicAlt` | Accessible alt text for the custom badge graphic. |
| `SITE_CONTACT_EMAIL` | *None* | `contactEmail` | Host contact email address displayed to guests. |

---

## 5. Statelessness & Filesystem Expectations

- **Stateless Application Layer**: The application process is fully stateless and ephemeral.
- **Local Filesystem & Read-Only Root Execution**: Scratch write operations to `/tmp` or `/app/.next/cache` (for Next.js `/_next/image` optimization) are temporary and must not be relied upon across container restarts or horizontal scaling. `docker-compose.yml` enforces `read_only: true`, `cap_drop: [ALL]`, and `security_opt: [no-new-privileges:true]` on both `migration` and `app`, mounting ephemeral `tmpfs` volumes at `/tmp` and `/app/.next/cache:uid=1001,gid=1001,mode=0755`.
- **Data & Media Persistence**:
  - Application state, registry items, contributors, and content configurations are stored in PostgreSQL (`prisma/schema.prisma`).
  - Uploaded media files are stored in S3-compatible object storage when `S3_*` credentials are configured, or written to `/app/public/uploads` via `LocalStorageProvider` (`src/utils/storage.ts`) when backed by a persistent volume/disk (such as `uploads_data:/app/public/uploads` in `docker-compose.yml` or a Render Persistent Disk) and streamed dynamically at `/uploads/*` in standalone mode (`next.config.ts` server `rewrites()` + `src/app/api/uploads/[...path]/route.ts` with `X-Content-Type-Options: nosniff`).

---

## 6. Reverse Proxy & Forwarded Header Handling

The application expects to be deployed behind an HTTP reverse proxy, load balancer, or cloud ingress controller (e.g., NGINX, Cloudflare, Google Cloud Run Ingress, AWS ALB).

- **Host Header Forwarding**:
  - Proxies must pass the original requested host via the `Host` or `X-Forwarded-Host` header.
  - Both `src/middleware.ts` and `getSubdomainFromHeaders()` in `src/lib/config.ts` inspect `X-Forwarded-Host` (first host if comma-separated) before `Host` and validate the resolved host against `ALLOWED_HOSTS`. Requests with invalid or unapproved host headers are rejected with `HTTP 400 Bad Request`.
- **Perimeter Session Exclusions**:
  - All perimeter-exempt paths (`/api/live`, `/api/health`, `/api/ready`, `/api/registry/webhook/stripe`, `/api/cron/*`, and `/uploads/*`) still enforce `ALLOWED_HOSTS` validation in `src/middleware.ts` before bypassing guest/admin session cookies in favor of route-specific controls (`stripe-signature` verification via `STRIPE_WEBHOOK_SECRET`, `Authorization: Bearer <CRON_SECRET>`, or path-contained `nosniff` media streaming).
- **Protocol Header Forwarding**:
  - Proxies should forward `X-Forwarded-Proto` (`https` or `http`) to enable accurate canonical URL generation.
- **Client IP Header Forwarding (`TRUST_PROXY`)**:
  - By default (`TRUST_PROXY=false`), the rate limiter ignores `X-Forwarded-For` and `X-Real-IP` headers so direct callers cannot spoof IP headers to bypass lockouts. Enable `TRUST_PROXY=true` (or set `TRUST_PROXY` to the trusted proxy hop count) when the ingress controller strips or overwrites untrusted forwarded IP headers.

---

## 7. HTTPS Assumptions & Security Policy

- **Transport Security**: Production deployments assume HTTPS termination at the reverse proxy/ingress layer.
- **Security Headers (Standalone / Server Mode Only)**: When running in standalone/server mode (`!isStaticExport`), `next.config.ts` (`headers()`) automatically injects the following HTTP security headers on all routes (`/(.*)`):
  - `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com; frame-src 'self' https://js.stripe.com https://hooks.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'self';`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Frame-Options: SAMEORIGIN`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- **Static Export Header Caveat**: Next.js `headers()` is disabled when `STATIC_EXPORT` is `'true'` or `'1'` (`output: 'export'`). Operators serving static showcase builds must configure equivalent `Content-Security-Policy`, HSTS, framing, MIME-sniffing, and referrer headers at their CDN, static host, or reverse-proxy layer.

---

## 8. Application Lifecycle & Probes

```
 +------------------+     +----------------------------------+     +-----------------------+     +-----------------------+
 |   Build Phase    | --> |         Migration Phase          | --> |      Start Phase      | --> | Liveness & Readiness  |
 | npm run build    |     | ./node_modules/.bin/prisma       |     | tini -> entrypoint -> |     | GET /api/live         |
 | (or build:export)|     | migrate deploy (offline in OCI)  |     | exec node server.js   |     | GET /api/health       |
 +------------------+     +----------------------------------+     +-----------------------+     | GET /api/ready        |
                                                                                                 +-----------------------+
```

1. **Build Phase (`npm run build` / `npm run build:export`)**:
   - Executes ESLint, migration and unused-export lints, Prisma Client generation (`prisma generate`), and Next.js standalone compilation (`output: 'standalone'`), or static HTML export (`output: 'export'`) via `npm run build:export` (`STATIC_EXPORT=true`).
   - Does **not** require an active database connection. Safe for CI/CD build environments.
2. **Migration Phase (`./node_modules/.bin/prisma migrate deploy` / `npx prisma migrate deploy`)**:
   - Runs before application startup via the `migration` service in `docker-compose.yml` (`./node_modules/.bin/prisma migrate deploy`), offline in `docker-entrypoint.sh` when `RUN_MIGRATIONS=true` (using the local `/app/node_modules/.bin/prisma` symlink with `NPM_CONFIG_UPDATE_NOTIFIER=false` and `CHECKPOINT_DISABLE=1` so zero npm registry calls occur), or via CI/CD release pipelines (`.github/workflows/db-migrate.yml`).
   - Applies pending database migrations safely without data loss.
3. **Start Phase (`tini` -> `docker-entrypoint.sh` -> `node server.js`)**:
   - `/usr/bin/tini -s` runs as PID 1 (or subreaper under `init: true`) and invokes `docker-entrypoint.sh`, which validates `DATABASE_URL` and hands off via `exec "$@"` (`exec node server.js`), launching the Next.js standalone HTTP server on `PORT` (`0.0.0.0`) and validating `src/env.ts`.
4. **Liveness, Startup, & Readiness Probes**:
   - **Liveness Endpoint (`GET /api/live`, `src/app/api/live/route.ts`)**:
     - Direct Next.js Route Handler returning `HTTP 200 OK` with `{ "status": "alive", "timestamp": "..." }` and `Cache-Control: no-store` **without querying PostgreSQL**.
     - Exempted from guest/admin session checks (`src/middleware.ts`), invite revocation checks (`src/utils/withApiMiddleware.ts`), and API rate limits (`src/utils/withApiMiddleware.ts`, `src/utils/rateLimit.ts`).
     - Targeted by the `Dockerfile` `HEALTHCHECK`, `docker-compose.yml` `app` `healthcheck`, and Google Cloud Run `--liveness-probe-request-path=/api/live` so transient database blips never trigger container restart loops.
   - **Startup & Rollout Health Endpoint (`GET /api/health`, `src/app/api/health/route.ts`)**:
     - Wrapped in `withApiMiddleware`, executes `SELECT 1` via Prisma, and returns `HTTP 200 OK` with wrapped JSON `{ "success": true, "data": { "status": "ok", "timestamp": "...", "database": "connected" } }` (or `HTTP 503 Service Unavailable` with `{ "success": false, "error": "...", ... }` when PostgreSQL is unreachable).
     - Used by Cloud Run startup probes (`--startup-probe-request-path=/api/health`) and CI/CD post-deployment/rollback verification (`.github/workflows/deploy.yml` and `.github/workflows/rollback.yml`).
     - Exempted from guest/admin session checks in `src/middleware.ts` (`normalizedPath === '/api/health'`) and exempted from API rate limiting in `src/utils/withApiMiddleware.ts` (`isHealthPath`).
   - **Readiness Endpoint (`GET /api/ready`, `src/app/api/ready/route.ts`)**:
     - Direct Next.js Route Handler (not wrapped by `withApiMiddleware`), executes `SELECT 1` via Prisma, and returns `HTTP 200 OK` with unwrapped JSON `{ "status": "ready", "database": "connected", "timestamp": "..." }`, or `HTTP 503 Service Unavailable` with `{ "status": "unhealthy", "database": "disconnected", "error": "Database connection failed", "timestamp": "..." }` on database failure (internal driver error messages are masked when `NODE_ENV=production`).
     - Exempted from guest/admin session checks in `src/middleware.ts` (`normalizedPath === '/api/ready'`) and not subject to `withApiMiddleware` rate-limit buckets.
   - **Perimeter Host Validation**: `/api/live`, `/api/health`, and `/api/ready` all pass through perimeter `ALLOWED_HOSTS` validation (`X-Forwarded-Host` / `Host`) in `src/middleware.ts`, so container/orchestrator probes must send an allowed `Host` header (e.g., `localhost` or a configured domain).
5. **Process Shutdown & Signal Delivery**:
   - `Dockerfile` runs `/usr/bin/tini -s` as PID 1 (and `docker-compose.yml` sets `init: true`) while `docker-entrypoint.sh` hands off via `exec "$@"` so `SIGTERM` and `SIGINT` propagate cleanly to `node server.js` and orphaned child processes are reaped.
   - `src/lib/prisma.ts` registers idempotent `SIGTERM` and `SIGINT` shutdown hooks (`shutdownPrisma()`) that coordinate with Next.js standalone HTTP server teardown to invoke `prisma.$disconnect()` and `pool.end()`, transmitting PostgreSQL `Terminate` (`0x58`) frames over active `pg.Pool` sockets before the container exits.
