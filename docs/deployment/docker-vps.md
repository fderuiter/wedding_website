# Deployment Recipe: Generic Docker / VPS (Canonical Portable Baseline)

**Support Tier**: Tier 1 — Officially Tested & Supported Adapter  
**Target Platform**: Any Virtual Private Server (VPS) / Virtual Machine (e.g., Ubuntu, Debian, AWS EC2, DigitalOcean Droplet, Hetzner, Linode) or bare-metal host running Docker & Docker Compose.

---

## Overview

The generic Docker/VPS deployment path serves as the **canonical portable baseline** for the application. It packages the application into a self-contained, multi-platform Docker container (`linux/amd64` and `linux/arm64`) with `/opt/prisma-cli` installed outside `/app` and `/app/scripts/generate-password-hash.mjs` copied for scrypt hash generation, orchestrated by `docker-compose.yml` across three services—`db` (`postgres:15-alpine` with `shm_size: "256mb"` and `no-new-privileges:true`), a dedicated one-shot `migration` job (`./node_modules/.bin/prisma migrate deploy` reusing `wedding-website:latest` via `pull_policy: never`), and `app` (the sole `build:` owner, running with `HOSTNAME="0.0.0.0"`, `RUN_MIGRATIONS="false"`, `init: true`, `stop_grace_period: 15s`, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges:true`, `tmpfs` mounts at `/tmp` and `/app/.next/cache`, persistent `uploads_data:/app/public/uploads` volume storage, and a built-in `/api/live` container healthcheck)—with bounded `json-file` log rotation (`max-size: "10m"`, `max-file: "3"`), `pids_limit`, `mem_limit`, and explicit `stop_grace_period` across every service. Zero-downtime updates layer `docker-compose.rollout.yml` (`app-standby` on `127.0.0.1:${STANDBY_PORT:-3001}:3000`) via `./scripts/rollout-vps.sh` behind a dual-upstream host reverse proxy. Standalone `docker run` deployments without Compose can opt into offline entrypoint migrations by setting `RUN_MIGRATIONS=true` or `RUN_MIGRATIONS=1` in `docker-entrypoint.sh` (and passing `--init --stop-timeout 15`). When running host CLI scripts or building from source outside Docker, install **Node.js v22.x LTS** (`>=22.22.1 <23.0.0` across `engines.node` and `devEngines.runtime`) and **`npm` `^10.9.0`** (enforced via `engines` and `devEngines` in `package.json`).

---

## 1. Database Provisioning & Connection

### Provisioning
You can run PostgreSQL either alongside the application via Docker Compose or connect to an external managed database (such as AWS RDS, DigitalOcean Managed Database, Neon, or Supabase).

*   **Docker Compose Co-location**: Uses the official `postgres:15-alpine` image (`db` service) with persistent volume mounting (`db_data:/var/lib/postgresql/data`), loopback host port binding (`127.0.0.1:${DB_PORT:-5432}:5432`), and a `pg_isready` healthcheck. `migration`, `app` (`docker-compose.yml`), and `app-standby` (`docker-compose.rollout.yml`) construct container `DATABASE_URL` identically from `DB_USER`, mandatory `DB_PASSWORD`, and `DB_NAME` via `${CONTAINER_DATABASE_URL:-postgres://${DB_USER:-wedding}:${DB_PASSWORD:?DB_PASSWORD is required}@db:5432/${DB_NAME:-wedding}}` and scope container `POSTGRES_URL_NON_POOLING` via `${CONTAINER_POSTGRES_URL_NON_POOLING:-}` whenever explicit container overrides are not provided in `.env` (preventing host `@localhost:5432` `DATABASE_URL` and `POSTGRES_URL_NON_POOLING` settings from leaking into containers).
*   **External PostgreSQL**: Ensure PostgreSQL v15+ is running and accessible over port `5432` with SSL/TLS enabled if remote. Set `CONTAINER_DATABASE_URL` (and optional `CONTAINER_POSTGRES_URL_NON_POOLING` when `CONTAINER_DATABASE_URL` connects via PgBouncer) directly in `.env` when orchestrating with `docker-compose.yml` (`migration`, `app`, and `app-standby` honor both container overrides automatically), or pass `DATABASE_URL` (and optional `POSTGRES_URL_NON_POOLING`) directly when running standalone `docker run`.

### Connection String Format
Configure `DATABASE_URL` as an unquoted standard PostgreSQL URI (`datasource.url` via `resolvePrismaDatasourceUrl` in `prisma.config.ts`, used by both the Next.js runtime and Prisma CLI; leave values unquoted in `.env` so standalone `docker run --env-file .env` does not inject literal quote characters):
```env
DATABASE_URL=postgresql://wedding_user:secure_password@db_host:5432/wedding_db?schema=public&sslmode=prefer
```
When `DATABASE_URL` (or `CONTAINER_DATABASE_URL` under Docker Compose) connects through a transaction-mode pooler such as PgBouncer, configure a direct unpooled URI targeting the same database and schema in `POSTGRES_URL_NON_POOLING` (for standalone `docker run`) or `CONTAINER_POSTGRES_URL_NON_POOLING` (for Docker Compose) so `resolvePrismaDatasourceUrl` in `prisma.config.ts` promotes the direct endpoint during `prisma migrate deploy` while keeping `shadowDatabaseUrl` `undefined`:
```env
POSTGRES_URL_NON_POOLING=postgresql://wedding_user:secure_password@db_host:5432/wedding_db?schema=public&sslmode=require
CONTAINER_POSTGRES_URL_NON_POOLING=postgresql://wedding_user:secure_password@db_host:5432/wedding_db?schema=public&sslmode=require
```

---

## 2. Docker & VPS Secrets and Compose Configuration

For the complete environment variable matrix, defaults, and persisted entity rules, refer to the [Application Runtime Contract](../runtime-contract.md) and [`.env.example`](../../.env.example).

### `.env` Interpolation & Secret Requirements in `docker-compose.yml`
`docker-compose.yml` substitutes environment variables directly from `.env` without hardcoding production fallback secrets:
*   **Mandatory Operator Secrets (`:?` required)**: `DB_PASSWORD`, `ADMIN_PASSWORD` (`scrypt:[16-byte saltBase64]:[64-byte keyBase64]` generated via `node scripts/generate-password-hash.mjs "password"`), `GUEST_PASSCODE`, and `GUEST_SESSION_SECRET` (32+ characters, distinct from `GUEST_PASSCODE`) have no default values in `docker-compose.yml`. Running `docker compose config` or `docker compose up -d` without setting them fails immediately. In addition, `src/env.ts` rejects non-64-byte scrypt hashes and repository placeholder/E2E fallback secrets in `NODE_ENV=production`.
*   **Compose Network, Proxy & Database Interpolation**: `DB_USER` (`wedding`), `DB_NAME` (`wedding`), and `DB_PORT` (`127.0.0.1:${DB_PORT:-5432}:5432`) configure the `db` container and fallback `DATABASE_URL`; `PORT` (`127.0.0.1:${PORT:-3000}:3000`), `STANDBY_PORT` (`127.0.0.1:${STANDBY_PORT:-3001}:3000` in `docker-compose.rollout.yml`), and `HOSTNAME` (`0.0.0.0`) configure loopback host port publishing and container network binding; `ALLOWED_HOSTS` and `TRUST_PROXY=1` (`${TRUST_PROXY:-1}` default in `docker-compose.yml` and `docker-compose.rollout.yml`, or `2` behind an upstream CDN/load balancer plus host proxy) configure reverse-proxy host validation and client IP forwarding behind Caddy or Nginx.
*   **Scoped Container Runtime, Full 21-Variable Forwarding & 32-Variable `SITE_*` Overrides**: `app` (in `docker-compose.yml`) and `app-standby` (in `docker-compose.rollout.yml`) pin `NODE_ENV: production` so host development overrides never leak into production containers, forward all 21 runtime keys from `src/env.ts` (including optional `S3_*`, `STRIPE_*`, `CRON_SECRET`, `RUN_MIGRATIONS`, and `POSTGRES_URL_NON_POOLING` — see the [Application Runtime Contract](../runtime-contract.md)) plus all 32 optional Layer 1 `SITE_*` overrides (`${SITE_*:-}`), and scope container `DATABASE_URL` (`${CONTAINER_DATABASE_URL:-...}`) and `POSTGRES_URL_NON_POOLING` (`${CONTAINER_POSTGRES_URL_NON_POOLING:-}`) identically across `migration`, `app`, and `app-standby` without requiring a manual `docker-compose.override.yml` file (automated CI smoke tests layer `--env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml` separately).
*   **Trimmed & Blank-Safe `SITE_*` Overrides**: `src/lib/config.ts` (`getEnvConfigOverrides`) trims leading/trailing whitespace on all 32 `SITE_*` keys and treats empty or whitespace-only values as unset before Zod validation and `isSiteInitialized` checks, while still rejecting non-empty malformed overrides (such as invalid coordinates, dates, or hex colors) at startup. Optional `SITE_*` keys (plus `STANDBY_PORT=3001` for `./scripts/rollout-vps.sh`) can be set directly in `.env`:
    ```env
    # Optional standby loopback port for ./scripts/rollout-vps.sh (defaults to 3001)
    # STANDBY_PORT=3001

    # Optional Layer 1 site overrides (blank or commented keys fall back to database AppConfig; see ../runtime-contract.md for all 32 SITE_* keys)
    SITE_PARTNER1_NAME="Alex"
    SITE_PARTNER2_NAME="Jordan"
    SITE_WEDDING_DATE="2027-09-18T17:00:00.000Z"
    SITE_BASE_URL="https://wedding.mydomain.com"
    ```
*   **Single-Owner Provider-Neutral Local BuildKit Caching**: `app` is the sole `build:` owner in `docker-compose.yml` (`migration` and `app-standby` set `pull_policy: never` on `wedding-website:latest`), compiling the image once on both `amd64` and `arm64` hosts using local BuildKit layer and cache mounts (`Dockerfile`) with zero GitHub Actions (`type=gha`) cache backend references in `docker-compose.yml` or `docker-compose.rollout.yml` (per-architecture CI `cache_from` overrides live strictly inside `docker-compose.ci.yml`).
*   If any secret in `.env` contains a literal `$`, escape it as `$$` for Docker Compose interpolation.

### Production Onboarding & `E2E_TEST=false`
`docker-compose.yml` defaults `E2E_TEST` to `false` (`E2E_TEST: ${E2E_TEST:-false}`) so fresh VPS deployments render the `<SetupWizard />` onboarding flow until couple names and `baseUrl` are saved (`docker-compose.ci.yml` isolates `E2E_TEST=true` strictly to automated CI smoke tests). Keep `E2E_TEST=false` (or unset) in `.env` for production deployments—setting `E2E_TEST=true` also disables `NODE_ENV=production` blocklists for committed `E2E_FALLBACK_*` secrets in `src/env.ts`.

---

## 3. Migration Mechanism

### Primary Path: Dedicated `migration` Service in `docker-compose.yml`
`docker-compose.yml` decouples schema migrations from application container boot:
1. `db` starts `postgres:15-alpine` bound to `127.0.0.1:${DB_PORT:-5432}:5432` and waits until its `pg_isready` healthcheck reports `service_healthy`.
2. `migration` runs `./node_modules/.bin/prisma migrate deploy` offline (`restart: "no"`, `read_only: true`, `cap_drop: [ALL]`, `tmpfs: [/tmp]`) against `DATABASE_URL` (`${CONTAINER_DATABASE_URL:-postgres://${DB_USER:-wedding}:${DB_PASSWORD:?DB_PASSWORD is required}@db:5432/${DB_NAME:-wedding}}`) and optional `POSTGRES_URL_NON_POOLING` (`${CONTAINER_POSTGRES_URL_NON_POOLING:-}`).
3. `app` defaults `RUN_MIGRATIONS` to `false` (`${RUN_MIGRATIONS:-false}`), sets `NODE_ENV: production`, and waits on `migration` (`condition: service_completed_successfully`) before executing `node server.js` behind `/usr/bin/tini`.

To run migrations on demand via Docker Compose (when `CONTAINER_DATABASE_URL` uses an external PgBouncer pooler, setting `CONTAINER_POSTGRES_URL_NON_POOLING` in `.env` allows `migration` to route through `prisma.config.ts` without extra flags):
```bash
docker compose run --rm migration
```
If passing an ad-hoc direct `DATABASE_URL` override on the CLI instead of setting `CONTAINER_POSTGRES_URL_NON_POOLING`, unset and clear `POSTGRES_URL_NON_POOLING` so Prisma 7 never sees matching primary and shadow database URLs (`P3025`):
```bash
env -u POSTGRES_URL_NON_POOLING docker compose run --rm \
  -e DATABASE_URL="${CONTAINER_POSTGRES_URL_NON_POOLING:-$CONTAINER_DATABASE_URL}" \
  -e POSTGRES_URL_NON_POOLING="" \
  migration
```

### Standalone Container Path (`docker-entrypoint.sh`)
When running the image directly via `docker run` without Docker Compose's `migration` service, set `RUN_MIGRATIONS=true` or `RUN_MIGRATIONS=1` so `docker-entrypoint.sh` validates `DATABASE_URL`, normalizes and preserves non-empty `POSTGRES_URL_NON_POOLING` (unsetting blank values), and executes `./node_modules/.bin/prisma migrate deploy` (symlinked to `/usr/local/bin/prisma` and backed by `/opt/prisma-cli`, with npm update checks disabled) prior to `node server.js`.

---

## 4. Asset Storage

*   **Local Disk Storage (Default — `uploads_data` Named Volume & Ephemeral `tmpfs` Cache)**: Static application files under `/app` are owned by `root:root` and mounted `read_only: true` in `docker-compose.yml` (`cap_drop: [ALL]`, `no-new-privileges:true`), with writable `tmpfs` memory mounts backing `/tmp` and `/app/.next/cache:uid=1001,gid=1001,mode=0755` for Next.js `/_next/image` optimization. Uploaded files are written to `/app/public/uploads` and streamed dynamically at `/uploads/*` in standalone mode (`src/app/api/uploads/[...path]/route.ts`, with `X-Content-Type-Options: nosniff`) without needing a container restart. Both `Dockerfile` and `docker-compose.yml` pre-create `/app/public/uploads` owned by `nextjs:nodejs` (UID/GID 1001) and mount the persistent `uploads_data` named volume by default so uploaded photos and branding assets survive `docker compose up -d --build`:
    ```yaml
    services:
      app:
        volumes:
          - uploads_data:/app/public/uploads
    volumes:
      uploads_data:
    ```
    If overriding `uploads_data` with a host bind mount (e.g., `./uploads:/app/public/uploads` or `-v /var/lib/wedding/uploads:/app/public/uploads` in standalone `docker run`), ensure host ownership/permissions allow writes by UID 1001 (`chown -R 1001:1001 ./uploads`).
*   **S3 / Cloudflare R2 / Google Cloud Storage Object Storage (Recommended for Multi-Instance)**: Configure all six S3-compatible environment variables as needed (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, and `S3_PUBLIC_URL`):
    *   **Cloudflare R2**: Set `S3_BUCKET`, `S3_REGION=auto`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, and `S3_PUBLIC_URL=https://assets.wedding.mydomain.com` (an R2 Custom Domain or public `https://pub-<id>.r2.dev` URL; private `*.r2.cloudflarestorage.com` endpoints require `S3_PUBLIC_URL`).
    *   **Google Cloud Storage (S3 Interoperability)**: Enable Cloud Storage HMAC keys and set `S3_BUCKET`, `S3_REGION=us-central1` (matching your bucket region), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT=https://storage.googleapis.com`, and optional `S3_PUBLIC_URL`.
    *   **AWS S3**: Set `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` (with `S3_ENDPOINT` omitted and `S3_PUBLIC_URL` optional for CloudFront).

---

## 5. Custom Domain & TLS

Use a reverse proxy such as **Caddy** or **Nginx** with **Let's Encrypt** on the host, configured with **dual loopback upstreams** (`127.0.0.1:3000` primary `app` and `127.0.0.1:3001` standby `app-standby`) so `./scripts/rollout-vps.sh` updates `app` with zero dropped HTTP requests. Always configure reverse proxies to sanitize and overwrite client IP headers (`X-Real-IP` and `X-Forwarded-For`) to prevent attackers from spoofing their IP address to evade rate limiting.

### Option A: Caddy (Automatic TLS + Standby Failover)
Create a `Caddyfile`:
```caddy
wedding.mydomain.com {
    reverse_proxy localhost:3000 localhost:3001 {
        lb_policy first
        lb_try_duration 5s
        lb_try_interval 100ms
        fail_duration 5s
        # Overwrite/strip untrusted incoming X-Real-IP header with trusted remote client IP
        header_up X-Real-IP {remote_host}
    }
}
```
*Note: `lb_policy first` sends all normal traffic to primary `localhost:3000` and automatically retries/fails over to warm `localhost:3001` (`app-standby`) while `app` recreates during `./scripts/rollout-vps.sh`. Caddy automatically manages `X-Forwarded-For` by appending the client IP, and `header_up X-Real-IP {remote_host}` ensures any incoming forged client `X-Real-IP` header is stripped and overwritten before the request reaches the container.*

### Option B: Nginx + Certbot (Primary + Backup Upstream Failover)
```nginx
upstream wedding_backend {
    server 127.0.0.1:3000 max_fails=1 fail_timeout=2s;
    server 127.0.0.1:3001 backup;
    keepalive 16;
}

server {
    server_name wedding.mydomain.com;

    location / {
        proxy_pass http://wedding_backend;
        proxy_http_version 1.1;
        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 2;
        proxy_connect_timeout 1s;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
*Note: Marking `127.0.0.1:3001` as `backup` routes all steady-state requests to primary `127.0.0.1:3000` and transparently retries on `127.0.0.1:3001` (`app-standby`) via `proxy_next_upstream` the instant `app` closes its socket during rollout. Setting `proxy_set_header X-Real-IP $remote_addr;` explicitly overwrites any client-supplied `X-Real-IP` header with the direct connecting IP address `$remote_addr`. Combined with `$proxy_add_x_forwarded_for`, this prevents rate limit evasion via forged proxy headers.*

Obtain TLS certificate:
```bash
sudo certbot --nginx -d wedding.mydomain.com
```

---

## 6. Build & Deploy Commands

### Initial Build & Start
```bash
# Clone repository on host
git clone https://github.com/fderuiter/wedding_website.git /opt/wedding_website
cd /opt/wedding_website

# Build the container image and generate a 16-byte salt / 64-byte scrypt hash inside Docker (no host Node.js required)
docker build -t wedding-website:latest .
ADMIN_HASH=$(docker run --rm wedding-website:latest node scripts/generate-password-hash.mjs "replace-with-strong-admin-password")
GUEST_SECRET=$(openssl rand -hex 32)
DB_SECRET=$(openssl rand -hex 24)

# Configure required secrets and runtime settings in .env (unquoted for `docker run --env-file` compatibility)
cat <<EOF > .env
DB_USER=wedding
DB_PASSWORD=${DB_SECRET}
DB_NAME=wedding
DATABASE_URL=postgresql://wedding:${DB_SECRET}@db:5432/wedding?schema=public
PORT=3000
STANDBY_PORT=3001
ADMIN_PASSWORD=${ADMIN_HASH}
ALLOWED_HOSTS=wedding.mydomain.com,localhost,127.0.0.1
GUEST_PASSCODE=choose-a-unique-celebration-passcode
GUEST_SESSION_SECRET=${GUEST_SECRET}
TRUST_PROXY=1
E2E_TEST=false
EOF

# Build wedding-website:latest once via `app`, run `migration`, and start `app` in detached mode
docker compose build app
docker compose up -d
```

### Zero-Downtime Deployment Update (`scripts/rollout-vps.sh`)
Use `./scripts/rollout-vps.sh` (layered with `docker-compose.rollout.yml`) so updates compile the image once, apply pending Prisma migrations, warm `app-standby` on `127.0.0.1:${STANDBY_PORT:-3001}:3000`, verify `/api/live` and `/api/ready` probes, recreate primary `app` on `127.0.0.1:${PORT:-3000}:3000` without dropping requests behind Caddy or Nginx, and retire `app-standby`:
```bash
git pull origin main
./scripts/rollout-vps.sh
```
*(For maintenance windows without a dual-upstream proxy, `docker compose build app && docker compose up -d` also applies `migration` before recreating `app`.)*

### Automated Rollouts via GitHub Actions (`docker-host` & `generic-webhook`)
Instead of building on the VPS, operators can pull attested multi-arch `ghcr.io` images automatically from `.github/workflows/deploy.yml` or `.github/workflows/deploy-provider.yml` using `provider: docker-host` (or `provider: generic-webhook`). Configure `vars.SERVICE_URL` plus environment secrets `DEPLOY_WEBHOOK_URL` and `DEPLOY_WEBHOOK_SECRET` in your `staging`, `production`, and optional unguarded `production-rollback` GitHub Environments, and see **Section 9** below for the stateless signed webhook payload, timestamp window, and dual-HMAC verification contract.

---

## 7. Health Checks & Graceful Shutdown

`docker-compose.yml` already configures built-in `healthcheck` probes on both `db` (`pg_isready`) and `app` (`/api/live`), along with `init: true` and `stop_grace_period: 15s` so Next.js finishes active HTTP requests and `src/lib/prisma.ts` drains `pg.Pool` within its `5000ms` shutdown safety timer—no manual edits to `docker-compose.yml` are required:

```yaml
  app:
    init: true
    stop_grace_period: 15s
    ports:
      - "127.0.0.1:${PORT:-3000}:3000"
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/live').then((res)=>{if(!res.ok)process.exit(1);}).catch(()=>process.exit(1))\""]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 20s
```

Verify live container status with `docker compose ps`. Stateless `GET` and `HEAD` probes to `/api/live`, `/api/health`, and `/api/ready` enforce syntactic `Host` validation only, so loopback `127.0.0.1` probes succeed without `Host` header overrides even when `ALLOWED_HOSTS` lists only public domains. Continuous container liveness checks hit `/api/live` (`HTTP 200` `{ "status": "alive", "timestamp": "..." }`) so brief PostgreSQL blips do not restart warm containers, while deployment rollout checks query `/api/health` (`HTTP 200 OK` with `Cache-Control: no-store` when PostgreSQL is connected):
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-09-30T14:30:00.000Z",
    "database": "connected"
  }
}
```
When PostgreSQL is unreachable (`HTTP 503 Service Unavailable`), `withApiMiddleware` (`isHealthProbe: true` in `src/utils/withApiMiddleware.ts`) preserves diagnostic probe fields `{ "success": false, "status": "degraded", "database": "disconnected", "timestamp": "2026-09-30T14:30:00.000Z", "error": "Database connection failed" }` on `/api/health` while sanitizing error text in `NODE_ENV=production` so internal driver details never leak. Unwrapped readiness monitors can query `/api/ready`, which verifies core schema tables and applied `_prisma_migrations` without requiring seeded `AppConfig` rows and returns `HTTP 200` `{ "status": "ready", "database": "connected", "timestamp": "..." }` or `HTTP 503` with `status: "unhealthy"` (`database: "connected"` and `error: "Database schema is not ready"` when schema/migrations are incomplete, or `database: "disconnected"` and `error: "Database connection failed"` when PostgreSQL is unreachable).

---

## 8. Rollback Strategy

1. **Tag Image Builds Before Updating**: Tag the currently running image (or pull an attested `ghcr.io/fderuiter/wedding_website@sha256:<digest>` release image) prior to upgrading:
   ```bash
   docker tag wedding-website:latest wedding-website:previous
   ```
2. **Networked & Port-Mapped Container Rollback**:
   *   **Via Docker Compose (Recommended — preserves Compose `db` network, `127.0.0.1:${PORT:-3000}:3000` port binding, `stop_grace_period: 15s`, and healthcheck)**:
       ```bash
       docker tag wedding-website:previous wedding-website:latest
       docker compose up -d --no-deps app
       ```
   *   **Via Standalone `docker run` (Must attach Compose network, publish loopback port, allow `15s` stop timeout, and load `DATABASE_URL` directly from `--env-file .env`)**:
       ```bash
       docker compose stop app
       docker run -d --name app-rollback \
           --init \
           --stop-timeout 15 \
           --network wedding_website_default \
           -p 127.0.0.1:3000:3000 \
           --read-only \
           --cap-drop=ALL \
           --security-opt=no-new-privileges:true \
           --tmpfs /tmp \
           --tmpfs /app/.next/cache:uid=1001,gid=1001,mode=0755 \
           -v wedding_website_uploads_data:/app/public/uploads \
           --env-file .env \
           -e E2E_TEST=false \
           wedding-website:previous
       ```
3. **Automated GitHub Actions Rollback (`rollback.yml` & `deploy-provider.yml`)**: When deploying via `provider: docker-host` or `provider: generic-webhook`, `.github/workflows/deploy-provider.yml` filters completed `deploy.yml` and `deploy-provider.yml` runs to the last non-dry-run target-environment (`staging` or `production`) rollout, verifies candidate tags in GHCR via `docker buildx imagetools inspect` (skipping unpublished `HEAD^1` commits), and forwards both `previous_image_tag` and `previous_image_digest` to `.github/workflows/rollback.yml` if `/api/health` fails.
4. **Database Schema Rollback**: Prisma migrations are forward-only by design. Keep database schema changes backward-compatible (e.g., expand-and-contract pattern) to ensure older container versions can operate alongside migrated schemas.

---

## 9. Webhooks & Scheduled Background Jobs

### Stripe `payment_intent.succeeded` Webhook
1. Set `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` in `.env` (`docker-compose.yml` forwards all three variables directly into `app`).
2. In the **Stripe Dashboard > Developers > Webhooks**, create an endpoint pointing to `https://wedding.mydomain.com/api/registry/webhook/stripe` (ensure `wedding.mydomain.com` is in `ALLOWED_HOSTS`) and subscribe to **`payment_intent.succeeded`**.
3. Ensure Caddy or Nginx forwards the raw request body and `Stripe-Signature` header untouched (default behavior in both reverse proxy configs above). `src/middleware.ts` exempts `/api/registry/webhook/stripe` from session cookies while verifying `ALLOWED_HOSTS`, and the webhook handler validates `stripe-signature` using `STRIPE_WEBHOOK_SECRET`.

### Signed Deployment Webhook Receiver (`docker-host` & `generic-webhook`)
When `.github/workflows/deploy-provider.yml` runs with `provider: docker-host` or `provider: generic-webhook` (without `dry_run`), GitHub Actions sends an authenticated `POST` request (`--fail-with-body`, 10s connect timeout, 30s max runtime) to `DEPLOY_WEBHOOK_URL` signed with `DEPLOY_WEBHOOK_SECRET` — requiring no repository-managed daemon on your VPS:
1. **GitHub Environment Secrets**: Set `DEPLOY_WEBHOOK_URL` (HTTPS listener URL on your VPS reverse proxy) and `DEPLOY_WEBHOOK_SECRET` (32+ byte random HMAC secret) in `staging`, `production`, and optional `production-rollback`, alongside `vars.SERVICE_URL`.
2. **`POST` JSON Payload Schema (`{image, digest, environment}`) & Multi-Line Raw-Byte Formatting**: `deploy-provider.yml` formats `PAYLOAD` using `jq -n` (without `-c`), sending pretty-printed multi-line UTF-8 JSON with 2-space indentation and internal `\n` newlines (trailing newline stripped by bash `$(...)`; `digest` is omitted only if empty):
   ```json
   {
     "image": "ghcr.io/fderuiter/wedding_website@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
     "digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
     "environment": "production"
   }
   ```
   **Raw-Byte Rule**: Read the unparsed HTTP request buffer (`PAYLOAD`) directly and compute HMAC digests over those exact raw bytes. Never parse JSON and re-serialize with `JSON.stringify()`, which strips `jq -n` newlines/indentation and breaks signature verification.
3. **Timestamp Window & Dual-HMAC Headers**:
   *   `Content-Type: application/json`
   *   `X-Deploy-Timestamp: <unix-seconds>` — UTC epoch seconds (`date -u +%s`). Reject requests when `Math.abs(nowSeconds - Number(timestamp)) > 300` (5-minute replay window).
   *   `X-Hub-Signature-256: sha256=<64-lowercase-hex>` — `HMAC-SHA256(DEPLOY_WEBHOOK_SECRET, PAYLOAD)` over raw `PAYLOAD` bytes.
   *   `X-Deploy-Signature-256: sha256=<64-lowercase-hex>` — `HMAC-SHA256(DEPLOY_WEBHOOK_SECRET, "${X-Deploy-Timestamp}.${PAYLOAD}")` over the timestamp-prefixed raw payload (`${X-Deploy-Timestamp}.${PAYLOAD}`). Verify both headers using constant-time digest comparison (`crypto.timingSafeEqual`) before pulling the `@sha256:` image and restarting `app`.

### Scheduled Broadcast Cron (`CRON_SECRET`)
1. Set `CRON_SECRET` in `.env` (`docker-compose.yml` forwards `CRON_SECRET` directly into `app`).
2. Add a host `crontab` entry (`crontab -e`) or systemd timer that triggers `/api/cron/broadcasts` every 5 minutes over loopback with an allowed `Host` header and `Authorization: Bearer <CRON_SECRET>`:
   ```cron
   */5 * * * * curl -fsS -X POST http://127.0.0.1:3000/api/cron/broadcasts -H "Host: localhost" -H "Authorization: Bearer replace-with-random-cron-secret" >/dev/null
   ```

---

## 10. Provider-Specific Limitations

*   **Host Dependency**: Requires managing server OS patches, Docker engine updates, and firewall rules (ports 80, 443, 22).
*   **Disk Persistence**: If using local filesystem storage, host backups must include the `uploads_data` Docker volume (or host upload directory) alongside `db_data`.
*   **Single-Node Availability**: Without an external load balancer or swarm/k8s cluster, host maintenance causes brief downtime.
