# Deployment Recipe: Generic Docker / VPS (Canonical Portable Baseline)

**Support Tier**: Tier 1 — Officially Tested & Supported Adapter  
**Target Platform**: Any Virtual Private Server (VPS) / Virtual Machine (e.g., Ubuntu, Debian, AWS EC2, DigitalOcean Droplet, Hetzner, Linode) or bare-metal host running Docker & Docker Compose.

---

## Overview

The generic Docker/VPS deployment path serves as the **canonical portable baseline** for the application. It packages the application into a self-contained, multi-platform Docker container (`linux/amd64` and `linux/arm64`) orchestrated by `docker-compose.yml` across three services—`db` (`postgres:15-alpine` with `shm_size: "256mb"` and `no-new-privileges:true`), a dedicated one-shot `migration` job (`./node_modules/.bin/prisma migrate deploy` reusing `wedding-website:latest` via `pull_policy: never`), and `app` (the sole `build:` owner, running with `HOSTNAME="0.0.0.0"`, `RUN_MIGRATIONS="false"`, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges:true`, `tmpfs` mounts at `/tmp` and `/app/.next/cache`, persistent `uploads_data:/app/public/uploads` volume storage, and a built-in `/api/live` container healthcheck)—with bounded `json-file` log rotation (`max-size: "10m"`, `max-file: "3"`), `pids_limit`, `mem_limit`, and explicit `stop_grace_period` across every service. Zero-downtime updates layer `docker-compose.rollout.yml` (`app-standby` on `127.0.0.1:${STANDBY_PORT:-3001}:3000`) via `./scripts/rollout-vps.sh` behind a dual-upstream host reverse proxy. Standalone `docker run` deployments without Compose can opt into offline entrypoint migrations by setting `RUN_MIGRATIONS=true` in `docker-entrypoint.sh`.

---

## 1. Database Provisioning & Connection

### Provisioning
You can run PostgreSQL either alongside the application via Docker Compose or connect to an external managed database (such as AWS RDS, DigitalOcean Managed Database, Neon, or Supabase).

*   **Docker Compose Co-location**: Uses the official `postgres:15-alpine` image (`db` service) with persistent volume mounting (`db_data:/var/lib/postgresql/data`), loopback host port binding (`127.0.0.1:${DB_PORT:-5432}:5432`), and a `pg_isready` healthcheck. `migration`, `app` (`docker-compose.yml`), and `app-standby` (`docker-compose.rollout.yml`) construct container `DATABASE_URL` automatically from `DB_USER`, mandatory `DB_PASSWORD`, and `DB_NAME` via `${CONTAINER_DATABASE_URL:-postgres://${DB_USER:-wedding}:${DB_PASSWORD:?DB_PASSWORD is required}@db:5432/${DB_NAME:-wedding}}` whenever an explicit `CONTAINER_DATABASE_URL` is not provided in `.env` (preventing host `@localhost:5432` `DATABASE_URL` settings from leaking into containers).
*   **External PostgreSQL**: Ensure PostgreSQL v15+ is running and accessible over port `5432` with SSL/TLS enabled if remote. Set `CONTAINER_DATABASE_URL` directly in `.env` when orchestrating with `docker-compose.yml` (`migration`, `app`, and `app-standby` honor explicit `CONTAINER_DATABASE_URL` overrides automatically), or pass `DATABASE_URL` directly when running standalone `docker run`.

### Connection String Format
Configure `DATABASE_URL` as a standard PostgreSQL URI (`datasource.url` in `prisma.config.ts`, used by both the Next.js runtime and `npx prisma migrate deploy`):
```env
DATABASE_URL="postgresql://wedding_user:secure_password@db_host:5432/wedding_db?schema=public&sslmode=prefer"
```
In `prisma.config.ts`, `POSTGRES_URL_NON_POOLING` is bound to `datasource.shadowDatabaseUrl` (used by `prisma migrate dev`), whereas `npx prisma migrate deploy` always reads `DATABASE_URL`. If `DATABASE_URL` connects through a transaction-mode pooler such as PgBouncer, pass an explicit `DATABASE_URL` override pointing to a direct PostgreSQL URL when running `prisma migrate deploy`:
```env
POSTGRES_URL_NON_POOLING="postgresql://wedding_user:secure_password@db_host:5432/wedding_db?schema=public&sslmode=require"
```

---

## 2. Required Environment Variables

The application validates the following runtime environment variables via `src/env.ts`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `production` | Application execution environment (`production`). |
| `DATABASE_URL` | Yes | — | Connection string for PostgreSQL database (`datasource.url` in `prisma.config.ts`, used by runtime and `prisma migrate deploy`). |
| `POSTGRES_URL_NON_POOLING` | No | — | Shadow database connection string (`datasource.shadowDatabaseUrl` in `prisma.config.ts` for `prisma migrate dev`); `prisma migrate deploy` requires an explicit `DATABASE_URL` override to bypass PgBouncer. |
| `ADMIN_PASSWORD` | Yes | — | Cryptographic hash of administrative password in `scrypt:[16-byte saltBase64]:[64-byte keyBase64]` format. Generate via `node scripts/generate-password-hash.mjs "password"`. |
| `ALLOWED_HOSTS` | Yes | `localhost,127.0.0.1,*.localhost` | Comma-separated list of trusted host domains (e.g., `wedding.mydomain.com,localhost,127.0.0.1`). |
| `MULTISITE_ENABLED` | No | `false` | Enable subdomain-based `AppConfig` branding/profile routing (`X-Forwarded-Host` checked before `Host`). Switches `AppConfig` rows only; `prisma/schema.prisma` shares the other 15 tables across subdomains without tenant row isolation. |
| `RUN_MIGRATIONS` | No | `false` | Set to `true` to automatically execute `prisma migrate deploy` on container startup in `docker-entrypoint.sh`. |
| `TRUST_PROXY` | No | `false` | Set to `1` behind a single-hop Caddy/Nginx reverse proxy (`docker-compose.yml` defaults to `${TRUST_PROXY:-1}`), or `2` behind an upstream CDN/load balancer plus host proxy, so rate limiting trusts `X-Forwarded-For` / `X-Real-IP`. |
| `GUEST_PASSCODE` | Yes | — | Unique passcode required for guest website access (default `wedding2026` is rejected in production). |
| `GUEST_SESSION_SECRET` | Yes | — | Dedicated server secret for guest invitation session signing (min 32 characters, distinct from `GUEST_PASSCODE`). |
| `HISTORY_VERSION_LIMIT` | No | `50` | Maximum history versions to retain per content entry. |
| `CRON_SECRET` | No | — | Secret authorization key for background cron triggers (e.g., `/api/cron/broadcasts`). |
| `S3_BUCKET` | No | — | Bucket name for S3 / Cloudflare R2 asset storage. |
| `S3_REGION` | No | — | Region for S3 bucket (`us-east-1` or `auto` for Cloudflare R2). |
| `S3_ACCESS_KEY_ID` | No | — | S3/R2 API access key ID. |
| `S3_SECRET_ACCESS_KEY` | No | — | S3/R2 API secret access key. |
| `S3_ENDPOINT` | No | — | Custom S3 endpoint URL (required for Cloudflare R2). |
| `S3_PUBLIC_URL` | No | — | CDN / public URL prefix for serving uploaded assets. |
| `STRIPE_SECRET_KEY` | No | — | Server-side Stripe secret key (`sk_...` / `rk_...`). Must be paired with `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` when enabling card checkout. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | No | — | Client-side Stripe publishable key (`pk_...`). Must be paired with `STRIPE_SECRET_KEY` when enabling card checkout. |
| `STRIPE_WEBHOOK_SECRET` | No | — | Stripe webhook signing secret (`whsec_...`) for `/api/registry/webhook/stripe`. |
| `PORT` | No | `3000` | Host/container HTTP port (`ENV PORT=3000` in `Dockerfile`; `127.0.0.1:${PORT:-3000}:3000` in `docker-compose.yml`). |
| `HOSTNAME` | No | `0.0.0.0` | Network interface bound by standalone `server.js` (`ENV HOSTNAME="0.0.0.0"` in `Dockerfile` and `HOSTNAME: "0.0.0.0"` in `docker-compose.yml`). |

### `.env` Interpolation & Secret Requirements in `docker-compose.yml`
`docker-compose.yml` substitutes environment variables directly from `.env` without hardcoding production fallback secrets:
*   **Mandatory Operator Secrets (`:?` required)**: `DB_PASSWORD`, `ADMIN_PASSWORD`, `GUEST_PASSCODE`, and `GUEST_SESSION_SECRET` have no default values in `docker-compose.yml`. Running `docker compose config` or `docker compose up -d` without setting them fails immediately. In addition, `src/env.ts` rejects non-64-byte scrypt hashes and repository placeholder/E2E fallback secrets in `NODE_ENV=production`.
*   **Scoped Container Runtime, Full 21-Variable Forwarding & 32-Variable `SITE_*` Overrides**: `app` (in `docker-compose.yml`) and `app-standby` (in `docker-compose.rollout.yml`) pin `NODE_ENV: production` so host development overrides never leak into production containers, forward all 21 runtime keys from `src/env.ts` (`NODE_ENV`, `DATABASE_URL`, `POSTGRES_URL_NON_POOLING`, `ADMIN_PASSWORD`, `ALLOWED_HOSTS`, `MULTISITE_ENABLED`, `RUN_MIGRATIONS`, `TRUST_PROXY`, `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`, `HISTORY_VERSION_LIMIT`, `CRON_SECRET`, `S3_*`, `STRIPE_*`, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) plus all 32 optional Layer 1 `SITE_*` overrides (`${SITE_*:-}`), and scope container `DATABASE_URL` across `migration`, `app`, and `app-standby` via `${CONTAINER_DATABASE_URL:-...}` without requiring a manual `docker-compose.override.yml` file (automated CI smoke tests layer `--env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml` separately).
*   **Trimmed & Blank-Safe `SITE_*` Overrides**: `src/lib/config.ts` (`getEnvConfigOverrides`) trims leading/trailing whitespace on all 32 `SITE_*` keys and treats empty or whitespace-only values as unset before Zod validation and `isSiteInitialized` checks, while still rejecting non-empty malformed overrides (such as invalid coordinates, dates, or hex colors) at startup. All 32 optional `SITE_*` keys (plus optional `STANDBY_PORT=3001` for rollout port customization) can be set directly in `.env`:
    ```env
    # Optional standby loopback port for ./scripts/rollout-vps.sh (defaults to 3001)
    # STANDBY_PORT=3001

    # Optional Layer 1 site overrides (blank or commented keys fall back to database AppConfig)
    SITE_PARTNER1_NAME="Alex"
    SITE_PARTNER2_NAME="Jordan"
    SITE_BRIDE_NAME=""
    SITE_GROOM_NAME=""
    SITE_WEDDING_DATE="2027-09-18T17:00:00.000Z"
    SITE_BASE_URL="https://wedding.mydomain.com"
    SITE_VENUE_NAME="Grand Conservatory"
    SITE_VENUE_ADDRESS="100 Garden Way"
    SITE_VENUE_CITY="Minneapolis"
    SITE_VENUE_STATE="MN"
    SITE_VENUE_ZIP="55401"
    SITE_LATITUDE="44.9778"
    SITE_LONGITUDE="-93.2650"
    SITE_TIMEZONE="America/Chicago"
    SITE_COLOR_PRIMARY="#4A5D4E"
    SITE_COLOR_SECONDARY="#D4AF37"
    SITE_THEME_PRESET="classic"
    SITE_THEME_TOKENS='{"--btn-radius":"12px"}'
    SITE_SHOW_COUNTDOWN="true"
    SITE_SHOW_ADD_TO_CALENDAR="true"
    SITE_SEO_TITLE="Alex & Jordan Wedding"
    SITE_SEO_DESCRIPTION="Join us to celebrate our wedding weekend."
    SITE_BRAND_MONOGRAM="A&J"
    SITE_BRAND_LOGO_URL="/assets/logo.svg"
    SITE_BRAND_LOGO_ALT="Alex and Jordan monogram logo"
    SITE_HERO_IMAGE_URL="/assets/hero.jpg"
    SITE_HERO_IMAGE_ALT="Alex and Jordan in the garden"
    SITE_BRAND_WATERMARK_URL="/assets/watermark.svg"
    SITE_BRAND_WATERMARK_ALT="Floral crest watermark"
    SITE_BADGE_GRAPHIC_URL="/assets/badge.svg"
    SITE_BADGE_GRAPHIC_ALT="Wedding crest badge"
    SITE_CONTACT_EMAIL="couple@wedding.example"
    ```
*   **Single-Owner Provider-Neutral Local BuildKit Caching**: `app` is the sole `build:` owner in `docker-compose.yml` (`migration` and `app-standby` set `pull_policy: never` on `wedding-website:latest`), compiling the image once on both `amd64` and `arm64` hosts using local BuildKit layer and cache mounts (`Dockerfile`) with zero GitHub Actions (`type=gha`) cache backend references in `docker-compose.yml` or `docker-compose.rollout.yml` (per-architecture CI `cache_from` overrides live strictly inside `docker-compose.ci.yml`).
*   If any secret in `.env` contains a literal `$`, escape it as `$$` for Docker Compose interpolation.

### Production Onboarding & `E2E_TEST=false`
`docker-compose.yml` defaults `E2E_TEST` to `false` (`E2E_TEST: ${E2E_TEST:-false}`) so fresh VPS deployments render the `<SetupWizard />` onboarding flow until couple names and `baseUrl` are saved (`docker-compose.ci.yml` isolates `E2E_TEST=true` strictly to automated CI smoke tests). Keep `E2E_TEST=false` (or unset) in `.env` for production onboarding.

---

## 3. Migration Mechanism

### Primary Path: Dedicated `migration` Service in `docker-compose.yml`
`docker-compose.yml` decouples schema migrations from application container boot:
1. `db` starts `postgres:15-alpine` bound to `127.0.0.1:${DB_PORT:-5432}:5432` and waits until its `pg_isready` healthcheck reports `service_healthy`.
2. `migration` runs `./node_modules/.bin/prisma migrate deploy` offline (`restart: "no"`, `read_only: true`, `cap_drop: [ALL]`, `tmpfs: [/tmp]`) against `DATABASE_URL` (`${CONTAINER_DATABASE_URL:-${POSTGRES_URL_NON_POOLING:-postgres://${DB_USER:-wedding}:${DB_PASSWORD:?DB_PASSWORD is required}@db:5432/${DB_NAME:-wedding}}}`) without forwarding `POSTGRES_URL_NON_POOLING`.
3. `app` defaults `RUN_MIGRATIONS` to `false` (`${RUN_MIGRATIONS:-false}`), sets `NODE_ENV: production`, and waits on `migration` (`condition: service_completed_successfully`) before executing `node server.js` behind `/usr/bin/tini`.

To run migrations on demand via Docker Compose:
```bash
docker compose run --rm migration
```
If overriding `CONTAINER_DATABASE_URL` to use an external PgBouncer pooler, pass an explicit non-pooled `DATABASE_URL` override to `migration` while unsetting and clearing `POSTGRES_URL_NON_POOLING` so Prisma 7 never sees matching primary and shadow database URLs (`P3025`):
```bash
env -u POSTGRES_URL_NON_POOLING docker compose run --rm \
  -e DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$CONTAINER_DATABASE_URL}" \
  -e POSTGRES_URL_NON_POOLING="" \
  migration
```

### Standalone Container Path (`docker-entrypoint.sh`)
When running the image directly via `docker run` without Docker Compose's `migration` service, set `RUN_MIGRATIONS=true` so `docker-entrypoint.sh` validates `DATABASE_URL`, unsets `POSTGRES_URL_NON_POOLING`, and executes `./node_modules/.bin/prisma migrate deploy` locally (with npm update checks disabled) prior to `node server.js`.

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
*   **S3 / Cloudflare R2 Object Storage (Recommended for Multi-Instance)**: Provide all four S3 environment variables (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). The application will stream uploads directly to S3/R2 and serve them via `S3_PUBLIC_URL`.

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

# Generate a 16-byte salt / 64-byte scrypt hash for your admin password
ADMIN_HASH=$(node scripts/generate-password-hash.mjs "replace-with-strong-admin-password")
GUEST_SECRET=$(openssl rand -hex 32)
DB_SECRET=$(openssl rand -hex 24)

# Configure required secrets and optional runtime settings in .env
cat <<EOF > .env
DB_USER=wedding
DB_PASSWORD=${DB_SECRET}
DB_NAME=wedding
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

---

## 7. Health Checks

`docker-compose.yml` already configures built-in `healthcheck` probes on both `db` (`pg_isready`) and `app` (`/api/live`)—no manual edits to `docker-compose.yml` are required:

```yaml
  app:
    ports:
      - "127.0.0.1:${PORT:-3000}:3000"
    healthcheck:
      test: ["CMD-SHELL", "node -e \"const h=(process.env.ALLOWED_HOSTS||'localhost').split(',').map((s)=>s.trim().replace(/^\\*\\./,'')).find(Boolean)||'localhost';fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/live',{headers:{Host:h}}).then((res)=>{if(!res.ok)process.exit(1);}).catch(()=>process.exit(1))\""]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 20s
```

Verify live container status with `docker compose ps`. Continuous container liveness checks hit `/api/live` (`{ "status": "alive", "timestamp": "..." }`) so brief PostgreSQL blips do not restart warm containers, while deployment rollout and readiness checks query `/api/health` (returning HTTP `200 OK` when PostgreSQL is connected, or `/api/ready` for unwrapped readiness status):
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

---

## 8. Rollback Strategy

1. **Tag Image Builds Before Updating**: Tag the currently running image (or pull an attested `ghcr.io/fderuiter/wedding_website@sha256:<digest>` release image) prior to upgrading:
   ```bash
   docker tag wedding-website:latest wedding-website:previous
   ```
2. **Networked & Port-Mapped Container Rollback**:
   *   **Via Docker Compose (Recommended — preserves Compose `db` network, `127.0.0.1:${PORT:-3000}:3000` port binding, and healthcheck)**:
       ```bash
       docker tag wedding-website:previous wedding-website:latest
       docker compose up -d --no-deps app
       ```
   *   **Via Standalone `docker run` (Must attach Compose network and publish loopback port)**:
       ```bash
       docker compose stop app
       docker run -d --name app-rollback \
           --network wedding_website_default \
           -p 127.0.0.1:3000:3000 \
           --read-only \
           --cap-drop=ALL \
           --security-opt=no-new-privileges:true \
           --tmpfs /tmp \
           --tmpfs /app/.next/cache:uid=1001,gid=1001,mode=0755 \
           -v wedding_website_uploads_data:/app/public/uploads \
           --env-file .env \
           -e DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}" \
           -e E2E_TEST=false \
           wedding-website:previous
       ```
3. **Database Schema Rollback**: Prisma migrations are forward-only by design. Keep database schema changes backward-compatible (e.g., expand-and-contract pattern) to ensure older container versions can operate alongside migrated schemas.

---

## 9. Webhooks & Scheduled Background Jobs

### Stripe `payment_intent.succeeded` Webhook
1. Set `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` in `.env` (`docker-compose.yml` forwards all three variables directly into `app`).
2. In the **Stripe Dashboard > Developers > Webhooks**, create an endpoint pointing to `https://wedding.mydomain.com/api/registry/webhook/stripe` (ensure `wedding.mydomain.com` is in `ALLOWED_HOSTS`) and subscribe to **`payment_intent.succeeded`**.
3. Ensure Caddy or Nginx forwards the raw request body and `Stripe-Signature` header untouched (default behavior in both reverse proxy configs above). `src/middleware.ts` exempts `/api/registry/webhook/stripe` from session cookies while verifying `ALLOWED_HOSTS`, and the webhook handler validates `stripe-signature` using `STRIPE_WEBHOOK_SECRET`.

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
