# Application Runtime Contract

This document defines the authoritative, provider-neutral runtime contract for the wedding website application. Any supported hosting infrastructure—including Docker containers, cloud container services (e.g., Google Cloud Run, AWS App Runner/ECS, Azure Container Apps), serverless hosting (e.g., Vercel), static showcase CDNs, or bare-metal/VM local production environments—must satisfy the specifications described here.

---

## 1. Node.js & Next.js Standalone Runtime

- **Target Architecture**: Dual-mode Next.js App Router configuration in `next.config.ts`:
  - **Standalone Server Mode (Default)**: Configured with `output: 'standalone'` when `STATIC_EXPORT` is unset or false, producing a self-contained Node.js server bundle at `.next/standalone/server.js` (packaged at `/app/server.js` in OCI containers).
  - **Static Showcase Export Mode (`STATIC_EXPORT`)**: Setting `STATIC_EXPORT=true` or `STATIC_EXPORT=1`—or running `npm run build:export` (`scripts/build-export.mjs`)—switches `next.config.ts` to `output: 'export'` with `distDir: '.next-export'`, `trailingSlash: true`, `images.unoptimized: true`, and optional subpath routing via `NEXT_PUBLIC_BASE_PATH` (`basePath`, `assetPrefix`, and client/asset URL prefixing via `src/lib/basePath.ts`). `scripts/build-export.mjs` stages build inputs without `src/app/api` (and without `public/uploads` or `public/mockServiceWorker.js`) inside `.next/export-stage`, compiles with `turbopack.root` pinned to the repository root, persists the export build cache in `.next-export/cache`, moves the generated `out/` directory to the repository root without modifying `src/app/api` or `.next/standalone`, and cleans up `.next/export-stage` automatically on exit or `SIGINT`/`SIGTERM`/`SIGHUP` while `src/lib/config.ts` and feature repositories render pages against static mock data without requiring PostgreSQL connectivity.
- **Node.js & Package Manager Requirement**: Node.js **v22.x LTS** runtime (`>=22.22.1 <23.0.0` across `engines.node` and `devEngines.runtime`) and `npm` `^10.9.0` (`npm@10.9.x`), pinned via `.nvmrc`, `.npmrc`, and both `engines` and `devEngines` (`onFail: "error"`) in `package.json`.
- **OCI Container Support**:
  - The official `Dockerfile` compiles build stages on `node:22-bookworm-slim` (pinned by `@sha256` digest, configuring `update-notifier=false` in `/usr/local/etc/npmrc` and a lockfile-pinned `/opt/prisma-cli`) and produces a multi-platform `runner` OCI image on `debian:bookworm-slim` (pinned by `@sha256` digest) containing only the stripped Node.js `v22` `/usr/local/bin/node` binary (`openssl`, `ca-certificates`, `tini`, `libstdc++6`, and zero `npm`/`npx`/`corepack`/`yarn`), offline `/usr/local/bin/prisma` (symlinked at `/app/node_modules/.bin/prisma`), `tini` installed as PID 1 (`ENTRYPOINT ["/usr/bin/tini", "-s", "--", "docker-entrypoint.sh"]`), setuid/setgid bits stripped across the root filesystem, and a built-in `/api/live` `HEALTHCHECK`.
  - The isolated Prisma CLI is installed outside `/app` at `/opt/prisma-cli` (owned by `root:root`, invoked through `/usr/local/bin/prisma` and symlinked at `/app/node_modules/.bin/prisma`) alongside `/usr/local/bin/docker-entrypoint.sh` (`root:root`). Under `/app`, only the Next.js standalone server output (`server.js` and traced `node_modules`), `.next/static`, `public`, `prisma`, `prisma.config.ts`, `src/lib/postgres-url.js`, and `/app/scripts/generate-password-hash.mjs` (`scripts/generate-password-hash.mjs`, not the entire repository `scripts/` directory) are packaged and owned by `root:root` so the non-root runtime user (`nextjs:nodejs`, UID/GID 1001) holds write access to zero static code paths (only runtime cache/upload mountpoints `/app/.next/cache` and `/app/public/uploads` are owned by `nextjs:nodejs`).

---

## 2. Network Interface, Listening Port & Host Binding

- **Listening Port & Host Interface**:
  - Listening port is configured via the `PORT` environment variable (defaults to `3000`).
  - Host interface binding is configured via the `HOSTNAME` environment variable (`ENV HOSTNAME="0.0.0.0"` in `Dockerfile` and `HOSTNAME: "0.0.0.0"` in `docker-compose.yml`), ensuring the standalone `server.js` binds to all available network interfaces (`0.0.0.0`) rather than a container-internal hostname.
- **Protocol**: HTTP/1.1 or HTTP/2 unencrypted traffic internally, expecting TLS termination at the ingress/reverse-proxy layer.

---

## 3. Database Specification & PostgreSQL Policy

- **Engine**: PostgreSQL version **15.0 or higher** (tested with PostgreSQL 15-alpine and Neon serverless Postgres).
- **Driver / ORM & Singleton Pool**: Prisma ORM with `@prisma/adapter-pg` backed by a process-wide singleton `pg.Pool` cached on `globalThis` via `globalForPrisma` (`GlobalPrismaState` `prisma` and `pgPool` properties in `src/lib/prisma.ts`) so SSR, API Route Handlers, hot reloads, and shutdown hooks share one connection pool. Pool parameters are constructed via `buildPostgresRuntimeConfig` (`src/lib/postgresPool.ts`), defaulting `connectionTimeoutMillis` to `10000ms` (`10s`, overridable in seconds via `?connect_timeout=` or `?pool_timeout=` from `DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS` in `src/lib/postgres-url.js`), `query_timeout` to `10000ms` (`10s`, overridable in seconds via `?socket_timeout=` from `DEFAULT_POSTGRES_QUERY_TIMEOUT_MS` in `src/lib/prisma.ts`), and `max` to `5` (overridable via `?connection_limit=`).
- **Connection Strings**:
  - `DATABASE_URL`: Primary connection string bound to `datasource.url` in `prisma.config.ts`. Used for both Next.js runtime operations (supporting PgBouncer, Neon Connection Pooling, Supabase Pooler, or direct TCP) and `npx prisma migrate deploy`. When `DATABASE_URL` routes through a transaction-mode connection pooler such as PgBouncer, `npx prisma migrate deploy` requires an explicit `DATABASE_URL` override pointing to a direct, non-pooled PostgreSQL endpoint so Prisma can acquire advisory locks.
  - `POSTGRES_URL_NON_POOLING` *(Optional)*: Direct, non-pooled connection URL bound to `datasource.shadowDatabaseUrl` in `prisma.config.ts` for local shadow database creation (`prisma migrate dev`). Operators on pooled serverless databases can also store their direct PostgreSQL URL in `POSTGRES_URL_NON_POOLING` and pass it via an explicit `DATABASE_URL` override (`DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING npx prisma migrate deploy`) during release migrations.
- **Provider Neutrality**: No database-vendor specific features or proprietary extensions are required. Standard relational PostgreSQL features (tables, foreign keys, indexes, JSONB) are used.

---

## 4. Environment Variable Matrix

All operator-facing configuration across application runtime (`src/env.ts`, `src/lib/config.ts`), Next.js and VitePress build pipelines (`next.config.ts`, `scripts/build-export.mjs`, `docs-portal/.vitepress/config.mts`), and container orchestration (`Dockerfile`, `docker-compose.yml`, `docker-compose.rollout.yml`) is supplied via environment variables. Core runtime variables are validated at startup by `src/env.ts` (Zod schema). Internal framework and test-runner flags (`NEXT_RUNTIME`, `npm_lifecycle_event`, and `JEST_WORKER_ID`) are managed automatically by Next.js, npm, and Jest rather than configured by operators.

### Mandatory Runtime Variables
| Variable | Default Value | Description & Validation Requirements |
|---|---|---|
| `DATABASE_URL` | *None* | Primary PostgreSQL connection URL (`datasource.url` in `prisma.config.ts`). Must be a valid `postgresql://` or `postgres://` connection string. |
| `ADMIN_PASSWORD` | *None* | Scrypt hash for admin authentication. Must match format `scrypt:[16-byte saltBase64]:[64-byte keyBase64]` (generated via `scripts/generate-password-hash.mjs`); plaintext passwords, non-64-byte hashes, and `ALWAYS_BLOCKED_PROD_ADMIN_HASHES` placeholders are rejected, `E2E_FALLBACK_ADMIN_HASHES` are blocked in `production` unless `E2E_TEST=true`, and `src/core/auth/auth.server.ts` derives a domain-separated HMAC signing key from the decoded hash bytes. |

### Production-Required Variables
These variables provide convenience defaults for local `development` and `test` modes in `src/env.ts`, but startup validation strictly requires unique, non-default values when `NODE_ENV=production` (**Security Note**: setting `E2E_TEST=true` under `NODE_ENV=production` disables the `E2E_FALLBACK_ADMIN_HASHES`, `E2E_FALLBACK_GUEST_PASSCODES`, and `E2E_FALLBACK_SESSION_SECRETS` blocklists in `src/env.ts` for disposable container smoke tests while keeping `ALWAYS_BLOCKED_PROD_ADMIN_HASHES`, `ALWAYS_BLOCKED_PROD_GUEST_PASSCODES`, and `ALWAYS_BLOCKED_PROD_SESSION_SECRETS` enforced—never set `E2E_TEST=true` in real production deployments):
| Variable | Dev / Test Default | Production Requirements & Description |
|---|---|---|
| `GUEST_PASSCODE` | `wedding2026` | Global passcode required for guest website access. Required in `production` (must not be empty or match `ALWAYS_BLOCKED_PROD_GUEST_PASSCODES` such as `wedding2026` or template placeholders; `E2E_FALLBACK_GUEST_PASSCODES` are also rejected unless `E2E_TEST=true`). |
| `GUEST_SESSION_SECRET` | `default-guest-session-secret` | Dedicated server secret for signing and verifying guest invitation session tokens (HMAC-SHA256). Required in `production`; must be at least 32 characters long, distinct from `GUEST_PASSCODE`, and must not match `ALWAYS_BLOCKED_PROD_SESSION_SECRETS` (`default-guest-session-secret` or template placeholders; `E2E_FALLBACK_SESSION_SECRETS` are also rejected unless `E2E_TEST=true`). |

*Security Warning (`E2E_TEST`)*: Setting `E2E_TEST=true` ([`src/env.ts`](../src/env.ts#L224-L266), `isE2ETestMode`) disables `NODE_ENV=production` blocklists for the repository's committed `E2E_FALLBACK_ADMIN_HASHES`, `E2E_FALLBACK_GUEST_PASSCODES`, and `E2E_FALLBACK_SESSION_SECRETS` (while `ALWAYS_BLOCKED_PROD_ADMIN_HASHES`, `ALWAYS_BLOCKED_PROD_GUEST_PASSCODES`, and `ALWAYS_BLOCKED_PROD_SESSION_SECRETS` remain rejected). Never enable `E2E_TEST=true` in real production deployments.

### Optional Infrastructure & Feature Variables
| Variable | Default Value | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime mode (`production`, `development`, `test`). Automatically set to `production` in `Dockerfile` runner environments. |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1,*.localhost` | Comma-separated list of whitelisted host domains or wildcard patterns validated against `X-Forwarded-Host` / `Host` in `src/middleware.ts`. Defaults to loopback hosts; production deployments serving custom domains must explicitly include their public hostnames (e.g., `localhost,127.0.0.1,wedding.example,*.wedding.example`). |
| `POSTGRES_URL_NON_POOLING` | *None* | Direct non-pooled connection string bound to `datasource.shadowDatabaseUrl` in `prisma.config.ts` (`prisma migrate dev`); can also supply an explicit `DATABASE_URL` override for `prisma migrate deploy` when bypassing PgBouncer. |
| `MULTISITE_ENABLED` | `false` | Enable subdomain-based `AppConfig` branding/profile routing (`src/lib/config.ts` resolves `X-Forwarded-Host` before `Host`). Switches `AppConfig` rows only; the other 15 tables in `prisma/schema.prisma` are shared across subdomains without tenant row isolation. |
| `RUN_MIGRATIONS` | `false` | Automatically run database schema migrations (`./node_modules/.bin/prisma migrate deploy`) during container startup in `docker-entrypoint.sh` when set to `true` or `1` (both `docker-entrypoint.sh` and `src/env.ts` accept `RUN_MIGRATIONS=true` and `RUN_MIGRATIONS=1`). |
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
| `NEXT_PUBLIC_BASE_PATH` | *None* | Static Export Build & Client Runtime (`next.config.ts`, `src/lib/basePath.ts`) | Optional URL subpath prefix (`basePath`, `assetPrefix`, and root-relative client API, redirect, download, and asset URL resolution via `withBasePath`) when serving under a subpath and value is not `'/'`. |
| `VITEPRESS_BASE` | `/` | Docs Portal (`docs-portal/.vitepress/config.mts`) | Base URL path for building and serving the VitePress documentation portal. |
| `E2E_TEST` | `false` (`docker-compose.yml`) | Runtime / Compose (`src/env.ts`, `src/lib/config.ts`, `docker-compose.yml`) | Defaults to `false` in `docker-compose.yml` so `<SetupWizard />` onboarding and full production credential blocklists stay active; setting `E2E_TEST=true` bypasses `<SetupWizard />` in `src/lib/config.ts` **and** disables `NODE_ENV=production` blocklists for committed `E2E_FALLBACK_*` credentials in `src/env.ts`. Restrict strictly to `.env.ci`, `docker-compose.ci.yml`, and automated E2E harnesses—never enable in production. |
| `CONTAINER_DATABASE_URL` | *None* | Docker Compose (`docker-compose.yml`, `docker-compose.rollout.yml`) | Explicit PostgreSQL connection URL override (`${CONTAINER_DATABASE_URL:-...}`) for `migration`, `app`, and `app-standby` containers (e.g., external managed PostgreSQL) so host `DATABASE_URL` (`@localhost:5432`) never leaks into container networking. |
| `DB_USER` | `wedding` | Docker Compose (`docker-compose.yml`) | PostgreSQL username interpolated into the `db` container (`POSTGRES_USER`) and fallback `migration`/`app` `CONTAINER_DATABASE_URL` default. |
| `DB_PASSWORD` | *None* | Docker Compose (`docker-compose.yml`) | Mandatory PostgreSQL password (`${DB_PASSWORD:?...}`) interpolated into the `db` container (`POSTGRES_PASSWORD`) and fallback `migration`/`app` `CONTAINER_DATABASE_URL` default (`.env.example` and `.env.ci` supply `wedding123` for local and CI runs). |
| `DB_NAME` | `wedding` | Docker Compose (`docker-compose.yml`) | PostgreSQL database name interpolated into the `db` container (`POSTGRES_DB`) and fallback `migration`/`app` `CONTAINER_DATABASE_URL` default. |
| `DB_PORT` | `5432` | Docker Compose (`docker-compose.yml`) | Loopback host TCP port published to container port `5432` for the `db` service (`127.0.0.1:${DB_PORT:-5432}:5432`). |
| `STANDBY_PORT` | `3001` | Docker Compose Rollout (`docker-compose.rollout.yml`, `scripts/rollout-vps.sh`) | Loopback host TCP port published to container port `3000` for the temporary `app-standby` service during zero-downtime VPS rollouts (`127.0.0.1:${STANDBY_PORT:-3001}:3000`). |

### Optional Site Configuration Overrides (`SITE_*`)
`src/lib/config.ts` (`getEnvConfigOverrides`, `readNonEmptySiteEnv`, and `getAppConfig`) supports 32 optional Layer 1 environment variable overrides that take precedence over database `AppConfig` rows and `APP_DEFAULTS`. Both `docker-compose.yml` (`app`) and `docker-compose.rollout.yml` (`app-standby`) forward all 32 `SITE_*` keys from the host environment (`${SITE_*:-}`), and `readNonEmptySiteEnv` trims leading/trailing whitespace via `.trim()` while treating empty or whitespace-only strings as unset (`undefined`) before validation and `isSiteInitialized` checks (whereas non-empty malformed overrides fail `AppConfigSchema` / `coordinateSchema` validation at runtime, throwing `Production Configuration Validation Failure` in `NODE_ENV=production`):
| Variable | Default Value | Target `AppConfig` Field | Description |
|---|---|---|---|
| `SITE_PARTNER1_NAME` | *None* | `partner1Name`, `brideName` | Override Partner 1 display name and synchronize legacy `brideName` (when non-empty). |
| `SITE_PARTNER2_NAME` | *None* | `partner2Name`, `groomName` | Override Partner 2 display name and synchronize legacy `groomName` (when non-empty). |
| `SITE_BRIDE_NAME` | *None* | `brideName`, `partner1Name` | Legacy alias overriding both `brideName` and `partner1Name` (when non-empty). |
| `SITE_GROOM_NAME` | *None* | `groomName`, `partner2Name` | Legacy alias overriding both `groomName` and `partner2Name` (when non-empty). |
| `SITE_WEDDING_DATE` | *None* | `weddingDate` | ISO 8601 date/timestamp string trimmed via `readNonEmptySiteEnv` and parsed via `new Date(...)` when non-empty (blank/whitespace values are ignored; non-empty invalid date strings fail `AppConfigSchema` validation). |
| `SITE_BASE_URL` | *None* | `baseUrl` | Canonical public base URL of the wedding website. |
| `SITE_VENUE_NAME` | *None* | `venueName` | Primary wedding venue name (when non-empty). |
| `SITE_VENUE_ADDRESS` | *None* | `venueAddress` | Street address of the primary venue. |
| `SITE_VENUE_CITY` | *None* | `venueCity` | City of the primary venue. |
| `SITE_VENUE_STATE` | *None* | `venueState` | State/province of the primary venue. |
| `SITE_VENUE_ZIP` | *None* | `venueZip` | Postal/ZIP code of the primary venue. |
| `SITE_LATITUDE` | *None* | `latitude` | Venue latitude coordinate trimmed via `readNonEmptySiteEnv` and parsed via `parseFloat(...)` when non-empty (blank/whitespace values are ignored; non-empty non-numeric or out-of-range values fail `coordinateSchema` validation). |
| `SITE_LONGITUDE` | *None* | `longitude` | Venue longitude coordinate trimmed via `readNonEmptySiteEnv` and parsed via `parseFloat(...)` when non-empty (blank/whitespace values are ignored; non-empty non-numeric or out-of-range values fail `coordinateSchema` validation). |
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
- **Local Filesystem & Read-Only Root Execution**: Scratch write operations to `/tmp` or `/app/.next/cache` (for Next.js `/_next/image` optimization) are temporary and must not be relied upon across container restarts or horizontal scaling. `docker-compose.yml` (and `docker-compose.rollout.yml` for `app-standby`) enforces `read_only: true`, `cap_drop: [ALL]`, and `security_opt: [no-new-privileges:true]` on application and migration containers (`NoNewPrivs: 1` across `db`, `migration`, `app`, and `app-standby`), `shm_size: "256mb"` on `db`, bounded `json-file` log rotation (`max-size: "10m"`, `max-file: "3"`), explicit `pids_limit` and `mem_limit` caps, and ephemeral `tmpfs` volumes at `/tmp` and `/app/.next/cache:uid=1001,gid=1001,mode=0755`.
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
  - Non-probe perimeter-exempt paths (`/api/registry/webhook/stripe`, `/api/cron/*`, and `/uploads/*`) enforce full `ALLOWED_HOSTS` validation (`isHostAllowed`) in `src/middleware.ts` before bypassing guest/admin session cookies in favor of route-specific controls (`stripe-signature` verification via `STRIPE_WEBHOOK_SECRET`, `Authorization: Bearer <CRON_SECRET>`, or path-contained `nosniff` media streaming).
  - Stateless read-only (`GET` and `HEAD`) probe requests to `/api/live`, `/api/health`, and `/api/ready` enforce syntactic `Host` validation (`isHostSyntaxValid` in `src/utils/hostValidation.ts`) only, rejecting empty, whitespace, comma-separated, CRLF, or invalid-port headers while permitting platform probe hosts (e.g., `healthcheck.railway.app`, Cloud Run internal pod/kubelet IPs, and `127.0.0.1:3000`). Non-read-only methods (such as `POST`) on probe paths still enforce full `ALLOWED_HOSTS` validation.
- **Protocol Header Forwarding**:
  - Proxies should forward `X-Forwarded-Proto` (`https` or `http`) to enable accurate canonical URL generation.
- **Client IP Header Forwarding (`TRUST_PROXY`)**:
  - By default (`TRUST_PROXY=false`), the rate limiter ignores `X-Forwarded-For` and `X-Real-IP` headers so direct callers cannot spoof IP headers to bypass lockouts. Set `TRUST_PROXY=1` behind single-hop reverse proxies (Caddy, Nginx, Vercel, Railway, Render) or `TRUST_PROXY=2` behind two-hop load balancers such as Google Cloud Run (`<client-ip>, <lb-ip>`).

---

## 7. HTTPS Assumptions & Security Policy

- **Transport Security**: Production deployments assume HTTPS termination at the reverse proxy/ingress layer.
- **Security Headers (Standalone / Server Mode Only)**: When running in standalone/server mode (`!isStaticExport`), `next.config.ts` (`headers()`) automatically injects the following HTTP security headers on all routes (`/(.*)`):
  - `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://js.stripe.com; worker-src 'self' blob:; frame-src 'self' https://js.stripe.com https://hooks.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'self';`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Frame-Options: SAMEORIGIN`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- **Static Export Header Caveat**: Next.js `headers()` is disabled when `STATIC_EXPORT` is `'true'` or `'1'` (`output: 'export'`). Operators serving static showcase builds must configure equivalent `Content-Security-Policy` (including `worker-src 'self' blob:` and `blob:` in `script-src` so `/heart` 3D text `blob:` workers and `importScripts` module hydration succeed), HSTS, framing, MIME-sniffing, and referrer headers at their CDN, static host, or reverse-proxy layer.

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
   - Executes Prisma Client generation (`prisma generate`), Next.js standalone compilation (`output: 'standalone'`), and standalone asset staging (`postbuild`), or static HTML export (`output: 'export'`) via `npm run build:export` (`STATIC_EXPORT=true`).
   - Does **not** require an active database connection. Safe for CI/CD build environments.
2. **Migration Phase (`/usr/local/bin/prisma migrate deploy` / `./node_modules/.bin/prisma migrate deploy`)**:
   - Runs offline before application startup via the `migration` service in `docker-compose.yml` (`./node_modules/.bin/prisma migrate deploy`), via Cloud Run Jobs or PaaS release hooks (`/usr/local/bin/prisma migrate deploy`), in `docker-entrypoint.sh` when `RUN_MIGRATIONS=true` or `RUN_MIGRATIONS=1` (unsetting `POSTGRES_URL_NON_POOLING` and invoking `/opt/prisma-cli` via `/usr/local/bin/prisma` symlinked at `/app/node_modules/.bin/prisma` with `NPM_CONFIG_UPDATE_NOTIFIER=false` and `CHECKPOINT_DISABLE=1` so zero npm registry calls occur), or via CI/CD release pipelines (`.github/workflows/db-migrate.yml`).
   - Applies pending database migrations safely without data loss.
3. **Start Phase (`tini` -> `docker-entrypoint.sh` -> `node server.js`)**:
   - `/usr/bin/tini -s` runs as PID 1 (or subreaper under `init: true`) and invokes `docker-entrypoint.sh`, which validates `DATABASE_URL` and hands off via `exec "$@"` (`exec node server.js`), launching the Next.js standalone HTTP server on `PORT` (`0.0.0.0`) and validating `src/env.ts`.
4. **Liveness, Startup, & Readiness Probes**:
   - **Liveness Endpoint (`GET /api/live`, `src/app/api/live/route.ts`)**:
     - Direct Next.js Route Handler returning `HTTP 200 OK` with `{ "status": "alive", "timestamp": "..." }` and `Cache-Control: no-store` **without querying PostgreSQL**.
     - Exempted from guest/admin session checks (`src/middleware.ts`), invite revocation checks (`src/utils/withApiMiddleware.ts`), and API rate limits (`src/utils/withApiMiddleware.ts`, `src/utils/rateLimit.ts`).
     - Targeted by the `Dockerfile` `HEALTHCHECK`, `docker-compose.yml` `app` `healthcheck`, and Google Cloud Run `--liveness-probe=httpGet.path=/api/live,httpGet.port=3000,periodSeconds=30` (or Knative `livenessProbe`) so transient database blips never trigger container restart loops.
   - **Startup & Rollout Health Endpoint (`GET /api/health`, `src/app/api/health/route.ts`)**:
     - Wrapped in `withApiMiddleware` (`isHealthProbe: true` in `src/utils/withApiMiddleware.ts`), executes `SELECT 1` via Prisma, and returns `HTTP 200 OK` with `Cache-Control: no-store` and wrapped JSON `{ "success": true, "data": { "status": "ok", "timestamp": "...", "database": "connected" } }` when PostgreSQL is reachable.
     - When PostgreSQL is unreachable, `GET /api/health` returns `HTTP 503 Service Unavailable` with `Cache-Control: no-store`, and `withApiMiddleware` (`isHealthProbe: true`) preserves diagnostic probe fields `{ "success": false, "status": "degraded", "database": "disconnected", "timestamp": "...", "error": "Database connection failed" }` (sanitizing error text in `NODE_ENV=production` so internal driver details never leak).
     - Used by Cloud Run Knative `startupProbe` (`httpGet.path: /api/health`, `port: 3000`), Railway deploy healthchecks (`/api/health` with `Host: healthcheck.railway.app`), and CI/CD post-deployment/rollback verification (`.github/workflows/deploy.yml` and `.github/workflows/rollback.yml`).
     - Exempted from guest/admin session checks in `src/middleware.ts` (`normalizedPath === '/api/health'`) and exempted from API rate limiting in `src/utils/withApiMiddleware.ts` (`isHealthPath`).
   - **Readiness Endpoint (`GET /api/ready`, `src/app/api/ready/route.ts`)**:
     - Direct Next.js Route Handler (not wrapped by `withApiMiddleware`, setting `Cache-Control: no-store`) that verifies core schema tables (`AppConfig`, `Media`, `RegistryItem`, `Contributor`, `InvitationCode`, `ContentNode`, `SubEvent`) exist in `current_schema()` via `information_schema.tables` and—when `_prisma_migrations` is present—confirms applied migrations completed with zero failed or unfinished entries (`finished_at IS NULL AND rolled_back_at IS NULL`). When `_prisma_migrations` is absent (for example after `prisma db push` in `playwright.config.ts`), `/api/ready` succeeds as soon as the core schema tables exist.
     - Never calls `isSiteInitialized` (`src/lib/config.ts`) and never requires rows in `AppConfig`, returning `HTTP 200 OK` with `Cache-Control: no-store` and unwrapped JSON `{ "status": "ready", "database": "connected", "timestamp": "..." }` on unseeded migrated databases so first-run `<SetupWizard />` onboarding (`src/app/layout.tsx`) and pre-seed container boot succeed.
     - Returns `HTTP 503 Service Unavailable` with `Cache-Control: no-store` and `{ "status": "unhealthy", "database": "connected", "error": "Database schema is not ready", "timestamp": "..." }` on zero-table databases, missing core tables, or failed migrations, or `{ "status": "unhealthy", "database": "disconnected", "error": "Database connection failed", "timestamp": "..." }` on database connection failures (internal table, migration, and driver details are masked when `NODE_ENV=production`).
     - Exempted from guest/admin session checks in `src/middleware.ts` (`normalizedPath === '/api/ready'`) and not subject to `withApiMiddleware` rate-limit buckets.
   - **Perimeter Host Validation**: Read-only (`GET` and `HEAD`) requests to `/api/live`, `/api/health`, and `/api/ready` validate `Host` header syntax (`isHostSyntaxValid` in `src/utils/hostValidation.ts`) without requiring `ALLOWED_HOSTS` membership, allowing PaaS and container orchestrator probes (such as `healthcheck.railway.app`, `169.254.1.1:3000`, and loopback `127.0.0.1:3000`) while still rejecting malformed or CRLF-injected `Host` headers with `HTTP 400`. Non-read-only methods on probe routes and all non-probe routes enforce full `ALLOWED_HOSTS` checks (`isHostAllowed`).
5. **Process Shutdown, Pool Draining & Signal Delivery**:
   - `Dockerfile` runs `/usr/bin/tini -s` as PID 1 (and `docker-compose.yml` sets `init: true` and `stop_grace_period: 15s` on `app`; standalone `docker run` deployments should pass `--init --stop-timeout 15`) while `docker-entrypoint.sh` hands off via `exec "$@"` so `SIGTERM` and `SIGINT` propagate cleanly to `node server.js` and orphaned child processes are reaped.
   - `src/lib/prisma.ts` caches `globalForPrisma.prisma` and `globalForPrisma.pgPool` on `globalThis` across all module graphs in every environment and registers idempotent `SIGTERM` and `SIGINT` hooks (`registerPrismaShutdownHooks()`): when framework signal listeners (such as Next.js standalone `start-server.js`) are attached, `interceptProcessExitUntilDrained()` wraps `process.exit` with an unref'd `5000ms` drain safety timer so HTTP listeners finish in-flight requests before `shutdownPrisma()` runs `prisma.$disconnect()` and `pool.end()`; when no framework listener is attached, `handleTerminationSignal` runs `shutdownPrisma()` directly under a `5000ms` safety timer and exits with code `130` (`SIGINT`) or `143` (`SIGTERM`), transmitting PostgreSQL `Terminate` (`0x58`) frames well within the `15s` container stop grace window.
