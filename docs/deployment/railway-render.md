# Deployment Recipe: Railway & Render (Low-Friction PaaS Targets)

**Support Tier**: Tier 2 — Community Supported PaaS Adapters  
**Target Platforms**: Railway.app and Render.com

---

## Overview

Platform-as-a-Service (PaaS) providers like Railway and Render offer low-friction deployment paths with managed PostgreSQL add-ons, automated Git deployments, and built-in SSL. The application deploys seamlessly to either platform using either native buildpacks or the provided root `Dockerfile`.

---

## 1. Database Provisioning & Connection

### Railway Setup
1. In the Railway Dashboard, create a new Project and select **Provision PostgreSQL**.
2. Railway automatically sets `DATABASE_URL` as a shared environment variable in format:
   ```env
   DATABASE_URL="postgresql://postgres:password@postgres.railway.internal:5432/railway"
   ```

### Render Setup
1. Create a new **New PostgreSQL** database in the Render Dashboard.
2. Copy the **Internal Database URL** (for services running inside Render) or **External Database URL**:
   ```env
   DATABASE_URL="postgres://user:password@dpg-xxxx-a.render.com/wedding_db?ssl=true"
   ```

---

## 2. Required Environment Variables

Set environment variables in the platform dashboard (Railway: **Variables** tab; Render: **Environment** tab):

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | Set to `production`. |
| `DATABASE_URL` | Yes | Connection string for Railway or Render PostgreSQL (`datasource.url` in `prisma.config.ts`, used by runtime and `prisma migrate deploy`). |
| `POSTGRES_URL_NON_POOLING` | No | Shadow database URL (`datasource.shadowDatabaseUrl` in `prisma.config.ts` for `prisma migrate dev`); can also store a direct PostgreSQL URL for an explicit `DATABASE_URL` override when `DATABASE_URL` uses PgBouncer. |
| `ADMIN_PASSWORD` | Yes | Cryptographic password hash (`scrypt:[saltBase64]:[keyBase64]`). |
| `ALLOWED_HOSTS` | Yes | Comma-separated domain whitelist (e.g. `wedding.up.railway.app,wedding.onrender.com,wedding.mydomain.com`). Read-only (`GET` and `HEAD`) probes to `/api/live`, `/api/health`, and `/api/ready` enforce syntactic `Host` validation only, so internal probe hosts like `healthcheck.railway.app` do not need to be listed. |
| `MULTISITE_ENABLED` | No | Enable subdomain-based `AppConfig` branding/profile routing (`false`). Switches `AppConfig` rows only; `prisma/schema.prisma` shares the other 15 tables across subdomains without tenant row isolation. |
| `RUN_MIGRATIONS` | No | Automatically run database migrations on container startup (`false`). |
| `TRUST_PROXY` | No | Set to `1` for single-hop Railway/Render platform ingress (or `2` when fronted by an external CDN/proxy such as Cloudflare; schema default `false`). |
| `GUEST_PASSCODE` | Yes | Unique passcode required for guest access (default `wedding2026` is rejected in production). |
| `GUEST_SESSION_SECRET` | Yes | Dedicated secret for guest invitation session signing (min 32 characters, distinct from `GUEST_PASSCODE`). |
| `HISTORY_VERSION_LIMIT` | No | History retention limit per content entry (default `50`). |
| `CRON_SECRET` | No | Authorization key for background cron triggers. |
| `S3_BUCKET` | No* | Bucket name for S3 / Cloudflare R2 asset storage. |
| `S3_REGION` | No* | Bucket region (`us-east-1` or `auto`). |
| `S3_ACCESS_KEY_ID` | No* | S3 API access key ID. |
| `S3_SECRET_ACCESS_KEY` | No* | S3 API secret access key. |
| `S3_ENDPOINT` | No | Custom S3 endpoint URL (for Cloudflare R2). |
| `S3_PUBLIC_URL` | No | CDN prefix URL for serving uploaded assets. |
| `STRIPE_SECRET_KEY` | No | Server-side Stripe secret key (`sk_...` / `rk_...`), paired with `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` for card checkout. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | No | Client-side Stripe publishable key (`pk_...`), paired with `STRIPE_SECRET_KEY` for card checkout. |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret (`whsec_...`) for `/api/registry/webhook/stripe`. |
| `HOSTNAME` | No | Network interface bound by standalone `server.js` (set `0.0.0.0` when deploying via Railway Nixpacks; preconfigured via `ENV HOSTNAME="0.0.0.0"` in `Dockerfile`). |

*\* Note: On Render, you can alternatively mount a Render Persistent Disk at `/app/public/uploads` for local storage.*

---

## 3. Migration Mechanism

Database migrations run automatically during the pre-deployment phase before new web service code goes live.

### Railway Migration Command
In Railway **Settings > Deploy > Custom Build / Pre-deploy Command**:
```bash
DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING ./node_modules/.bin/prisma migrate deploy
```

### Render Migration Command
In Render **Web Service Settings > Build & Deploy > Pre-Deploy Command**:
```bash
DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING ./node_modules/.bin/prisma migrate deploy
```

*Note: The official `Dockerfile` packages the isolated offline Prisma CLI at `/usr/local/bin/prisma` symlinked at `./node_modules/.bin/prisma` (which also works on native Node.js/Nixpacks buildpacks without `npx` or npm registry traffic). `prisma.config.ts` binds `datasource.url` to `DATABASE_URL` and `datasource.shadowDatabaseUrl` to `POSTGRES_URL_NON_POOLING`. Supplying `DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING` routes `prisma migrate deploy` directly to the unpooled PostgreSQL endpoint when `POSTGRES_URL_NON_POOLING` is set (falling back to `DATABASE_URL` when unset) and unsets `POSTGRES_URL_NON_POOLING` for the migration subprocess so Prisma acquires migration advisory locks without triggering `P3025`.*

---

## 4. Asset Storage

### Option A: Render Persistent Disk (Render Only)
Render allows mounting a persistent disk to preserve uploads without external object storage:
1. In Render Web Service settings, navigate to **Disks**.
2. Click **Add Disk**: Name `wedding-uploads`, Mount Path `/app/public/uploads`, Size `10 GB`.
3. In standalone mode (`server.js`), files written to `/app/public/uploads` are streamed dynamically at `/uploads/*` (`src/app/api/uploads/[...path]/route.ts`, with `X-Content-Type-Options: nosniff`) without restarting the container.

### Option B: S3 / Cloudflare R2 / Google Cloud Storage (Recommended for Railway & Render)
Configure all six S3-compatible environment variables as needed (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, and `S3_PUBLIC_URL`):
*   **Cloudflare R2**: Set `S3_BUCKET`, `S3_REGION=auto`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, and `S3_PUBLIC_URL=https://assets.wedding.mydomain.com` (an R2 Custom Domain or public `https://pub-<id>.r2.dev` URL; private `*.r2.cloudflarestorage.com` endpoints require `S3_PUBLIC_URL`).
*   **Google Cloud Storage (S3 Interoperability)**: Enable Cloud Storage HMAC keys and set `S3_BUCKET`, `S3_REGION=us-central1` (matching your bucket region), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT=https://storage.googleapis.com`, and optional `S3_PUBLIC_URL`.
*   **AWS S3**: Set `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` (with `S3_ENDPOINT` omitted and `S3_PUBLIC_URL` optional for CloudFront).

---

## 5. Custom Domain & TLS

Both Railway and Render provide automatic TLS certificates via Let's Encrypt.

### Railway Domain Setup
1. Navigate to **Settings > Networking > Custom Domains**.
2. Enter your custom domain (e.g., `wedding.mydomain.com`).
3. Point your DNS provider's `CNAME` record to the target assigned by Railway (e.g., `xxxx.up.railway.app`).

### Render Domain Setup
1. Navigate to **Web Service Settings > Custom Domains**.
2. Click **Add Custom Domain** and enter `wedding.mydomain.com`.
3. Configure your DNS provider with the specified `CNAME` or `A` record. SSL is provisioned automatically within minutes.

---

## 6. Build & Deploy Commands

### Railway Deployment (Docker or Nixpacks)
*   **Option A — Docker (Recommended)**: Select **Docker** as the build provider to use the root `Dockerfile`, which installs build-time `devDependencies`, runs `postbuild`, sets `ENV HOSTNAME="0.0.0.0"`, and executes `docker-entrypoint.sh` automatically.
*   **Option B — Nixpacks**: Because `NODE_ENV=production` omits `devDependencies` (`prisma`, `typescript`, `@tailwindcss/postcss`, and `@types/*` in `package.json`) needed by `npm run build` (`prisma generate && next build`), and `npm start` launches `node .next/standalone/server.js`:
    *   **Variables**: Set `HOSTNAME=0.0.0.0` so standalone `server.js` binds to `0.0.0.0` for Railway ingress and healthcheck traffic.
    *   **Build Command**: `npm ci --include=dev && npm run build && npm run postbuild` (installs required build-time `devDependencies` and copies `.next/static` and `public` into `.next/standalone/`).
    *   **Start Command**: `npm start`

### Render Deployment
*   **Environment**: Docker (uses root `Dockerfile`).
*   **Build Command**: Handled by `Dockerfile`.
*   **Start Command**: Handled by `Dockerfile`.

---

## 7. Health Checks

Both platforms support HTTP health check probes for zero-downtime deployment rollouts alongside the container's built-in `/api/live` liveness `HEALTHCHECK`:

*   **Deployment Readiness Path (`/api/health`)**: Verifies PostgreSQL connectivity (`SELECT 1`) and returns HTTP 200 `{ "success": true, "data": { "status": "ok", "database": "connected", ... } }` before routing live user traffic to a newly deployed revision (or use `/api/ready` for unwrapped readiness responses with masked production error messages).
*   **Process Liveness Path (`/api/live`)**: Returns HTTP 200 `{ "status": "alive", "timestamp": "..." }` without querying PostgreSQL. Used by the `Dockerfile` `HEALTHCHECK` and recommended for continuous runtime liveness monitors so brief database blips do not trigger container restart loops.
*   **Railway Configuration**: In **Settings > Healthcheck Path** (deploy-time readiness gate), enter `/api/health`. Railway's internal probe sends `Host: healthcheck.railway.app`, which passes syntactic `Host` validation automatically without adding `healthcheck.railway.app` to `ALLOWED_HOSTS`.
*   **Render Configuration**: In **Web Service Settings > Health Check Path**, enter `/api/live` to prevent runtime restart loops during transient database maintenance (or `/api/health` if gating database connectivity exclusively at deploy time). Render's internal probe requests likewise succeed on `GET` and `HEAD` without extra `ALLOWED_HOSTS` entries.

---

## 8. Rollback Strategy

### Railway Rollback
1. Open the Railway project and navigate to the **Deployments** tab.
2. Select any previous successful deployment commit.
3. Click **Redeploy** to instantly roll back live traffic to that build version.

### Render Rollback
1. In the Render Dashboard, go to **Events** or **Deploys**.
2. Locate the last known good deployment.
3. Click **Rollback** to switch traffic back to the chosen release.

---

## 9. Webhooks & Scheduled Background Jobs

### Stripe `payment_intent.succeeded` Webhook
1. Configure `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` (`whsec_...`) in Railway **Variables** or Render **Environment**.
2. In **Stripe Dashboard > Developers > Webhooks**, register `https://wedding.mydomain.com/api/registry/webhook/stripe` (ensuring the host is included in `ALLOWED_HOSTS`) and subscribe to **`payment_intent.succeeded`**.
3. `src/middleware.ts` exempts `/api/registry/webhook/stripe` from session cookies while checking `ALLOWED_HOSTS`, and the webhook route verifies `stripe-signature` against `STRIPE_WEBHOOK_SECRET`.

### Scheduled Broadcast Cron (`CRON_SECRET`)
1. Set `CRON_SECRET` on the web service in Railway or Render.
2. Trigger `/api/cron/broadcasts` with `Authorization: Bearer <CRON_SECRET>`:
   *   **Railway Cron Service**: Add an lightweight Alpine/curl service with a **Cron Schedule** (`*/5 * * * *`) running `curl -fsS -X POST https://wedding.mydomain.com/api/cron/broadcasts -H "Authorization: Bearer $CRON_SECRET"`.
   *   **Render Cron Job**: Create a **New Cron Job** (`*/5 * * * *`) sharing `CRON_SECRET` and running `curl -fsS -X POST https://wedding.mydomain.com/api/cron/broadcasts -H "Authorization: Bearer $CRON_SECRET"`.

---

## 10. Provider-Specific Limitations

1.  **Railway Ephemeral Disks**: Containers on Railway use ephemeral local filesystems. Local uploads will be wiped on restart unless using external S3/R2 storage.
2.  **Render Free Tier Spin-Down**: Render free web services automatically sleep after 15 minutes of inactivity, causing a 30–50 second cold start delay on the next request. Remedy: Upgrade to a paid instance ($7/mo) for 24/7 uptime.
3.  **Build Timeout**: Render free builds have a 15-minute execution cap; ensure `npm ci` and Next.js builds remain efficient.
