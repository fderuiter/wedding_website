# Deployment Recipe: Generic Docker / VPS (Canonical Portable Baseline)

**Support Tier**: Tier 1 — Officially Tested & Supported Adapter  
**Target Platform**: Any Virtual Private Server (VPS) / Virtual Machine (e.g., Ubuntu, Debian, AWS EC2, DigitalOcean Droplet, Hetzner, Linode) or bare-metal host running Docker & Docker Compose.

---

## Overview

The generic Docker/VPS deployment path serves as the **canonical portable baseline** for the application. It packages the application into a self-contained, multi-platform Docker container (`linux/amd64` and `linux/arm64`) orchestrated by `docker-compose.yml` across three services: `db` (`postgres:15-alpine`), a dedicated one-shot `migration` job (`npx prisma migrate deploy`), and `app` (running with `HOSTNAME="0.0.0.0"`, `RUN_MIGRATIONS="false"`, persistent `uploads_data:/app/public/uploads` volume storage, and a built-in `/api/health` container healthcheck). Standalone `docker run` deployments without Compose can opt into entrypoint migrations by setting `RUN_MIGRATIONS=true` in `docker-entrypoint.sh`.

---

## 1. Database Provisioning & Connection

### Provisioning
You can run PostgreSQL either alongside the application via Docker Compose or connect to an external managed database (such as AWS RDS, DigitalOcean Managed Database, Neon, or Supabase).

*   **Docker Compose Co-location**: Uses the official `postgres:15-alpine` image (`db` service) with persistent volume mounting (`db_data:/var/lib/postgresql/data`) and a `pg_isready` healthcheck. Both `migration` and `app` construct `DATABASE_URL` automatically from `DB_USER`, `DB_PASSWORD`, and `DB_NAME` (`postgres://${DB_USER:-wedding}:${DB_PASSWORD:-wedding123}@db:5432/${DB_NAME:-wedding}`). Note that `docker-compose.yml` publishes `${DB_PORT:-5432}:5432`; on public VPS hosts, firewall port `5432` or restrict `DB_PORT` to loopback (`127.0.0.1:5432`).
*   **External PostgreSQL**: Ensure PostgreSQL v15+ is running and accessible over port `5432` with SSL/TLS enabled if remote, and override `DATABASE_URL` on `migration` and `app` via `docker-compose.override.yml` (see `.env` interpolation limits below).

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
| `ADMIN_PASSWORD` | Yes | — | Cryptographic hash of administrative password in `scrypt:[saltBase64]:[keyBase64]` format. Generate via `node scripts/generate-password-hash.mjs "password"`. |
| `ALLOWED_HOSTS` | Yes | — | Comma-separated list of trusted host domains (e.g., `wedding.mydomain.com,localhost`). |
| `MULTISITE_ENABLED` | No | `false` | Enable subdomain-based `AppConfig` branding/profile routing (`X-Forwarded-Host` checked before `Host`). Switches `AppConfig` rows only; `prisma/schema.prisma` shares the other 14 tables across subdomains without tenant row isolation. |
| `RUN_MIGRATIONS` | No | `false` | Set to `true` to automatically execute `prisma migrate deploy` on container startup in `docker-entrypoint.sh`. |
| `TRUST_PROXY` | No | `false` | Set to `true` (or a positive hop count) when behind Caddy/Nginx so rate limiting trusts `X-Forwarded-For` / `X-Real-IP`. |
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

### Limits on `.env` Interpolation in `docker-compose.yml`
`docker-compose.yml` does **not** set `env_file: .env` on the `app` or `migration` services; Docker Compose only reads `.env` to substitute `${VAR:-default}` expressions declared inside `docker-compose.yml`:
*   **Interpolated from `.env` by `docker-compose.yml`**: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`, `PORT`, `ADMIN_PASSWORD`, `ALLOWED_HOSTS`, `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`, and `E2E_TEST`.
*   **Ignored if placed only in `.env`**:
    1. `DATABASE_URL` in `.env` is ignored because `migration` and `app` explicitly set `DATABASE_URL: postgres://${DB_USER:-wedding}:${DB_PASSWORD:-wedding123}@db:5432/${DB_NAME:-wedding}`.
    2. Optional runtime variables (`TRUST_PROXY`, `MULTISITE_ENABLED`, `HISTORY_VERSION_LIMIT`, `CRON_SECRET`, `S3_*`, `STRIPE_*`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `POSTGRES_URL_NON_POOLING`) are **not** forwarded into `app` unless you declare them in a `docker-compose.override.yml` (via `env_file: .env` or `environment:` mappings).
*   If any secret in `.env` contains a literal `$`, escape it as `$$` for Docker Compose interpolation.

### Production Onboarding & `E2E_TEST=false`
`docker-compose.yml` sets `E2E_TEST: ${E2E_TEST:-true}` on `app` so automated CI container smoke tests bypass initial setup. In `src/lib/config.ts`, `isSiteInitialized()` immediately returns `true` when `E2E_TEST === 'true'`, skipping the `<SetupWizard />` onboarding screen even on an empty database. For real VPS deployments, explicitly set `E2E_TEST=false` in `.env` so initial onboarding runs until couple names and `baseUrl` are configured.

---

## 3. Migration Mechanism

### Primary Path: Dedicated `migration` Service in `docker-compose.yml`
`docker-compose.yml` decouples schema migrations from application container boot:
1. `db` starts `postgres:15-alpine` and waits until its `pg_isready` healthcheck reports `service_healthy`.
2. `migration` runs `npx prisma migrate deploy` (`restart: "no"`) against `DATABASE_URL` (`postgres://${DB_USER:-wedding}:${DB_PASSWORD:-wedding123}@db:5432/${DB_NAME:-wedding}`).
3. `app` sets `RUN_MIGRATIONS: "false"` and waits on `migration` (`condition: service_completed_successfully`) before executing `node server.js`.

To run migrations on demand via Docker Compose:
```bash
docker compose run --rm migration
```
If overriding `DATABASE_URL` to use an external PgBouncer pooler, pass an explicit non-pooled `DATABASE_URL` override to `migration` (`docker compose run --rm -e DATABASE_URL="$POSTGRES_URL_NON_POOLING" migration`).

### Standalone Container Path (`docker-entrypoint.sh`)
When running the image directly via `docker run` without Docker Compose's `migration` service, set `RUN_MIGRATIONS=true` so `docker-entrypoint.sh` validates `DATABASE_URL` and executes `prisma migrate deploy` prior to `node server.js`.

---

## 4. Asset Storage

*   **Local Disk Storage (Default — `uploads_data` Named Volume)**: Uploaded files are written to `/app/public/uploads` and streamed dynamically at `/uploads/*` in standalone mode (`src/app/api/uploads/[...path]/route.ts`, with `X-Content-Type-Options: nosniff`) without needing a container restart. Both `Dockerfile` and `docker-compose.yml` pre-create `/app/public/uploads` owned by `nextjs:nodejs` (UID/GID 1001) and mount the persistent `uploads_data` named volume by default so uploaded photos and branding assets survive `docker compose up -d --build`:
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

Use a reverse proxy such as **Caddy** or **Nginx** with **Let's Encrypt** on the host. Always configure reverse proxies to sanitize and overwrite client IP headers (`X-Real-IP` and `X-Forwarded-For`) to prevent attackers from spoofing their IP address to evade rate limiting.

### Option A: Caddy (Automatic TLS)
Create a `Caddyfile`:
```caddy
wedding.mydomain.com {
    reverse_proxy localhost:3000 {
        # Overwrite/strip untrusted incoming X-Real-IP header with trusted remote client IP
        header_up X-Real-IP {remote_host}
    }
}
```
*Note: Caddy automatically manages `X-Forwarded-For` by appending the client IP. Adding `header_up X-Real-IP {remote_host}` ensures any incoming forged client `X-Real-IP` header is stripped and overwritten before the request reaches the container.*

### Option B: Nginx + Certbot
```nginx
server {
    server_name wedding.mydomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
*Note: Setting `proxy_set_header X-Real-IP $remote_addr;` explicitly overwrites any client-supplied `X-Real-IP` header with the direct connecting IP address `$remote_addr`. Combined with `$proxy_add_x_forwarded_for`, this prevents rate limit evasion via forged proxy headers.*

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

# Configure Compose interpolation variables in .env
cat <<'EOF' > .env
DB_USER=wedding
DB_PASSWORD=replace-with-strong-db-password
DB_NAME=wedding
PORT=3000
ADMIN_PASSWORD=scrypt:c2FsdA==:aGFzaA==
ALLOWED_HOSTS=wedding.mydomain.com,localhost,127.0.0.1
GUEST_PASSCODE=replace-with-unique-guest-passcode
GUEST_SESSION_SECRET=replace-with-random-secret-at-least-32-characters
E2E_TEST=false
EOF

# Optional: create docker-compose.override.yml if forwarding TRUST_PROXY, CRON_SECRET, S3_*, STRIPE_*, or an external DATABASE_URL
cat <<'EOF' > docker-compose.override.yml
services:
  app:
    environment:
      TRUST_PROXY: "true"
      CRON_SECRET: "replace-with-random-cron-secret"
      STRIPE_SECRET_KEY: "sk_live_..."
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_..."
      STRIPE_WEBHOOK_SECRET: "whsec_..."
EOF

# Build images, run the migration service, and start app in detached mode
docker compose up -d --build
```

### Deployment Update
Always rebuild and run both `migration` and `app` so pending Prisma migrations execute before the updated `app` container starts:
```bash
git pull origin main
docker compose up -d --build
```

---

## 7. Health Checks

`docker-compose.yml` already configures built-in `healthcheck` probes on both `db` (`pg_isready`) and `app` (`/api/health`)—no manual edits to `docker-compose.yml` are required:

```yaml
  app:
    ports:
      - "127.0.0.1:${PORT:-3000}:3000"
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/api/health').then((res) => { if (!res.ok) process.exit(1); }).catch(() => process.exit(1))\""]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 20s
```

Verify live container health status with `docker compose ps`. The `/api/health` route tests database connectivity and returns HTTP `200 OK` with payload:
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
           --env-file .env \
           -e DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}" \
           -e E2E_TEST=false \
           wedding-website:previous
       ```
3. **Database Schema Rollback**: Prisma migrations are forward-only by design. Keep database schema changes backward-compatible (e.g., expand-and-contract pattern) to ensure older container versions can operate alongside migrated schemas.

---

## 9. Webhooks & Scheduled Background Jobs

### Stripe `payment_intent.succeeded` Webhook
1. Forward `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` into the `app` service via `docker-compose.override.yml`.
2. In the **Stripe Dashboard > Developers > Webhooks**, create an endpoint pointing to `https://wedding.mydomain.com/api/registry/webhook/stripe` (ensure `wedding.mydomain.com` is in `ALLOWED_HOSTS`) and subscribe to **`payment_intent.succeeded`**.
3. Ensure Caddy or Nginx forwards the raw request body and `Stripe-Signature` header untouched (default behavior in both reverse proxy configs above). `src/middleware.ts` exempts `/api/registry/webhook/stripe` from session cookies while verifying `ALLOWED_HOSTS`, and the webhook handler validates `stripe-signature` using `STRIPE_WEBHOOK_SECRET`.

### Scheduled Broadcast Cron (`CRON_SECRET`)
1. Forward `CRON_SECRET` into `app` via `docker-compose.override.yml`.
2. Add a host `crontab` entry (`crontab -e`) or systemd timer that triggers `/api/cron/broadcasts` every 5 minutes over loopback with an allowed `Host` header and `Authorization: Bearer <CRON_SECRET>`:
   ```cron
   */5 * * * * curl -fsS -X POST http://127.0.0.1:3000/api/cron/broadcasts -H "Host: localhost" -H "Authorization: Bearer replace-with-random-cron-secret" >/dev/null
   ```

---

## 10. Provider-Specific Limitations

*   **Host Dependency**: Requires managing server OS patches, Docker engine updates, and firewall rules (ports 80, 443, 22).
*   **Disk Persistence**: If using local filesystem storage, host backups must include the `uploads_data` Docker volume (or host upload directory) alongside `db_data`.
*   **Single-Node Availability**: Without an external load balancer or swarm/k8s cluster, host maintenance causes brief downtime.
